'use strict';
async function handle({ sock, from }) {
  const text = `╔══════════════════════════════╗
║   🤖  B O T I F Y  X  v1.0.3  ║
╚══════════════════════════════╝

👥 *GROUP MANAGEMENT*
├ *antilink on/off* — Block links
├ *promote* — Make member admin
├ *demote* — Remove admin role
├ *kick* — Remove a member
├ *resetlink* — Reset invite link
├ *welcome on/off* — Join message
├ *goodbye on/off* — Leave message
├ *tagall* — Mention everyone
├ *hidetag [msg]* — Hidden mention
└ *warn* — Warn a member (5 = kick)

🛠️ *TOOLS*
├ *vv* — Reveal view-once media
├ *getpp* — Get profile picture
├ *sticker* — Image to sticker
└ *menu* — Show this menu

👑 *OWNER ONLY*
├ *ping* — Check bot speed
├ *botstatus* — Bot information
└ *mode public/private* — Set mode

🛡️ *PROTECTION*
├ *anticall on/off* — Reject calls
├ *antidelete on/off* — Show deleted
└ *antiedit on/off* — Show edits

🔕 *SECRET*
└ Reply to any status with text or
  emoji → that status gets saved
  privately and sent to admin 📥

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _All commands use * prefix_
💡 _Reply to a message to target it_`;

  await sock.sendMessage(from, { text });
}
module.exports = { handle };
