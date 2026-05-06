'use strict';
const { getBotMode } = require('../utils/dataManager');
const { getAdminNumber } = require('../utils/botState');

const START_TIME = Date.now();

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function handle({ sock, from }) {
  const uptime  = formatUptime(Date.now() - START_TIME);
  const mode    = getBotMode();
  const admin   = getAdminNumber();
  const nodeVer = process.version;
  const now     = new Date().toLocaleString('en-GB', { timeZone: 'UTC' });

  const text = `╔══════════════════════════════╗
║       🤖  BOT STATUS         ║
╚══════════════════════════════╝

📌 *Name:*      BOTIFY X
🏷️ *Version:*   v1.0.3
🟢 *Status:*    Online & Active
⚙️ *Runtime:*   Node.js ${nodeVer}
🖥️ *Platform:*  Railway (Cloud)
📊 *Mode:*      ${mode === 'public' ? '🌍 Public' : '🔒 Private'}
👑 *Admin:*     ${admin ? '+' + admin : 'Not set'}
⏱️ *Uptime:*    ${uptime}
🕒 *Time (UTC):* ${now}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _Powered by BOTIFY X v1.0.3_`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
