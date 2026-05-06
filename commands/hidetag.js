'use strict';
async function handle({ sock, from, msg, argStr, isGroup, isAdmin }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Admin only.* You must be an admin to use hidetag.' });
  }
  if (!argStr) {
    return sock.sendMessage(from, {
      text: '❌ *No message provided.*\n\n📌 Usage: *hidetag [your message here]'
    });
  }
  try {
    const meta    = await sock.groupMetadata(from);
    const members = meta.participants.map(p => p.id);
    // Send the message tagging everyone silently, then delete the command message
    await sock.sendMessage(from, { text: argStr, mentions: members });
    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
  } catch (e) {
    console.error('[Hidetag]', e.message);
    await sock.sendMessage(from, { text: '❌ *Failed.* Make sure the bot is a group admin.' });
  }
}
module.exports = { handle };
