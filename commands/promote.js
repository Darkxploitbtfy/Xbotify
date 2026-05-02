'use strict';
async function handle({ sock, from, msg, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0];
  if (!target) return sock.sendMessage(from, { text: '❌ Reply to or @mention a user.\nUsage: *promote' });
  try {
    await sock.groupParticipantsUpdate(from, [target], 'promote');
    await sock.sendMessage(from, { text: `✅ @${target.split('@')[0]} promoted to admin!`, mentions: [target] });
  } catch { await sock.sendMessage(from, { text: '❌ Failed — bot must be admin.' }); }
}
module.exports = { handle };
