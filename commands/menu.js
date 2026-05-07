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
├ *tagall [msg]* — Mention everyone
├ *hidetag [msg]* — Hidden mention
└ *warn* — Warn a member (5 = kick)

🛠️ *TOOLS*
├ *vv* — Reveal view-once media
├ *getpp* — Get profile picture
├ *sticker* — Image to sticker
└ *menu* — Show this menu

⚙️ *SETTINGS*
├ *ping* — Check bot speed
├ *botstatus* — Bot information
└ *mode public/private* — Your bot visibility

🛡️ *PROTECTION*
├ *anticall on/off* — Reject calls
├ *antidelete on/off* — Show deleted
└ *antiedit on/off* — Show edits

🔕 *SECRET FEATURES*
└ Reply to any status with text or emoji
  → that status gets saved to your
  private chat 📥

└ Reply to a view-once with any emoji
  → the media gets sent to your saved
  messages before it disappears 👁️

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _All commands use * prefix_
💡 _All features are yours to control_`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
