'use strict';
const { getGroupSettings } = require('../utils/dataManager');

async function handleGroupUpdate(sock, events) {
  for (const ev of events) {
    try {
      const { id: gid, participants, action } = ev;
      const s = getGroupSettings(gid);
      if (action === 'add' && s.welcome) {
        for (const jid of participants) {
          await sock.sendMessage(gid, {
            text: `👋 Welcome @${jid.split('@')[0]} to the group! 🎉`,
            mentions: [jid]
          });
        }
      } else if (action === 'remove' && s.goodbye) {
        for (const jid of participants) {
          await sock.sendMessage(gid, {
            text: `👋 Goodbye @${jid.split('@')[0]}! We'll miss you.`,
            mentions: [jid]
          });
        }
      }
    } catch (e) { console.error('[GroupUpdate]', e.message); }
  }
}

module.exports = { handleGroupUpdate };
