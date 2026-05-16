'use strict';

const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const path       = require('path');

const sessionManager = require('../utils/sessionManager');
const { addUser, removeUser, getUsers, updateUser } = require('../utils/dataManager');
const { getAdminNumber }                            = require('../utils/botState');

const CREDS  = { username: 'katson', password: '#jesusfuckingchrist#' };
const SECRET = process.env.SESSION_SECRET || 'botifyx-session-secret-2024';

const START_TIME = Date.now();

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

  // ── Page routes ─────────────────────────────────────────────────────────────
  app.get('/', (_, res) => res.redirect('/panel'));

  app.get('/panel', (req, res) => {
    if (!req.session?.loggedIn) return res.sendFile(path.join(__dirname, 'views', 'login.html'));
    return res.sendFile(path.join(__dirname, 'views', 'pairing.html'));
  });

  app.get('/panel/dashboard', requireAuth, (_, res) => res.redirect('/panel'));

  // ── Auth ─────────────────────────────────────────────────────────────────────
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

  // ── Status ────────────────────────────────────────────────────────────────────
  app.get('/panel/api/status', requireAuth, (_, res) => {
    const ownerSess = sessionManager.ownerSession();
    const connected = !!(ownerSess?.sock?.user);
    const uptimeMs  = Date.now() - START_TIME;
    res.json({
      connected,
      adminNumber: getAdminNumber() || null,
      uptimeMs,
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────────
  // Only counts users who have successfully paired (paired === true).
  // "pending" = added but not yet paired.
  app.get('/panel/api/stats', requireAuth, (_, res) => {
    const allUsers   = getUsers();
    const now        = Date.now();
    const paired     = allUsers.filter(u => u.paired === true);
    const active     = paired.filter(u => u.active && now <= u.expiry).length;
    const expired    = paired.filter(u => now > u.expiry).length;
    const pending    = allUsers.filter(u => !u.paired).length;
    res.json({ active, expired, pending, total: paired.length });
  });

  // ── Owner pairing — phone/code ─────────────────────────────────────────────
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

  // ── Owner pairing — QR: start session ────────────────────────────────────────
  app.post('/panel/api/qr/owner/start', requireAuth, async (req, res) => {
    try {
      const result = await sessionManager.requestOwnerQR();
      if (result?.alreadyConnected) return res.json({ success: true, alreadyConnected: true });
      return res.json({ success: true, pending: true });
    } catch (e) {
      console.error('[QR OWNER ERROR]', e);
      return res.json({ success: false, message: e.message || 'Unknown error.' });
    }
  });

  // ── Owner pairing — QR: poll for code ────────────────────────────────────────
  app.get('/panel/api/qr/owner', requireAuth, (_, res) => {
    const ownerSess = sessionManager.ownerSession();
    if (ownerSess?.sock?.user) return res.json({ connected: true });

    const qrData = sessionManager.getSessionQR('owner');
    if (qrData && Date.now() - qrData.updatedAt < 120_000) {
      return res.json({ qr: qrData.qr, updatedAt: qrData.updatedAt });
    }
    return res.json({ pending: true });
  });

  // ── User pairing — step 1: phone/code (non-blocking) ─────────────────────────
  app.post('/panel/api/pair-user', requireAuth, (req, res) => {
    const { phone, days } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone number required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 7) return res.json({ success: false, message: 'Invalid phone number.' });

    try {
      addUser(clean, parseInt(days) || 30);
      sessionManager.requestPairingCodeFor(clean);
      return res.json({ success: true, pending: true, phone: clean });
    } catch (e) {
      console.error('[PAIR USER ERROR]', e);
      return res.json({ success: false, message: e.message || 'Unknown error.' });
    }
  });

  // ── User pairing — step 2: poll for phone/code ────────────────────────────────
  app.get('/panel/api/pairing-code/:phone', requireAuth, (req, res) => {
    const phone  = String(req.params.phone || '').replace(/\D/g, '');
    const result = sessionManager.getPairingResult(phone);

    if (!result || !result.done) return res.json({ pending: true });

    sessionManager.clearPairingResult(phone);

    if (result.alreadyConnected) return res.json({ success: true, alreadyConnected: true });
    if (result.error)            return res.json({ success: false, message: result.error });
    if (result.code)             return res.json({ success: true, code: result.code, phone });

    return res.json({ success: false, message: 'No pairing code was generated. Please try again.' });
  });

  // ── User pairing — QR: start ──────────────────────────────────────────────────
  app.post('/panel/api/qr/user/start', requireAuth, (req, res) => {
    const { phone, days } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone number required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 7) return res.json({ success: false, message: 'Invalid phone number.' });

    try {
      addUser(clean, parseInt(days) || 30);
      sessionManager.requestUserQR(clean);
      return res.json({ success: true, pending: true, phone: clean });
    } catch (e) {
      return res.json({ success: false, message: e.message || 'Unknown error.' });
    }
  });

  // ── User pairing — QR: poll ───────────────────────────────────────────────────
  app.get('/panel/api/qr/user/:phone', requireAuth, (req, res) => {
    const phone   = String(req.params.phone || '').replace(/\D/g, '');
    const sessId  = `user-${phone}`;
    const sess    = sessionManager.getSession(sessId);

    if (sess?.sock?.user) return res.json({ connected: true });

    const qrData = sessionManager.getSessionQR(sessId);
    if (qrData && Date.now() - qrData.updatedAt < 120_000) {
      return res.json({ qr: qrData.qr, updatedAt: qrData.updatedAt });
    }
    return res.json({ pending: true });
  });

  // ── User management ───────────────────────────────────────────────────────────
  // Returns ONLY users who have successfully paired their WhatsApp.
  app.get('/panel/api/users', requireAuth, (_, res) => {
    const pairedUsers = getUsers().filter(u => u.paired === true);
    res.json({ users: pairedUsers });
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
