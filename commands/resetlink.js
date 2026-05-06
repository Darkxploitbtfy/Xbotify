'use strict';
async function handle({ sock, from, isGroup, isAdmin }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Admin only.* You must be an admin to reset the group link.' });
  }
  try {
    const code = await sock.groupRevokeInvite(from);
    await sock.sendMessage(from, {
      text: `🔗 *Group Invite Link Reset!* ✅\n\nOld link has been *revoked*. New link:\nhttps://chat.whatsapp.com/${code}`
    });
  } catch {
    await sock.sendMessage(from, {
      text: '❌ *Failed to reset link.* Make sure the bot is a group admin and try again.'
    });
  }
}
module.exports = { handle };
