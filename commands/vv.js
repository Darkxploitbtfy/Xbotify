'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

// Unwrap a view-once container to get the inner image/video message
function unwrapVO(msgContent) {
  return (
    msgContent?.viewOnceMessage?.message          ||
    msgContent?.viewOnceMessageV2?.message        ||
    msgContent?.viewOnceMessageV2Extension?.message
  );
}

/**
 * *vv — manually reveal a view-once by replying to it with this command
 */
async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, { text: '❌ *Reply to a view-once message to reveal it.*' });
  }

  const qm    = ctx.quotedMessage;
  const inner = unwrapVO(qm) || qm;  // fall back to raw if already unwrapped

  const isImg = !!inner.imageMessage;
  const isVid = !!inner.videoMessage;
  if (!isImg && !isVid) {
    return sock.sendMessage(from, { text: '❌ No view-once media found in the quoted message.' });
  }

  try {
    const fake = {
      key:     { ...msg.key, id: ctx.stanzaId, remoteJid: from, participant: ctx.participant },
      message: inner,
    };
    const buf = await downloadMediaMessage(fake, 'buffer', {}, { logger: SLOG });
    if (isImg) await sock.sendMessage(from, { image: buf, caption: '👁️ View-once revealed by BOTIFY X' });
    else        await sock.sendMessage(from, { video: buf, caption: '👁️ View-once revealed by BOTIFY X' });
  } catch (e) {
    console.error('[VV]', e.message);
    await sock.sendMessage(from, { text: '❌ Could not reveal — media may have expired.' });
  }
}

/**
 * handleSecret — called automatically when anyone replies to a view-once
 * with only emojis.  The already-unwrapped inner message is passed directly
 * (messages.js calls fakeVoMsg() before calling us).
 *
 * @param {object} sock    - Baileys socket for this session
 * @param {object} msg     - fake message with key + message = inner content
 * @param {string} destJid - where to send the saved media (session owner's JID)
 */
async function handleSecret(sock, msg, destJid) {
  if (!destJid) return;

  const inner = msg.message;
  if (!inner) return;

  const isImg = !!inner.imageMessage;
  const isVid = !!inner.videoMessage;
  if (!isImg && !isVid) return;

  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: SLOG });
    if (isImg) await sock.sendMessage(destJid, { image: buf, caption: '🔕 *Secret view-once saved*' });
    else        await sock.sendMessage(destJid, { video: buf, caption: '🔕 *Secret view-once saved*' });
  } catch (e) {
    console.error('[VV Secret]', e.message);
  }
}

module.exports = { handle, handleSecret };
