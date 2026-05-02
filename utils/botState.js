'use strict';
let _sock      = null;
let _connected = false;
let _admin     = '';

module.exports = {
  setSocket(s)      { _sock = s; },
  getSocket()       { return _sock; },
  setConnected(v)   { _connected = !!v; },
  isConnected()     { return _connected; },
  setAdminNumber(n) { _admin = String(n).replace(/\D/g,''); process.env.ADMIN_NUMBER = _admin; },
  getAdminNumber()  { return _admin || process.env.ADMIN_NUMBER || ''; }
};
