'use strict';
const { setBotMode, getBotMode } = require('../utils/dataManager');
async function handle({ sock, from, args, isAdmin }) {
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Owner only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='public')  { setBotMode('public');  return sock.sendMessage(from,{text:'🌍 Bot mode: *PUBLIC* — everyone can use commands.'}); }
  if (sub==='private') { setBotMode('private'); return sock.sendMessage(from,{text:'🔒 Bot mode: *PRIVATE* — admin only.'}); }
  return sock.sendMessage(from,{text:`⚙️ Mode: *${getBotMode().toUpperCase()}*\nUsage: *mode public/private`});
}
module.exports = { handle };
