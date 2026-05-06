'use strict';
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getAdminNumber }       = require('../utils/botState');
const SLOG = { level:'silent', info(){}, error(){}, warn(){}, debug(){}, trace(){}, child(){ return this; } };

async function handle(sock, msg) {
  const admin = getAdminNumber();
  if (!admin) return;
  const adminJid = admin + '@s.whatsapp.net';
  const sender   = msg.pushName || msg.key?.participant || 'Unknown';
  try {
    const text   = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    const isImg  = !!msg.message?.imageMessage;
    const isVid  = !!msg.message?.videoMessage;
    if (isImg || isVid) {
      const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: SLOG });
      if (isImg) await sock.sendMessage(adminJid, { image: buf, caption:`📸 Status saved!\nFrom: ${sender}` });
      else       await sock.sendMessage(adminJid, { video: buf, caption:`🎥 Status saved!\nFrom: ${sender}` });
    } else if (text) {
      await sock.sendMessage(adminJid, { text:`📝 Status saved!\nFrom: ${sender}\n\n${text}` });
    }
  } catch (e) { console.error('[StatusSaver]', e.message); }
}
module.exports = { handle };
