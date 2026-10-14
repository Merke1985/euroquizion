// ⚙️ Admin (on the host page, behind the password): the songs (Key Change!, the Disqualivision clips, the United by
// Nonsense translations), the minigame prompts, the items in the boutique, the trivia questions, and the requests
// (bugs and changes for Claude to pick up). Saved in Supabase (escSave in quiz.js): live for everyone on the next game.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  // the sections (left) and their parts (the tabs on top): [icon, name, what it's for, [[tab, name, what it's for]]]
  var GROUPS = [
    ['🎵', 'Songs', 'The songs the minigames use', [['jury', '🎤 Key Change!', 'The songs to sing: the part to sing and the lyrics on the phones'], ['green', '⚖️ Disqualivision', 'The performances that get judged'], ['titles', '🗣️ United by Nonsense', 'The English translation of every non-English title']]],
    ['🎉', 'Minigames', 'Texts used in the minigames', [['roasts', '⚖️ Disqualivision prompts', 'The questions players answer about the performance']]],
    ['🛍️', 'Items', 'Lynda’s boutique', [['items', '🛍️ All items', 'Names, explanations, shelf (price) and stock']]],
    ['❓', 'Trivia', 'The questions between the songs', [['trivia', '❓ Trivia questions', 'One right answer, three wrong ones and an explanation']]],
    ['💬', 'Feedback', 'From the players, and Claude’s reports', [['fb', '💬 Player feedback', 'Sent with the Feedback button on the join screen'], ['notes', '🔔 Reports', 'What Claude did on each run']]],
    ['🔒', 'Settings', 'The admin password', [['pass', '🔒 Password', 'The password for this admin']]]];
  var TABS = []; GROUPS.forEach(function (g) { TABS = TABS.concat(g[3]); });
  var NOSAVE = { pass: 1, req: 1, fb: 1, notes: 1 };
  function groupOf(t) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][3].some(function (x) { return x[0] === t; })) return GROUPS[i]; return GROUPS[0]; }
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
      green: clone(QUIP_SONGS), roasts: clone(ROASTS), titles: clone(ESC_EDIT.titles || {}),
      items: SHOP_ITEMS.map(function (it) { return { id: it.id, icon: it.icon, name: it.name, desc: it.desc, tier: it.tier || 2, stock: it.stock == null ? '' : it.stock, off: !!it.off }; }),
      trivia: clone(OBSCURE)
    };
    dirty = false;
  }
  function open() {
    if (!W) {
      W = document.createElement('div'); W.id = 'editov'; W.className = 'testov editov';
      W.innerHTML = '<div class="testcard xecard"><div class="testhead"><h2>⚙️ Admin</h2><input type="password" id="xepass" class="hidden" autocomplete="off"><button class="btn alt small" id="xelock" type="button">🔒 Lock</button><button class="btn alt small" id="xeclose" type="button">Close</button></div>' +
        '<div id="xegate" class="xegate hidden"></div><div id="xemain" class="xemain"><nav class="xenav">' + GROUPS.map(function (g, gi) { return '<button type="button" class="xesec" data-g="' + gi + '"><span class="xesi">' + g[0] + '</span><span><b>' + g[1] + '</b><small>' + g[2] + '</small></span></button>'; }).join('') + '</nav><div class="xecontent"><div class="xesubs" id="xesubs"></div><p class="xesubhint" id="xesubhint"></p><div id="xebody"></div>' +
        '<div class="xefoot"><span id="xemsg"></span><button class="btn alt small" id="xedef" type="button">Back to the built-in list</button><button class="btn small" id="xesave" type="button">💾 Save</button></div></div></div>';
      document.body.appendChild(W);
      $('xepass').value = pass();
      $('xepass').addEventListener('input', function () { try { sessionStorage.setItem('esc-edit-pass', this.value); } catch (e) {} });
      $('xeclose').addEventListener('click', close);
      $('xelock').addEventListener('click', function () { try { sessionStorage.removeItem('esc-edit-pass'); sessionStorage.removeItem('esc-admin-ok'); } catch (e) {} $('xepass').value = ''; gate(); });
      W.addEventListener('click', function (e) { if (e.target === W) close(); });
      [].forEach.call(W.querySelectorAll('.xesec'), function (b) { b.addEventListener('click', function () { var g = GROUPS[+b.getAttribute('data-g')]; if (dirty && groupOf(tab) !== g) { msg('Save first, or your changes are lost (press it again to leave anyway).', 'warn'); dirty = false; return; } tab = g[3][0][0]; draw(); }); });
      $('xesave').addEventListener('click', save);
      $('xedef').addEventListener('click', backToDefault);
    }
    if (!escClient()) { W.querySelector('#xebody').innerHTML = '<p class="mute">There is no Supabase connection on this page, so nothing can be saved.</p>'; }
    fresh(); W.classList.remove('hidden');
    var ok = false; try { ok = sessionStorage.getItem('esc-admin-ok') === '1'; } catch (e) {}
    if ((window.escAttention || 0) > 0) tab = 'fb';   // (something waits for you: straight to the requests)
    if (ok) { $('xegate').classList.add('hidden'); $('xemain').classList.remove('hidden'); draw(); } else gate();
  }
  // ---- the door: the admin opens with the password (the very first time, you choose one) ----
  function gate() {
    var G = $('xegate'), sb = escClient(); $('xemain').classList.add('hidden'); G.classList.remove('hidden');
    var done = function (pw) { try { sessionStorage.setItem('esc-edit-pass', pw); sessionStorage.setItem('esc-admin-ok', '1'); } catch (e) {} $('xepass').value = pw; G.classList.add('hidden'); $('xemain').classList.remove('hidden'); draw(); };
    if (!sb) { G.innerHTML = '<p class="mute">There is no Supabase connection on this page.</p>'; return; }
    G.innerHTML = '<p class="mute">Checking…</p>';
    sb.rpc('esc_has_pass').then(function (r) {
      if (!r.data) {
        G.innerHTML = '<h3>🔒 Choose an admin password</h3><p class="mute">There is no password yet. Choose one: you need it to open the admin, save changes and send requests.</p><div class="xerowtop"><input type="password" id="xeg1" placeholder="New password" autocomplete="new-password"><input type="password" id="xeg2" placeholder="Once more" autocomplete="new-password"><button type="button" class="btn small" id="xegset">Set password</button></div><p id="xegmsg" class="bad"></p>';
        $('xegset').onclick = function () {
          var a = $('xeg1').value, b2 = $('xeg2').value; if (a.length < 4) { $('xegmsg').textContent = 'At least 4 characters, please.'; return; } if (a !== b2) { $('xegmsg').textContent = 'The two passwords are not the same.'; return; }
          sb.rpc('esc_set_pass', { p_old: '', p_new: a }).then(function (x) { if (x.error) { $('xegmsg').textContent = x.error.message; return; } done(a); });
        };
        return;
      }
      G.innerHTML = '<h3>🔒 Admin</h3><div class="xerowtop"><input type="password" id="xeg1" placeholder="Password" autocomplete="current-password"><button type="button" class="btn small" id="xegin">Open</button></div><p id="xegmsg" class="bad"></p>';
      var go = function () { var pw = $('xeg1').value; sb.rpc('esc_pass_ok', { p_pass: pw }).then(function (x) { if (x.data === true) done(pw); else $('xegmsg').textContent = 'Wrong password.'; }); };
      $('xegin').onclick = go; $('xeg1').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); }); setTimeout(function () { try { $('xeg1').focus(); } catch (e) {} }, 50);
    });
  }
  function close() { if (dirty && !confirmLeave()) return; W.classList.add('hidden'); if (window.escAdminBadge) window.escAdminBadge(); }
  function confirmLeave() { msg('You have unsaved changes: press Save, or Close again to throw them away.', 'warn'); dirty = false; return false; }
  function msg(t, k) { var m = $('xemsg'); m.textContent = t || ''; m.className = k || ''; }
  function touch() { dirty = true; msg('Not saved yet', 'warn'); }
  function draw() {
    var g = groupOf(tab), sub = g[3].filter(function (x) { return x[0] === tab; })[0];
    [].forEach.call(W.querySelectorAll('.xesec'), function (b) { b.classList.toggle('on', GROUPS[+b.getAttribute('data-g')] === g); b.classList.toggle('attn', GROUPS[+b.getAttribute('data-g')][1] === 'Feedback' && (window.escAttention || 0) > 0); });
    $('xesubs').innerHTML = '<h3 class="xesech">' + g[0] + ' ' + g[1] + '</h3>' + (g[3].length > 1 ? '<div class="xetabs">' + g[3].map(function (t) { return '<button type="button" class="xetab' + (t[0] === tab ? ' on' : '') + '" data-t="' + t[0] + '" title="' + t[2] + '">' + t[1] + '</button>'; }).join('') + '</div>' : '');
    $('xesubhint').textContent = sub ? sub[2] : '';
    [].forEach.call($('xesubs').querySelectorAll('.xetab'), function (b) { b.onclick = function () { if (dirty) { msg('Save first, or your changes are lost (press it again to leave anyway).', 'warn'); dirty = false; return; } tab = b.getAttribute('data-t'); draw(); }; });
    $('xesave').classList.toggle('hidden', !!NOSAVE[tab]); $('xedef').classList.toggle('hidden', !!NOSAVE[tab]);
    var B = $('xebody'); msg(dirty ? 'Not saved yet' : '', dirty ? 'warn' : '');
    if (tab === 'jury') drawJury(B); else if (tab === 'green') drawGreen(B); else if (tab === 'roasts') drawRoasts(B); else if (tab === 'titles') drawTitles(B); else if (tab === 'items') drawItems(B); else if (tab === 'trivia') drawTrivia(B); else if (tab === 'req' || tab === 'fb' || tab === 'notes') drawReq(B, tab); else drawPass(B);
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
  // ---- the boutique: names, texts, shelf, stock, in or out of the shop (what an item DOES stays in the code: a new kind of item is a request) ----
  function drawItems(B) {
    var tiers = [[3, '💎 Luxury'], [2, '⭐ Popular'], [1, '🏷️ Bargains']];
    B.innerHTML = '<p class="mute">Change the name, the explanation, the shelf (that sets the price) or the stock, or take an item out of the shop. A brand-new item does something new, so that goes in 📝 Requests.</p>' +
      '<div class="xelist">' + data.items.map(function (it, i) {
        return '<div class="xerow' + (it.off ? ' xeoff' : '') + '" data-i="' + i + '"><div class="xerowtop"><input type="text" class="xeicon" maxlength="4" value="' + esc(it.icon) + '"><input type="text" class="xename" placeholder="Name" value="' + esc(it.name) + '">' +
          '<select class="xetier">' + tiers.map(function (t) { return '<option value="' + t[0] + '"' + (+it.tier === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>' +
          '<label>Stock <input type="number" class="xestock" min="1" max="20" placeholder="∞" value="' + esc(String(it.stock)) + '"></label>' +
          '<label class="xechk"><input type="checkbox" class="xein"' + (it.off ? '' : ' checked') + '> In the shop</label></div>' +
          '<textarea class="xelytxt xedesc" rows="2" placeholder="What it does (shown on the phones)">' + esc(it.desc) + '</textarea></div>';
      }).join('') + '</div>';
    [].forEach.call(B.querySelectorAll('.xerow'), function (row) {
      var it = data.items[+row.getAttribute('data-i')];
      row.querySelector('.xeicon').addEventListener('input', function () { it.icon = this.value; touch(); });
      row.querySelector('.xename').addEventListener('input', function () { it.name = this.value; touch(); });
      row.querySelector('.xetier').addEventListener('change', function () { it.tier = +this.value; touch(); });
      row.querySelector('.xestock').addEventListener('input', function () { it.stock = this.value; touch(); });
      row.querySelector('.xein').addEventListener('change', function () { it.off = !this.checked; row.classList.toggle('xeoff', it.off); touch(); });
      row.querySelector('.xedesc').addEventListener('input', function () { it.desc = this.value; touch(); });
    });
  }
  // ---- the trivia questions (the 'Trivia' questions between the song questions) ----
  var trq = '';
  function drawTrivia(B) {
    var cc = (H().countries) || {};
    var hit = function (f) { var t = trq.toLowerCase(); return !t || [f.q, f.a, f.e].concat(f.w || []).join(' ').toLowerCase().indexOf(t) >= 0; };
    B.innerHTML = '<p class="mute">The trivia questions: one right answer, three wrong ones, and what the hosts explain afterwards. The year and country link it to the songs of that contest (it only comes up when that year is in play).</p>' +
      '<div class="xerowtop"><input type="search" id="xetq" placeholder="Search…" value="' + esc(trq) + '"><button type="button" class="btn alt small" id="xeadd">＋ Add a question</button><span class="mute" style="font-size:.85rem">' + data.trivia.length + ' questions</span></div>' +
      '<div class="xelist">' + data.trivia.map(function (f, i) {
        if (!hit(f)) return '';
        var w = f.w || [], s = f.s || [];
        return '<div class="xerow" data-i="' + i + '"><div class="xerowtop"><input type="text" class="xep xeq" placeholder="The question" value="' + esc(f.q || '') + '"><button type="button" class="btn alt small xedel">🗑</button></div>' +
          '<div class="xerowtop xetriv"><input type="text" class="xea" placeholder="✅ Right answer" value="' + esc(f.a || '') + '">' + [0, 1, 2].map(function (k) { return '<input type="text" class="xew" data-k="' + k + '" placeholder="❌ Wrong answer" value="' + esc(w[k] || '') + '">'; }).join('') + '</div>' +
          '<div class="xerowtop"><input type="text" class="xee" placeholder="The explanation afterwards" value="' + esc(f.e || '') + '"><label>Year <input type="number" class="xey" min="1956" max="2100" value="' + esc(String(s[0] || '')) + '"></label>' +
          '<label>Country <select class="xecc"><option value="">–</option>' + Object.keys(cc).filter(function (c) { return c.length === 2; }).sort(function (a, b) { return String(cc[a]).localeCompare(String(cc[b])); }).map(function (c) { return '<option value="' + c + '"' + (s[1] === c ? ' selected' : '') + '>' + esc(cc[c]) + '</option>'; }).join('') + '</select></label>' +
          '<label class="xechk" title="Put the answers in number order instead of shuffling them"><input type="checkbox" class="xen"' + (f.n ? ' checked' : '') + '> 1-2-3 order</label></div></div>';
      }).join('') + '</div>';
    $('xetq').addEventListener('input', function () { trq = this.value; var at = this.selectionStart; drawTrivia(B); var x = $('xetq'); x.focus(); try { x.setSelectionRange(at, at); } catch (e) {} });
    $('xeadd').addEventListener('click', function () { trq = ''; data.trivia.unshift({ q: '', a: '', w: ['', '', ''], e: '' }); touch(); drawTrivia(B); B.querySelector('.xeq').focus(); });
    [].forEach.call(B.querySelectorAll('.xerow'), function (row) {
      var f = data.trivia[+row.getAttribute('data-i')]; f.w = f.w || ['', '', ''];
      row.querySelector('.xeq').addEventListener('input', function () { f.q = this.value; touch(); });
      row.querySelector('.xea').addEventListener('input', function () { f.a = this.value; touch(); });
      [].forEach.call(row.querySelectorAll('.xew'), function (x) { x.addEventListener('input', function () { f.w[+x.getAttribute('data-k')] = this.value; touch(); }); });
      row.querySelector('.xee').addEventListener('input', function () { f.e = this.value; touch(); });
      var setS = function () { var y = +row.querySelector('.xey').value || 0, c = row.querySelector('.xecc').value; if (y && c) f.s = [y, c]; else delete f.s; touch(); };
      row.querySelector('.xey').addEventListener('input', setS); row.querySelector('.xecc').addEventListener('change', setS);
      row.querySelector('.xen').addEventListener('change', function () { if (this.checked) f.n = true; else delete f.n; touch(); });
      row.querySelector('.xedel').addEventListener('click', function () { data.trivia.splice(data.trivia.indexOf(f), 1); touch(); drawTrivia(B); });
    });
  }
  // ---- 📝 Requests: bugs and changes for Claude to pick up ----
  var RQ_ST = { 'new': ['🆕', 'Waiting'], working: ['⚙️', 'Being worked on'], done: ['✅', 'Done'], needs_ok: ['✋', 'Needs your OK'], approved: ['👍', 'Approved: next run'], undo: ['↩️', 'Undo: next run'], undone: ['↩️', 'Undone'], declined: ['🚫', 'Not done'], question: ['❓', 'Question for you'], feedback: ['💬', 'Player feedback: Claude reviews it'] };
  var RQ_KIND = { bug: '🐞 Bug', change: '💡 Suggestion', idea: '💡 Suggestion' };
  var rqGame = 'general', rqKind = 'bug'; var rqTick = null;
  function gameName(k) { var g = (H().games || []).filter(function (x) { return x.k === k; })[0]; return g ? g.icon + ' ' + g.title : ({ general: '🌍 General', trivia: '❓ Trivia', shop: '🛍️ Boutique & items', final: '🏆 Grand Final', phone: '📱 Phones' })[k] || k; }
  function drawReq(B, mode) {
    var sb = escClient();
    if (mode === 'notes') { B.innerHTML = '<div id="xenotes"><p class="mute">Loading…</p></div><p class="mute xereqhow">Claude checks every night (around 3:00). When something was done, a report appears here and you get an email. In a hurry? Press Run now on the scheduled task <b>“Process EuroQuizion requests”</b> in the Claude app.</p>'; drawNotes(sb); return; }
    B.innerHTML = (mode === 'fb' ? '<p class="mute xereqhow">Players can send a bug or a suggestion with the 💬 Feedback button on the join screen. Claude looks at each one at night and writes what it would do; nothing is built until you press 👍 Go ahead.</p>' : '<div class="xerow xereqnew"><div class="xerowtop"><select id="xerk">' + [['bug', '🐞 Bug'], ['idea', '💡 Suggestion']].map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === rqKind ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>' +
      '<textarea class="xelytxt" id="xert" rows="3" placeholder="What is wrong, or what should change? The more precise, the better."></textarea><div class="xerowtop" style="justify-content:flex-end"><button type="button" class="btn small" id="xersend">📨 Send</button></div></div>' +
      '<p class="mute xereqhow">Claude handles these at night (around 3:00). Fixes for things that are wrong are built straight away, each with an overview and an ↩️ Undo button; anything new (an item, a trivia mode, a minigame, reworking one) waits for your 👍 first.</p>') +
      '<div class="xerowtop" style="justify-content:flex-end"><button type="button" class="btn alt small" id="xerref">🔄 Refresh</button></div><div class="xelist xelist2" id="xerl"><p class="mute">Loading…</p></div>';
    if ($('xerk')) $('xerk').onchange = function () { rqKind = this.value; };
    clearInterval(rqTick); rqTick = setInterval(function () { if (!$('xerl') || !W || W.classList.contains('hidden') || (tab !== 'req' && tab !== 'fb')) { clearInterval(rqTick); return; } load(); }, 20000);   // (new requests and feedback show up by themselves)
    var load = function () {
      if (!sb) { $('xerl').innerHTML = '<p class="mute">No Supabase connection.</p>'; return; }
      sb.rpc('esc_req_list', { p_pass: pass() }).then(function (r) {
        if (r.error) { $('xerl').innerHTML = '<p class="bad">' + esc(/password/.test(r.error.message) ? 'Wrong password: lock and open the admin again.' : r.error.message) + '</p>'; return; }
        var rows = (r.data || []).filter(function (q) { return mode === 'fb' ? q.source === 'player' : q.source !== 'player'; });
        $('xerl').innerHTML = rows.length ? rows.map(function (q) {
          var st = RQ_ST[q.status] || ['•', q.status], d = new Date(q.created_at);
          var acts = (q.status === 'needs_ok' ? '<button type="button" class="btn small" data-a="approve">👍 Go ahead</button><button type="button" class="btn alt small" data-a="decline">🚫 Don’t</button>' : '') +
            (q.status === 'done' ? '<button type="button" class="btn alt small" data-a="undo">↩️ Undo</button>' : '') +
            (q.status === 'question' ? '<button type="button" class="btn small" data-a="answer">💬 Answer</button>' : '') +
            (q.status === 'feedback' ? '<button type="button" class="btn small" data-a="review">📨 Make it a request</button><button type="button" class="btn alt small" data-a="decline">🚫 Ignore</button>' : '') +
            (['new', 'needs_ok', 'question', 'declined', 'undone', 'feedback'].indexOf(q.status) >= 0 ? '<button type="button" class="btn alt small" data-a="delete">🗑</button>' : '');
          return '<div class="xerow xereq st-' + q.status + '" data-id="' + q.id + '"><div class="xerowtop"><b>#' + q.id + ' · ' + (RQ_KIND[q.kind] || q.kind) + (q.game && q.game !== 'general' ? ' · ' + esc(gameName(q.game)) : '') + (q.source === 'player' ? ' · 💬 from ' + esc(q.who || 'a player') : '') + '</b><span class="xest">' + st[0] + ' ' + st[1] + '</span></div>' +
            '<p class="xebody2">' + esc(q.body) + '</p>' + (q.note ? '<div class="xenote">' + esc(q.note).replace(/\n/g, '<br>') + (q.version ? '<small> · v' + esc(q.version) + '</small>' : '') + '</div>' : '') +
            '<div class="xerowtop"><small class="mute">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</small><span style="flex:1"></span>' + acts + '</div></div>';
        }).join('') : '<p class="mute">' + (mode === 'fb' ? 'No feedback from players yet.' : 'No requests yet.') + '</p>';
        [].forEach.call($('xerl').querySelectorAll('[data-a]'), function (b) { b.onclick = function () {
          var id = +b.closest('.xereq').getAttribute('data-id'), a = b.getAttribute('data-a');
          if (a === 'answer') { var t = prompt('Your answer:'); if (!t) return; sb.rpc('esc_req_answer', { p_pass: pass(), p_id: id, p_text: t }).then(function (x) { if (x.error) msg(x.error.message, 'bad'); load(); }); return; }
          if (a === 'delete' && !confirm('Delete request #' + id + '?')) return;
          if (a === 'undo' && !confirm('Undo request #' + id + '? The next run puts it back the way it was.')) return;
          sb.rpc('esc_req_act', { p_pass: pass(), p_id: id, p_action: a }).then(function (x) { if (x.error) msg(x.error.message, 'bad'); else msg('✓', 'ok'); load(); });
        }; });
      });
    };
    if ($('xersend')) $('xersend').onclick = function () {
      var t = $('xert').value.trim(); if (!t || !sb) return;
      sb.rpc('esc_req_add', { p_pass: pass(), p_game: rqGame, p_kind: rqKind, p_body: t }).then(function (x) { if (x.error) { msg(/password/.test(x.error.message) ? 'Wrong password' : x.error.message, 'bad'); return; } $('xert').value = ''; msg('Sent ✓ #' + x.data, 'ok'); load(); });
    };
    $('xerref').onclick = function () { $('xerl').innerHTML = '<p class="mute">Loading…</p>'; load(); };
    load();
  }
  function drawNotes(sb) {   // (the reports of the runs: new ones highlighted, then marked as read)
    if (!sb) return;
    sb.rpc('esc_notes_list', { p_pass: pass() }).then(function (r) {   // (the reports of the nightly runs: new ones highlighted, then marked as read)
      var ns = (r && r.data) || [], el = $('xenotes'); if (!el) return; if (!ns.length) { el.innerHTML = '<p class="mute">No reports yet.</p>'; return; }
      var unseen = ns.filter(function (n) { return !n.seen; }).length;
      el.innerHTML = '<div class="xenotes">' + ns.slice(0, 20).map(function (n) {
        var d = new Date(n.created_at);
        return '<div class="xenoterow' + (n.seen ? '' : ' unseen') + '"><b>' + (n.seen ? '' : '🆕 ') + esc(n.title) + '</b> <small class="mute">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</small>' + (n.body ? '<p>' + esc(n.body).replace(/\n/g, '<br>') + '</p>' : '') + '</div>';
      }).join('') + '</div>';
      if (unseen) sb.rpc('esc_notes_seen', { p_pass: pass() }).then(function () { if (window.escAdminBadge) window.escAdminBadge(); });
    });
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
    if (key === 'items') { var io = {}; data.items.forEach(function (it) { var st = parseInt(it.stock, 10); io[it.id] = { icon: String(it.icon || '').trim(), name: String(it.name || '').trim(), desc: String(it.desc || '').trim(), tier: +it.tier || 2, stock: st > 0 ? st : -1, off: !!it.off }; }); return io; }
    if (key === 'trivia') return data.trivia.filter(function (f) { return String(f.q || '').trim() && String(f.a || '').trim() && (f.w || []).some(function (w) { return String(w || '').trim(); }); }).map(function (f) { var o2 = { q: String(f.q).trim(), a: String(f.a).trim(), w: (f.w || []).map(function (w) { return String(w || '').trim(); }).filter(Boolean), e: String(f.e || '').trim() }; if (f.n) o2.n = true; if (f.s && f.s[0] && f.s[1]) o2.s = [+f.s[0], f.s[1]]; return o2; });
    if (key === 'jury') { var o = {}; Object.keys(data.jury).forEach(function (id) { var c = data.jury[id]; if (c && c[1] > c[0]) o[id] = [+c[0], +c[1]]; }); return o; }
    return data[key];
  }
  function save() {
    var keys = tab === 'jury' ? ['jury', 'lyrics'] : [tab];
    if (tab === 'jury' && Object.keys(data.jury).some(function (id) { var c = data.jury[id]; return !(c && c[1] > c[0]); })) { msg('Every song needs a “to” later than its “from”.', 'bad'); return; }
    if (tab === 'green' && !clean('green').length) { msg('Keep at least one clip.', 'bad'); return; }
    if (tab === 'roasts' && !clean('roasts').length) { msg('Keep at least one prompt.', 'bad'); return; }
    if (tab === 'trivia' && !clean('trivia').length) { msg('Keep at least one question.', 'bad'); return; }
    if (tab === 'items' && data.items.some(function (it) { return !String(it.name || '').trim(); })) { msg('Every item needs a name.', 'bad'); return; }
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
    else if (tab === 'items') data.items = ESC_DEF.items.map(function (it) { return { id: it.id, icon: it.icon, name: it.name, desc: it.desc, tier: it.tier || 2, stock: it.stock == null ? '' : it.stock, off: false }; });
    else if (tab === 'trivia') data.trivia = clone(ESC_DEF.trivia);
    touch(); draw(); msg('The built-in list is back: press Save to use it.', 'warn');
  }
  window.escEditorOpen = open;
  // the badge on the ⚙️ Admin button: how many reports and requests wait for you (only a number, no password needed)
  window.escAdminBadge = function () {
    var b = $('adminbtn'), sb = escClient(); if (!b || !sb) return;
    sb.rpc('esc_attention').then(function (r) { var n = +(r && r.data) || 0; window.escAttention = n; b.classList.toggle('attn', n > 0); b.setAttribute('data-n', n > 9 ? '9+' : String(n)); });
  };
  setTimeout(window.escAdminBadge, 1500); setInterval(function () { if (document.visibilityState === 'visible') window.escAdminBadge(); }, 300000);
})();
