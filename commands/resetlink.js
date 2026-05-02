'use strict';
async function handle({ sock, from, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  try {
    const code = await sock.groupRevokeInvite(from);
    await sock.sendMessage(from, { text: `🔗 Group link reset!\nhttps://chat.whatsapp.com/${code}` });
  } catch { await sock.sendMessage(from, { text: '❌ Failed — bot must be admin.' }); }
}
module.exports = { handle };
