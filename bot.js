'use strict';
const crypto = require('crypto');

if (!global.crypto) {
  global.crypto = crypto;
}
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs   = require('fs');

const { handleConnection } = require('./events/connection');
const { handleMessages, handleMessageDelete, handleCall } = require('./events/messages');
const { handleGroupUpdate } = require('./events/groupUpdate');
const { setSocket, setConnected } = require('./utils/botState');

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth');

let sock = null;
let _starting = false;

async function startBot(phoneNumber) {
  if (_starting) {
    console.log('[BOTIFY X] Already starting...');
    return null;
  }

  _starting = true;

  try {
    // ensure auth folder exists
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger)
  },
  logger,
  browser: ['Mac OS', 'Safari', '10.15.7'], // 🔥 FIX
  printQRInTerminal: false,
  syncFullHistory: false,
  markOnlineOnConnect: false
});

    setSocket(sock);

    // save session
    sock.ev.on('creds.update', saveCreds);

    // connection updates
    sock.ev.on('connection.update', (update) => {
  const { connection, lastDisconnect } = update;

  if (connection === 'connecting') {
    console.log('[BOTIFY X] Connecting...');
  }

  if (connection === 'open') {
    console.log('[BOTIFY X] Connected successfully!');
    setConnected(true);
  }

  if (connection === 'close') {
    setConnected(false);

    const reason = lastDisconnect?.error?.output?.statusCode;

    console.log('[BOTIFY X] Connection closed:', reason);

    if (reason === 401) {
      console.log('[BOTIFY X] Logged out. Delete auth folder and reconnect.');
    } else {
      console.log('[BOTIFY X] Connection ended. Waiting...');
    }
  }
});

    // message handlers
    sock.ev.on('messages.upsert', ({ messages }) => {
      handleMessages(sock, { messages });
    });

    sock.ev.on('messages.delete', (u) => {
      handleMessageDelete(sock, u);
    });

    sock.ev.on('group-participants.update', ({ id, participants, action }) => {
      handleGroupUpdate(sock, [{ id, participants, action }]);
    });

    sock.ev.on('call', (calls) => {
      handleCall(sock, calls);
    });

    // 🔥 PAIRING (FIXED)
    if (phoneNumber && !state.creds.registered) {
  console.log('[BOTIFY X] Preparing pairing...');

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const code = await sock.requestPairingCode(phoneNumber);

    console.log('[BOTIFY X] Pairing code:', code);

    _starting = false;
    return code;

  } catch (err) {
    console.error('[REAL ERROR]', err); // 👈 FULL ERROR

    _starting = false;
    throw err; // 👈 DON'T HIDE IT
  }
    }

    _starting = false;
    return null;

  } catch (err) {
    console.error('[BOTIFY X ERROR]', err);
    _starting = false;
    throw err;
  }
}

module.exports = { startBot };
