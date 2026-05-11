'use strict';
/**
 * ╔════════════════════════════╗
 * ║    BOTIFY X  v1.1.4        ║
 * ╠════════════════════════════╣
 * ║  /panel  → login           ║
 * ║  /panel/dashboard → panel  ║
 * ║  WhatsApp → commands only  ║
 * ╚════════════════════════════╝
 */

// ── Global error guards ────────────────────────────────────────────────────────
// These must be registered FIRST, before anything else is required.
// Without them a single unhandled rejection crashes the entire Railway process,
// taking down all WhatsApp sessions permanently until the next deploy.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception — continuing:', err?.message, err?.stack);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[FATAL] Unhandled Rejection — continuing:', msg);
});

// ── Polyfill Web Crypto for Node.js 18 / Baileys compatibility ─────
// Must be before any require() that touches Baileys internals
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

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
║          BOTIFY X  v1.1.4            ║
╠══════════════════════════════════════╣
║  Panel  : http://localhost:${PORT}/panel
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
