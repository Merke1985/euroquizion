// The content editor (🔧 Testing → ✏️ Edit songs & prompts): the Key Change! songs (with the part to sing and the
// lyrics), the Disqualivision clips and prompts, and the United by Nonsense translations. Saved in Supabase
// (escSave in quiz.js), so it is live for everyone on the next game; an optional password protects it.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TABS = [['jury', '🎤 Key Change!'], ['green', '🛋️ Disqualivision clips'], ['roasts', '💬 Disqualivision prompts'], ['titles', '🌍 United by Nonsense'], ['pass', '🔒 Password']];
  var tab = 'jury', W = null, data = null, dirty = false;
  function H() { return (window.escHostData && window.escHostData()) || { songs: [], countries: {}, chorusBase: {} }; }
  function pass() { try { return sessionStorage.getItem('esc-edit-pass') || ''; } catch (e) { return ''; } }
  function ytId(v) { v = String(v || '').trim(); var m = v.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : /^[\w-]{11}$/.test(v) ? v : ''; }
  function songOf(id) { var s = H().songs.filter(function (x) { return x[4] === id; })[0]; return s; }
  function songName(s) { var c = H().countries[s[1]] || s[1]; return s[3] + ' – ' + s[2] + ' (' + c + ' ' + s[0] + ')'; }
  // Times are shown and typed as m:ss.cc (1:20.00); typing plain seconds (80 or 80,5) works too.
  function tFmt(v) { v = Math.max(0, +v || 0); var m = Math.floor(v / 60), r = v - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2); }
  function tParse(t) {
    t = String(t || '').trim().replace(',', '.'); if (!t) return null;
    var m = t.match(/^(\d+):(\d{1,2}(?:\.\d*)?)$/); if (m) return +m[1] * 60 + +m[2];
    return /^\d+(\.\d*)?$/.test(t) ? +t : null;
  }
  function tInput(cls, v, k) { return '<input type="text" inputmode="decimal" class="' + cls + ' xetime" placeholder="0:00.00"' + (k != null ? ' data-k="' + k + '"' : '') + ' value="' + tFmt(v) + '">'; }
  function tWire(el, set) {
    el.addEventListener('input', function () { var v = tParse(el.value); el.classList.toggle('bad', v == null); if (v != null) { set(v); touch(); } });
    el.addEventListener('change', function () { var v = tParse(el.value); if (v != null) el.value = tFmt(v); });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fresh() {   // a working copy of what is live now
    var h = H();
    data = {
      jury: clone(ESC_EDIT.jury || h.chorusBase || {}), lyrics: clone(ESC_EDIT.lyrics || LYRICS || {}),
      green: clone(QUIP_SONGS), roasts: clone(ROASTS), titles: clone(ESC_EDIT.titles || {})
    };
    dirty = false;
  }
  function open() {
    if (!W) {
      W = document.createElement('div'); W.id = 'editov'; W.className = 'testov editov';
      W.innerHTML = '<div class="testcard xecard"><div class="testhead"><h2>✏️ Songs &amp; prompts</h2><input type="password" id="xepass" placeholder="Password (if you set one)" autocomplete="off"><button class="btn alt small" id="xeclose" type="button">Close</button></div>' +
        '<div class="xetabs">' + TABS.map(function (t) { return '<button type="button" class="xetab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="xebody"></div>' +
        '<div class="xefoot"><span id="xemsg"></span><button class="btn alt small" id="xedef" type="button">Back to the built-in list</button><button class="btn small" id="xesave" type="button">💾 Save</button></div></div>';
      document.body.appendChild(W);
      $('xepass').value = pass();
      $('xepass').addEventListener('input', function () { try { sessionStorage.setItem('esc-edit-pass', this.value); } catch (e) {} });
      $('xeclose').addEventListener('click', close);
      W.addEventListener('click', function (e) { if (e.target === W) close(); });
      [].forEach.call(W.querySelectorAll('.xetab'), function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-t'); draw(); }); });
      $('xesave').addEventListener('click', save);
      $('xedef').addEventListener('click', backToDefault);
    }
    if (!escClient()) { W.querySelector('#xebody').innerHTML = '<p class="mute">There is no Supabase connection on this page, so nothing can be saved.</p>'; }
    fresh(); W.classList.remove('hidden'); draw();
  }
  function close() { if (dirty && !confirmLeave()) return; W.classList.add('hidden'); }
  function confirmLeave() { msg('You have unsaved changes: press Save, or Close again to throw them away.', 'warn'); dirty = false; return false; }
  function msg(t, k) { var m = $('xemsg'); m.textContent = t || ''; m.className = k || ''; }
  function touch() { dirty = true; msg('Not saved yet', 'warn'); }
  function draw() {
    [].forEach.call(W.querySelectorAll('.xetab'), function (b) { b.classList.toggle('on', b.getAttribute('data-t') === tab); });
    $('xesave').classList.toggle('hidden', tab === 'pass'); $('xedef').classList.toggle('hidden', tab === 'pass');
    var B = $('xebody'); msg(dirty ? 'Not saved yet' : '', dirty ? 'warn' : '');
    if (tab === 'jury') drawJury(B); else if (tab === 'green') drawGreen(B); else if (tab === 'roasts') drawRoasts(B); else if (tab === 'titles') drawTitles(B); else drawPass(B);
  }
  // ---- Key Change!: the songs to choose from, the part to sing, and the lyrics on the phones ----
  function drawJury(B) {
    var ids = Object.keys(data.jury);
    B.innerHTML = '<p class="mute">The songs players vote on in Key Change! (up to four of them come up each time). Set the part they sing, in seconds from the start of the video, and the lyrics shown on their phones.</p>' +
      '<div class="xelist">' + (ids.length ? ids.map(function (id) {
        var s = songOf(id), c = data.jury[id] || [0, 0], ly = data.lyrics[id] || '';
        return '<div class="xerow" data-id="' + id + '"><div class="xerowtop"><b>' + esc(s ? songName(s) : id) + '</b>' +
          '<label>from ' + tInput('xen', c[0], 0) + '</label><label>to ' + tInput('xen', c[1], 1) + '</label>' +
          '<a class="btn alt small" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + id + '&t=' + Math.floor(c[0]) + 's">▶ Listen</a><button type="button" class="btn alt small xely">' + (ly ? '📝 Lyrics ✓' : '📝 Lyrics') + '</button><button type="button" class="btn alt small xedel">🗑</button></div>' +
          '<textarea class="xelytxt hidden" rows="8" placeholder="The lyrics, one line per line">' + esc(ly) + '</textarea></div>';
      }).join('') : '<p class="mute">No songs yet: Key Change! then picks random songs.</p>') + '</div>' +
      '<h3>Add a song</h3><input type="search" id="xefind" placeholder="Search title, artist, country or year…"><div id="xefound" class="xefound"></div>';
    [].forEach.call(B.querySelectorAll('.xerow'), function (r) {
      var id = r.getAttribute('data-id');
      [].forEach.call(r.querySelectorAll('.xen'), function (n) { tWire(n, function (v) { data.jury[id][+n.getAttribute('data-k')] = v; }); });
      r.querySelector('.xely').addEventListener('click', function () { r.querySelector('.xelytxt').classList.toggle('hidden'); });
      r.querySelector('.xelytxt').addEventListener('input', function () { if (this.value.trim()) data.lyrics[id] = this.value; else delete data.lyrics[id]; touch(); });
      r.querySelector('.xedel').addEventListener('click', function () { delete data.jury[id]; touch(); draw(); });
    });
    find(B, function (s) { return !data.jury[s[4]]; }, function (s) { data.jury[s[4]] = [60, 80]; touch(); draw(); });
  }
  function find(B, ok, add) {
    var inp = B.querySelector('#xefind'), out = B.querySelector('#xefound');
    inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase(); if (q.length < 2) { out.innerHTML = ''; return; }
      var hits = H().songs.filter(function (s) { return ok(s) && (s[3] + ' ' + s[2] + ' ' + (H().countries[s[1]] || '') + ' ' + s[0]).toLowerCase().indexOf(q) >= 0; }).slice(0, 12);
      out.innerHTML = hits.length ? hits.map(function (s) { return '<button type="button" class="xehit" data-id="' + s[4] + '">＋ ' + esc(songName(s)) + '</button>'; }).join('') : '<p class="mute">Nothing found.</p>';
      [].forEach.call(out.querySelectorAll('.xehit'), function (b) { b.addEventListener('click', function () { add(songOf(b.getAttribute('data-id'))); }); });
    });
  }
  // ---- Disqualivision: the clips (a YouTube video and where to start) ----
  function drawGreen(B) {
    B.innerHTML = '<p class="mute">The performances shown in Disqualivision: one per round, never twice in one game. Paste a YouTube link (or the video id) and the second it should start at.</p>' +
      '<div class="xelist">' + data.green.map(function (c, i) {
        return '<div class="xerow" data-i="' + i + '"><div class="xerowtop"><input type="text" class="xename" placeholder="Name (for you)" value="' + esc(c.name || '') + '"><input type="text" class="xeyt" placeholder="YouTube link or id" value="' + esc(c.id) + '"><label>start ' + tInput('xen', c.s || 0) + '</label>' +
          '<a class="btn alt small" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' + esc(c.id) + '&t=' + (c.s || 0) + 's">▶ Watch</a><button type="button" class="btn alt small xedel">🗑</button></div></div>';
      }).join('') + '</div><button type="button" class="btn alt small" id="xeadd">＋ Add a clip</button>';
    [].forEach.call(B.querySelectorAll('.xerow'), function (r) {
      var c = data.green[+r.getAttribute('data-i')];
      r.querySelector('.xename').addEventListener('input', function () { c.name = this.value; touch(); });
      r.querySelector('.xeyt').addEventListener('change', function () { var id = ytId(this.value); this.classList.toggle('bad', !id); if (id) { c.id = id; this.value = id; } touch(); });
      tWire(r.querySelector('.xen'), function (v) { c.s = v; });
      r.querySelector('.xedel').addEventListener('click', function () { data.green.splice(data.green.indexOf(c), 1); touch(); draw(); });
    });
    $('xeadd').addEventListener('click', function () { data.green.push({ id: '', s: 0, name: '' }); touch(); draw(); });
  }
  // ---- Disqualivision: the prompts (and the house answer, used when only one player wrote something) ----
  function drawRoasts(B) {
    B.innerHTML = '<p class="mute">The questions players answer about the performance. The house answer is used when only one player wrote something.</p>' +
      '<div class="xelist">' + data.roasts.map(function (r, i) {
        return '<div class="xerow" data-i="' + i + '"><div class="xerowtop"><input type="text" class="xep" placeholder="The question" value="' + esc(r.p) + '"><input type="text" class="xeh" placeholder="House answer" value="' + esc(r.h || '') + '"><button type="button" class="btn alt small xedel">🗑</button></div></div>';
      }).join('') + '</div><button type="button" class="btn alt small" id="xeadd">＋ Add a prompt</button>';
    [].forEach.call(B.querySelectorAll('.xerow'), function (row) {
      var r = data.roasts[+row.getAttribute('data-i')];
      row.querySelector('.xep').addEventListener('input', function () { r.p = this.value; touch(); });
      row.querySelector('.xeh').addEventListener('input', function () { r.h = this.value; touch(); });
      row.querySelector('.xedel').addEventListener('click', function () { data.roasts.splice(data.roasts.indexOf(r), 1); touch(); draw(); });
    });
    $('xeadd').addEventListener('click', function () { data.roasts.push({ p: '', h: '' }); touch(); draw(); B.querySelector('.xerow:last-child .xep').focus(); });
  }
  // ---- United by Nonsense: the English translation of every non-English title ----
  var tq = '', tAll = false;
  function trOf(id) { return Object.prototype.hasOwnProperty.call(data.titles, id) ? (data.titles[id] || '') : (TITLE_BASE[id] || ''); }
  function drawTitles(B) {
    var all = H().songs.filter(function (s) { return String(s[10]).toLowerCase() !== 'english'; });
    var withTr = all.filter(function (s) { return trOf(s[4]); }).length;
    B.innerHTML = '<p class="mute">United by Nonsense asks what a title means; the real English translation hides between the players’ made-up ones. ' + withTr + ' of ' + all.length + ' non-English songs have a translation (only those can come up).</p>' +
      '<div class="xerowtop"><input type="search" id="xetq" placeholder="Search title, artist, country or year…" value="' + esc(tq) + '"><label class="xechk"><input type="checkbox" id="xetall"' + (tAll ? ' checked' : '') + '> also songs without a translation</label></div><div class="xelist" id="xetl"></div>';
    var list = function () {
      var q = tq.toLowerCase(), hits = all.filter(function (s) { return (tAll || trOf(s[4])) && (!q || (s[3] + ' ' + s[2] + ' ' + (H().countries[s[1]] || '') + ' ' + s[0]).toLowerCase().indexOf(q) >= 0); });
      var n = hits.length; hits = hits.slice(0, 60);
      $('xetl').innerHTML = hits.map(function (s) { return '<div class="xerow" data-id="' + s[4] + '"><div class="xerowtop"><b class="xeorig">' + esc(s[3]) + '<small>' + esc(s[2] + ' · ' + (H().countries[s[1]] || s[1]) + ' ' + s[0] + ' · ' + s[10]) + '</small></b><input type="text" class="xetr" placeholder="English translation" value="' + esc(trOf(s[4])) + '"></div></div>'; }).join('') + (n > 60 ? '<p class="mute">…and ' + (n - 60) + ' more: search to narrow it down.</p>' : '');
      [].forEach.call($('xetl').querySelectorAll('.xerow'), function (r) {
        var id = r.getAttribute('data-id');
        r.querySelector('.xetr').addEventListener('input', function () { var v = this.value.trim(); if (v === (TITLE_BASE[id] || '')) delete data.titles[id]; else data.titles[id] = v || null; touch(); });
      });
    };
    $('xetq').addEventListener('input', function () { tq = this.value; list(); });
    $('xetall').addEventListener('change', function () { tAll = this.checked; list(); });
    list();
  }
  // ---- the password ----
  function drawPass(B) {
    B.innerHTML = '<p class="mute" id="xepst">Checking…</p><p>Type the current password at the top (if there is one), then:</p><div class="xerowtop"><input type="password" id="xenew" placeholder="New password (empty = no password)" autocomplete="new-password"><button type="button" class="btn small" id="xesetp">Set password</button></div>';
    var sb = escClient();
    if (!sb) $('xepst').textContent = 'No Supabase connection on this page.';
    if (sb) sb.rpc('esc_has_pass').then(function (r) { $('xepst').textContent = r.data ? '🔒 A password is set: saving needs it.' : '🔓 No password yet: anyone with the game open could save changes. Set one below.'; });
    $('xesetp').addEventListener('click', function () {
      var nw = $('xenew').value; if (!sb) return;
      sb.rpc('esc_set_pass', { p_old: pass(), p_new: nw }).then(function (r) {
        if (r.error) { msg(/password/.test(r.error.message) ? 'Wrong current password' : r.error.message, 'bad'); return; }
        try { sessionStorage.setItem('esc-edit-pass', nw); } catch (e) {} $('xepass').value = nw; msg(nw ? 'Password set ✓' : 'Password removed ✓', 'ok'); drawPass(B);
      });
    });
  }
  // ---- save / back to the built-in list ----
  function clean(key) {
    if (key === 'green') return data.green.filter(function (c) { return ytId(c.id); }).map(function (c) { return { id: ytId(c.id), s: Math.max(0, +c.s || 0), name: String(c.name || '').slice(0, 80) }; });
    if (key === 'roasts') return data.roasts.filter(function (r) { return String(r.p || '').trim(); }).map(function (r) { return { p: String(r.p).trim(), h: String(r.h || '').trim() || 'No comment' }; });
    if (key === 'jury') { var o = {}; Object.keys(data.jury).forEach(function (id) { var c = data.jury[id]; if (c && c[1] > c[0]) o[id] = [+c[0], +c[1]]; }); return o; }
    return data[key];
  }
  function save() {
    var keys = tab === 'jury' ? ['jury', 'lyrics'] : [tab];
    if (tab === 'jury' && Object.keys(data.jury).some(function (id) { var c = data.jury[id]; return !(c && c[1] > c[0]); })) { msg('Every song needs a “to” later than its “from”.', 'bad'); return; }
    if (tab === 'green' && !clean('green').length) { msg('Keep at least one clip.', 'bad'); return; }
    if (tab === 'roasts' && !clean('roasts').length) { msg('Keep at least one prompt.', 'bad'); return; }
    msg('Saving…', '');
    var run = function (i) {
      if (i >= keys.length) { dirty = false; draw(); msg('Saved ✓ It is used from the next game on.', 'ok'); return; }
      escSave(keys[i], clean(keys[i]), pass()).then(function (r) { if (r !== true) { msg(r, 'bad'); return; } run(i + 1); });
    };
    run(0);
  }
  function backToDefault() {
    var h = H();
    if (tab === 'jury') { data.jury = clone(h.chorusBase || {}); }
    else if (tab === 'green') data.green = clone(ESC_DEF.green);
    else if (tab === 'roasts') data.roasts = clone(ESC_DEF.roasts);
    else if (tab === 'titles') data.titles = {};
    touch(); draw(); msg('The built-in list is back: press Save to use it.', 'warn');
  }
  window.escEditorOpen = open;
})();
