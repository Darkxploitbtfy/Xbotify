'use strict';
async function handle({ sock, from, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  try {
    const meta = await sock.groupMetadata(from);
    const members = meta.participants.map(p => p.id);
    const text = members.map(m => `@${m.split('@')[0]}`).join(' ');
    await sock.sendMessage(from, { text: `📣 Tagging everyone:\n${text}`, mentions: members });
  } catch { await sock.sendMessage(from, { text: '❌ Failed.' }); }
}
module.exports = { handle };
