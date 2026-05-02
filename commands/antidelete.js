'use strict';
async function handle({ sock, from, args, isAdmin, state }) {
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Owner only.' });
  if (from.endsWith('@g.us')) return sock.sendMessage(from, { text: '❌ Private chats only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { state.antidelete=true;  return sock.sendMessage(from,{text:'🗑️ Antidelete *ON* — deleted messages will be shown.'}); }
  if (sub==='off') { state.antidelete=false; return sock.sendMessage(from,{text:'🗑️ Antidelete *OFF*.'}); }
  return sock.sendMessage(from,{text:`🗑️ Antidelete: *${state.antidelete?'ON':'OFF'}*\nUsage: *antidelete on/off`});
}
module.exports = { handle };
