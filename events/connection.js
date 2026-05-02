'use strict';
const { setConnected } = require('../utils/botState');

const CONNECT_MSG = `━━━━━━━━━━━━━━━
BOTIFY X v1.0.3
━━━━━━━━━━━━━━━

✅ Connected successfully
⚡ System online
🔐 Secure session active`;

function handleConnection(update, sock, restart) {
  const { connection, lastDisconnect } = update;
  if (connection === 'open') {
    setConnected(true);
    console.log('[BOTIFY X] ✅ WhatsApp connected!');
    const admin = process.env.ADMIN_NUMBER;
    if (admin) {
      const jid = admin.replace(/\D/g,'') + '@s.whatsapp.net';
      setTimeout(() => sock.sendMessage(jid, { text: CONNECT_MSG }).catch(() => {}), 3000);
    }
  } else if (connection === 'close') {
    setConnected(false);
    const code = lastDisconnect?.error?.output?.statusCode;
    console.log('[BOTIFY X] Connection closed. Status code:', code);
    if (code !== 401 && code !== 403) {
      console.log('[BOTIFY X] Reconnecting in 5s...');
      setTimeout(restart, 5000);
    } else {
      console.log('[BOTIFY X] Session ended. Re-pair from the panel.');
    }
  }
}

module.exports = { handleConnection };
