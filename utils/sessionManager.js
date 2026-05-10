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

// Fetch the WA version with a timeout + hardcoded fallback.
// The network call can hang on Railway when GitHub is unreachable.
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
    // Hardcoded recent version — avoids Railway crashes when GitHub is down
    return [2, 3000, 1023141840];
  }
}

async function startSession({ id, phoneNumber = null, isOwner = false } = {}) {
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
    // ubuntu/Chrome is more compatible with Railway's clock/TLS environment
    // than macOS/Safari and avoids WhatsApp's "problem with your clock" error.
    browser:                        Browsers.ubuntu('Chrome'),
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage:       () => false,
    // Longer timeouts prevent Railway's proxy from terminating mid-handshake.
    connectTimeoutMs:               60_000,
    keepAliveIntervalMs:            30_000,
    msgRetryCounterCache,
    getMessage:                     async () => ({ conversation: '' }),
  });

  // ── Create session object first so the Proxy closure can reference it ─────
  const session = { id, sock, isOwner, phoneNumber, saveCreds, onlineTimer: null };
  sessions.set(id, session);   // ← set early to prevent duplicate sessions

  // ── Load persisted toggles and wrap in a Proxy that auto-saves ─────────────
  // Every assignment to session.state.antidelete / antiedit / anticall /
  // alwaysonline is intercepted and written to data/state-{key}.json so
  // settings survive Railway restarts.
  const stateKey = phoneNumber || id;
  const rawState = {
    anticall: false, antidelete: false, antiedit: false, alwaysonline: false,
    ...loadSessionState(stateKey),
  };

  const sessionState = new Proxy(rawState, {
    set(target, prop, value) {
      target[prop] = value;
      saveSessionState(stateKey, target);
      // Manage the alwaysonline timer here so command files stay simple
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

  // Restore alwaysonline timer immediately if it was on before the last restart
  if (rawState.alwaysonline && !session.onlineTimer) {
    session.onlineTimer = setInterval(() => {
      sock.sendPresenceUpdate('available').catch(() => {});
    }, 15_000);
  }

  sock.ev.on('creds.update', saveCreds);

  // ── Connection events ──────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (session.shuttingDown) {
      if (connection === 'close') sessions.delete(id);
      return;
    }

    if (connection === 'open') {
      logger.info({ id }, 'WhatsApp connection open');
      pendingPairings.delete(id);

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

      // Mark as connected — used by dashboard status endpoint
      botState.setConnected(true);

      try { await handleConnection.onOpen({ session }); }
      catch (err) { logger.error({ err }, 'connection.onOpen failed'); }
    }

    if (connection === 'close') {
      const code      = lastDisconnect?.error?.output?.statusCode
                     || lastDisconnect?.error?.statusCode
                     || 0;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn({ id, code, loggedOut }, 'Connection closed');

      // Mark as disconnected immediately so the dashboard reflects reality
      botState.setConnected(false);

      if (session.onlineTimer) { clearInterval(session.onlineTimer); session.onlineTimer = null; }
      sessions.delete(id);

      if (loggedOut) {
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
        if (!isOwner && phoneNumber) users.markPaired(phoneNumber, false);
        return;
      }

      setTimeout(() => {
        startSession({ id, phoneNumber, isOwner }).catch((err) =>
          logger.error({ err, id }, 'Failed to reconnect session'),
        );
      }, 4000);
    }
  });

  // ── Message events ─────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async (payload) => {
    try { await handleMessages({ session, payload }); }
    catch (err) { logger.error({ err, id }, 'messages.upsert handler failed'); }
  });

  sock.ev.on('messages.delete', async (update) => {
    try { await handleMessageDelete(sock, update, session.state); }
    catch (err) { logger.error({ err, id }, 'messages.delete handler failed'); }
  });

  sock.ev.on('messages.update', async (updates) => {
    try { await handleMessageEdit(sock, updates, session.state); }
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

  // ── Request pairing code for new unregistered sessions ────────────────────
  if (!sock.authState.creds.registered && phoneNumber) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const code   = await sock.requestPairingCode(phoneNumber);
      const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
      pendingPairings.set(id, { code: pretty, createdAt: Date.now(), phone: phoneNumber });
      logger.info({ id }, 'Pairing code generated');
      session.pairingCode = pretty;
      return session;
    } catch (err) {
      logger.error({ err, id }, 'Failed to request pairing code');
      throw err;
    }
  }

  return session;
}

// ── Owner pairing (synchronous — waits for the code) ──────────────────────────
async function requestOwnerPairing(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');

  const existing = sessions.get(OWNER_ID);
  if (existing?.sock?.user) return { alreadyConnected: true, phone: number };
  if (existing) {
    existing.shuttingDown = true;
    try { existing.sock.end(undefined); } catch (_) {}
    sessions.delete(OWNER_ID);
  }

  const authDir = authPathFor(OWNER_ID);
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });

  config.owner.set(number);
  const session = await startSession({ id: OWNER_ID, phoneNumber: number, isOwner: true });
  return {
    phone:       number,
    pairingCode: session.pairingCode || pendingPairings.get(OWNER_ID)?.code || null,
  };
}

// ── User pairing (non-blocking — background) ───────────────────────────────────
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
  if (session.onlineTimer) { clearInterval(session.onlineTimer); session.onlineTimer = null; }
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
