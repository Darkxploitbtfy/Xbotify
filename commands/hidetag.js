'use strict';
async function handle({ sock, from, msg, argStr, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  if (!argStr)  return sock.sendMessage(from, { text: '❌ Usage: *hidetag [message]' });
  try {
    const meta = await sock.groupMetadata(from);
    const members = meta.participants.map(p => p.id);
    await sock.sendMessage(from, { text: argStr, mentions: members });
    await sock.sendMessage(from, { delete: msg.key });
  } catch { await sock.sendMessage(from, { text: '❌ Failed — bot must be admin.' }); }
}
module.exports = { handle };
