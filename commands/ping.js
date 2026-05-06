'use strict';
async function handle({ sock, from }) {
  const start = Date.now();
  await sock.sendMessage(from, { text: '⏳ _Checking response time…_' });
  const ms = Date.now() - start;
  await sock.sendMessage(from, {
    text: `🏓 *Pong!*\n\n⚡ *Response Time:* ${ms}ms\n🤖 *Bot:* BOTIFY X v1.0.3\n🟢 *Status:* Online & Ready`
  });
}
module.exports = { handle };
