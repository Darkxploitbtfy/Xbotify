'use strict';
const crypto = require('crypto');

if (!global.crypto) {
  global.crypto = crypto;
}

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

let sock     = null;
let _starting = false;

async function startBot(phoneNumber) {
  if (_starting) {
    console.log('[BOTIFY X] Already starting...');
    return null;
  }

  _starting = true;

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser: ['Mac OS', 'Safari', '10.15.7'],
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000
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
        _starting = false;
      }

      if (connection === 'close') {
        setConnected(false);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('[BOTIFY X] Connection closed. Code:', statusCode);
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[BOTIFY X] Logged out. Delete auth folder and reconnect.');
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

    if (phoneNumber && !state.creds.registered) {
      console.log('[BOTIFY X] Waiting before requesting pairing code...');

      await new Promise(resolve => setTimeout(resolve, 6000));

      const clean = String(phoneNumber).replace(/\D/g, '');
      const code = await sock.requestPairingCode(clean);

      console.log('[BOTIFY X] Pairing code generated:', code);
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
