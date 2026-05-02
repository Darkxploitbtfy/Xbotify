'use strict';
async function handle({ sock, from }) {
  const t = Date.now();
  await sock.sendMessage(from, { text: '⏳ Pinging...' });
  await sock.sendMessage(from, { text: `🏓 *Pong!*\n⚡ Speed: *${Date.now()-t}ms*\n🤖 BOTIFY X v1.0.3 is online!` });
}
module.exports = { handle };
