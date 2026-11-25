/* Draws the day-by-day plan. The plan itself is not in this file or in the page: it is one document
   in the database (/lists/<key>/plan), fetched after the password, and kept on the phone so the page
   also opens with no internet. To change the plan, edit ~/sri-lanka-maldives-trip/site-admin/plan.json
   and run: node site-admin/plan.mjs push */
(function () {
  'use strict';
  var CACHE = 'mlsl-plan-cache-v1';
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TAGS = { optional: ['opt', 'Optional'], top: ['top', 'Top pick'], booked: ['top', 'Booked'] };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  // "Lunch at [[Name|maps search]]" -> text with a map pin. Everything is added as text, never as HTML.
  function rich(parent, text) {
    var re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, last = 0, m;
    text = String(text || '');
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el('a', 'pin', '📍 ' + m[1]);
      a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(m[2] || m[1]);
      a.target = '_blank'; a.rel = 'noopener';
      parent.appendChild(a);
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }
  function parts(iso) {  // "2026-12-11" -> { day: "11", wd: "Fri", label: "Fri 11 Dec" }
    var p = String(iso || '').split('-').map(Number);
    var d = new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
    if (isNaN(d)) return { day: '', wd: '', label: '' };
    var wd = DAYS[d.getUTCDay()];
    return { day: String(p[2]), wd: wd, label: wd + ' ' + p[2] + ' ' + MONTHS[p[1] - 1] };
  }
  function list(v) { return Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : []; }

  function render(plan) {
    var now = new Date();
    var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    var nav = $('days'), host = $('plan');
    nav.textContent = ''; host.textContent = '';
    $('subtitle').textContent = (plan.meta && plan.meta.subtitle) || '';
    var leg = null, todayCard = null, todayChip = null;

    list(plan.days).forEach(function (d) {
      var when = parts(d.date);
      var chip = el('a'); chip.href = '#' + d.id;
      chip.appendChild(el('b', '', when.day)); chip.appendChild(document.createTextNode(when.wd));
      nav.appendChild(chip);

      if (d.leg && d.leg !== leg) { leg = d.leg; host.appendChild(el('div', 'leg', leg)); }
      var sec = el('section', 'day'); sec.id = d.id;
      // A day can carry a soft colour wash: "tint": "rose" on the day in plan.json.
      if (d.tint === 'rose') { sec.classList.add('tint-rose'); chip.classList.add('tint-rose'); }
      sec.appendChild(el('div', 'date', d.label || when.label));
      var h = el('h2', '', d.title || '');
      if (d.sub) h.appendChild(el('span', 'sub', d.sub));
      sec.appendChild(h);
      if (d.status) sec.appendChild(el('span', 'status' + (d.open ? ' open' : ''), d.status));
      list(d.stops).forEach(function (s) {
        var row = el('div', 'stop');
        row.appendChild(el('div', 'time', s.t || ''));
        var what = el('div', 'what');
        rich(what, s.what);
        if (TAGS[s.tag]) { what.appendChild(document.createTextNode(' ')); what.appendChild(el('span', TAGS[s.tag][0], TAGS[s.tag][1])); }
        if (s.note) rich(what.appendChild(el('small')), s.note);
        row.appendChild(what);
        sec.appendChild(row);
      });
      if (d.tip) sec.appendChild(el('div', 'tip', d.tip));
      host.appendChild(sec);
      if (d.date === today) { sec.classList.add('today'); chip.classList.add('today'); todayCard = sec; todayChip = chip; }
    });

    var groups = list(plan.contacts);
    if (groups.length) {
      var help = el('section', 'help');
      help.appendChild(el('h2', '', '📞 Contacts'));
      groups.forEach(function (g) {
        if (g.group) help.appendChild(el('h3', '', g.group));
        var box = el('div', 'contacts');
        list(g.items).forEach(function (c) {
          var a = el('a', '', (c.name || '') + ' ');
          a.href = 'tel:' + String(c.tel || '').replace(/[^+\d]/g, '');
          a.appendChild(el('b', '', c.show || c.tel || ''));
          box.appendChild(a);
        });
        help.appendChild(box);
      });
      host.appendChild(help);
    }

    if (todayChip) todayChip.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (location.hash && document.getElementById(location.hash.slice(1))) document.getElementById(location.hash.slice(1)).scrollIntoView();
    else if (todayCard) todayCard.scrollIntoView({ block: 'start' });
  }

  function note(text, cls) { var n = $('sync'); n.textContent = text; n.className = 'sync ' + (cls || ''); n.hidden = !text; }

  // Ask before dialling: no accidental calls.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a) return;
    var name = (a.childNodes[0] && a.childNodes[0].textContent || '').trim();
    var num = a.getAttribute('href').replace('tel:', '');
    if (!confirm('Call ' + (name ? name + ' on ' + num : num) + '?')) e.preventDefault();
  });

  Trip.init(function () {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(CACHE)); } catch (e) {}
    var shown = false;
    if (saved && saved.key === Trip.keyTag() && saved.plan) { render(saved.plan); shown = true; }
    else note('Loading the plan…');

    fetch(Trip.path('plan') + '.json').then(function (r) {
      if (r.status === 401 || r.status === 403) { Trip.lock('The password has changed. Enter the new one.'); return null; }
      if (!r.ok) throw new Error('unexpected');
      return r.json().then(function (plan) {
        if (!plan || !plan.days) { if (!shown) note('The plan hasn\'t been added yet.', 'warn'); return; }
        try { localStorage.setItem(CACHE, JSON.stringify({ key: Trip.keyTag(), plan: plan })); } catch (e) {}
        render(plan);
        note(plan.meta && plan.meta.updated ? 'Plan last changed ' + plan.meta.updated : '');
      });
    }).catch(function () {
      note(shown ? '⚠️ Offline: showing the plan saved on this phone' : '⚠️ No internet, and no plan saved on this phone yet', 'warn');
    });
  });
})();
