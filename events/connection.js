'use strict';

const { setConnected }        = require('../utils/botState');
const { getSessionOwnerMode } = require('../utils/dataManager');

async function onOpen({ session }) {
  const { sock } = session;
  setConnected(true);
  console.log('[BOTIFY X] ✅ WhatsApp connected!');

  const phone = session.phoneNumber
    || process.env.OWNER_NUMBER
    || process.env.ADMIN_NUMBER
    || '';

  if (!phone) return;

  const jid     = phone.replace(/\D/g, '') + '@s.whatsapp.net';
  const mode    = getSessionOwnerMode(phone);
  const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';

  const msg = `┏━━─『 BOTIFY-X 』─━━
┃ » *Username*: not set
┃ » *Platform*: pairing portal
┃ » *Prefix*: [ * ]
┃ » *Mode*: ${modeStr}
┃ » *Version*: [ v1.1.4 ]
┗━━━━━━━━━━━━─···`;

  setTimeout(() => sock.sendMessage(jid, { text: msg }).catch(() => {}), 3000);
}

module.exports = { onOpen };
