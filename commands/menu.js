'use strict';

const { getSessionOwnerMode } = require('../utils/dataManager');
const { getAdminNumber }      = require('../utils/botState');

const VERSION = '1.0.3';

async function handle({ sock, from, sessionOwnerPhone }) {
  // Step 1: loading message
  await sock.sendMessage(from, { text: '⏳ _Loading menu..._' });

  // Step 2: gather live info
  const start   = Date.now();
  const mode    = getSessionOwnerMode(sessionOwnerPhone);
  const admin   = getAdminNumber();
  const pingMs  = Date.now() - start;
  const modeStr = mode === 'public' ? '🌍 Public' : '🔒 Private';

  const text = `┏▣ ◈ BOTIFY-X ◈
┃ *ᴏᴡɴᴇʀ* : ${admin ? '+' + admin : 'Not Set!'}
┃ *ᴘʀᴇғɪx* : [ * ]
┃ *ʜᴏsᴛ* : Railway
┃ *ᴍᴏᴅᴇ* : ${modeStr}
┃ *ᴠᴇʀsɪᴏɴ* : v${VERSION}
┃ *sᴘᴇᴇᴅ* : ${pingMs}ms
┗▣

👥 *GROUP MANAGEMENT*
├ *antigroupmention on/off* — Block status mentions
├ *antilink on/off* — Block links (5 warns = kick)
├ *approve [#]* — Approve join request by number
├ *approveall* — Approve all join requests
├ *close* — Lock group (admins only)
├ *closetime [time]* — Close for a set time
├ *demote* — Remove admin role
├ *disapproveall* — Reject all join requests
├ *goodbye on/off* — Goodbye message
├ *hidetag [msg]* — Silent tag all members
├ *kick* — Remove a member
├ *listactive* — Top active members ranking
├ *open* — Open group for everyone
├ *opentime [time]* — Open for a set time
├ *promote* — Make member admin
├ *resetlink* — Reset invite link
├ *resetwarn* — Clear warnings for a user
├ *tagall [msg]* — Tag all members
├ *warn* — Warn a member (5 = kick)
└ *welcome on/off* — Welcome message

🛠️ *TOOLS*
├ *block* — Block someone (reply or @mention)
├ *delete* — Delete a replied message
├ *getpp* — Get profile picture
├ *helpers* — Support contact
├ *listblocked* — List blocked contacts
├ *sticker / s* — Image to sticker
├ *togstatus* — Post replied message as status
├ *unblock* — Unblock someone (reply or @mention)
└ *vv* — Reveal a view-once message

⚙️ *SETTINGS*
├ *alwaysonline on/off* — Stay online 24/7
├ *anticall on/off* — Auto-reject calls
├ *antidelete on/off* — Show deleted messages
├ *antiedit on/off* — Show edited messages
├ *botstatus* — Bot performance info
├ *mode public/private* — Command visibility
└ *ping* — Check bot speed

🔕 *SECRET FEATURES*
├ Reply to any status with text or emoji → saved 📥
└ Reply to a view-once with any emoji → revealed 👁️

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ _All commands use * prefix_
💡 _Every feature is yours to control_`;

  await sock.sendMessage(from, { text });
}

module.exports = { handle };
