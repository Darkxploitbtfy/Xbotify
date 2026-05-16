'use strict';

const { getSessionOwnerMode } = require('../utils/dataManager');
const { getAdminNumber }      = require('../utils/botState');

const VERSION = '1.1.4';

async function handle({ sock, from, sessionOwnerPhone }) {
  const start   = Date.now();
  const mode    = getSessionOwnerMode(sessionOwnerPhone);
  const admin   = getAdminNumber();
  const pingMs  = Date.now() - start;
  const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';

  const text = `╔══════════════════════════╗
║     ⚡  BOTIFY  X  ⚡     ║
╚══════════════════════════╝
┌─────────────────────────┐
│ 👑 Owner : ${admin ? '+' + admin : 'Not Set'}
│ 🔖 Prefix : [ * ]
│ 🛰️ Host   : Railway
│ 🔒 Mode   : ${modeStr}
│ 📦 Version: v${VERSION}
│ ⚡ Speed  : ${pingMs}ms
└─────────────────────────┘

▸▸ 👥 GROUP MANAGEMENT ◂◂
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ◈ antigroupmention
  ◈ antilink
  ◈ approve
  ◈ approveall
  ◈ close
  ◈ closetime
  ◈ demote
  ◈ disapproveall
  ◈ goodbye
  ◈ hidetag
  ◈ kick
  ◈ listactive
  ◈ open
  ◈ opentime
  ◈ promote
  ◈ resetlink
  ◈ resetwarn
  ◈ tagall
  ◈ warn
  ◈ welcome

▸▸ 🛠️ TOOLS ◂◂
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ◈ block
  ◈ delete
  ◈ getpp
  ◈ helpers
  ◈ listblocked
  ◈ sticker  ›  s
  ◈ togstatus
  ◈ unblock
  ◈ vv

▸▸ ⚙️ SETTINGS ◂◂
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ◈ alwaysonline
  ◈ anticall
  ◈ antidelete
  ◈ antiedit
  ◈ botstatus
  ◈ mode
  ◈ ping

▸▸ 🔕 SECRET FEATURES ◂◂
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ◈ Reply to a status   → saved 📥
  ◈ Reply to view-once  → revealed 👁️

━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚡ Prefix: *  │  All yours`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
