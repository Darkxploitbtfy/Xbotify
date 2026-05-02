'use strict';
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = { level:'silent', info(){}, error(){}, warn(){}, debug(){}, trace(){}, child(){ return this; } };

async function handle({ sock, from, msg }) {
  const ctx    = msg.message?.extendedTextMessage?.contextInfo;
  const imgMsg = msg.message?.imageMessage || ctx?.quotedMessage?.imageMessage;
  if (!imgMsg) return sock.sendMessage(from, { text: '❌ Reply to an image.\nUsage: *sticker' });
  try {
    let target = msg;
    if (!msg.message?.imageMessage && ctx) {
      target = { key: { ...msg.key, id: ctx.stanzaId, remoteJid: from, participant: ctx.participant }, message: ctx.quotedMessage };
    }
    const buf = await downloadMediaMessage(target, 'buffer', {}, { logger: SLOG });
    await sock.sendMessage(from, { sticker: buf });
  } catch (e) {
    console.error('[Sticker]', e.message);
    await sock.sendMessage(from, { text: '❌ Failed to create sticker.' });
  }
}
module.exports = { handle };
