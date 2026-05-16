'use strict';

const { getGroupMsgCounts } = require('../utils/dataManager');

async function handle({ sock, from, isGroup, sessionMsgCounts }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
  }

  // Prefer in-memory counts from the current session (accurate, real-time).
  // They reset on bot restart so numbers reflect activity since last connect.
  // Fall back to persistent file-based counts when no in-memory data exists yet.
  const memCounts = sessionMsgCounts?.get(from);

  let entries;
  if (memCounts && memCounts.size > 0) {
    entries = Array.from(memCounts.entries()); // [phone, count]
  } else {
    const persisted = getGroupMsgCounts(from);
    entries = Object.entries(persisted);
  }

  if (entries.length === 0) {
    return sock.sendMessage(from, {
      text: `📊 *Active Members*\n\nNo messages recorded yet in this session.\nSend some messages in the group first!`,
    });
  }

  // Sort by count descending
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 20);

  const medals = ['🥇', '🥈', '🥉'];
  const lines  = top.map(([phone, count], i) => {
    const rank = medals[i] || `${String(i + 1).padStart(2, ' ')}.`;
    const bar  = '█'.repeat(Math.min(Math.round(count / Math.max(top[0][1], 1) * 8), 8));
    return `${rank} *+${phone}*\n    ${bar} ${count} msg${count === 1 ? '' : 's'}`;
  });

  const source = memCounts && memCounts.size > 0 ? '_Since last bot start_' : '_All-time data_';

  await sock.sendMessage(from, {
    text: `📊 *Most Active Members*\n${source}\n\n${lines.join('\n\n')}\n\n_Showing top ${top.length} of ${entries.length} active member(s)_`,
  });
}

module.exports = { handle };
