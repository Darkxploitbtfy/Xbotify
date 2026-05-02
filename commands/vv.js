'use strict';
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = { level:'silent', info(){}, error(){}, warn(){}, debug(){}, trace(){}, child(){ return this; } };

async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return sock.sendMessage(from, { text: '❌ Reply to a view-once message.' });
  const qm = ctx.quotedMessage;
  const inner =
    qm.viewOnceMessage?.message ||
    qm.viewOnceMessageV2?.message ||
    qm.viewOnceMessageV2Extension?.message || qm;
  const isImg = !!inner.imageMessage, isVid = !!inner.videoMessage;
  if (!isImg && !isVid) return sock.sendMessage(from, { text: '❌ No view-once media found.' });
  try {
    const fake = { key:{ ...msg.key, id:ctx.stanzaId, remoteJid:from, participant:ctx.participant }, message: inner };
    const buf  = await downloadMediaMessage(fake, 'buffer', {}, { logger: SLOG });
    if (isImg) await sock.sendMessage(from, { image: buf, caption:'👁️ View-once revealed by BOTIFY X' });
    else       await sock.sendMessage(from, { video: buf, caption:'👁️ View-once revealed by BOTIFY X' });
  } catch (e) {
    console.error('[VV]', e.message);
    await sock.sendMessage(from, { text: '❌ Could not reveal — media may have expired.' });
  }
}

async function handleSecret(sock, msg, adminJid) {
  if (!adminJid) return;
  const inner =
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message?.viewOnceMessageV2Extension?.message;
  if (!inner) return;
  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: SLOG });
    if (inner.imageMessage) await sock.sendMessage(adminJid, { image: buf, caption:'🔕 *Secret view-once saved*' });
    else if (inner.videoMessage) await sock.sendMessage(adminJid, { video: buf, caption:'🔕 *Secret view-once saved*' });
  } catch (e) { console.error('[VV Secret]', e.message); }
}
module.exports = { handle, handleSecret };
