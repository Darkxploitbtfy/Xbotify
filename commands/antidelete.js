'use strict';
async function handle({ sock, from, args, isAdmin, state }) {
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Owner only.* Only the bot owner can toggle antidelete.' });
  }
  if (from.endsWith('@g.us')) {
    return sock.sendMessage(from, { text: '📩 *Antidelete only works in private (DM) chats.*' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    state.antidelete = true;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Enabled!* ✅\n\nDeleted messages in your DMs will be revealed and sent back to you automatically.`
    });
  }
  if (sub === 'off') {
    state.antidelete = false;
    return sock.sendMessage(from, {
      text: `🗑️ *Antidelete Disabled.* ❌\n\nDeleted messages will no longer be tracked.`
    });
  }
  return sock.sendMessage(from, {
    text: `🗑️ *Antidelete Status:* ${state.antidelete ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*antidelete on — Enable\n*antidelete off — Disable`
  });
}
module.exports = { handle };
