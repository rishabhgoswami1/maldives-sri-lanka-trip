/* Shared bring list for the Maldives / Sri Lanka trip.

   The whole list (items and ticks) lives in a Firebase Realtime Database at
     <db>/lists/<key>/bring/<itemId> = { who, cat, text, ord, done? }
   and is read and written over plain HTTPS: no library, no login. <key> comes from the trip password
   (see core.js), so only people who know the password can see or change the list.
   Changes stream in live; changes made offline wait in a queue on the phone and go out later.

   To add or remove items from the Mac, use ~/sri-lanka-maldives-trip/site-admin/list.mjs. */
(function () {
  'use strict';

  var PEOPLE = [
    { id: 'rishabh', name: 'Rishabh' },
    { id: 'divya', name: 'Divya' }
  ];
  // Sections, in page order. An item whose "cat" isn't listed here still shows, in a section of its own.
  var CATS = [
    { id: 'docs', label: '🛂 Documents' },
    { id: 'money', label: '💳 Money and cards' },
    { id: 'tech', label: '🔌 Phone and chargers' },
    { id: 'clothes', label: '👕 Clothes' },
    { id: 'beach', label: '🩱 Beach and swim' },
    { id: 'shoes', label: '🩴 Footwear' },
    { id: 'care', label: '🧴 Toiletries and sun' },
    { id: 'health', label: '💊 Health' },
    { id: 'photo', label: '📷 Camera and photos' },
    { id: 'cabin', label: '🎒 For the flight' },
    { id: 'other', label: '✨ Anything else' }
  ];
  var LIST = 'bring';
  var MAX_TEXT = 200;
  var store = { who: 'mlsl-who', cache: 'mlsl-bring-cache-v1', queue: 'mlsl-bring-queue-v1' };

  var $ = function (id) { return document.getElementById(id); };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsJson(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch (e) { return fallback; } }

  // ---- where the data is ------------------------------------------------------------------------
  function base() { return Trip.path(LIST); }

  // ---- state -------------------------------------------------------------------------------------
  var server = {};   // the list as the database last sent it
  var queue = [];    // changes made here that the database hasn't confirmed yet
  var who = lsGet(store.who) === 'divya' ? 'divya' : 'rishabh';
  var online = false;
  var sending = false;

  function clean(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (id) {
      var it = obj[id];
      if (it && typeof it === 'object' && typeof it.text === 'string' && it.text) out[id] = it;
    });
    return out;
  }
  function applyOp(target, op) {
    if (op.op === 'del') delete target[op.id];
    else if (op.op === 'put') target[op.id] = op.val;
    else if (op.op === 'patch' && target[op.id]) {
      var merged = {};
      Object.keys(target[op.id]).forEach(function (k) { merged[k] = target[op.id][k]; });
      Object.keys(op.val).forEach(function (k) { merged[k] = op.val[k]; });
      target[op.id] = merged;
    }
  }
  function view() {
    var v = {};
    Object.keys(server).forEach(function (id) { v[id] = server[id]; });
    queue.forEach(function (op) { applyOp(v, op); });
    return v;
  }
  function saveLocal() {
    lsSet(store.cache, JSON.stringify({ key: Trip.keyTag(), items: server }));
    lsSet(store.queue, JSON.stringify({ key: Trip.keyTag(), ops: queue }));
  }

  // ---- talking to the database -------------------------------------------------------------------
  function setSync(text, cls) { var el = $('sync'); el.textContent = text; el.className = 'sync ' + (cls || ''); }
  function showSync() {
    if (queue.length) setSync('⏳ ' + queue.length + (queue.length === 1 ? ' change' : ' changes') + ' waiting for internet (saved on this phone)', 'warn');
    else if (online) setSync('✓ Live: you both see the same list', 'ok');
    else setSync('⚠️ Offline: showing the last saved list', 'warn');
  }

  function change(op) {
    queue.push(op);
    saveLocal(); render(); showSync();
    flush();
  }
  function flush() {
    if (sending || !queue.length || !Trip.hasKey()) return;
    sending = true;
    var op = queue[0];
    var url = base() + '/' + encodeURIComponent(op.id) + '.json';
    var init = op.op === 'del' ? { method: 'DELETE' }
      : { method: op.op === 'put' ? 'PUT' : 'PATCH', body: JSON.stringify(op.val) };
    fetch(url, init).then(function (r) {
      sending = false;
      if (r.ok) { applyOp(server, op); online = true; }
      else if (r.status >= 500 || r.status === 429) { throw new Error('busy'); }
      // Any other answer means the database refused it (for example a tick on an item the other
      // person just removed): drop the change rather than retrying it for ever.
      queue.shift();
      saveLocal(); render(); showSync();
      flush();
    }).catch(function () {
      sending = false; online = false; showSync();
    });
  }
  setInterval(function () { if (queue.length) flush(); }, 15000);
  window.addEventListener('online', flush);

  function setAt(segs, data) {
    if (!segs.length) { server = clean(data); return; }
    var id = segs[0];
    if (segs.length === 1) {
      if (data === null || data === undefined) delete server[id]; else server[id] = data;
      return;
    }
    if (!server[id]) server[id] = {};
    if (data === null || data === undefined) delete server[id][segs[1]]; else server[id][segs[1]] = data;
  }
  function onEvent(kind, msg) {
    var segs = (msg.path || '/').split('/').filter(Boolean);
    if (kind === 'put') setAt(segs, msg.data);
    else Object.keys(msg.data || {}).forEach(function (k) { setAt(segs.concat(k.split('/').filter(Boolean)), msg.data[k]); });
    server = clean(server);
    online = true;
    saveLocal(); render(); showSync();
  }

  var es = null, retry = null;
  function stop() { if (es) es.close(); es = null; clearTimeout(retry); }
  function listen() {
    if (es) es.close();
    clearTimeout(retry);
    if (!window.EventSource) { poll(); return; }
    es = new EventSource(base() + '.json');
    es.addEventListener('put', function (e) { onEvent('put', JSON.parse(e.data)); });
    es.addEventListener('patch', function (e) { onEvent('patch', JSON.parse(e.data)); });
    es.addEventListener('cancel', function () { stop(); Trip.lock('The password has changed. Enter the new one.'); });
    es.onopen = function () { online = true; showSync(); flush(); };
    es.onerror = function () {
      online = false; showSync();
      // The browser reconnects by itself after a dropped connection; a closed stream needs a fresh start.
      if (es.readyState === 2) retry = setTimeout(start, 8000);
    };
  }
  function poll() {
    fetch(base() + '.json').then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) { onEvent('put', { path: '/', data: d }); flush(); })
      .catch(function () { online = false; showSync(); });
    retry = setTimeout(poll, 15000);
  }
  function start() {
    // One plain request first: it tells a wrong key (the database says no) apart from no internet.
    fetch(base() + '.json?shallow=true').then(function (r) {
      if (r.status === 401 || r.status === 403) { stop(); Trip.lock('The password has changed. Enter the new one.'); return; }
      listen();
    }).catch(function () { online = false; showSync(); listen(); });
  }

  // ---- drawing -----------------------------------------------------------------------------------
  var sections = {};  // cat id -> { root, list, badge, empty, form, input, both }
  var rows = {};      // item id -> { root, box, text }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function otherPerson() { return PEOPLE[0].id === who ? PEOPLE[1] : PEOPLE[0]; }
  function catLabel(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i].label;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
  function newId() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function makeSection(cat) {
    var root = el('section');
    root.dataset.cat = cat;
    var h = el('h2'); h.appendChild(el('span', '', catLabel(cat)));
    var badge = el('small'); h.appendChild(badge);
    var empty = el('p', 'empty', 'Nothing here yet.');
    var list = el('div', 'rows');

    var add = el('div', 'add');
    var open = el('button', '', '＋ Add'); open.type = 'button';
    var form = el('form'); form.hidden = true;
    var input = el('input'); input.type = 'text'; input.maxLength = MAX_TEXT;
    input.placeholder = 'What to bring?'; input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done'); input.setAttribute('aria-label', 'New item in ' + catLabel(cat));
    var go = el('button', 'go', 'Add'); go.type = 'submit';
    var x = el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
    var bothLabel = el('label', 'both');
    var both = el('input'); both.type = 'checkbox';
    var bothText = el('span');
    bothLabel.appendChild(both); bothLabel.appendChild(bothText);
    form.appendChild(input); form.appendChild(go); form.appendChild(x); form.appendChild(bothLabel);
    add.appendChild(open); add.appendChild(form);

    open.addEventListener('click', function () { open.hidden = true; form.hidden = false; input.focus(); });
    x.addEventListener('click', function () { form.hidden = true; open.hidden = false; input.value = ''; both.checked = false; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (!text) { input.focus(); return; }
      var now = Date.now();
      var forWhom = both.checked ? [who, otherPerson().id] : [who];
      forWhom.forEach(function (p, i) {
        change({ op: 'put', id: newId(), val: { who: p, cat: cat, text: text, ord: now + i } });
      });
      // Stay open: adding several things in a row is the common case. "Both" is a per-item choice.
      input.value = ''; both.checked = false; input.focus();
    });

    root.appendChild(h); root.appendChild(empty); root.appendChild(list); root.appendChild(add);
    return { root: root, list: list, badge: badge, empty: empty, form: form, open: open, input: input, both: both, bothText: bothText };
  }

  function makeRow(id) {
    var root = el('div', 'row');
    var label = el('label');
    var box = el('input'); box.type = 'checkbox';
    var text = el('span');
    label.appendChild(box); label.appendChild(text);
    var acts = el('div', 'acts');
    var ren = el('button', 'ren', '✎'); ren.type = 'button'; ren.setAttribute('aria-label', 'Rename');
    var del = el('button', 'del', '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove');
    acts.appendChild(ren); acts.appendChild(del);
    root.appendChild(label); root.appendChild(acts);

    box.addEventListener('change', function () { change({ op: 'patch', id: id, val: { done: box.checked } }); });
    ren.addEventListener('click', function () {
      var cur = (view()[id] || {}).text || '';
      var next = prompt('Change this item to:', cur);
      if (next === null) return;
      next = next.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (next && next !== cur) change({ op: 'patch', id: id, val: { text: next } });
    });
    del.addEventListener('click', function () {
      var cur = (view()[id] || {}).text || 'this item';
      if (confirm('Remove "' + cur + '" from the list?')) change({ op: 'del', id: id });
    });
    return { root: root, box: box, text: text };
  }

  function render() {
    var items = view();
    var pendingIds = {};
    queue.forEach(function (op) { pendingIds[op.id] = true; });

    // Counts for the two buttons at the top.
    PEOPLE.forEach(function (p) {
      var mine = Object.keys(items).filter(function (id) { return items[id].who === p.id; });
      var done = mine.filter(function (id) { return items[id].done === true; }).length;
      var btn = $('who-' + p.id);
      btn.setAttribute('aria-pressed', String(p.id === who));
      btn.querySelector('small').textContent = done + ' / ' + mine.length + ' packed';
      if (p.id === who) {
        $('meter').style.width = (mine.length ? done / mine.length * 100 : 0) + '%';
        $('count').textContent = done + ' / ' + mine.length;
      }
    });

    // Which sections to show: the fixed ones, then any other category this person has items in.
    var ids = Object.keys(items).filter(function (id) { return items[id].who === who; });
    var byCat = {};
    ids.forEach(function (id) { var c = items[id].cat || 'other'; (byCat[c] = byCat[c] || []).push(id); });
    var order = CATS.map(function (c) { return c.id; });
    Object.keys(byCat).sort().forEach(function (c) { if (order.indexOf(c) < 0) order.splice(order.length - 1, 0, c); });

    var host = $('lists');
    order.forEach(function (cat, i) {
      var sec = sections[cat] || (sections[cat] = makeSection(cat));
      if (host.children[i] !== sec.root) host.insertBefore(sec.root, host.children[i] || null);
      var list = (byCat[cat] || []).sort(function (a, b) {
        return (items[a].ord || 0) - (items[b].ord || 0) || (a < b ? -1 : 1);
      });
      list.forEach(function (id, j) {
        var row = rows[id] || (rows[id] = makeRow(id));
        if (row.text.textContent !== items[id].text) row.text.textContent = items[id].text;
        row.box.checked = items[id].done === true;
        row.root.classList.toggle('pending', !!pendingIds[id]);
        if (sec.list.children[j] !== row.root) sec.list.insertBefore(row.root, sec.list.children[j] || null);
      });
      while (sec.list.children.length > list.length) sec.list.removeChild(sec.list.lastChild);
      var done = list.filter(function (id) { return items[id].done === true; }).length;
      sec.badge.textContent = done + '/' + list.length;
      sec.badge.hidden = !list.length;
      sec.empty.hidden = !!list.length;
      sec.root.classList.toggle('complete', list.length > 0 && done === list.length);
      sec.bothText.textContent = 'Also add it to ' + otherPerson().name + '\'s list';
    });
    // Drop sections that are no longer needed, and rows of items that are gone.
    Object.keys(sections).forEach(function (cat) {
      if (order.indexOf(cat) < 0) { if (sections[cat].root.parentNode) host.removeChild(sections[cat].root); delete sections[cat]; }
    });
    Object.keys(rows).forEach(function (id) {
      if (!items[id] || items[id].who !== who) { if (rows[id].root.parentNode) rows[id].root.parentNode.removeChild(rows[id].root); delete rows[id]; }
    });
  }

  // ---- buttons -----------------------------------------------------------------------------------
  PEOPLE.forEach(function (p) {
    $('who-' + p.id).addEventListener('click', function () {
      if (who === p.id) return;
      who = p.id; lsSet(store.who, who);
      Object.keys(sections).forEach(function (c) {
        var s = sections[c]; s.form.hidden = true; s.open.hidden = false; s.input.value = ''; s.both.checked = false;
      });
      render();
    });
  });
  $('edit').addEventListener('click', function () {
    var on = document.body.classList.toggle('editing');
    $('edit').textContent = on ? '✓ Done' : '✎ Edit list';
    $('edit').setAttribute('aria-pressed', String(on));
  });
  $('untick').addEventListener('click', function () {
    var items = view();
    var mine = Object.keys(items).filter(function (id) { return items[id].who === who && items[id].done === true; });
    if (!mine.length) return;
    var name = PEOPLE.filter(function (p) { return p.id === who; })[0].name;
    if (!confirm('Untick all ' + mine.length + ' ticked items on ' + name + '\'s list?')) return;
    mine.forEach(function (id) { change({ op: 'patch', id: id, val: { done: false } }); });
  });
  // ---- go ----------------------------------------------------------------------------------------
  Trip.init(function () {
    var cached = lsJson(store.cache, {}), queued = lsJson(store.queue, {});
    server = cached.key === Trip.keyTag() ? clean(cached.items) : {};
    queue = queued.key === Trip.keyTag() && Array.isArray(queued.ops) ? queued.ops : [];
    render(); showSync();
    start();
  });
})();
