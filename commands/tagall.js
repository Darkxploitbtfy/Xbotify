'use strict';

/**
 * *tagall [message]
 * Tags every member in the group.
 * Available to any session owner — no admin restriction.
 */
async function handle({ sock, from, argStr, isGroup }) {
  if (!isGroup) {
    return sock.sendMessage(from, { text: '❌ *This command only works in groups.*' });
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
