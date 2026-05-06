'use strict';

const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const config = require('./config');
const logger = require('./logger');
const users = require('./users');
const handleMessages = require('../events/messages');
const handleGroupParticipants = require('../events/groupParticipants');
const handleConnection = require('../events/connection');

const OWNER_ID = 'owner';
const sessions = new Map();
const pendingPairings = new Map();

function authPathFor(id) {
  return path.resolve(config.paths.auth, id);
}

function getSession(id) {
  return sessions.get(id) || null;
}

function listSessions() {
  return Array.from(sessions.entries()).map(([id, s]) => ({
    id,
    connected: !!s.sock?.user,
    user: s.sock?.user || null,
    isOwner: !!s.isOwner,
  }));
}

async function startSession({ id, phoneNumber = null, isOwner = false } = {}) {
  if (!id) throw new Error('Session id is required');

  if (sessions.has(id)) {
    return sessions.get(id);
  }

  const authDir = authPathFor(id);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS('Safari'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
  });

  const session = { id, sock, isOwner, phoneNumber, saveCreds };
  sessions.set(id, session);

  sock.ev.on('creds.update', saveCreds);

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
        if (num && !process.env.OWNER_NUMBER) {
          try {
            config.owner.set(num);
          } catch (err) {
            logger.warn({ err }, 'Could not persist owner number');
          }
        }
      }
      if (!isOwner && phoneNumber) {
        users.markPaired(phoneNumber, true);
      }
      try {
        await handleConnection.onOpen({ session });
      } catch (err) {
        logger.error({ err }, 'connection.onOpen failed');
      }
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.warn({ id, code, loggedOut }, 'Connection closed');

      sessions.delete(id);

      if (loggedOut) {
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (_) {}
        if (!isOwner && phoneNumber) {
          users.markPaired(phoneNumber, false);
        }
        return;
      }

      setTimeout(() => {
        startSession({ id, phoneNumber, isOwner }).catch((err) =>
          logger.error({ err, id }, 'Failed to reconnect session'),
        );
      }, 3000);
    }
  });

  sock.ev.on('messages.upsert', async (payload) => {
    try {
      await handleMessages({ session, payload });
    } catch (err) {
      logger.error({ err, id }, 'messages.upsert handler failed');
    }
  });

  sock.ev.on('group-participants.update', async (payload) => {
    try {
      await handleGroupParticipants({ session, payload });
    } catch (err) {
      logger.error({ err, id }, 'group-participants handler failed');
    }
  });

  if (!sock.authState.creds.registered && phoneNumber) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const code = await sock.requestPairingCode(phoneNumber);
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

async function requestOwnerPairing(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');

  const existing = sessions.get(OWNER_ID);
  if (existing?.sock?.user) {
    return { alreadyConnected: true, phone: number };
  }
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
    phone: number,
    pairingCode: session.pairingCode || pendingPairings.get(OWNER_ID)?.code || null,
  };
}

async function requestPairingCodeFor(phoneNumber) {
  const number = String(phoneNumber || '').replace(/\D/g, '');
  if (!number) throw new Error('Invalid phone number');

  const id = `user-${number}`;

  if (sessions.has(id)) {
    const existing = sessions.get(id);
    if (existing.sock?.user) {
      return { id, alreadyConnected: true };
    }
    existing.shuttingDown = true;
    try { existing.sock.end(undefined); } catch (_) {}
    sessions.delete(id);
  }

  const authDir = authPathFor(id);
  if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });

  const session = await startSession({ id, phoneNumber: number, isOwner: false });
  return {
    id,
    pairingCode: session.pairingCode || pendingPairings.get(id)?.code || null,
  };
}

async function shutdownSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    await session.sock.logout();
  } catch (_) {}
  sessions.delete(id);
  return true;
}

function ownerSession() {
  return sessions.get(OWNER_ID) || null;
}

function ownerStatus() {
  const s = ownerSession();
  return {
    phone: config.owner.number || null,
    connected: !!s?.sock?.user,
    pairing: pendingPairings.get(OWNER_ID) || null,
    fromEnv: !!process.env.OWNER_NUMBER,
  };
}

function restoreExistingSessions() {
  const root = path.resolve(config.paths.auth);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const tasks = [];
  for (const e of entries) {
    const id = e.name;
    if (id === OWNER_ID) {
      tasks.push(
        startSession({ id, phoneNumber: null, isOwner: true }).catch((err) =>
          logger.error({ err, id }, 'Failed to restore owner session'),
        ),
      );
      continue;
    }
    const phone = id.startsWith('user-') ? id.slice(5) : null;
    tasks.push(
      startSession({ id, phoneNumber: phone, isOwner: false }).catch((err) =>
        logger.error({ err, id }, 'Failed to restore session'),
      ),
    );
  }
  return tasks;
}

module.exports = {
  startSession,
  requestPairingCodeFor,
  requestOwnerPairing,
  shutdownSession,
  getSession,
  listSessions,
  ownerSession,
  ownerStatus,
  restoreExistingSessions,
  pendingPairings,
};
