'use strict';
const fs   = require('fs');
const path = require('path');

const D  = path.join(__dirname, '../data');
const UF = path.join(D, 'users.json');
const SF = path.join(D, 'settings.json');
const WF = path.join(D, 'warnings.json');

function r(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function w(f, d)  { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Users ───────────────────────────────────────────────────────────
function getUsers()     { return r(UF, []); }

function addUser(phone, days = 30) {
  const users  = getUsers();
  const expiry = Date.now() + days * 86400000;
  const i      = users.findIndex(u => u.phone === phone);
  if (i !== -1) {
    users[i].expiry = expiry;
    users[i].active = true;
    w(UF, users);
    return users[i];
  }
  const user = { phone, expiry, active: true, addedAt: Date.now(), mode: 'public' };
  users.push(user);
  w(UF, users);
  return user;
}

function removeUser(phone) { w(UF, getUsers().filter(u => u.phone !== phone)); }

function updateUser(phone, patch) {
  const users = getUsers();
  const i     = users.findIndex(u => u.phone === phone);
  if (i === -1) return false;
  users[i] = { ...users[i], ...patch };
  w(UF, users);
  return true;
}

function isUserAllowed(phone) {
  const user = getUsers().find(u => u.phone === phone);
  if (!user)                    return { allowed: false, reason: 'not_found' };
  if (!user.active)             return { allowed: false, reason: 'inactive' };
  if (Date.now() > user.expiry) return { allowed: false, reason: 'expired' };
  return { allowed: true };
}

// ── Per-session-owner mode ──────────────────────────────────────────
// Each person who links their WhatsApp controls their bot's visibility
// independently. Mode is stored in their user record ('mode' field).
// For the global admin (not in users list), mode is stored in settings.json.

function getSessionOwnerMode(phone) {
  if (!phone) return getSettings().botMode || 'public';
  const user = getUsers().find(u => u.phone === phone);
  if (user) return user.mode || 'public';
  // Not in users list → must be the admin
  return getSettings().botMode || 'public';
}

function setSessionOwnerMode(phone, mode) {
  const valid = mode === 'public' || mode === 'private';
  if (!valid) return;
  // Try to update user record first
  const updated = updateUser(phone, { mode });
  if (!updated) {
    // Not in users list → admin; persist in global settings
    const s = getSettings();
    s.botMode = mode;
    saveSettings(s);
  }
}

// ── Global settings (kept for backwards compat) ─────────────────────
function getSettings()    { return r(SF, { botMode: 'public', groups: {} }); }
function saveSettings(s)  { w(SF, s); }
function getBotMode()     { return getSettings().botMode || 'public'; }
function setBotMode(mode) { const s = getSettings(); s.botMode = mode; saveSettings(s); }

function getGroupSettings(gid) {
  const s = getSettings();
  if (!s.groups)       s.groups = {};
  if (!s.groups[gid])  s.groups[gid] = { antilink: false, welcome: false, goodbye: false };
  return s.groups[gid];
}
function updateGroupSettings(gid, patch) {
  const s = getSettings();
  if (!s.groups) s.groups = {};
  s.groups[gid] = { ...(s.groups[gid] || {}), ...patch };
  saveSettings(s);
}

// ── Warnings ────────────────────────────────────────────────────────
function getWarnings()           { return r(WF, {}); }
function addWarning(gid, phone)  {
  const ww = getWarnings(); const k = `${gid}:${phone}`;
  ww[k] = (ww[k] || 0) + 1; w(WF, ww); return ww[k];
}
function resetWarnings(gid, phone) { const ww = getWarnings(); delete ww[`${gid}:${phone}`]; w(WF, ww); }
function getWarningCount(gid, phone) { return getWarnings()[`${gid}:${phone}`] || 0; }

module.exports = {
  getUsers, addUser, removeUser, updateUser, isUserAllowed,
  getSessionOwnerMode, setSessionOwnerMode,
  getSettings, saveSettings, getBotMode, setBotMode,
  getGroupSettings, updateGroupSettings,
  addWarning, resetWarnings, getWarningCount,
};
