'use strict';
const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const path       = require('path');
const { addUser, removeUser, getUsers, updateUser } = require('../utils/dataManager');
const { setAdminNumber, getAdminNumber, isConnected } = require('../utils/botState');

const CREDS  = { username: 'katson', password: '#jesusfuckingchrist#' };
const SECRET = process.env.SESSION_SECRET || 'botifyx-session-secret-2024';

function requireAuth(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.redirect('/panel');
}

function createDashboard() {
  const app = express();

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(session({
    secret: SECRET, resave: false, saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 86400000 }
  }));

  // ── Routes ────────────────────────────────────────────────

  app.get('/',                    (_, res) => res.redirect('/panel'));
  app.get('/panel',               (req, res) => {
    if (req.session?.loggedIn) return res.redirect('/panel/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
  });
  app.get('/panel/dashboard',     requireAuth, (_, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

  app.post('/panel/login', (req, res) => {
    const { username, password } = req.body;
    if (username === CREDS.username && password === CREDS.password) {
      req.session.loggedIn = true;
      return res.json({ success: true, redirect: '/panel/dashboard' });
    }
    res.json({ success: false, message: 'Invalid credentials.' });
  });

  app.post('/panel/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  // ── API ───────────────────────────────────────────────────

  app.get('/panel/api/status', requireAuth, (_, res) => {
    res.json({ connected: isConnected(), adminNumber: getAdminNumber() || null });
  });

  app.post('/panel/api/pair', requireAuth, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone number required.' });
    const clean = String(phone).replace(/\D/g, '');
    if (clean.length < 7) return res.json({ success: false, message: 'Invalid phone number — include country code, digits only.' });
    if (isConnected()) return res.json({ success: false, message: 'Bot is already connected.' });
    try {
      setAdminNumber(clean);
      const { startBot } = require('../bot');
      const code = await startBot(clean);
      if (code) return res.json({ success: true, code });
      return res.json({ success: false, message: 'Could not generate pairing code. A session may already exist.' });
    } catch (e) {
      console.error('[Pair API]', e.message);
      res.json({ success: false, message: e.message });
    }
  });

  app.get('/panel/api/users', requireAuth, (_, res) => {
    res.json({ users: getUsers() });
  });

  app.post('/panel/api/users/add', requireAuth, (req, res) => {
    const { phone, days } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    const user = addUser(String(phone).replace(/\D/g,''), parseInt(days) || 30);
    res.json({ success: true, user });
  });

  app.post('/panel/api/users/remove', requireAuth, (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    removeUser(String(phone).replace(/\D/g,''));
    res.json({ success: true });
  });

  app.post('/panel/api/users/toggle', requireAuth, (req, res) => {
    const { phone, active } = req.body;
    if (!phone) return res.json({ success: false, message: 'Phone required.' });
    res.json({ success: updateUser(String(phone).replace(/\D/g,''), { active: !!active }) });
  });

  return app;
}

module.exports = { createDashboard };
