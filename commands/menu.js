'use strict';
async function handle({ sock, from }) {
  await sock.sendMessage(from, { text: `╔═══════════════════════╗
║    BOTIFY X v1.0.3     ║
╚═══════════════════════╝

━━━━ 👥 GROUP ━━━━
*antilink on/off
*promote
*demote
*kick
*resetlink
*welcome on/off
*goodbye on/off
*tagall
*hidetag [message]
*warn

━━━━ 🛠️ UTILITY ━━━━
*vv — reveal view-once
*getpp — profile picture
*sticker — image to sticker
Reply to status → saved to admin

━━━━ 👑 OWNER ━━━━
*ping
*mode public/private

━━━━ 🔧 OTHER ━━━━
*anticall on/off
*antidelete on/off
*antiedit on/off
*menu

━━━━ 🔕 SECRET ━━━━
Reply to view-once with emojis only
→ Secretly saved & sent to admin

━━━━━━━━━━━━━━━━━━━━━━━
⚡ Powered by BOTIFY X` });
}
module.exports = { handle };
