'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getAdminNumber }       = require('../utils/botState');
const SLOG = { level: 'silent', info() {}, error() {}, warn() {}, debug() {}, trace() {}, child() { return this; } };

/**
 * Called when the admin (owner) REPLIES to someone's status from their phone.
 * WhatsApp sends this reply as a fromMe=true DM to the status poster's JID.
 * The original status content lives in contextInfo.quotedMessage.
 * contextInfo.remoteJid === 'status@broadcast' confirms it's a status reply.
 */
async function handle(sock, msg) {
  const admin = getAdminNumber();
  if (!admin) return;

  const adminJid = admin + '@s.whatsapp.net';

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
      // Build a fake message pointing at the original status so Baileys can download it
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
      if (isImg) await sock.sendMessage(adminJid, { image: buf, caption });
      else        await sock.sendMessage(adminJid, { video: buf, caption });
    } else if (isText) {
      const text = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text;
      await sock.sendMessage(adminJid, {
        text: `📝 *Status Saved!*\n👤 From: *${sender}*\n\n_"${text}"_${replyText ? `\n\n💬 Your reply: _${replyText}_` : ''}`,
      });
    }
  } catch (e) {
    console.error('[StatusSaver]', e.message);
  }
}

module.exports = { handle };
