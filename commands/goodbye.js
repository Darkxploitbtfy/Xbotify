'use strict';
const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');
async function handle({ sock, from, args, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { updateGroupSettings(from,{goodbye:true});  return sock.sendMessage(from,{text:'👋 Goodbye messages *ON*.'}); }
  if (sub==='off') { updateGroupSettings(from,{goodbye:false}); return sock.sendMessage(from,{text:'👋 Goodbye messages *OFF*.'}); }
  const cur = getGroupSettings(from).goodbye;
  return sock.sendMessage(from,{text:`👋 Goodbye: *${cur?'ON':'OFF'}*\nUsage: *goodbye on/off`});
}
module.exports = { handle };
