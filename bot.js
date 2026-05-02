'use strict';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs   = require('fs');

const { handleConnection }                              = require('./events/connection');
const { handleMessages, handleMessageDelete, handleCall } = require('./events/messages');
const { handleGroupUpdate }                             = require('./events/groupUpdate');
const { setSocket, setConnected }                       = require('./utils/botState');

// Store auth in /app/auth on Railway (same as __dirname/auth locally)
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'auth');

let _starting = false;

async function startBot(phoneNumber) {
  if (_starting) return null;
  _starting = true;

  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser:                    Browsers.macOS('Safari'),
      printQRInTerminal:          false,
      generateHighQualityLinkPreview: false,
      syncFullHistory:            false,
      markOnlineOnConnect:        true,
      connectTimeoutMs:           60000,
      keepAliveIntervalMs:        25000,
      retryRequestDelayMs:        2000
    });

    setSocket(sock);
    _starting = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', update => {
      handleConnection(update, sock, () => { _starting = false; startBot(phoneNumber); });
      if (update.connection === 'open')  setConnected(true);
      if (update.connection === 'close') setConnected(false);
    });

    sock.ev.on('messages.upsert', ({ messages }) => handleMessages(sock, { messages }));
    sock.ev.on('messages.delete', u => handleMessageDelete(sock, u));
    sock.ev.on('group-participants.update', ({ id, participants, action }) =>
      handleGroupUpdate(sock, [{ id, participants, action }])
    );
    sock.ev.on('call', calls => handleCall(sock, calls));

    // Generate pairing code if not yet registered
    if (phoneNumber && !state.creds.registered) {
      await new Promise(r => setTimeout(r, 3000));
      const code = await sock.requestPairingCode(phoneNumber);
      console.log('[BOTIFY X] Pairing code issued.');
      return code;
    }

    return null;
  } catch (e) {
    _starting = false;
    throw e;
  }
}

module.exports = { startBot };
