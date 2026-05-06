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
const statusSaver   = require('../commands/statusSaver');

// In-memory runtime state (resets on restart — by design)
const state = { anticall: false, antidelete: false, antiedit: false };

// Cache for antidelete — stores body of DM messages (TTL 5 min)
const msgCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Cache for antiedit — stores original body before an edit (TTL 10 min)
const editCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });

const LINK_RE  = /https?:\/\/\S+|chat\.whatsapp\.com\/\S+/i;
const EMOJI_RE = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\s)+$/u;

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

      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

      const isCommand = body.startsWith('*');

      // fromMe = message sent by the bot's own account (the paired phone).
      // We MUST allow fromMe commands so the owner can control the bot from
      // their own device. Only skip non-command fromMe messages.
      if (msg.key.fromMe && !isCommand) continue;

      // ── Status broadcast ─────────────────────────────
      if (from === 'status@broadcast') {
        await statusSaver.handle(sock, msg);
        continue;
      }

      // ── Secret: emoji reply to view-once ─────────────
      const isVO = !!(
        msg.message?.viewOnceMessage ||
        msg.message?.viewOnceMessageV2 ||
        msg.message?.viewOnceMessageV2Extension
      );
      if (isVO && body.trim() && EMOJI_RE.test(body.trim())) {
        const adminNum = getAdminNumber();
        if (adminNum) {
          const adminJid = adminNum + '@s.whatsapp.net';
          await vvCmd.handleSecret(sock, msg, adminJid);
        }
        continue;
      }

      // ── Cache for antidelete & antiedit ──────────────
      if (!isGroup && body) {
        if (state.antidelete) msgCache.set(msg.key.id, { from, body });
        if (state.antiedit)   editCache.set(msg.key.id, body);
      }

      // ── Antilink (group only, non-command messages) ──
      if (isGroup && sender && !isCommand) {
        const gs = getGroupSettings(from);
        if (gs.antilink && LINK_RE.test(body)) {
          try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
          const count = addWarning(from, sender.split('@')[0].split(':')[0]);
          if (count >= 5) {
            await sock.sendMessage(from, {
              text: `⚠️ @${sender.split('@')[0].split(':')[0]} removed for repeated links.`,
              mentions: [sender]
            });
            try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
            resetWarnings(from, sender.split('@')[0].split(':')[0]);
          } else {
            await sock.sendMessage(from, {
              text: `⚠️ @${sender.split('@')[0].split(':')[0]}, no links allowed! Warning ${count}/5`,
              mentions: [sender]
            });
          }
          continue;
        }
      }

      // ── Only handle * commands ────────────────────────
      if (!isCommand) continue;

      const parts  = body.trim().slice(1).split(/\s+/);
      const cmd    = parts[0].toLowerCase();
      const args   = parts.slice(1);
      const argStr = args.join(' ').trim();

      // For fromMe commands, sender is the bot's own JID — use the owner number
      const effectiveSender = msg.key.fromMe
        ? (getAdminNumber() + '@s.whatsapp.net')
        : (sender || from);

      // Access check
      const access = checkAccess(effectiveSender);
      if (!access.allowed) {
        await sock.sendMessage(from, { text: denyMsg(access.reason) });
        continue;
      }

      const ctx = { sock, msg, from, sender: effectiveSender, args, argStr, isGroup, isAdmin: access.isAdmin, state };

      switch (cmd) {
        case 'antilink':    await antilinkCmd.handle(ctx);   break;
        case 'anticall':    await anticallCmd.handle(ctx);   break;
        case 'antidelete':  await antideleteCmd.handle(ctx); break;
        case 'antiedit':    await antieditCmd.handle(ctx);   break;
        case 'promote':     await promoteCmd.handle(ctx);    break;
        case 'demote':      await demoteCmd.handle(ctx);     break;
        case 'kick':        await kickCmd.handle(ctx);       break;
        case 'resetlink':   await resetlinkCmd.handle(ctx);  break;
        case 'welcome':     await welcomeCmd.handle(ctx);    break;
        case 'goodbye':     await goodbyeCmd.handle(ctx);    break;
        case 'tagall':      await tagallCmd.handle(ctx);     break;
        case 'hidetag':     await hidetagCmd.handle(ctx);    break;
        case 'warn':        await warnCmd.handle(ctx);       break;
        case 'vv':          await vvCmd.handle(ctx);         break;
        case 'getpp':       await getppCmd.handle(ctx);      break;
        case 'ping':        await pingCmd.handle(ctx);       break;
        case 'mode':        await modeCmd.handle(ctx);       break;
        case 'sticker':
        case 's':           await stickerCmd.handle(ctx);    break;
        case 'menu':        await menuCmd.handle(ctx);       break;
        default: break;
      }
    } catch (e) {
      console.error('[Messages]', e.message);
    }
  }
}

async function handleMessageDelete(sock, update) {
  if (!state.antidelete) return;
  try {
    for (const key of (update.keys || [])) {
      if (key.remoteJid?.endsWith('@g.us')) continue;
      const cached = msgCache.get(key.id);
      if (!cached) continue;
      await sock.sendMessage(cached.from, { text: `🗑️ *Deleted message:*\n\n${cached.body}` });
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
        text: `✏️ *Message was edited*\n\n*Original:*\n${original}\n\n*Edited:*\n${edited}`
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
        await sock.sendMessage(call.from, { text: "📵 I can't receive calls at the moment." });
      }
    } catch (e) { console.error('[AntiCall]', e.message); }
  }
}

module.exports = { handleMessages, handleMessageDelete, handleMessageEdit, handleCall };
