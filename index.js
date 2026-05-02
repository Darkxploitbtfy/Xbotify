'use strict';
/**
 * ╔════════════════════════════╗
 * ║    BOTIFY X  v1.0.3        ║
 * ╠════════════════════════════╣
 * ║  /panel  → login           ║
 * ║  /panel/dashboard → panel  ║
 * ║  WhatsApp → commands only  ║
 * ╚════════════════════════════╝
 */

const path = require('path');
const fs   = require('fs');

// ── Ensure data directory and default files exist ──────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  'data/users.json':    '[]',
  'data/settings.json': '{"botMode":"public","groups":{}}',
  'data/warnings.json': '{}'
};
for (const [rel, val] of Object.entries(DEFAULTS)) {
  const p = path.join(__dirname, rel);
  if (!fs.existsSync(p)) fs.writeFileSync(p, val);
}

// NOTE: auth/ is intentionally NOT pre-created here.
// It is created automatically by bot.js at runtime when startBot() is called.

// ── Start web panel ────────────────────────────────────────────────
const { createDashboard } = require('./dashboard/app');
const PORT = process.env.PORT || 3000;

const app = createDashboard();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════╗
║          BOTIFY X  v1.0.3            ║
╠══════════════════════════════════════╣
║  Panel  : http://localhost:${PORT}/panel
║  Login  : katson / #jesusfuckingchrist#
╚══════════════════════════════════════╝`);
});

// ── Auto-reconnect if an existing session is found ─────────────────
const AUTH_DIR  = process.env.AUTH_DIR || path.join(__dirname, 'auth');
const CREDS_FILE = path.join(AUTH_DIR, 'creds.json');

if (fs.existsSync(CREDS_FILE)) {
  console.log('[BOTIFY X] Existing session found — reconnecting...');
  const { startBot } = require('./bot');
  startBot(null).catch(e => console.error('[BOTIFY X] Reconnect error:', e.message));
} else {
  console.log('[BOTIFY X] No session. Use /panel → Connect Bot to pair.');
}
