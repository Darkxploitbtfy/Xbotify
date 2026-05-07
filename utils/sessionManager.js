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

const config = require('./config');
const logger = require('./logger');
const users  = require('./users');
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

// Stores async pairing results for user sessions.
// Key = phone (string), Value = { code, error, done, alreadyConnected }
const pairingQueue = new Map();

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

// Fetch the latest WA version with an 8-second timeout and a hardcoded fallback.
// On Railway, GitHub fetches can hang indefinitely — without this guard the bot
// becomes completely unresponsive whenever a new session tries to start.
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
    // Known stable version for @whiskeysockets/baileys 6.7.x
    return [2, 3000, 1015920];
  }
}

async function startSession({ id, phoneNumber = null, isOwner = false } = {}) {
  if (!id) throw new Error('Session id is required');
  if (sessions.has(id)) return sessions.get(id);

  const authDir = authPathFor(id);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version              = await fetchVersion();

  // Per-session retry counter cache — fixes "Waiting for this message"
  const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser:                        Browsers.macOS('Safari'),
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
    // Prevent history sync from hanging the "Syncing, keep app open" screen.
    shouldSyncHistoryMessage:       () => false,
    msgRetryCounterCache,
    // Prevents "Waiting for this message" on linked devices.
    getMessage: async () => ({ conversation: '' }),
  });

  // Per-session feature toggles.  Each linked user controls their own bot.
  const sessionState = { anticall: false, antidelete: false, antiedit: false };

  const session = { id, sock, isOwner, phoneNumber, saveCreds, state: sessionState };
  sessions.set(id, session);

  sock.ev.on('creds.update', saveCreds);

  // ── Connection state ──────────────────────────────────────────────
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

      try { await handleConnection.onOpen({ session }); }
      catch (err) { logger.error({ err }, 'connection.onOpen failed'); }
    }

    if (connection === 'close') {
      // Extract status code without requiring @hapi/boom —
      // Baileys errors already carry `.output.statusCode`.
      const code      = lastDisconnect?.error?.output?.statusCode
                     || lastDisconnect?.error?.statusCode
                     || 0;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn({ id, code, loggedOut }, 'Connection closed');
      sessions.delete(id);

      if (loggedOut) {
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
        if (!isOwner && phoneNumber) users.markPaired(phoneNumber, false);
        return;
      }

      // Reconnect after a short delay.
      // startSession guards against duplicate sessions via sessions.has(id).
      setTimeout(() => {
        startSession({ id, phoneNumber, isOwner }).catch((err) =>
          logger.error({ err, id }, 'Failed to reconnect session'),
        );
      }, 4000);
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────
  sock.ev.on('messages.upsert', async (payload) => {
    try { await handleMessages({ session, payload }); }
    catch (err) { logger.error({ err, id }, 'messages.upsert handler failed'); }
  });

  // ── Deleted messages (antidelete) ─────────────────────────────────
  sock.ev.on('messages.delete', async (update) => {
    try { await handleMessageDelete(sock, update, session.state); }
    catch (err) { logger.error({ err, id }, 'messages.delete handler failed'); }
  });

  // ── Edited messages (antiedit) ────────────────────────────────────
  sock.ev.on('messages.update', async (updates) => {
    try { await handleMessageEdit(sock, updates, session.state); }
    catch (err) { logger.error({ err, id }, 'messages.update handler failed'); }
  });

  // ── Calls (anticall) ──────────────────────────────────────────────
  sock.ev.on('call', async (calls) => {
    try { await handleCall(sock, calls, session.state); }
    catch (err) { logger.error({ err, id }, 'call handler failed'); }
  });

  // ── Group member events ───────────────────────────────────────────
  sock.ev.on('group-participants.update', async (payload) => {
    try { await handleGroupParticipants({ session, payload }); }
    catch (err) { logger.error({ err, id }, 'group-participants handler failed'); }
  });

  // ── Request pairing code for new sessions ─────────────────────────
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

// ── Owner pairing (synchronous — owner is assumed to be present at panel) ────
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

// ── User pairing — NON-BLOCKING ───────────────────────────────────────────────
// Starts the session creation in the background and returns immediately.
// The caller should poll getPairingResult(phone) to check progress.
function requestPairingCodeFor(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');
  const id = `user-${number}`;

  // Clear any stale result from a previous attempt
  pairingQueue.delete(number);

  // Start async — explicitly NOT awaited so the HTTP route returns instantly
  _startUserSession(id, number).catch((err) => {
    logger.error({ err, id }, 'User session background start failed');
    if (!pairingQueue.has(number)) {
      pairingQueue.set(number, { error: err.message || 'Unknown error', done: true });
    }
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

    if (code) {
      pairingQueue.set(number, { code, done: true });
    } else if (session.sock?.user) {
      pairingQueue.set(number, { alreadyConnected: true, done: true });
    } else {
      pairingQueue.set(number, { error: 'No pairing code generated — please try again.', done: true });
    }
  } catch (e) {
    pairingQueue.set(number, { error: e.message || 'Unknown error', done: true });
  }
}

// Called by the dashboard to poll for a pending pairing code result.
function getPairingResult(phone) {
  const number = String(phone || '').replace(/\D/g, '');
  return pairingQueue.get(number) || null;
}

// Called after the result has been consumed by the frontend.
function clearPairingResult(phone) {
  const number = String(phone || '').replace(/\D/g, '');
  pairingQueue.delete(number);
}

async function shutdownSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
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
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
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
