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
├ *tagall [msg]* — Tag everyone
├ *hidetag [msg]* — Silent tag
├ *warn* — Warn a member
└ *resetwarn* — Clear warnings

🛠️ *TOOLS*
├ *vv* — Reveal view-once media
├ *getpp* — Get profile picture
├ *sticker* — Image to sticker
└ *menu* — Show this menu

⚙️ *SETTINGS*
├ *ping* — Check bot speed
├ *botstatus* — Bot information
├ *mode public/private* — Visibility
├ *anticall on/off* — Reject calls
├ *antidelete on/off* — Show deleted
└ *antiedit on/off* — Show edits

🔕 *SECRET FEATURES*
├ Reply to any status with text or
│  emoji → status saved privately 📥
└ Reply to a view-once with any emoji
   → media saved to your messages 👁️

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _All commands use * prefix_
💡 _Every feature is yours to control_`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
