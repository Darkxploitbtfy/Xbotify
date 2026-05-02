'use strict';
const { addWarning, resetWarnings } = require('../utils/dataManager');
async function handle({ sock, from, msg, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) return sock.sendMessage(from, { text: '❌ Reply to or @mention a user.\nUsage: *warn' });
  const phone = target.split('@')[0];
  const count = addWarning(from, phone);
  if (count >= 5) {
    await sock.sendMessage(from, { text: `⚠️ @${phone} reached 5 warnings and will be removed!`, mentions: [target] });
    try { await sock.groupParticipantsUpdate(from, [target], 'remove'); } catch {}
    resetWarnings(from, phone);
  } else {
    await sock.sendMessage(from, { text: `⚠️ Warning ${count}/5 for @${phone}. ${5-count} left before kick.`, mentions: [target] });
  }
}
module.exports = { handle };
