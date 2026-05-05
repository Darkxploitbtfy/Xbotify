'use strict';

const crypto = require('crypto');
if (!global.crypto) global.crypto = crypto;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs   = require('fs');

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
    // 🔥 FORCE CLEAN SESSION (fix connection closed)
    if (fs.existsSync(AUTH_DIR)) {
      console.log('[BOTIFY X] Clearing old session...');
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser: ['Ubuntu', 'Chrome', '110.0.0'], // 🔥 stable fingerprint
      printQRInTerminal: false
    });

    setSocket(sock);

    sock.ev.on('creds.update', saveCreds);

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

        const code = lastDisconnect?.error?.output?.statusCode;
        console.log('[BOTIFY X] Connection closed:', code);

        if (code === DisconnectReason.loggedOut) {
          console.log('[BOTIFY X] Logged out. Will need re-pair.');
        }
      }
    });

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

    // 🔥 PAIRING (IMMEDIATE + CLEAN)
    if (phoneNumber && !state.creds.registered) {
      console.log('[BOTIFY X] Generating pairing code...');

      const clean = String(phoneNumber).replace(/\D/g, '');

      const code = await sock.requestPairingCode(clean);

      console.log('[BOTIFY X] Pairing code:', code);

      _starting = false;
      return code;
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
