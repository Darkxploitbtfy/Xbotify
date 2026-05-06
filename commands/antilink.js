'use strict';
const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');

async function handle({ sock, from, args, isGroup, isAdmin }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }
  if (!isAdmin) {
    return sock.sendMessage(from, { text: '🔒 *Admin only.* You must be an admin to use this command.' });
  }
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'on') {
    updateGroupSettings(from, { antilink: true });
    return sock.sendMessage(from, {
      text: `🔗 *Antilink Enabled!* ✅\n\nAny links shared in this group will be:\n• 🗑️ Automatically deleted\n• ⚠️ User warned (5 warnings = kick)\n\nMake sure the bot is a group admin for deletion to work.`
    });
  }
  if (sub === 'off') {
    updateGroupSettings(from, { antilink: false });
    return sock.sendMessage(from, {
      text: `🔗 *Antilink Disabled.* ❌\n\nLinks are now allowed in this group.`
    });
  }
  const cur = getGroupSettings(from).antilink;
  return sock.sendMessage(from, {
    text: `🔗 *Antilink Status:* ${cur ? '✅ ON' : '❌ OFF'}\n\n📌 Usage:\n*antilink on — Enable\n*antilink off — Disable`
  });
}

module.exports = { handle };
