'use strict';

const fs   = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const NodeCache = require('node-cache');

const config       = require('./config');
const logger       = require('./logger');
const users        = require('./users');
const botState     = require('./botState');
const { loadSessionState, saveSessionState } = require('./dataManager');
const {
  handleMessages,
  handleMessageDelete,
  handleMessageEdit,
  handleCall,
} = require('../events/messages');
const { handleGroupParticipants } = require('../events/groupParticipants');
const handleConnection             = require('../events/connection');

const OWNER_ID        = 'owner';
const sessions        = new Map();
const pendingPairings = new Map();
const pairingQueue    = new Map();

const qrCodes        = new Map();
const reconnectDelays = new Map();

function authPathFor(id) {
  return path.resolve(config.paths.auth, id);
}

function getSession(id)  { return sessions.get(id) || null; }

function listSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    connected: !!s.sock?.user,
    user:      s.sock?.user || null,
    isOwner:   !!s.isOwner,
  }));
}

// Fetch WA version with timeout + hardcoded fallback for Railway
async function fetchVersion() {
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('version fetch timeout')), 8000),
      ),
    ]);
    return result.version;
  } catch {
    return [2, 3000, 1023141840];
  }
}

function _scheduleReconnect({ id, phoneNumber, isOwner, useQR }, delayOverride) {
  const prev      = reconnectDelays.get(id) || 0;
  const nextDelay = delayOverride !== undefined
    ? delayOverride
    : (prev === 0 ? 4_000 : Math.min(prev * 2, 120_000));
  reconnectDelays.set(id, nextDelay);

  logger.warn({ id, nextDelay }, 'Scheduling reconnect');

  const attempt = () => {
    startSession({ id, phoneNumber, isOwner, useQR })
      .then(() => {})
      .catch((err) => {
        logger.error({ err, id }, 'Reconnect attempt failed — will retry');
        const d = Math.min((reconnectDelays.get(id) || 4_000) * 2, 120_000);
        reconnectDelays.set(id, d);
        setTimeout(attempt, d);
      });
  };

  setTimeout(attempt, nextDelay);
}

async function startSession({ id, phoneNumber = null, isOwner = false, useQR = false } = {}) {
  if (!id) throw new Error('Session id is required');
  if (sessions.has(id)) return sessions.get(id);

  const authDir = authPathFor(id);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version              = await fetchVersion();
  const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, logger),
    },
    // Use a stable browser fingerprint to minimize "out of sync" errors
    browser:                        Browsers.ubuntu('Chrome'),
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
    // Prevent Baileys from requesting full history on reconnect
    shouldSyncHistoryMessage:       () => false,
    connectTimeoutMs:               60_000,
    keepAliveIntervalMs:            20_000,
    retryRequestDelayMs:            3_000,
    // Stable getMessage prevents "out of sync" by returning a safe default
    // instead of failing with undefined when Baileys can't find a cached message
    getMessage: async (key) => {
      return { conversation: '' };
    },
    msgRetryCounterCache,
    // Avoid aggressive re-syncing that can trigger "device out of sync"
    maxMsgRetryCount:   3,
    fireInitQueries:    true,
  });

  const session = {
    id,
    sock,
    isOwner,
    phoneNumber,
    saveCreds,
    onlineTimer:  null,
    connectedAt:  0,
    shuttingDown: false,
    useQR,
    pairingCode:  null,
  };
  sessions.set(id, session);

  const stateKey = phoneNumber || id;
  const rawState = {
    anticall: false, antidelete: false, antiedit: false, alwaysonline: false,
    ...loadSessionState(stateKey),
  };

  const sessionState = new Proxy(rawState, {
    set(target, prop, value) {
      target[prop] = value;
      saveSessionState(stateKey, target);
      if (prop === 'alwaysonline') {
        if (value && !session.onlineTimer) {
          session.onlineTimer = setInterval(() => {
            sock.sendPresenceUpdate('available').catch(() => {});
          }, 15_000);
        } else if (!value && session.onlineTimer) {
          clearInterval(session.onlineTimer);
          session.onlineTimer = null;
        }
      }
      return true;
    },
  });

  session.state = sessionState;

  if (rawState.alwaysonline && !session.onlineTimer) {
    session.onlineTimer = setInterval(() => {
      sock.sendPresenceUpdate('available').catch(() => {});
    }, 15_000);
  }

  sock.ev.on('creds.update', saveCreds);

  // ── Connection events ──────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodes.set(id, { qr, updatedAt: Date.now() });
      logger.info({ id }, 'QR code updated');
    }

    if (session.shuttingDown) {
      if (connection === 'close') {
        sessions.delete(id);
        qrCodes.delete(id);
      }
      return;
    }

    if (connection === 'open') {
      logger.info({ id }, 'WhatsApp connection open');
      pendingPairings.delete(id);
      qrCodes.delete(id);

      session.connectedAt = Date.now();
      reconnectDelays.delete(id);

      if (isOwner) {
        const num = sock.user?.id?.split(':')[0]?.split('@')[0]?.replace(/\D/g, '');
        if (num) {
          try { config.owner.set(num); } catch (err) {
            logger.warn({ err }, 'Could not persist owner number');
          }
          session.phoneNumber = num;
        }
      }

      if (!isOwner && phoneNumber) users.markPaired(phoneNumber, true);

      botState.setConnected(true);

      try { await handleConnection.onOpen({ session }); }
      catch (err) { logger.error({ err }, 'connection.onOpen failed'); }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                      || lastDisconnect?.error?.statusCode
                      || 0;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;

      // 428 = conflict/connection replaced by another device — don't reconnect
      const replaced   = statusCode === 428;

      // 515 = restart required — reconnect quickly with minimal delay
      const restartNeeded = statusCode === DisconnectReason.restartRequired || statusCode === 515;

      logger.warn({ id, statusCode, loggedOut, replaced, restartNeeded }, 'Connection closed');

      botState.setConnected(false);
      qrCodes.delete(id);

      if (session.onlineTimer) { clearInterval(session.onlineTimer); session.onlineTimer = null; }
      sessions.delete(id);

      if (loggedOut) {
        reconnectDelays.delete(id);
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
        if (!isOwner && phoneNumber) users.markPaired(phoneNumber, false);
        return;
      }

      if (replaced) {
        logger.warn({ id }, 'Session replaced by another device — not reconnecting');
        return;
      }

      // Restart-required: reconnect almost immediately
      _scheduleReconnect({ id, phoneNumber, isOwner, useQR }, restartNeeded ? 1_000 : undefined);
    }
  });

  // ── Message events ─────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async (payload) => {
    try { await handleMessages({ session, payload }); }
    catch (err) { logger.error({ err, id }, 'messages.upsert handler failed'); }
  });

  sock.ev.on('messages.delete', async (update) => {
    try { await handleMessageDelete(sock, update, session.state, session); }
    catch (err) { logger.error({ err, id }, 'messages.delete handler failed'); }
  });

  sock.ev.on('messages.update', async (updates) => {
    try { await handleMessageEdit(sock, updates, session.state, session); }
    catch (err) { logger.error({ err, id }, 'messages.update handler failed'); }
  });

  sock.ev.on('call', async (calls) => {
    try { await handleCall(sock, calls, session.state); }
    catch (err) { logger.error({ err, id }, 'call handler failed'); }
  });

  sock.ev.on('group-participants.update', async (payload) => {
    try { await handleGroupParticipants({ session, payload }); }
    catch (err) { logger.error({ err, id }, 'group-participants handler failed'); }
  });

  // ── Request pairing code (phone mode) ─────────────────────────────────────
  if (!sock.authState.creds.registered && phoneNumber && !useQR) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const code   = await sock.requestPairingCode(phoneNumber);
      const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
      pendingPairings.set(id, { code: pretty, createdAt: Date.now(), phone: phoneNumber });
      logger.info({ id }, 'Pairing code generated');
      session.pairingCode = pretty;
      return session;
    } catch (err) {
      logger.error({ err, id }, 'Failed to request pairing code');
      sessions.delete(id);
      throw err;
    }
  }

  return session;
}

// ── Owner pairing — phone/code ─────────────────────────────────────────────────
async function requestOwnerPairing(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');

  const existing = sessions.get(OWNER_ID);
  if (existing?.sock?.user) return { alreadyConnected: true, phone: number };
  if (existing) {
    existing.shuttingDown = true;
    try { existing.sock.end(undefined); } catch (_) {}
    sessions.delete(OWNER_ID);
    qrCodes.delete(OWNER_ID);
  }

  const authDir = authPathFor(OWNER_ID);
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });

  config.owner.set(number);
  const session = await startSession({ id: OWNER_ID, phoneNumber: number, isOwner: true, useQR: false });
  return {
    phone:       number,
    pairingCode: session.pairingCode || pendingPairings.get(OWNER_ID)?.code || null,
  };
}

// ── Owner pairing — QR ────────────────────────────────────────────────────────
async function requestOwnerQR() {
  const existing = sessions.get(OWNER_ID);
  if (existing?.sock?.user) return { alreadyConnected: true };
  if (existing) {
    existing.shuttingDown = true;
    try { existing.sock.end(undefined); } catch (_) {}
    sessions.delete(OWNER_ID);
    qrCodes.delete(OWNER_ID);
  }

  const authDir = authPathFor(OWNER_ID);
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });

  startSession({ id: OWNER_ID, phoneNumber: null, isOwner: true, useQR: true })
    .catch((err) => logger.error({ err }, 'QR owner session start failed'));

  return { pending: true };
}

function getSessionQR(id) {
  return qrCodes.get(id) || null;
}

function requestUserQR(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');
  const id = `user-${number}`;
  qrCodes.delete(id);
  _startUserQRSession(id, number).catch((err) => {
    logger.error({ err, id }, 'User QR session background start failed');
  });
  return { id, pending: true };
}

async function _startUserQRSession(id, number) {
  try {
    if (sessions.has(id)) {
      const existing = sessions.get(id);
      if (existing.sock?.user) return;
      existing.shuttingDown = true;
      try { existing.sock.end(undefined); } catch (_) {}
      sessions.delete(id);
      qrCodes.delete(id);
    }
    const authDir = authPathFor(id);
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    await startSession({ id, phoneNumber: number, isOwner: false, useQR: true });
  } catch (e) {
    logger.error({ err: e, id }, 'User QR session failed');
  }
}

function requestPairingCodeFor(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');
  const id = `user-${number}`;
  pairingQueue.delete(number);
  _startUserSession(id, number).catch((err) => {
    logger.error({ err, id }, 'User session background start failed');
    if (!pairingQueue.has(number))
      pairingQueue.set(number, { error: err.message || 'Unknown error', done: true });
  });
  return { id, pending: true };
}

async function _startUserSession(id, number) {
  try {
    if (sessions.has(id)) {
      const existing = sessions.get(id);
      if (existing.sock?.user) {
        pairingQueue.set(number, { alreadyConnected: true, done: true });
        return;
      }
      existing.shuttingDown = true;
      try { existing.sock.end(undefined); } catch (_) {}
      sessions.delete(id);
    }
    const authDir = authPathFor(id);
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    const session = await startSession({ id, phoneNumber: number, isOwner: false });
    const code    = session.pairingCode || pendingPairings.get(id)?.code || null;
    if (code)                    pairingQueue.set(number, { code, done: true });
    else if (session.sock?.user) pairingQueue.set(number, { alreadyConnected: true, done: true });
    else                         pairingQueue.set(number, { error: 'No pairing code generated — please try again.', done: true });
  } catch (e) {
    pairingQueue.set(number, { error: e.message || 'Unknown error', done: true });
  }
}

function getPairingResult(phone) {
  return pairingQueue.get(String(phone || '').replace(/\D/g, '')) || null;
}
function clearPairingResult(phone) {
  pairingQueue.delete(String(phone || '').replace(/\D/g, ''));
}

async function shutdownSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  session.shuttingDown = true;
  if (session.onlineTimer) { clearInterval(session.onlineTimer); session.onlineTimer = null; }
  reconnectDelays.delete(id);
  qrCodes.delete(id);
  try { await session.sock.logout(); } catch (_) {}
  sessions.delete(id);
  return true;
}

function ownerSession() { return sessions.get(OWNER_ID) || null; }

function ownerStatus() {
  const s = ownerSession();
  return {
    phone:     config.owner.number || null,
    connected: !!s?.sock?.user,
    pairing:   pendingPairings.get(OWNER_ID) || null,
    fromEnv:   !!process.env.OWNER_NUMBER,
  };
}

function restoreExistingSessions() {
  const root = path.resolve(config.paths.auth);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory());
  const tasks   = [];
  for (const e of entries) {
    const sid   = e.name;
    const phone = sid.startsWith('user-')
      ? sid.slice(5)
      : (config.owner.number || process.env.OWNER_NUMBER || null);
    tasks.push(
      startSession({ id: sid, phoneNumber: phone, isOwner: sid === OWNER_ID }).catch((err) =>
        logger.error({ err, id: sid }, 'Failed to restore session'),
      ),
    );
  }
  return tasks;
}

module.exports = {
  startSession,
  requestPairingCodeFor,
  requestOwnerPairing,
  requestOwnerQR,
  requestUserQR,
  getSessionQR,
  getPairingResult,
  clearPairingResult,
  shutdownSession,
  getSession,
  listSessions,
  ownerSession,
  ownerStatus,
  restoreExistingSessions,
  pendingPairings,
};
