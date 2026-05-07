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
const resetwarnCmd  = require('../commands/resetwarn');
const vvCmd         = require('../commands/vv');
const getppCmd      = require('../commands/getpp');
const pingCmd       = require('../commands/ping');
const modeCmd       = require('../commands/mode');
const stickerCmd    = require('../commands/sticker');
const menuCmd       = require('../commands/menu');
const botstatusCmd  = require('../commands/botstatus');
const statusSaver   = require('../commands/statusSaver');

// Shared caches — message IDs are globally unique so no cross-session conflicts
// antidelete: stores { from, body } per message id (TTL 5 min)
const msgCache  = new NodeCache({ stdTTL: 300,  checkperiod: 60 });
// antiedit: stores original body per message id (TTL 10 min)
const editCache = new NodeCache({ stdTTL: 600,  checkperiod: 60 });

// Detectors
const LINK_RE  = /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i;
// Emoji-only: covers all emoji presentation forms, ZWJ sequences, and variation selectors
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;

// Extract text body from any message type
function extractBody(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation                                               ||
    m.extendedTextMessage?.text                                  ||
    m.imageMessage?.caption                                      ||
    m.videoMessage?.caption                                      ||
    m.documentMessage?.caption                                   ||
    m.buttonsResponseMessage?.selectedButtonId                   ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId      ||
    m.templateButtonReplyMessage?.selectedId                     ||
    ''
  );
}

function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

// Build a fake Baileys message suitable for downloadMediaMessage from a view-once
// quotedMessage container.
function fakeVoMsg(key, qm) {
  const inner =
    qm.viewOnceMessage?.message          ||
    qm.viewOnceMessageV2?.message        ||
    qm.viewOnceMessageV2Extension?.message;
  if (!inner) return null;
  return { key, message: inner };
}

async function handleMessages({ session, payload }) {
  // ── Only process real-time new messages ────────────────────────────
  // 'append' = history sync on startup — we must never reprocess old messages.
  if (payload.type !== 'notify') return;

  const sock     = session.sock;
  const messages = payload.messages || [];

  // Per-session state lives on the session object (set by sessionManager.js).
  // Falls back to a safe default so nothing crashes if state is missing.
  const state = session.state || { anticall: false, antidelete: false, antiedit: false };

  // Phone of whoever linked this session (owner or a paid user).
  const sessionOwnerPhone = session.phoneNumber || getAdminNumber();

  for (const msg of messages) {
    try {
      if (!msg.message) continue;

      const from    = msg.key.remoteJid;
      if (!from) continue;

      const isGroup   = from.endsWith('@g.us');
      const sender    = isGroup ? (msg.key.participant || '') : from;
      const body      = extractBody(msg);
      const isCommand = body.startsWith('*');

      // ── fromMe messages (session owner typed this on their phone) ──
      if (msg.key.fromMe) {
        const fmCtx = msg.message?.extendedTextMessage?.contextInfo;

        // A) Session owner replied to someone's status → save it
        if (fmCtx?.remoteJid === 'status@broadcast') {
          await statusSaver.handle(sock, msg, sessionOwnerPhone);
        }

        // B) Session owner replied to a view-once with only emojis → reveal it
        //    THIS MUST BE BEFORE the `if (!isCommand) continue` skip.
        if (!isCommand && fmCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
          const qm   = fmCtx.quotedMessage;
          const isVO = !!(qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension);
          if (isVO) {
            const fake = fakeVoMsg(
              { remoteJid: from, id: fmCtx.stanzaId || msg.key.id, participant: null, fromMe: false },
              qm,
            );
            if (fake) await vvCmd.handleSecret(sock, fake, sessionOwnerPhone + '@s.whatsapp.net');
            continue;
          }
        }

        // Skip all other non-command fromMe messages to prevent loops
        if (!isCommand) continue;
      }

      // ── Ignore other people's status posts ────────────────────────
      if (from === 'status@broadcast') continue;

      // ── Secret view-once: non-fromMe emoji reply ───────────────────
      // Someone in the session owner's group/DM replies to a view-once
      // with only emojis → send the media to the session owner's saved-messages.
      const replyCtx = msg.message?.extendedTextMessage?.contextInfo;
      if (!isCommand && replyCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
        const qm   = replyCtx.quotedMessage;
        const isVO = !!(qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension);
        if (isVO) {
          const fake = fakeVoMsg(
            { remoteJid: from, id: replyCtx.stanzaId || msg.key.id, participant: sender, fromMe: false },
            qm,
          );
          if (fake) await vvCmd.handleSecret(sock, fake, sessionOwnerPhone + '@s.whatsapp.net');
          continue;
        }
      }

      // ── Cache for antidelete & antiedit ────────────────────────────
      // Cache ALL chats (DMs and groups) so deletions are caught everywhere.
      if (body && state.antidelete) {
        msgCache.set(msg.key.id, { from, body, sender: cleanNum(sender || from) });
      }
      if (body && state.antiedit) {
        editCache.set(msg.key.id, body);
      }

      // ── Antilink (group, non-command messages) ─────────────────────
      if (isGroup && sender && !isCommand) {
        const gs = getGroupSettings(from);
        if (gs.antilink && LINK_RE.test(body)) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, id: msg.key.id, participant: sender, fromMe: false },
            });
          } catch (e) { console.error('[Antilink] Delete failed:', e.message); }

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

      // ── Only process * commands beyond this point ──────────────────
      if (!isCommand) continue;

      // ── Resolve effective sender ───────────────────────────────────
      // fromMe:true means the session owner typed this on their own phone.
      // Use session.phoneNumber — NOT always the global admin — so each
      // linked user is correctly identified as their session's owner.
      const effectiveSender = msg.key.fromMe
        ? (sessionOwnerPhone + '@s.whatsapp.net')
        : (sender || from);

      // ── Access gate ────────────────────────────────────────────────
      const access = checkAccess(effectiveSender, sessionOwnerPhone);
      if (!access.allowed) {
        await sock.sendMessage(from, { text: denyMsg(access.reason) });
        continue;
      }

      const parts  = body.trim().slice(1).split(/\s+/);
      const cmd    = parts[0].toLowerCase();
      const args   = parts.slice(1);
      const argStr = args.join(' ').trim();

      const ctx = {
        sock, msg, from,
        sender: effectiveSender,
        args, argStr,
        isGroup,
        isAdmin: access.isAdmin,
        sessionOwnerPhone,
        state,  // per-session state passed to commands
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
        case 'resetwarn':          await resetwarnCmd.handle(ctx);  break;
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

// ── handleMessageDelete ─────────────────────────────────────────────
// Called from sessionManager with the per-session state.
async function handleMessageDelete(sock, update, state) {
  if (!state?.antidelete) return;
  try {
    for (const key of (update.keys || [])) {
      const cached = msgCache.get(key.id);
      if (!cached) continue;
      await sock.sendMessage(cached.from, {
        text: `🗑️ *Deleted Message Detected*\n\n_"${cached.body}"_`,
      });
      msgCache.del(key.id);
    }
  } catch (e) { console.error('[AntiDelete]', e.message); }
}

// ── handleMessageEdit ───────────────────────────────────────────────
async function handleMessageEdit(sock, updates, state) {
  if (!state?.antiedit) return;
  try {
    for (const { key, update } of updates) {
      if (!update?.message) continue;
      const jid      = key.remoteJid;
      if (!jid) continue;
      const original = editCache.get(key.id);
      if (!original) continue;
      const edited   =
        update.message?.conversation              ||
        update.message?.extendedTextMessage?.text || '';
      if (!edited || edited === original) continue;
      await sock.sendMessage(jid, {
        text: `✏️ *Message Edited*\n\n📌 *Original:*\n_"${original}"_\n\n🔄 *Edited to:*\n_"${edited}"_`,
      });
      editCache.set(key.id, edited);
    }
  } catch (e) { console.error('[AntiEdit]', e.message); }
}

// ── handleCall ──────────────────────────────────────────────────────
async function handleCall(sock, calls, state) {
  if (!state?.anticall) return;
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
