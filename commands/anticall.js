'use strict';
async function handle({ sock, from, args, isAdmin, state }) {
  if (!isAdmin) return sock.sendMessage(from, { text: '❌ Owner only.' });
  const sub = (args[0]||'').toLowerCase();
  if (sub==='on')  { state.anticall=true;  return sock.sendMessage(from,{text:'📵 Anticall *ON* — calls rejected.'}); }
  if (sub==='off') { state.anticall=false; return sock.sendMessage(from,{text:'📵 Anticall *OFF*.'}); }
  return sock.sendMessage(from,{text:`📵 Anticall: *${state.anticall?'ON':'OFF'}*\nUsage: *anticall on/off`});
}
module.exports = { handle };
