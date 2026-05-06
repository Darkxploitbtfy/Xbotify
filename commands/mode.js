'use strict';
const { setBotMode, getBotMode } = require('../utils/dataManager');

async function handle({ sock, from, args, isAdmin }) {
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Owner only.* Only the bot owner can change the bot mode.' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'public') {
    setBotMode('public');
    return sock.sendMessage(from, {
      text: `🌍 *Bot Mode: PUBLIC* ✅\n\nAll users with access can now use bot commands. 🤖`
    });
  }
  if (sub === 'private') {
    setBotMode('private');
    return sock.sendMessage(from, {
      text: `🔒 *Bot Mode: PRIVATE* ✅\n\nOnly the bot owner can use commands now.`
    });
  }
  const cur = getBotMode();
  return sock.sendMessage(from, {
    text: `⚙️ *Bot Mode:* ${cur === 'public' ? '🌍 PUBLIC' : '🔒 PRIVATE'}\n\n📌 Usage:\n*mode public — Open to all users\n*mode private — Owner only`
  });
}
module.exports = { handle };
