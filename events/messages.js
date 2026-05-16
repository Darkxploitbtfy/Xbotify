'use strict';

const NodeCache = require('node-cache');
const { checkAccess, denyMsg }     = require('../utils/access');
const { getGroupSettings, addWarning, resetWarnings, addMsgCount } = require('../utils/dataManager');
const { getAdminNumber }           = require('../utils/botState');

// ── Command handlers ───────────────────────────────────────────────────────────
const antilinkCmd         = require('../commands/antilink');
const anticallCmd         = require('../commands/anticall');
const antideleteCmd       = require('../commands/antidelete');
const antieditCmd         = require('../commands/antiedit');
const antigroupmentionCmd = require('../commands/antigroupmention');
const approveCmd          = require('../commands/approve');
const approveallCmd       = require('../commands/approveall');
const disapproveallCmd    = require('../commands/disapproveall');
const closeCmd            = require('../commands/close');
const closetimeCmd        = require('../commands/closetime');
const openCmd             = require('../commands/open');
const opentimeCmd         = require('../commands/opentime');
const listactiveCmd       = require('../commands/listactive');
const togstatusCmd        = require('../commands/togstatus');
const blockCmd            = require('../commands/block');
const unblockCmd          = require('../commands/unblock');
const listblockedCmd      = require('../commands/listblocked');
const deleteCmd           = require('../commands/delete');
const alwaysonlineCmd     = require('../commands/alwaysonline');
const helpersCmd          = require('../commands/helpers');
const promoteCmd          = require('../commands/promote');
const demoteCmd           = require('../commands/demote');
const kickCmd             = require('../commands/kick');
const resetlinkCmd        = require('../commands/resetlink');
const welcomeCmd          = require('../commands/welcome');
const goodbyeCmd          = require('../commands/goodbye');
const tagallCmd           = require('../commands/tagall');
const hidetagCmd          = require('../commands/hidetag');
const warnCmd             = require('../commands/warn');
const resetwarnCmd        = require('../commands/resetwarn');
const vvCmd               = require('../commands/vv');
const getppCmd            = require('../commands/getpp');
const pingCmd             = require('../commands/ping');
const modeCmd             = require('../commands/mode');
const stickerCmd          = require('../commands/sticker');
const menuCmd             = require('../commands/menu');
const botstatusCmd        = require('../commands/botstatus');
const statusSaver         = require('../commands/statusSaver');

// ── Caches ─────────────────────────────────────────────────────────────────────
const msgCache  = new NodeCache({ stdTTL: 300,  checkperiod: 60 });
const editCache = new NodeCache({ stdTTL: 600,  checkperiod: 60 });

// ── Global deduplication across all sessions ───────────────────────────────────
// Prevents the same message being processed twice when multiple sessions are
// active simultaneously (e.g. owner + user session both in the same group).
// Key: msgId — value: true. TTL: 120 s.
const globalDedup = new NodeCache({ stdTTL: 120, checkperiod: 30 });

// ── In-memory message counts per group (resets on bot restart) ─────────────────
// Map<groupJid, Map<phone, count>>
// Commands (listactive) read from this for real-time accuracy.
const sessionMsgCounts = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────────
const LINK_RE  = /(https?:\/\/\S+|chat\.whatsapp\.com\/\S+)/i;
const EMOJI_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u;

function extractBody(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation                                           ||
    m.extendedTextMessage?.text                              ||
    m.imageMessage?.caption                                  ||
    m.videoMessage?.caption                                  ||
    m.documentMessage?.caption                               ||
    m.buttonsResponseMessage?.selectedButtonId               ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId  ||
    m.templateButtonReplyMessage?.selectedId                 ||
    ''
  );
}

function cleanNum(jid) {
  return (jid || '').split('@')[0].split(':')[0];
}

function selfJid(sessionOwnerPhone) {
  return String(sessionOwnerPhone || '').replace(/\D/g, '') + '@s.whatsapp.net';
}

function fakeVoMsg(key, qm) {
  const inner =
    qm.viewOnceMessage?.message          ||
    qm.viewOnceMessageV2?.message        ||
    qm.viewOnceMessageV2Extension?.message;
  if (inner) return { key, message: inner };
  if (qm.imageMessage || qm.videoMessage) return { key, message: qm };
  return null;
}

// ── Main message handler ───────────────────────────────────────────────────────
async function handleMessages({ session, payload }) {
  // 'append' = Baileys replaying history on startup – skip entirely
  if (payload.type !== 'notify') return;

  const sock              = session.sock;
  const messages          = payload.messages || [];
  const state             = session.state || {};
  const sessionOwnerPhone = session.phoneNumber || getAdminNumber();
  const connectedAt       = session.connectedAt || 0;

  for (const msg of messages) {
    try {
      if (!msg.message) continue;

      const from = msg.key.remoteJid;
      if (!from) continue;

      // ── Drop messages older than this socket's connection time ─────────────
      const msgTimestampMs = (msg.messageTimestamp || 0) * 1000;
      if (connectedAt > 0 && msgTimestampMs > 0 && msgTimestampMs < connectedAt - 15000) {
        continue;
      }

      // ── Global deduplication — prevents double responses when multiple ──────
      // sessions are active in the same group (owner + user both connected).
      // Skip the key.fromMe branch since owner's own messages are session-specific.
      if (!msg.key.fromMe) {
        const dedupKey = msg.key.id;
        if (globalDedup.get(dedupKey)) continue;
        globalDedup.set(dedupKey, true);
      }

      // ── Protocol message detection ──────────────────────────────────────────
      const proto = msg.message?.protocolMessage;

      if (proto !== undefined && proto !== null) {
        // ── Delete (REVOKE) ────────────────────────────────────────────────────
        if (proto.type === 0) {
          if (state.antidelete) {
            const deletedId = proto.key?.id;
            if (deletedId) {
              const cached = msgCache.get(deletedId);
              if (cached) {
                const dest = selfJid(sessionOwnerPhone);
                const groupLabel = cached.from && cached.from !== dest
                  ? `\n📍 _From: ${cached.from}_\n` : '\n';
                await sock.sendMessage(dest, {
                  text: `🗑️ *Deleted Message*${groupLabel}\n_"${cached.body}"_`,
                });
                msgCache.del(deletedId);
              }
            }
          }
          continue;
        }

        // ── Edit (MESSAGE_EDIT) ────────────────────────────────────────────────
        if (proto.type === 14) {
          if (state.antiedit) {
            const originalId = proto.key?.id;
            const ec         = proto.editedMessage;
            const newText    =
              ec?.conversation                  ||
              ec?.extendedTextMessage?.text      ||
              ec?.imageMessage?.caption          ||
              ec?.videoMessage?.caption          ||
              '';
            if (originalId && newText) {
              const originalText = editCache.get(originalId);
              if (originalText && newText !== originalText) {
                const dest = selfJid(sessionOwnerPhone);
                const chatJid = proto.key?.remoteJid || from;
                const groupLabel = chatJid && chatJid !== dest
                  ? `\n📍 _From: ${chatJid}_\n` : '\n';
                await sock.sendMessage(dest, {
                  text: `✏️ *Message Edited*${groupLabel}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
                });
              }
              editCache.set(originalId, newText);
            }
          }
          continue;
        }

        continue;
      }

      // ── Alternative edit format (some Baileys versions) ────────────────────
      const editedMsg = msg.message?.editedMessage;
      if (editedMsg) {
        if (state.antiedit) {
          const originalId = editedMsg.key?.id;
          const em         = editedMsg.message;
          const newText    =
            em?.conversation              ||
            em?.extendedTextMessage?.text  ||
            em?.imageMessage?.caption      ||
            em?.videoMessage?.caption      ||
            '';
          if (originalId && newText) {
            const originalText = editCache.get(originalId);
            if (originalText && newText !== originalText) {
              const dest = selfJid(sessionOwnerPhone);
              const chatJid = editedMsg.key?.remoteJid || from;
              const groupLabel = chatJid && chatJid !== dest
                ? `\n📍 _From: ${chatJid}_\n` : '\n';
              await sock.sendMessage(dest, {
                text: `✏️ *Message Edited*${groupLabel}\n📌 *Original:*\n_"${originalText}"_\n\n🔄 *Edited to:*\n_"${newText}"_`,
              });
            }
            editCache.set(originalId, newText);
          }
        }
        continue;
      }

      const isGroup   = from.endsWith('@g.us');
      const sender    = isGroup ? (msg.key.participant || '') : from;
      const body      = extractBody(msg);
      const isCommand = body.startsWith('*');

      // ── fromMe messages (session owner typed on their phone) ──────────────
      if (msg.key.fromMe) {
        const fmCtx = msg.message?.extendedTextMessage?.contextInfo;

        // A) Owner replied to a status → save it
        if (fmCtx?.remoteJid === 'status@broadcast') {
          await statusSaver.handle(sock, msg, sessionOwnerPhone);
        }

        // B) Owner replied to any media with only emoji → reveal if view-once
        if (!isCommand && fmCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
          const qm = fmCtx.quotedMessage;
          const hasMedia = !!(
            qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension ||
            qm.imageMessage    || qm.videoMessage
          );
          if (hasMedia) {
            const fake = fakeVoMsg(
              { remoteJid: from, id: fmCtx.stanzaId || msg.key.id, participant: null, fromMe: false },
              qm,
            );
            if (fake) await vvCmd.handleSecret(sock, fake, selfJid(sessionOwnerPhone));
            continue;
          }
        }

        if (!isCommand) continue;
      }

      // ── Ignore raw status posts from others ──────────────────────────────
      if (from === 'status@broadcast') continue;

      // ── Secret view-once reveal for non-fromMe emoji reply ────────────────
      const replyCtx = msg.message?.extendedTextMessage?.contextInfo;
      if (!isCommand && replyCtx?.quotedMessage && body.trim() && EMOJI_RE.test(body.trim())) {
        const qm = replyCtx.quotedMessage;
        const hasMedia = !!(
          qm.viewOnceMessage || qm.viewOnceMessageV2 || qm.viewOnceMessageV2Extension ||
          qm.imageMessage    || qm.videoMessage
        );
        if (hasMedia) {
          const fake = fakeVoMsg(
            { remoteJid: from, id: replyCtx.stanzaId || msg.key.id, participant: sender, fromMe: false },
            qm,
          );
          if (fake) await vvCmd.handleSecret(sock, fake, selfJid(sessionOwnerPhone));
          continue;
        }
      }

      // ── Cache message bodies for antidelete / antiedit ───────────────────
      if (body) {
        msgCache.set(msg.key.id,  { from, body });
        editCache.set(msg.key.id, body);
      }

      // ── Track message counts for *listactive (in-memory per session) ──────
      if (isGroup && sender) {
        const num = cleanNum(sender);
        if (!sessionMsgCounts.has(from)) sessionMsgCounts.set(from, new Map());
        const gc = sessionMsgCounts.get(from);
        gc.set(num, (gc.get(num) || 0) + 1);
        // Also persist so listactive has data on first run
        addMsgCount(from, num);
      }

      // ── Group automated enforcement (non-command messages) ────────────────
      if (isGroup && sender && !isCommand) {
        const gs = getGroupSettings(from);

        const isGroupMention =
          !!msg.message?.groupMentionedMessage ||
          !!(msg.message?.extendedTextMessage?.contextInfo?.groupMentionedMessage);

        if (gs.antigroupmention && isGroupMention) {
          try {
            await sock.sendMessage(from, {
              delete: { remoteJid: from, id: msg.key.id, participant: sender, fromMe: false },
            });
          } catch (e) { console.error('[AntiGroupMention] Delete failed:', e.message); }

          const num   = cleanNum(sender);
          const count = addWarning(from, num);
          if (count >= 5) {
            await sock.sendMessage(from, {
              text: `🚨 @${num} has been *removed* for repeatedly mentioning groups in status!`,
              mentions: [sender],
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, num);
          } else {
            await sock.sendMessage(from, {
              text: `🔕 @${num}, group mentions in status are *not allowed* here!\n⚠️ Warning *${count}/5* — ${5 - count} more warning(s) before removal.`,
              mentions: [sender],
            });
          }
          continue;
        }

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

      // ── Only process * commands beyond this point ─────────────────────────
      if (!isCommand) continue;

      const effectiveSender = msg.key.fromMe
        ? (sessionOwnerPhone + '@s.whatsapp.net')
        : (sender || from);

      // ── Access gate ───────────────────────────────────────────────────────
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
        state,
        sessionMsgCounts,
      };

      switch (cmd) {
        case 'antigroupmention':   await antigroupmentionCmd.handle(ctx);  break;
        case 'antilink':           await antilinkCmd.handle(ctx);          break;
        case 'approve':            await approveCmd.handle(ctx);           break;
        case 'approveall':         await approveallCmd.handle(ctx);        break;
        case 'close':              await closeCmd.handle(ctx);             break;
        case 'closetime':          await closetimeCmd.handle(ctx);         break;
        case 'demote':             await demoteCmd.handle(ctx);            break;
        case 'disapproveall':      await disapproveallCmd.handle(ctx);     break;
        case 'goodbye':            await goodbyeCmd.handle(ctx);           break;
        case 'hidetag':            await hidetagCmd.handle(ctx);           break;
        case 'kick':               await kickCmd.handle(ctx);              break;
        case 'listactive':         await listactiveCmd.handle(ctx);        break;
        case 'open':               await openCmd.handle(ctx);              break;
        case 'opentime':           await opentimeCmd.handle(ctx);          break;
        case 'promote':            await promoteCmd.handle(ctx);           break;
        case 'resetlink':          await resetlinkCmd.handle(ctx);         break;
        case 'resetwarn':          await resetwarnCmd.handle(ctx);         break;
        case 'tagall':             await tagallCmd.handle(ctx);            break;
        case 'warn':               await warnCmd.handle(ctx);              break;
        case 'welcome':            await welcomeCmd.handle(ctx);           break;
        case 'block':              await blockCmd.handle(ctx);             break;
        case 'delete':             await deleteCmd.handle(ctx);            break;
        case 'getpp':              await getppCmd.handle(ctx);             break;
        case 'helpers':            await helpersCmd.handle(ctx);           break;
        case 'listblocked':        await listblockedCmd.handle(ctx);       break;
        case 'sticker': case 's':  await stickerCmd.handle(ctx);           break;
        case 'togstatus':          await togstatusCmd.handle(ctx);         break;
        case 'unblock':            await unblockCmd.handle(ctx);           break;
        case 'vv':                 await vvCmd.handle(ctx);                break;
        case 'alwaysonline':       await alwaysonlineCmd.handle(ctx);      break;
        case 'anticall':           await anticallCmd.handle(ctx);          break;
        case 'antidelete':         await antideleteCmd.handle(ctx);        break;
        case 'antiedit':           await antieditCmd.handle(ctx);          break;
        case 'botstatus':          await botstatusCmd.handle(ctx);         break;
        case 'menu':               await menuCmd.handle(ctx);              break;
        case 'mode':               await modeCmd.handle(ctx);              break;
        case 'ping':               await pingCmd.handle(ctx);              break;
        default: break;
      }
    } catch (e) {
      console.error('[Messages] Uncaught error in message loop:', e.message);
    }
  }
}

// ── handleMessageDelete ────────────────────────────────────────────────────────
async function handleMessageDelete(sock, update, state, session) {
  if (!state?.antidelete) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest = selfJid(sessionOwnerPhone);
    const keys = update?.keys || (Array.isArray(update) ? update : []);
    for (const key of keys) {
      const cached = msgCache.get(key.id);
      if (!cached) continue;
      const groupLabel = cached.from && cached.from !== dest
        ? `\n📍 _From: ${cached.from}_\n` : '\n';
      await sock.sendMessage(dest, {
        text: `🗑️ *Deleted Message*${groupLabel}\n_"${cached.body}"_`,
      });
      msgCache.del(key.id);
    }
  } catch (e) { console.error('[AntiDelete]', e.message); }
}

// ── handleMessageEdit ──────────────────────────────────────────────────────────
async function handleMessageEdit(sock, updates, state, session) {
  if (!state?.antiedit) return;
  try {
    const sessionOwnerPhone = session?.phoneNumber || getAdminNumber();
    const dest = selfJid(sessionOwnerPhone);
    for (const { key, update } of (updates || [])) {
      if (!update?.message) continue;
      const jid      = key.remoteJid;
      if (!jid) continue;
      const original = editCache.get(key.id);
      if (!original) continue;

      const m      = update.message;
      const edited =
        m?.editedMessage?.message?.conversation              ||
        m?.editedMessage?.message?.extendedTextMessage?.text ||
        m?.protocolMessage?.editedMessage?.conversation      ||
        m?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
        m?.conversation                                      ||
        m?.extendedTextMessage?.text                         ||
        '';

      if (!edited || edited === original) continue;
      const groupLabel = jid && jid !== dest ? `\n📍 _From: ${jid}_\n` : '\n';
      await sock.sendMessage(dest, {
        text: `✏️ *Message Edited*${groupLabel}\n📌 *Original:*\n_"${original}"_\n\n🔄 *Edited to:*\n_"${edited}"_`,
      });
      editCache.set(key.id, edited);
    }
  } catch (e) { console.error('[AntiEdit]', e.message); }
}

// ── handleCall ─────────────────────────────────────────────────────────────────
async function handleCall(sock, calls, state) {
  if (!state?.anticall) return;
  for (const call of (calls || [])) {
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

module.exports = { handleMessages, handleMessageDelete, handleMessageEdit, handleCall, sessionMsgCounts };
