'use strict';

const path = require('path');

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '../auth');

let _ownerNumber = process.env.OWNER_NUMBER || '';

module.exports = {
  paths: {
    auth: AUTH_DIR,
  },
  owner: {
    get number() {
      return _ownerNumber || process.env.OWNER_NUMBER || '';
    },
    set(num) {
      _ownerNumber = String(num).replace(/\D/g, '');
      process.env.OWNER_NUMBER = _ownerNumber;
      process.env.ADMIN_NUMBER = _ownerNumber;
    },
  },
};
