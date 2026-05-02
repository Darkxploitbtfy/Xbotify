'use strict';
async function handle({ sock, from, args, isAdmin, state }) {
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Owner only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { state.antiedit=true;  return sock.sendMessage(from,{text:'✏️ Antiedit *ON* — edited originals shown.'}); }
  if (sub==='off') { state.antiedit=false; return sock.sendMessage(from,{text:'✏️ Antiedit *OFF*.'}); }
  return sock.sendMessage(from,{text:`✏️ Antiedit: *${state.antiedit?'ON':'OFF'}*\nUsage: *antiedit on/off`});
}
module.exports = { handle };
