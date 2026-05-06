'use strict';

const NodeCache = require('node-cache');
const { checkAccess, denyMsg }                          = require('../utils/access');
const { getGroupSettings, addWarning, resetWarnings }   = require('../utils/dataManager');
const { getAdminNumber }                                = require('../utils/botState');

// Command handlers
const antilinkCmd   = require('../commands/antilink');
const anticallCmd   = require('../commands/anticall');
const antideleteCmd = require('../commands/antidelete');
const antieditCmd   = require('../commands/antiedit');
const promoteCmd    = require('../commands/promote');
const demoteCmd     = require('../commands/demote');
const kickCmd       = require('../commands/kick');
const resetlinkCmd  = require('../commands/resetlink');
const welcomeCmd    = require('../commands/welcome');
const goodbyeCmd    = require('../commands/goodbye');
const tagallCmd     = require('../commands/tagall');
const hidetagCmd    = require('../commands/hidetag');
const warnCmd       = require('../commands/warn');
const vvCmd         = require('../commands/vv');
const getppCmd      = require('../commands/getpp');
const pingCmd       = require('../commands/ping');
const modeCmd       = require('../commands/mode');
const stickerCmd    = require('../commands/sticker');
const menuCmd       = require('../commands/menu');
const botstatusCmd  = require('../commands/botstatus');
const statusSaver   = require('../commands/statusSaver');

// In-memory runtime state (resets on restart — by design)
const state = { anticall: false, antidelete: false, antiedit: false };

// Cache for antidelete — stores body of DM messages (TTL 5 min)
const msgCache  = new NodeCache({ stdTTL: 300, checkperiod: 60 });
// Cache for antiedit — stores original body before an edit (TTL 10 min)
const editCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });

// Link detector
const LINK_RE  = /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i;
// Emoji-only detector for secret view-once trigger
const EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\s)+$/u;

// Extract text body from any message type
function extractBody(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId ||
    ''
  );
}

// Strip device suffix (e.g. 447911123456:0 → 447911123456)
function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

async function handleMessages({ session, payload }) {
  const sock     = session.sock;
  const messages = payload.messages || [];

  for (const msg of messages) {
    try {
      if (!msg.message) continue;

      const from = msg.key.remoteJid;
      if (!from) continue;

      const isGroup = from.endsWith('@g.us');
      const sender  = isGroup ? (msg.key.participant || '') : from;
      const body    = extractBody(msg);
      const isCommand = body.startsWith('*');

      // ── fromMe messages ────────────────────────────────────
      // Only two cases are interesting when fromMe=true:
      //   1) The admin typed a * command from their own phone
      //   2) The admin replied to someone's STATUS — capture that status
      if (msg.key.fromMe) {
        // Check if this is a reply to a status (contextInfo.remoteJid === 'status@broadcast')
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        if (ctx?.remoteJid === 'status@broadcast') {
          // Admin replied to a status — save it
          await statusSaver.handle(sock, msg);
        }
        // Skip all other fromMe non-command messages to avoid loops
        if (!isCommand) continue;
      }

      // ── Ignore status@broadcast posts from others ──────────
      // We only save statuses when the admin explicitly replies to them (handled above).
      if (from === 'status@broadcast') continue;

      // ── Secret: emoji-only reply to a view-once → send media to admin ──
      // Triggered when someone (or admin) replies to a view-once message
      // in their "message yourself" chat with only emojis.
      const replyCtx = msg.message?.extendedTextMessage?.contextInfo;
      if (replyCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
        const qm = replyCtx.quotedMessage;
        const isQuotedVO = !!(
          qm.viewOnceMessage ||
          qm.viewOnceMessageV2 ||
          qm.viewOnceMessageV2Extension
        );
        if (isQuotedVO) {
          const adminNum = getAdminNumber();
          if (adminNum) {
            const fakeMsg = {
              key: {
                remoteJid:   from,
                id:          replyCtx.stanzaId || msg.key.id,
                participant: replyCtx.participant || sender,
                fromMe:      false,
              },
              message: qm,
            };
            await vvCmd.handleSecret(sock, fakeMsg, adminNum + '@s.whatsapp.net');
          }
          continue;
        }
      }

      // ── Cache for antidelete & antiedit (DMs only) ─────────
      if (!isGroup && body) {
        if (state.antidelete) msgCache.set(msg.key.id,  { from, body });
        if (state.antiedit)   editCache.set(msg.key.id, body);
      }

      // ── Antilink (group non-command messages) ───────────────
      if (isGroup && sender && !isCommand) {
        const gs = getGroupSettings(from);
        if (gs.antilink && LINK_RE.test(body)) {
          const deleteKey = {
            remoteJid:   from,
            id:          msg.key.id,
            participant: sender,
            fromMe:      false,
          };
          try {
            await sock.sendMessage(from, { delete: deleteKey });
          } catch (delErr) {
            console.error('[Antilink] Delete failed (bot may not be admin):', delErr.message);
          }

          const num   = cleanNum(sender);
          const count = addWarning(from, num);

          if (count >= 5) {
            await sock.sendMessage(from, {
              text: `🚨 @${num} has been *removed* from the group for sending links repeatedly!`,
              mentions: [sender],
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, num);
          } else {
            await sock.sendMessage(from, {
              text: `⛔ @${num}, links are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more warning(s) before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }
      }

      // ── Only process * commands beyond this point ───────────
      if (!isCommand) continue;

      const parts  = body.trim().slice(1).split(/\s+/);
      const cmd    = parts[0].toLowerCase();
      const args   = parts.slice(1);
      const argStr = args.join(' ').trim();

      // For fromMe commands the sender is the bot — map to owner
      const effectiveSender = msg.key.fromMe
        ? (getAdminNumber() + '@s.whatsapp.net')
        : (sender || from);

      // Access gate
      const access = checkAccess(effectiveSender);
      if (!access.allowed) {
        await sock.sendMessage(from, { text: denyMsg(access.reason) });
        continue;
      }

      const ctx = {
        sock, msg, from,
        sender: effectiveSender,
        args, argStr,
        isGroup,
        isAdmin: access.isAdmin,
        state,
      };

      switch (cmd) {
        case 'antilink':           await antilinkCmd.handle(ctx);   break;
        case 'anticall':           await anticallCmd.handle(ctx);   break;
        case 'antidelete':         await antideleteCmd.handle(ctx); break;
        case 'antiedit':           await antieditCmd.handle(ctx);   break;
        case 'promote':            await promoteCmd.handle(ctx);    break;
        case 'demote':             await demoteCmd.handle(ctx);     break;
        case 'kick':               await kickCmd.handle(ctx);       break;
        case 'resetlink':          await resetlinkCmd.handle(ctx);  break;
        case 'welcome':            await welcomeCmd.handle(ctx);    break;
        case 'goodbye':            await goodbyeCmd.handle(ctx);    break;
        case 'tagall':             await tagallCmd.handle(ctx);     break;
        case 'hidetag':            await hidetagCmd.handle(ctx);    break;
        case 'warn':               await warnCmd.handle(ctx);       break;
        case 'vv':                 await vvCmd.handle(ctx);         break;
        case 'getpp':              await getppCmd.handle(ctx);      break;
        case 'ping':               await pingCmd.handle(ctx);       break;
        case 'mode':               await modeCmd.handle(ctx);       break;
        case 'sticker': case 's':  await stickerCmd.handle(ctx);    break;
        case 'menu':               await menuCmd.handle(ctx);       break;
        case 'botstatus':          await botstatusCmd.handle(ctx);  break;
        default: break;
      }
    } catch (e) {
      console.error('[Messages] Uncaught error:', e.message);
    }
  }
}

async function handleMessageDelete(sock, update) {
  if (!state.antidelete) return;
  try {
    for (const key of (update.keys || [])) {
      if (key.remoteJid?.endsWith('@g.us')) continue; // DMs only
      const cached = msgCache.get(key.id);
      if (!cached) continue;
      await sock.sendMessage(cached.from, {
        text: `🗑️ *Deleted Message Detected*\n\n_"${cached.body}"_`,
      });
    }
  } catch (e) { console.error('[AntiDelete]', e.message); }
}

async function handleMessageEdit(sock, updates) {
  if (!state.antiedit) return;
  try {
    for (const { key, update } of updates) {
      if (!update?.message) continue;
      const jid = key.remoteJid;
      if (!jid) continue;
      const original = editCache.get(key.id);
      if (!original) continue;
      const edited =
        update.message?.conversation ||
        update.message?.extendedTextMessage?.text || '';
      if (!edited || edited === original) continue;
      await sock.sendMessage(jid, {
        text: `✏️ *Message Edited*\n\n📌 *Original:*\n_"${original}"_\n\n🔄 *Edited to:*\n_"${edited}"_`,
      });
      editCache.set(key.id, edited);
    }
  } catch (e) { console.error('[AntiEdit]', e.message); }
}

async function handleCall(sock, calls) {
  if (!state.anticall) return;
  for (const call of calls) {
    try {
      if (call.status === 'offer') {
        await sock.rejectCall(call.id, call.from);
        await sock.sendMessage(call.from, {
          text: '📵 *Calls are not allowed!*\nThis bot cannot receive calls. Please send a message instead. 🙏',
        });
      }
    } catch (e) { console.error('[AntiCall]', e.message); }
  }
}

module.exports = { handleMessages, handleMessageDelete, handleMessageEdit, handleCall };
