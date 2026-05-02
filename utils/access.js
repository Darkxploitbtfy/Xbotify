'use strict';
const { isUserAllowed, getBotMode } = require('./dataManager');
const { getAdminNumber }            = require('./botState');

function isAdmin(jid) {
  const a = getAdminNumber();
  if (!a) return false;
  return jid.split('@')[0] === a;
}

function checkAccess(senderJid) {
  if (isAdmin(senderJid)) return { allowed: true, isAdmin: true };
  if (getBotMode() === 'private') return { allowed: false, reason: 'private_mode', isAdmin: false };
  const res = isUserAllowed(senderJid.split('@')[0]);
  return res.allowed
    ? { allowed: true, isAdmin: false }
    : { allowed: false, reason: res.reason, isAdmin: false };
}

function denyMsg(reason) {
  const map = {
    expired:      '❌ Your access has expired. Contact admin to renew.',
    not_found:    '❌ You are not authorised. Ask admin to add you.',
    inactive:     '❌ Your access is disabled. Contact admin.',
    private_mode: '❌ Bot is in private mode. Only admin can use commands.'
  };
  return map[reason] || '❌ Access denied.';
}

module.exports = { isAdmin, checkAccess, denyMsg };
