'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const SLOG = {
  level: 'silent',
  info()  {}, error() {}, warn()  {}, debug() {}, trace() {},
  child() { return this; },
};

/**
 * Called when the session owner replies to someone's status from their phone.
 *   msg.key.fromMe = true
 *   msg.message.extendedTextMessage.contextInfo.remoteJid = 'status@broadcast'
 *
 * @param {object} sock             - Baileys socket for this session
 * @param {object} msg              - The reply message
 * @param {string} sessionOwnerPhone - Phone number of the person who owns this session.
 *                                    The saved status is sent to their "message yourself".
 */
async function handle(sock, msg, sessionOwnerPhone) {
  if (!sessionOwnerPhone) return;

  // Send to the session owner's own saved-messages chat
  const destJid = sessionOwnerPhone.replace(/\D/g, '') + '@s.whatsapp.net';

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return;

  const quotedMsg = ctx.quotedMessage;
  const sender    = ctx.participant
    ? ctx.participant.split('@')[0].split(':')[0]
    : 'Unknown';
  const replyText = msg.message?.extendedTextMessage?.text || '';

  const isImg  = !!quotedMsg?.imageMessage;
  const isVid  = !!quotedMsg?.videoMessage;
  const isText = !!(quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text);

  try {
    if (isImg || isVid) {
      const fakeMsg = {
        key: {
          remoteJid:   'status@broadcast',
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant,
          fromMe:      false,
        },
        message: quotedMsg,
      };
      const buf     = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      const caption = `📸 *Status Saved!*\n👤 From: *${sender}*${replyText ? `\n💬 Your reply: _${replyText}_` : ''}`;
      if (isImg) await sock.sendMessage(destJid, { image: buf, caption });
      else        await sock.sendMessage(destJid, { video: buf, caption });
    } else if (isText) {
      const text = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text;
      await sock.sendMessage(destJid, {
        text: `📝 *Status Saved!*\n👤 From: *${sender}*\n\n_"${text}"_${replyText ? `\n\n💬 Your reply: _${replyText}_` : ''}`,
      });
    }
  } catch (e) {
    console.error('[StatusSaver]', e.message);
  }
}

module.exports = { handle };
