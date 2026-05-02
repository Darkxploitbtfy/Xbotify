'use strict';
const { updateGroupSettings, getGroupSettings } = require('../utils/dataManager');
async function handle({ sock, from, args, isGroup, isAdmin }) {
  if (!isGroup) return sock.sendMessage(from, { text: '❌ Groups only.' });
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Admin only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { updateGroupSettings(from,{antilink:true});  return sock.sendMessage(from,{text:'🔗 Antilink *ON* — links deleted, users warned (5 warns = kick).'}); }
  if (sub==='off') { updateGroupSettings(from,{antilink:false}); return sock.sendMessage(from,{text:'🔗 Antilink *OFF*.'}); }
  const cur = getGroupSettings(from).antilink;
  return sock.sendMessage(from,{text:`🔗 Antilink: *${cur?'ON':'OFF'}*\nUsage: *antilink on/off`});
}
module.exports = { handle };
