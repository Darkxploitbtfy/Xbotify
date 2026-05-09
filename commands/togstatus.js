'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info() {}, error() {}, warn() {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * *togstatus — reply to any message (text/image/video) in the group to post
 * it as your WhatsApp status (story).
 */
async function handle({ sock, from, msg }) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) {
    return sock.sendMessage(from, {
      text: '❌ *Reply to a message (text, image, or video) to post it as your status.*\n\n📌 Usage: *togstatus',
    });
  }

  const qm     = ctx.quotedMessage;
  const isImg  = !!qm.imageMessage;
  const isVid  = !!qm.videoMessage;
  const isText = !!(qm.conversation || qm.extendedTextMessage?.text);

  try {
    if (isImg || isVid) {
      const fakeMsg = {
        key: {
          remoteJid:   from,
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant,
          fromMe:      false,
        },
        message: qm,
      };
      const buf     = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      const caption = qm.imageMessage?.caption || qm.videoMessage?.caption || '';
      if (isImg) {
        await sock.sendMessage('status@broadcast', { image: buf, caption });
      } else {
        await sock.sendMessage('status@broadcast', { video: buf, caption });
      }
    } else if (isText) {
      const text = qm.conversation || qm.extendedTextMessage?.text;
      await sock.sendMessage('status@broadcast', { text });
    } else {
      return sock.sendMessage(from, {
        text: '❌ Unsupported message type. Only text, images, and videos can be posted as status.',
      });
    }

    await sock.sendMessage(from, {
      text: '✅ *Posted to your WhatsApp status!*',
    });
  } catch (e) {
    console.error('[TogStatus]', e.message);
    await sock.sendMessage(from, { text: '❌ Failed to post status. Please try again.' });
  }
}

module.exports = { handle };
