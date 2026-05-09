'use strict';

const { getGroupMsgCounts } = require('../utils/dataManager');

async function handle({ sock, from, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  const counts = getGroupMsgCounts(from);
  const entries = Object.entries(counts);

  if (entries.length === 0) {
    return sock.sendMessage(from, {
      text: `📊 *Active Members*\n\nNo message data yet. Send some messages first!`,
    });
  }

  // Sort by count descending
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 20);

  const medals = ['🥇', '🥈', '🥉'];
  const lines  = top.map(([phone, count], i) => {
    const rank = medals[i] || `${i + 1}.`;
    return `${rank} *+${phone}* — ${count} message${count === 1 ? '' : 's'}`;
  });

  await sock.sendMessage(from, {
    text: `📊 *Most Active Members*\n\n${lines.join('\n')}\n\n_Top ${top.length} of ${entries.length} active member(s)_`,
  });
}

module.exports = { handle };
