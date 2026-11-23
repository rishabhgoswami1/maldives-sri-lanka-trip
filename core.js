/* Shared by both pages: where the database is, and the password gate.

   Nothing about the trip is in these public files. The data (the bring list and the day-by-day plan)
   lives in a Firebase Realtime Database under /lists/<key>/..., where <key> is worked out from the
   trip password (PBKDF2-SHA256). The database only answers for the right key, so the pages can only
   load data for someone who typed the right password. The key (never the password) is remembered
   on the device so the password is asked once per phone. */
window.Trip = (function () {
  'use strict';
  var SALT = 'maldives-sri-lanka-trip-2026';
  var ROUNDS = 600000;   // slow on purpose: every guess at the password costs this much work
  var TRIES_STORE = 'mlsl-tries';
  var KEY_STORE = 'mlsl-key-v2';
  var DATA_STORES = ['mlsl-bring-cache-v1', 'mlsl-bring-queue-v1', 'mlsl-plan-cache-v1', 'mlsl-key'];

  var cfg = window.TRIP_CONFIG || {};
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var dbRoot = cfg.db || '';
  // On the Mac the pages talk to the stand-in database (site-admin/mock-db.mjs), or to ?db=<url>.
  if (isLocal) dbRoot = new URLSearchParams(location.search).get('db') || location.origin + '/db';
  dbRoot = dbRoot.replace(/\/+$/, '');

  function $(id) { return document.getElementById(id); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var key = lsGet(KEY_STORE) || '';
  var onReady = null;

  // A pause after 5 wrong passwords in a row: 30 s, then longer, up to 5 minutes. It only slows down
  // guessing on this page; what really keeps guessers out is a password that isn't guessable.
  var tries = { n: 0, until: 0 };
  try { tries = JSON.parse(lsGet(TRIES_STORE)) || tries; } catch (e) {}
  function waitLeft() { return Math.max(0, Math.ceil((tries.until - Date.now()) / 1000)); }
  function wrongTry() {
    tries.n += 1;
    if (tries.n >= 5) tries.until = Date.now() + Math.min(300, 30 * (tries.n - 4)) * 1000;
    lsSet(TRIES_STORE, JSON.stringify(tries));
  }

  function derive(password) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password.trim().toLowerCase().normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
      .then(function (material) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SALT), iterations: ROUNDS }, material, 256);
      })
      .then(function (bits) {
        return Array.prototype.map.call(new Uint8Array(bits), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
  }

  function showGate(message) {
    $('app').hidden = true;
    $('gate').hidden = false;
    if (message) $('gate-msg').textContent = message;
    if ($('lock')) $('lock').hidden = true;
  }
  function open() {
    $('gate').hidden = true;
    $('app').hidden = false;
    if ($('lock')) $('lock').hidden = false;
    if (onReady) onReady();
  }
  // Forget the key and everything saved on this device, and ask for the password again.
  function lock(message) {
    key = '';
    lsDel(KEY_STORE);
    DATA_STORES.forEach(lsDel);
    showGate(message || 'Enter the trip password.');
  }

  function init(ready) {
    onReady = ready;
    if (!dbRoot) { showGate('The trip pages aren\'t connected yet.'); $('gate-form').hidden = true; return; }
    if (!window.crypto || !crypto.subtle) { showGate('This browser can\'t open the trip pages. Try Safari or Chrome.'); $('gate-form').hidden = true; return; }

    $('gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('gate-input'), button = $('gate-form').querySelector('button');
      if (!input.value.trim()) { input.focus(); return; }
      if (waitLeft()) { $('gate-msg').textContent = 'Too many wrong tries. Wait ' + waitLeft() + ' seconds, then try again.'; return; }
      button.disabled = true; $('gate-msg').textContent = 'Checking…';
      derive(input.value).then(function (k) {
        return fetch(dbRoot + '/lists/' + k + '/bring.json?shallow=true').then(function (r) {
          button.disabled = false;
          if (r.status === 401 || r.status === 403) {
            wrongTry();
            $('gate-msg').textContent = waitLeft() ? 'That password isn\'t right. Wait ' + waitLeft() + ' seconds before the next try.' : 'That password isn\'t right. Try again.';
            input.select(); return;
          }
          if (!r.ok) throw new Error('unexpected');
          key = k; lsSet(KEY_STORE, k); lsDel(TRIES_STORE); tries = { n: 0, until: 0 }; input.value = '';
          open();
        });
      }).catch(function () {
        button.disabled = false;
        $('gate-msg').textContent = 'Couldn\'t check the password: no internet? Try again.';
      });
    });
    if ($('lock')) $('lock').addEventListener('click', function () {
      if (confirm('Lock the trip pages on this phone? You will need the password to open them again.')) { lock(); location.reload(); }
    });

    if (key) open(); else showGate();
  }

  return {
    init: init,
    lock: lock,
    hasKey: function () { return !!key; },
    keyTag: function () { return key.slice(0, 8); },           // only to tell one key's saved data from another's
    path: function (sub) { return dbRoot + '/lists/' + key + '/' + sub; }   // add ".json" to call it
  };
})();
