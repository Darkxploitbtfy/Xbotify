'use strict';
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getAdminNumber }       = require('../utils/botState');
const SLOG = { level:'silent', info(){}, error(){}, warn(){}, debug(){}, trace(){}, child(){ return this; } };

/**
 * Called for every status@broadcast message.
 * We ONLY save a status when the paired user REPLIES to it.
 * A reply-to-status has contextInfo.quotedMessage containing the original status.
 */
async function handle(sock, msg) {
  // A reply-to-status always carries contextInfo with quotedMessage
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return; // Not a reply — ignore

  const admin = getAdminNumber();
  if (!admin) return;

  const adminJid  = admin + '@s.whatsapp.net';
  const sender    = msg.pushName || ctx.participant?.split('@')[0] || 'Unknown';
  const replyText = msg.message?.extendedTextMessage?.text || '';

  // The original status is the quoted message
  const quotedMsg = ctx.quotedMessage;
  const isImg = !!quotedMsg?.imageMessage;
  const isVid = !!quotedMsg?.videoMessage;
  const text   = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text;

  try {
    if (isImg || isVid) {
      // Build a fake message object so downloadMediaMessage can fetch the media
      const fakeMsg = {
        key: {
          remoteJid:   'status@broadcast',
          id:          ctx.stanzaId || msg.key.id,
          participant: ctx.participant || msg.key.participant,
          fromMe:      false,
        },
        message: quotedMsg,
      };
      const buf = await downloadMediaMessage(fakeMsg, 'buffer', {}, { logger: SLOG });
      const caption = `📸 *Status Saved!*\n👤 From: *${sender}*${replyText ? `\n💬 Your reply: _${replyText}_` : ''}`;
      if (isImg) await sock.sendMessage(adminJid, { image: buf, caption });
      else        await sock.sendMessage(adminJid, { video: buf, caption });
    } else if (text) {
      await sock.sendMessage(adminJid, {
        text: `📝 *Status Saved!*\n👤 From: *${sender}*\n\n_"${text}"_${replyText ? `\n\n💬 Your reply: _${replyText}_` : ''}`
      });
    }
  } catch (e) { console.error('[StatusSaver]', e.message); }
}

module.exports = { handle };
