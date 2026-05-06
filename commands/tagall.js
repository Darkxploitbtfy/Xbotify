'use strict';
async function handle({ sock, from, argStr, isGroup, isAdmin }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Admin only.* You must be an admin to tag everyone.' });
  }
  try {
    const meta    = await sock.groupMetadata(from);
    const members = meta.participants.map(p => p.id);
    const header  = argStr ? `📣 *${argStr}*\n\n` : `📣 *Attention everyone!*\n\n`;
    const tags    = members.map(m => `@${m.split('@')[0]}`).join(' ');
    await sock.sendMessage(from, { text: header + tags, mentions: members });
  } catch (e) {
    console.error('[Tagall]', e.message);
    await sock.sendMessage(from, { text: '❌ *Failed.* Make sure the bot is a group admin.' });
  }
}
module.exports = { handle };
