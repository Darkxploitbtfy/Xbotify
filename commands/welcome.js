'use strict';
const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');
async function handle({ sock, from, args, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { updateGroupSettings(from,{welcome:true});  return sock.sendMessage(from,{text:'👋 Welcome messages *ON*.'}); }
  if (sub==='off') { updateGroupSettings(from,{welcome:false}); return sock.sendMessage(from,{text:'👋 Welcome messages *OFF*.'}); }
  const cur = getGroupSettings(from).welcome;
  return sock.sendMessage(from,{text:`👋 Welcome: *${cur?'ON':'OFF'}*\nUsage: *welcome on/off`});
}
module.exports = { handle };
