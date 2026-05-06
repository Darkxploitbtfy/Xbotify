'use strict';

const { setConnected } = require('../utils/botState');

const CONNECT_MSG = `━━━━━━━━━━━━━━━
BOTIFY X v1.0.3
━━━━━━━━━━━━━━━

✅ Connected successfully
⚡ System online
🔐 Secure session active`;

async function onOpen({ session }) {
  const { sock } = session;
  setConnected(true);
  console.log('[BOTIFY X] ✅ WhatsApp connected!');
  const admin = process.env.OWNER_NUMBER || process.env.ADMIN_NUMBER;
  if (admin) {
    const jid = admin.replace(/\D/g, '') + '@s.whatsapp.net';
    setTimeout(() => sock.sendMessage(jid, { text: CONNECT_MSG }).catch(() => {}), 3000);
  }
}

module.exports = { onOpen };
