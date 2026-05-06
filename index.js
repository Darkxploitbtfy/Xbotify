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

// ── Restore any existing sessions ──────────────────────────────────
const { restoreExistingSessions } = require('./utils/sessionManager');
const pending = restoreExistingSessions();
if (pending.length) {
  console.log(`[BOTIFY X] Restoring ${pending.length} session(s)...`);
  Promise.all(pending).catch(e => console.error('[BOTIFY X] Session restore error:', e.message));
} else {
  console.log('[BOTIFY X] No session. Use /panel → Connect Bot to pair.');
}
