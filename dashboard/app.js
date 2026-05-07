'use strict';

const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const path       = require('path');

const sessionManager = require('../utils/sessionManager');
const { addUser, removeUser, getUsers, updateUser } = require('../utils/dataManager');
const { getAdminNumber, isConnected }               = require('../utils/botState');

const CREDS  = { username: 'katson', password: '#jesusfuckingchrist#' };
const SECRET = process.env.SESSION_SECRET || 'botifyx-session-secret-2024';

function requireAuth(req, res, next) {
  if (req.session?.loggedIn) return next();
  return res.redirect('/panel');
}

function createDashboard() {
  const app = express();

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(session({
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 86400000 },
  }));

  // ── Page routes ──────────────────────────────────────────────────────
  app.get('/', (_, res) => res.redirect('/panel'));

  app.get('/panel', (req, res) => {
    if (!req.session?.loggedIn) return res.sendFile(path.join(__dirname, 'views', 'login.html'));
    return res.sendFile(path.join(__dirname, 'views', 'pairing.html'));
  });

  app.get('/panel/dashboard', requireAuth, (_, res) => res.redirect('/panel'));

  // ── Auth ─────────────────────────────────────────────────────────────
  app.post('/panel/login', (req, res) => {
    const { username, password } = req.body;
    if (username === CREDS.username && password === CREDS.password) {
      req.session.loggedIn = true;
      return res.json({ success: true, redirect: '/panel' });
    }
    return res.json({ success: false, message: 'Invalid credentials.' });
  });

  app.post('/panel/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  // ── Status ────────────────────────────────────────────────────────────
  app.get('/panel/api/status', requireAuth, (_, res) => {
    res.json({
      connected:   isConnected(),
      adminNumber: getAdminNumber() || null,
    });
  });

  // ── Owner pairing ─────────────────────────────────────────────────────
  // The owner is always at their panel while pairing, so we can wait
  // synchronously for the code (typically takes 5-8 seconds).
  app.post('/panel/api/pair', requireAuth, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone number required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 7) return res.json({ success: false, message: 'Invalid phone number.' });
    try {
      const result = await sessionManager.requestOwnerPairing(clean);
      if (result?.alreadyConnected) return res.json({ success: true, alreadyConnected: true });
      if (result?.pairingCode)      return res.json({ success: true, code: result.pairingCode });
      return res.json({ success: false, message: 'Failed to generate pairing code.' });
    } catch (e) {
      console.error('[PAIR ERROR]', e);
      return res.json({ success: false, message: e.message || 'Unknown error.' });
    }
  });

  // ── User pairing — step 1: kick off session creation (non-blocking) ───
  // We start the Baileys session in the background and return immediately so
  // Railway's 30-second proxy timeout is never reached.
  // The frontend polls /api/pairing-code/:phone for the result.
  app.post('/panel/api/pair-user', requireAuth, (req, res) => {
    const { phone, days } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone number required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 7) return res.json({ success: false, message: 'Invalid phone number.' });

    try {
      // Register user first so access control works even before the session starts
      addUser(clean, parseInt(days) || 30);

      // Non-blocking: starts socket creation + pairing code request in background
      sessionManager.requestPairingCodeFor(clean);

      return res.json({ success: true, pending: true, phone: clean });
    } catch (e) {
      console.error('[PAIR USER ERROR]', e);
      return res.json({ success: false, message: e.message || 'Unknown error.' });
    }
  });

  // ── User pairing — step 2: poll for the pairing code ─────────────────
  // Returns { pending: true } while the code isn't ready yet.
  // Returns { success: true, code: "XXXX-XXXX" } when ready.
  // Returns { success: false, message: "..." } on error.
  app.get('/panel/api/pairing-code/:phone', requireAuth, (req, res) => {
    const phone  = String(req.params.phone || '').replace(/\D/g, '');
    const result = sessionManager.getPairingResult(phone);

    if (!result || !result.done) {
      return res.json({ pending: true });
    }

    // Consume the result — next poll starts fresh
    sessionManager.clearPairingResult(phone);

    if (result.alreadyConnected) return res.json({ success: true, alreadyConnected: true });
    if (result.error)            return res.json({ success: false, message: result.error });
    if (result.code)             return res.json({ success: true, code: result.code, phone });

    return res.json({ success: false, message: 'No pairing code was generated. Please try again.' });
  });

  // ── User management ───────────────────────────────────────────────────
  app.get('/panel/api/users', requireAuth, (_, res) => {
    res.json({ users: getUsers() });
  });

  app.post('/panel/api/users/add', requireAuth, (req, res) => {
    const { phone, days } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    const user = addUser(String(phone).replace(/\D/g, ''), parseInt(days) || 30);
    return res.json({ success: true, user });
  });

  app.post('/panel/api/users/remove', requireAuth, (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    removeUser(String(phone).replace(/\D/g, ''));
    return res.json({ success: true });
  });

  app.post('/panel/api/users/toggle', requireAuth, (req, res) => {
    const { phone, active } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    return res.json({
      success: updateUser(String(phone).replace(/\D/g, ''), { active: !!active }),
    });
  });

  return app;
}

module.exports = { createDashboard };
