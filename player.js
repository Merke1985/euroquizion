(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // One player id per tab; survives a refresh.
  var pid = null;
  try { pid = sessionStorage.getItem('esc-pid'); } catch (e) {}
  if (!pid) pid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try { sessionStorage.setItem('esc-pid', pid); } catch (e) {}
  var net = null, name = '', room = '', state = null, endsAt = 0, countries = {}, joinTimer = null, hiTimer = null, lastPhaseKey = '', builtKey = '', pickUntil = 0, want = null, picking = false, hi = function () {}, hiHooked = false;
  try { want = sessionStorage.getItem('esc-char'); } catch (e) {}
  var wantCC = null; try { wantCC = sessionStorage.getItem('esc-cc'); } catch (e) {}

  $('name').value = store.get('esc-name') || '';
  var qs = new URLSearchParams(location.search), k = qs.get('k');
  // Inside the host's own page (a game without a shared screen) the hosting buttons make no sense.
  if (qs.get('embed')) { document.body.classList.add('embed'); $('hostlinks').classList.add('hidden'); }
  if (k) $('code').value = k.toUpperCase().slice(0, 4);
  /* rejoining: the last game this phone was in (for 12 hours). The code is filled in, and the host gives you your own place back */
  var rejoin = null; try { rejoin = JSON.parse(store.get('esc-rejoin') || 'null'); } catch (e) {}
  if (rejoin && !(Date.now() - rejoin.t < 12 * 3600000)) rejoin = null;
  if (rejoin && !k && !$('code').value) $('code').value = rejoin.room;
  var wasPid = '';
  /* your own photo as avatar: taken with the camera or picked from the phone, cut to a square and made small */
  var myPic = null; try { myPic = localStorage.getItem('esc-mypic'); if (!picOk(myPic)) myPic = null; } catch (e) {}
  if (myPic) CHAR_IMG['u:' + pid] = myPic;
  function picSend() { if (!net || !myPic) return; var msg = { pid: pid, img: myPic }; net.send('pic', msg); setTimeout(function () { if (net) net.send('pic', msg); }, 1500); }
  function picTake(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S;
        var s = Math.min(im.width, im.height), sx = (im.width - s) / 2, sy = Math.max(0, (im.height - s) / 2 - s * 0.08);   /* (a square from the middle, a little towards the top: the face) */
        cv.getContext('2d').drawImage(im, sx, sy, s, s, 0, 0, S, S);
        var d = cv.toDataURL('image/jpeg', 0.72); if (!picOk(d)) { d = cv.toDataURL('image/jpeg', 0.5); if (!picOk(d)) return; }
        myPic = d; try { localStorage.setItem('esc-mypic', d); } catch (e) {}
        CHAR_IMG['u:' + pid] = d; want = 'u:' + pid; pickUntil = Date.now() + 3000; try { sessionStorage.setItem('esc-char', want); } catch (e) {}
        picSend(); setTimeout(hi, 300); pickKey = ''; if (state) onState(state);
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  ['picCam', 'picUp'].forEach(function (id) { $(id).addEventListener('change', function (e) { picTake(e.target.files && e.target.files[0]); e.target.value = ''; }); });
  $('howbtn').addEventListener('click', function () { $('howov').classList.remove('hidden'); });
  $('howclose').addEventListener('click', function () { $('howov').classList.add('hidden'); });
  $('howov').addEventListener('click', function (e) { if (e.target === $('howov')) $('howov').classList.add('hidden'); });
  countries = COUNTRY_NAMES;   /* (built into quiz.js: no need to download the whole song list) */

  // ---------- The Grand Final: tick the songs that fit ----------
  var chReadyKey = '', chKey = '', chMask = 0, chLocked = false, chBarKey = '';
  function chaseSend(lock) {
    if (!net || !chKey) return; var k = chKey, m = chMask;
    net.send('chase', { pid: pid, key: k, mask: m, lock: !!lock });
    if (lock) [700, 2000].forEach(function (ms) { setTimeout(function () { if (net && chKey === k && state && state.chase && state.chase.st === 'ask') net.send('chase', { pid: pid, key: k, mask: m, lock: true }); }, ms); });
  }
  var heelSent = '';
  function chaseView(c) {
    var l = c.lanes[pid];
    var dz = !!(l && l.danger && c.st !== 'win'), dzt = '⚠️ Danger! ' + (c.mname || 'The monster') + ' will smash your space next turn. Get answers right to escape!';
    ['chdanger', 'chdanger2'].forEach(function (id) { $(id).classList.toggle('hidden', !dz); $(id).textContent = dz ? dzt : ''; });
    if (!l) { show('v-wait'); $('waittitle').textContent = '🏁 The Grand Final'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    var where = 'Space ' + l.pos + ' of ' + c.end + ' · ' + (c.wake ? (c.mname || 'the monster').replace(/^The /, 'the ') + ' is still waiting' : (c.mname || 'the monster').replace(/^The /, 'the ') + ' is on ' + c.mon);
    if (c.st === 'win') { var me2 = c.win && c.win.indexOf(pid) >= 0; show('v-wait'); $('waittitle').textContent = me2 ? '🏆 You win the Grand Final!' : '🏁 The chase is over'; $('waitsub').textContent = me2 ? 'Thank you Europe!' : 'Watch the big screen.'; return; }
    if (l.out) { show('v-wait'); $('waittitle').textContent = '💀 Caught by ' + (c.mname || 'the monster').replace(/^The /, 'the ') + '!'; $('waitsub').textContent = 'You made it to space ' + l.pos + '. Watch the others run…'; return; }
    if (c.sd && (!c.act || c.act.indexOf(pid) < 0)) { show('v-wait'); $('waittitle').textContent = l.fell ? '💥 You fell off the stage!' : '🏆 Sudden death on the stage'; $('waitsub').textContent = 'Watch the big screen: the last one standing wins.'; return; }
    if (c.sd && c.st !== 'ask') { show('v-wait'); $('waittitle').textContent = '🏆 Sudden death!'; $('waitsub').textContent = c.st === 'show' || c.st === 'pause' || c.st === 'sdres' ? (l.res != null ? l.res + ' out of 3 right' : '') : 'Get ready: whoever gets fewer right than the others falls off the stage.'; return; }
    if (c.st === 'heelpick' && c.hp) {   /* the Broken Heel: whoever has it picks who gets it */
      if (c.hp.by !== pid) { show('v-wait'); $('waittitle').textContent = '⏳ A player is using an item…'; $('waitsub').textContent = 'Please wait!'; return; }
      show('v-chase'); $('chstat').textContent = '🏁 ' + where; $('chtext').textContent = '👠 Who gets your broken heel?'; $('chhelp').textContent = heelSent === c.hp.key ? 'Done! Watch the big screen…' : 'They can’t move on the first question. Pick a player (anyone on ice skates is safe):';
      $('chpbar').parentNode.classList.add('hidden'); $('chready').classList.add('hidden');
      var hk = c.hp.key + '|' + heelSent; if ($('chopts').getAttribute('data-k') !== hk) {
        $('chopts').setAttribute('data-k', hk);
        $('chopts').innerHTML = heelSent === c.hp.key ? '' : (c.hp.opts || []).map(function (o) { return '<button type="button" class="opt heelopt" data-p="' + esc(o.pid) + '">' + esc(o.name) + ' <small>(space ' + o.pos + ')</small></button>'; }).join('');
        [].forEach.call($('chopts').querySelectorAll('.heelopt'), function (b) { b.onclick = function () { if (!net || heelSent === c.hp.key) return; heelSent = c.hp.key; var msg = { pid: pid, key: c.hp.key, heelTo: b.getAttribute('data-p') }; net.send('chase', msg); setTimeout(function () { if (state && state.chase && state.chase.st === 'heelpick' && state.chase.hp && state.chase.hp.key === msg.key) net.send('chase', msg); }, 1500); chaseView(state.chase); }; });
      }
      return;
    }
    if (c.st === 'ready' || c.st === 'go') {
      var rd = !!(c.ready && c.ready[pid]) || chReadyKey === c.rkey;
      show('v-chase'); $('chstat').textContent = '🏁 ' + where; $('chtext').textContent = rd ? 'You’re ready!' : 'Are you ready?';
      $('chhelp').textContent = rd ? 'Waiting for the others…' : 'The chase starts when everyone is ready.'; $('chopts').innerHTML = '';
      if (c.st === 'ready' && chBarKey !== c.rkey) { chBarKey = c.rkey; var rb = $('chpbar'); rb.style.transition = 'none'; rb.style.width = (c.rleft / 600) + '%'; rb.getBoundingClientRect(); rb.style.transition = 'width ' + c.rleft + 'ms linear'; rb.style.width = '0%'; }
      $('chpbar').parentNode.classList.toggle('hidden', c.st !== 'ready');
      $('chready').classList.remove('hidden'); $('chready').classList.toggle('on', rd); $('chready').setAttribute('aria-pressed', rd ? 'true' : 'false'); $('chreadytext').textContent = rd ? 'Ready!' : 'Ready';
      return;
    }
    $('chpbar').parentNode.classList.remove('hidden'); $('chready').classList.add('hidden');
    if (c.st === 'intro' || !c.items) { show('v-wait'); $('waittitle').textContent = '🏁 The Grand Final'; $('waitsub').textContent = (c.mname || 'A Eurovision icon') + ' is coming! Get ready: ' + where.toLowerCase() + '.'; return; }
    if (c.st === 'ask') {
      if (chKey !== c.key) { chKey = c.key; chMask = 0; chLocked = false; }
      if (chLocked || l.lock) { show('v-wait'); $('waittitle').textContent = 'Locked in!'; $('waitsub').textContent = where; return; }
      show('v-chase'); $('chstat').textContent = '🏁 ' + where; $('chtext').textContent = c.text;
      $('chhelp').textContent = l.pos >= (c.goal || c.end) - 3 ? '🏆 You can reach the stage: only a perfect answer (all three right) gets you on it and wins!' : 'Tick every song that fits: none, some or all. When the time runs out, what you ticked counts: one space for each one right.';
      $('chopts').innerHTML = c.items.map(function (it, i) { return '<button type="button" class="opt' + ((chMask >> i) & 1 ? ' on' : '') + '" data-i="' + i + '"><b>' + ((chMask >> i) & 1 ? '✓' : 'ABC'[i]) + '</b>' + esc(it) + '</button>'; }).join('');
      if (chBarKey !== c.key) { chBarKey = c.key; var b = $('chpbar'); b.style.transition = 'none'; b.style.width = (c.left / 100) + '%'; b.getBoundingClientRect(); b.style.transition = 'width ' + c.left + 'ms linear'; b.style.width = '0%'; }
      return;
    }
    // the answer and the moves
    show('v-wait');
    $('waittitle').textContent = c.st === 'show' || c.st === 'pause' ? (l.res ? '+' + l.res + (l.res === 1 ? ' space' : ' spaces') : 'No move this time') : c.st === 'diva' ? (c.mname || 'A Eurovision icon') + ' moves…' : 'Moving…';
    $('waitsub').textContent = where;
  }
  $('chopts').addEventListener('click', function (e) { var b = e.target.closest('.opt'); if (!b || chLocked) return; chMask ^= 1 << +b.getAttribute('data-i'); if (state && state.chase) chaseView(state.chase); chaseSend(false); });
  $('chready').addEventListener('click', function () {
    var cs = state && state.chase;
    if (cs && (cs.st === 'ready' || cs.st === 'go')) { if (chReadyKey === cs.rkey || !net) return; chReadyKey = cs.rkey; var rk = cs.rkey; net.send('chase', { pid: pid, key: rk, ready: 1 }); [800, 2200].forEach(function (ms) { setTimeout(function () { if (net && state && state.chase && state.chase.st === 'ready') net.send('chase', { pid: pid, key: rk, ready: 1 }); }, ms); }); chaseView(cs); }
  });

  function show(id) { var wl = document.getElementById('welcome'); if (wl) wl.classList.toggle('hidden', id !== 'v-join'); ['v-join', 'v-pick', 'v-brief', 'v-wait', 'v-guess', 'v-draw', 'v-quip', 'v-sing', 'v-chase', 'v-reveal'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want(!!(state && state.remote && (((state.phase === 'guess' || (state.phase === 'reveal' && state.q && state.q.subject === 'trivia')) && state.q && state.q.noclip) || (state.gallery && state.phase === 'dall') || (state.draw && state.phase === 'loading')))); }   // no music on the start page; only under clip-less questions in online games

  if (document.body.classList.contains('embed')) { setInterval(function () { if (!state || picking) tellHeight(); }, 500); }
  $('joinform').addEventListener('submit', function (e) {
    e.preventDefault();
    room = $('code').value.trim().toUpperCase(); name = $('name').value.trim(); name = name.charAt(0).toUpperCase() + name.slice(1);
    if (room.length !== 4 || !name) return;
    store.set('esc-name', name);
    wasPid = rejoin && rejoin.room === room && rejoin.pid !== pid ? rejoin.pid : '';   /* (the same game as before, in a new tab: ask for the old place) */
    store.set('esc-rejoin', JSON.stringify({ room: room, pid: pid, t: Date.now() }));
    $('joinerr').textContent = '';
    state = null; kicked = false;
    net = escConnect(room);
    $('demo').classList.toggle('hidden', !net.demo);
    if (want && want.indexOf('u:') === 0) want = myPic ? 'u:' + pid : null;
    if (myPic) CHAR_IMG['u:' + pid] = myPic;
    net.on('pic', function (pm) { if (pm && pm.pid && picOk(pm.img) && CHAR_IMG['u:' + pm.pid] !== pm.img) { CHAR_IMG['u:' + pm.pid] = pm.img; pickKey = ''; if (state) onState(state); } });
    net.on('state', onState);
    // The host cleared the room: back to the join screen, and quiet until this phone joins again.
    net.on('kick', function (km) {
      if (kicked || (km && km.pid && km.pid !== pid)) return;   /* (the host removed one other player: not me) */
      kicked = true; clearInterval(hiTimer); state = null;
      document.querySelector('main').classList.remove('ingame'); $('pstage').classList.add('hidden'); rowUpdate(); $('chatbar').classList.add('hidden');
      show('v-join'); $('joinerr').textContent = 'The host removed all players. Join again to play.';
    });
    net.on('chat', chatAdd);
    // A finished drawing comes from the host as packets of lines, when it is that drawing's turn to be guessed.
    net.on('draw', function (d) {
      if (d && d.batch && d.best) { bestTake(d); return; }
      if (!d || !d.batch || !state || !state.draw || d.pid !== state.draw.pid) return; if (d.first) drawClear($('pdraw')); d.batch.forEach(function (m) { drawPaint($('pdraw'), m); }); });
    net.on('result', onResult);
    net.on('bomb', udOnMap);
    net.on('zg', zgOnLive);
    net.on('rule', ruOnLive);
    // Each hello carries what this phone last knew, so a host that reconnects can restore the game.
    hi = function () {
      if (kicked) return;
      var m = me();
      net.send('hi', { pid: pid, was: wasPid, name: name, char: want, cc: wantCC, score: m ? m.score : null,
        last: state ? { phase: state.phase, round: state.round, total: state.total, total_ms: state.total_ms, cfg: state.cfg } : null });
    };
    net.on('_open', function () { hi(); if (want === 'u:' + pid) picSend(); });
    net.on('sync', hi);
    clearInterval(hiTimer); hiTimer = setInterval(hi, 30000);   // a sign of life for the host; every phone in the room receives it too, so not too often
    if (!hiHooked) {
      hiHooked = true;
      // back from another app or a locked screen: say hello at once, and ask for the current state
      document.addEventListener('visibilitychange', function () { if (!document.hidden && net && hi && !kicked) { net.send('hi', { pid: pid, name: name, char: want, cc: wantCC, score: (me() || {}).score, back: 1 }); } });
      // leaving: tell the host, so nobody waits for this phone
      window.addEventListener('pagehide', function () { if (net) net.send('hi', { pid: pid, bye: 1 }); });
    }
    show('v-wait'); $('waittitle').textContent = 'Connecting…'; $('waitsub').textContent = 'Room ' + room;
    clearTimeout(joinTimer);
    joinTimer = setTimeout(function () {
      if (state) return;
      clearInterval(hiTimer); show('v-join');
      $('joinerr').textContent = 'No game found with code ' + room + '. Is the code right?';
    }, 7000);
  });

  function ptsText(n) { return n + (n === 1 ? ' point' : ' points'); }
  function me() { return state && state.players.filter(function (p) { return p.pid === pid; })[0]; }
  if (document.body.classList.contains('embed') && $('code').value.length === 4 && $('name').value.trim()) setTimeout(function () { $('joinform').querySelector('button').click(); }, 0);

  var revealAt = 0, nextAt = 0, toldParent = false, lastH = 0, endShown = false;
  // Inside the host's page the frame should be exactly as tall as its content while in the lobby.
  function tellHeight() {
    setTimeout(function () {
      var mn = document.querySelector('main'), h = mn.offsetTop + mn.scrollHeight + 8;
      if (Math.abs(h - lastH) > 4) { lastH = h; try { parent.postMessage({ esc: 'h', h: h }, location.origin); } catch (e) {} }
    }, 60);
  }
  var kicked = false;
  function onState(s) {
    if (kicked) return;
    if (s && s.players) charCC(s.players);
    onState2(s);
    if (s.phase !== 'shop') $('shopui').classList.add('hidden');
    if (s.phase !== 'bomb' || !s.bomb) $('bombui').classList.add('hidden');
    if (s.phase !== 'carpet' || !s.carpet) $('carpetui').classList.add('hidden');
    if (s.phase !== 'organ' || !s.organ) $('orui').classList.add('hidden');
    if (s.phase !== 'rule' || !s.rule) { $('ruui').classList.add('hidden'); if (ruD) ruSet(''); }
    if (s.phase !== 'zg' || !s.zg) { $('zgui').classList.add('hidden'); if (zgU) { zgHeld = {}; zgSet(); } }
    if (s.phase !== 'clueacc' && s.phase !== 'cluerooms' && !(s.phase === 'reveal' && s.clue && s.clue.st === 'ask')) $('clueui').classList.add('hidden');
    if (s.phase !== 'cluerooms') { $('edui').classList.add('hidden'); if (edCur) { edCur = ''; edClear(); } }
    if (!(s.phase === 'note' && s.note && (s.note.st === 'guess' || s.note.st === 'ctl'))) { $('noteui').classList.add('hidden'); if ($('ntctl')) $('ntctl').classList.add('hidden'); }
    if (!(s.phase === 'qj' && s.qj && (s.qj.st === 'show' || s.qj.st === 'input'))) $('qjui').classList.add('hidden');
    bagUpdate(s); robCheck(s);
    remoteVideo(s);
    rowUpdate();
    // During a game the screen keeps one fixed skeleton, so nothing jumps between question, waiting and answer.
    var ing = !!me() && ['lobby', 'brief', 'intro', 'end'].indexOf(s.phase) < 0;
    document.querySelector('main').classList.toggle('ingame', ing);
    // In the host's own page the lobby view shrinks to a pill around avatar, name and Edit.
    document.querySelector('main').classList.toggle('compact', document.body.classList.contains('embed') && !!me() && s.phase === 'lobby' && !picking);
    $('waitlabel').textContent = ing && s.round && s.phase !== 'bomb' && s.phase !== 'note' && s.phase !== 'carpet' && s.phase !== 'zg' && s.phase !== 'rule' && s.phase !== 'organ' && s.phase !== 'cluerooms' ? 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total) : '';
    if (s.phase !== 'end') endShown = false;
    revealAt = (s.phase === 'guess' || s.phase === 'svote' || s.phase === 'sbest') && s.reveal_in ? Date.now() + s.reveal_in : 0;
    nextAt = s.phase === 'reveal' && s.next_in ? Date.now() + s.next_in : 0;
    // Inside the host's page: let it know once this player is in, so the lobby can open up.
    if (document.body.classList.contains('embed')) tellHeight();
    if (!toldParent && me() && document.body.classList.contains('embed')) { toldParent = true; try { parent.postMessage({ esc: 'joined' }, location.origin); } catch (e) {} }
  }
  function onState2(s) {
    state = s; clearTimeout(joinTimer);
    endsAt = Date.now() + (s.left || 0);
    var m = me();
    $('me').innerHTML = s.phase === 'lobby' ? '' : (m ? charSvg(m.char) : '') + esc(name + (m && !s.hide ? ' · ' + m.score : ''));   // s.hide: totals stay secret until the end
    $('mychar').innerHTML = m && s.phase === 'lobby' ? charSvg(m.char) : '';   // the big avatar only belongs in the lobby
    // In the lobby: a small avatar and your name on top, with an Edit button for both.
    $('profile').classList.toggle('hidden', !(m && s.phase === 'lobby'));
    $('myname').textContent = name;
    // The host hands out a random free avatar on joining; "Select avatar" lets you change it in the lobby.
    if (!m) {
      var full = s.players.length >= Math.min(CHARS.length, MAX_PLAYERS);
      show('v-wait'); $('waittitle').textContent = full ? 'This game is full' : 'Joining…'; $('waitsub').textContent = full ? 'There can be at most ' + MAX_PLAYERS + ' players in one game.' : '';
      return;
    }
    if (m.cc && wantCC !== m.cc && Date.now() > pickUntil) { wantCC = m.cc; try { sessionStorage.setItem('esc-cc', wantCC); } catch (e) {} }
    if (m.char && want !== m.char && Date.now() > pickUntil) { want = m.char; try { sessionStorage.setItem('esc-char', want); } catch (e) {} }
    if (s.phase === 'lobby' && !m.char && !picking && joinFlow === 0) { joinFlow = 1; pickOpen('avatar'); }   /* just joined: choose your avatar first, then your country */
    if (picking) {
      if (s.phase !== 'lobby') picking = false;
      else { renderPicker(s, m); show('v-pick'); return; }
    }
    var key = s.phase + ':' + s.round;
    if (s.phase !== 'guess') builtKey = '';
    if (!s.gallery && !s.draw) dKey = '';
    if (!s.sing) sKey = '';
    var fresh = key !== lastPhaseKey; lastPhaseKey = key;
    if (fresh && s.phase === 'reveal' && s.remote && !s.sing && m) Music.ding();   // no shared screen: every phone plays the reveal sound itself
    if (s.sing && s.phase !== 'reveal' && s.phase !== 'end' && s.phase !== 'lobby' && s.phase !== 'paused' && s.phase !== 'guess') { renderSing(s, m); return; }
    if (s.phase === 'brief' || s.phase === 'intro') {
      // The briefing before the first song: the settings, how scoring works, and a Ready button.
      var b = s.brief || { rows: [], scoring: '' }, n = s.players.filter(function (p) { return p.in; }).length;
      show('v-brief');
      $('briefset').innerHTML = b.rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
      $('briefscore').textContent = b.scoring || '';
      // Everyone in the room on top, with a green ring once they are ready.
      $('pbrief').innerHTML = s.players.slice().sort(function (x, y) { return x.name.localeCompare(y.name); }).map(function (p) {
        return '<div class="pl' + (p.in || s.phase === 'intro' ? ' in' : '') + (p.off ? ' off' : '') + '">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></div>';
      }).join('');
      var intro = s.phase === 'intro';
      $('readybtn').classList.toggle('hidden', !!m.in || intro);
      $('briefwait').className = intro ? 'briefcd' : 'mute';
      $('briefwait').textContent = intro ? 'Starting in ' + Math.max(1, Math.ceil((s.left || 0) / 1000)) : m.in ? 'You’re ready. Waiting for the others (' + n + ' of ' + s.players.length + ')…' : n + ' of ' + s.players.length + ' ready';
      return;
    }
    $('v-wait').classList.toggle('lobbyview', s.phase === 'lobby');
    if (s.phase !== 'chase') { $('chdanger2').classList.add('hidden'); $('chdanger').classList.add('hidden'); }
    if (s.phase !== 'lobby') { $('lobbyready').classList.add('hidden'); $('lobbystart').classList.add('hidden'); }
    if (s.phase === 'lobby') {
      var emb = document.body.classList.contains('embed');   // the host already sees the lobby around this frame
      var nrdy = s.players.filter(function (p) { return p.in; }).length;
      // The big Ready button at the bottom: press to check it, press again to take it back.
      $('lobbyready').classList.remove('hidden'); $('lobbyready').classList.toggle('on', !!m.in); $('lobbyready').setAttribute('aria-pressed', m.in ? 'true' : 'false');
      $('lobbyreadytext').textContent = m.in ? 'Ready!' : 'Ready';
      $('lobbystart').classList.remove('hidden'); $('lobbystart').disabled = !s.all_ready;   // always there, greyed out until everyone is ready
      show('v-wait'); $('waittitle').textContent = emb ? '' : 'You’re in!'; $('waitsub').textContent = emb ? '' : s.all_ready ? 'Everyone is ready. Anyone can start the game.' : m.in ? 'You’re ready. Waiting for the others (' + nrdy + ' of ' + s.players.length + ')…' : 'Press Ready when you’re set. Start unlocks when everyone is ready.';
    }
    else if ((s.phase === 'fun' || s.phase === 'pspin') && s.fun) { show('v-wait'); $('waittitle').textContent = s.fun.icon + ' ' + s.fun.title; $('waitsub').textContent = s.fun.sub; }
    else if (s.phase === 'part' && s.part) {
      show('v-wait'); $('waittitle').textContent = s.part.of > 1 ? 'Round ' + s.part.n + ' of ' + s.part.of : 'Get ready';
      $('waitsub').textContent = s.part.spin ? (s.part.label ? 'Songs from: ' + s.part.label : 'Spinning the era…') : '';
    }
    else if (s.phase === 'qshow') { show('v-wait'); $('waittitle').textContent = 'Here are the answers'; $('waitsub').textContent = 'Watch the big screen. You can vote for the funniest in a moment.'; }
    else if (s.phase === 'qall' && s.quips) {
      // Quip!: finish the line you were given.
      var qp = s.quips.prompts[pid];
      if (quipKey !== s.quips.id) { quipKey = s.quips.id; quipSent = false; $('quipin').value = ''; $('quipfb').textContent = ''; }
      var isBluff = /^What does “/.test(qp || '');
      $('qlead').textContent = isBluff ? 'About the song that is playing:' : 'Write a funny answer about the song that is playing. Afterwards everyone votes for the funniest.'; $('quipin').placeholder = isBluff ? 'Your fake translation…' : 'Your funniest answer…';
      if (!qp) { show('v-wait'); $('waittitle').textContent = 'Everyone is writing'; $('waitsub').textContent = 'You can vote in a moment.'; }
      else if (s.quips.done[pid] || quipSent) { show('v-wait'); $('waittitle').textContent = 'Answer sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
      else { show('v-quip'); $('qprompt').textContent = qp; }
    }
    else if (s.phase === 'chase' && s.chase) chaseView(s.chase);
    else if (s.phase === 'shop' && s.shop) shopView(s);
    else if (s.phase === 'shop') { show('v-wait'); $('waittitle').textContent = 'Welcome to the boutique! 🛍️'; $('waitsub').textContent = 'Lynda is talking… watch the big screen.'; }
    else if (s.phase === 'bomb' && s.bomb) bombView(s);
    else if (s.phase === 'cluerooms' && s.clue) edView(s);
    else if ((s.phase === 'clueacc' || s.phase === 'cluerev') && s.clue) clueView(s);
    else if (s.phase === 'note' && s.note) noteView(s);
    else if (s.phase === 'carpet' && s.carpet) carpetView(s);
    else if (s.phase === 'zg' && s.zg) zgView(s);
    else if (s.phase === 'rule' && s.rule) ruView(s);
    else if (s.phase === 'organ' && s.organ) orView(s);
    else if (s.phase === 'qj' && s.qj) qjView(s);
    else if (s.phase === 'dall' && s.gallery) {
      // Draw!: everyone picks one of their own four songs and draws it, all within the minute.
      var go = s.gallery.opts[pid];
      if (dKey !== s.gallery.id) { dKey = s.gallery.id; padPicked = -1; padDone = false; padReset(); $('dopts').innerHTML = (go || []).map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button>'; }).join(''); }
      var gc = s.gallery.chosen[pid] != null ? s.gallery.chosen[pid] : padPicked;
      if (!go) { show('v-wait'); $('waittitle').textContent = 'Everyone is drawing'; $('waitsub').textContent = 'You can guess the drawings in a moment.'; }
      else if (s.gallery.done[pid] || padDone) { show('v-wait'); $('waittitle').textContent = padSkipped ? 'No drawing this time' : 'Drawing sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
      else { show('v-draw'); $('dround').textContent = 'Postcard Picasso'; drawView(go, gc); }
    }
    else if (s.phase === 'loading' && s.draw) { show('v-wait'); $('waittitle').textContent = 'Get ready…'; $('waitsub').textContent = s.draw.pid === pid ? 'Your drawing is next.' : 'Next: a drawing by ' + s.draw.name + '.'; }
    else if (s.phase === 'guess' && s.draw && s.draw.pid === pid) { show('v-wait'); $('waittitle').textContent = 'Your drawing!'; $('waitsub').textContent = 'The others are guessing what it is.'; }
    else if (s.phase === 'guess' && s.best && s.best.only && s.best.only !== pid) { show('v-wait'); $('waittitle').textContent = '🎉 Party round!'; $('waitsub').textContent = (s.q && s.q.text) || ''; }
    else if (s.phase === 'picks') { show('v-wait'); $('waittitle').textContent = 'Answers are in'; $('waitsub').textContent = 'Watch the big screen.'; }
    else if (s.phase === 'paused') { show('v-wait'); $('waittitle').textContent = 'Game restored'; $('waitsub').textContent = 'The host will continue in a moment.'; }
    else if (s.phase === 'loading' && s.remote) { show('v-wait'); $('waittitle').textContent = 'Get ready…'; $('waitsub').textContent = 'Turn your sound on.'; }
    else if (s.phase === 'opening') { show('v-wait'); $('waittitle').textContent = '✨ The show is starting!'; $('waitsub').textContent = 'Watch the big screen.'; }
    else if (s.phase === 'loading') { show('v-wait'); $('waittitle').textContent = 'Ears open…'; $('waitsub').textContent = ''; }
    else if (s.phase === 'guess') {
      var q = s.q || { type: 'open', text: 'Which song is this?', hint: 'Type the title…' };
      if (m && m.sit) { show('v-wait'); $('waittitle').innerHTML = '<span class="pmic"><i>🎤</i><b>💥</b></span>Broken mic!'; $('waitsub').textContent = m.sit + ' broke your mic: you sit out this question.'; }
      else if (m && m.got) { show('v-wait'); $('waittitle').textContent = 'Correct'; $('waitsub').textContent = ptsText(m.pts) + '. Waiting for the others…'; }
      else if (m && m.done) { show('v-wait'); $('waittitle').textContent = 'Incorrect'; $('waitsub').textContent = 'Your answer is locked in. Waiting for the others…'; }
      else {
        show('v-guess'); $('roundlabel').textContent = 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total);
        $('pdraw').classList.toggle('hidden', !s.draw);
        if (s.draw && builtKey !== key) drawClear($('pdraw'));
        $('qtext').textContent = m && m.flag && q.type === 'mc' ? '🚩 A giant flag is blocking your view!' : q.text;
        /* items on you, shown on the screen itself: a giant flag over the question, a pillar in front of it (half points) */
        var vg = $('v-guess'), fl = vg.querySelector('.pflag'), pl = vg.querySelector('.ppillar');
        if (!fl) { fl = document.createElement('div'); fl.className = 'pflag'; fl.innerHTML = '<i class="pole"></i><i class="cloth"><b></b></i>'; vg.appendChild(fl); }
        if (!pl) { pl = document.createElement('div'); pl.className = 'ppillar'; pl.innerHTML = '<i class="cap"></i><i class="shaft"></i><i class="base"></i><span>½ points</span>'; vg.appendChild(pl); }
        var fc = m && m.flag && m.flagc ? m.flagc : ''; if (fl.getAttribute('data-cc') !== fc) { fl.setAttribute('data-cc', fc); fl.querySelector('.cloth').style.backgroundImage = fc ? 'url(https://flagcdn.com/w640/' + fc + '.png)' : ''; fl.classList.toggle('cc', !!fc); }
        fl.classList.toggle('on', !!(m && m.flag));
        if (m && m.flag) requestAnimationFrame(flagFit); pl.classList.toggle('on', !!(m && m.half));
        var cn = $('ccnote'), ck = m && m.cc ? m.cc : ''; if (cn.getAttribute('data-cc') !== ck) { cn.setAttribute('data-cc', ck); cn.innerHTML = ck ? '<img src="https://flagcdn.com/w40/' + ck + '.png" alt=""><span>You get bonus points for answering questions about songs from the country you represent' + (countries[ck] ? ' (' + esc(countries[ck]) + ')' : '') + '!</span>' : ''; }
        cn.classList.toggle('hidden', !ck);
        $('opts').classList.toggle('flagged', !!(m && m.flag) && q.type === 'mc'); $('flagmsg').classList.toggle('hidden', !(m && m.flag && q.type === 'mc'));   /* the flag hides every answer: only the outlines are left, so you pick blind */
        var mc = q.type === 'mc';
        $('guessform').classList.toggle('hidden', mc); $('opts').classList.toggle('hidden', !mc);
        var bkey = key + (mc && m && m.flag && q.subject !== 'best' ? '|flag' : '');   /* (a Giant Flag landing mid-question: the answers are rebuilt, scrambled) */
        if (builtKey !== bkey) {   // build the question once per song, so typing is never wiped
          var rebuilt = builtKey.split('|')[0] === key; builtKey = bkey;
          if (!rebuilt) { $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb'; }
          $('guess').placeholder = q.hint || ''; $('guess').inputMode = (q.subject === 'place' || q.subject === 'points' || q.subject === 'year') ? 'numeric' : 'text';
          var bq = q.subject === 'best' && s.best;   // best drawing: a small picture on every button, and your own cannot be picked
          var flagged = !!(m && m.flag) && mc && !bq;   // a Giant Flag: the answers in another order, lettered anew
          var order = mc ? q.options.map(function (o, i) { return i; }) : []; if (flagged) for (var j = order.length - 1; j > 0; j--) { var r2 = Math.floor(Math.random() * (j + 1)), tmp = order[j]; order[j] = order[r2]; order[r2] = tmp; }
          $('opts').innerHTML = mc ? order.map(function (i, pos) { var o = q.options[i];
            var own = !!s.best && s.best.pids[i] === pid;   // your own drawing or answer cannot be picked
            return '<button type="button" class="opt' + (bq ? ' bestopt' : '') + '" data-i="' + i + '"' + (own ? ' disabled' : '') + '>' + (bq ? '<canvas data-g="' + i + '" width="' + DRAW_W + '" height="' + DRAW_H + '"></canvas>' : '') + '<b>' + 'ABCDEFGHIJKLMNOP'[flagged ? pos : i] + '</b><span class="otx">' + esc(o) + (own ? ' (yours)' : '') + '</span></button>';
          }).join('') : '';
          $('opts').classList.toggle('bestgrid', !!bq);
          $('opts').classList.toggle('smoked', !!(q.smoke && q.smoke.indexOf(pid) < 0));   // someone else's Smoke Machine: guess blind
          if (bq) bestPaint();
          if (q.peel) setTimeout(peelPaint, 0);
          if (rebuilt && myPick.key === key) { var pb = $('opts').querySelector('button[data-i="' + myPick.i + '"]'); if (pb) pb.classList.add('picked'); }   /* (rebuilt: what you had picked stays picked) */

          if (!mc) $('guess').focus();
        }
        if (mc) {   // the Eurovision Fan: the answers it blew away (on this phone only)
          var fan = (q.fan && q.fan[pid]) || [];
          [].forEach.call($('opts').querySelectorAll('.opt'), function (b) { var gone = fan.indexOf(+b.getAttribute('data-i')) >= 0; if (gone && !b.classList.contains('blown')) { b.classList.add('blown'); b.disabled = true; setTimeout(function () { b.style.display = 'none'; }, 800); } });
        }
      }
    }
    else if (s.phase === 'reveal' && s.clue && s.clue.st === 'ask') clueNotes(s);   // Edgar: after each question, your notebook
    else if (s.phase === 'reveal' || s.phase === 'end') {
      show('v-reveal');
      var r = s.reveal || {};
      if (s.phase !== 'end') $('verdict').className = 'fb verdict' + (s.draw && s.draw.pid === pid ? (m && m.got ? ' ok' : ' no') : '');
      $('verdict').textContent = s.phase === 'end' ? $('verdict').textContent || 'Final scores' : (s.draw && s.draw.pid === pid ? (m && m.got ? 'They got it! +' + m.pts : 'Nobody guessed it') : (s.q && s.q.text) || '');   // the question stays where it was, so the bars do not move
      var why = s.phase === 'reveal' && s.q && s.q.explain;   // the odd-one-out reason takes the top line, right under the video
      $('rround').textContent = s.phase === 'end' ? '' : why || 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total);
      $('rround').className = why ? 'why' : 'mute';
      // The end of the game: no song any more, just the scoreboard counting up (once).
      var end = s.phase === 'end';
      $('songcard').classList.toggle('hidden', end || (!!s.best && !s.best.quip));   // Quip! is about a song, so that one shows it $('pfinal').classList.toggle('hidden', !end);
      if (end && !endShown) {
        endShown = true; $('verdict').className = 'fb verdict'; $('verdict').textContent = 'Final scores';
        finalBoard($('pfinal'), s.players, pid, function (wins) {
          var iWon = wins.some(function (w) { return w.pid === pid; });
          $('verdict').className = 'fb verdict ' + (iWon ? 'ok' : '');
          $('verdict').textContent = !wins.length ? 'Nobody scored' : iWon ? (wins.length > 1 ? 'You share the win!' : 'You win!') : wins.map(function (w) { return w.name; }).join(' & ') + (wins.length > 1 ? ' win!' : ' wins!');
        }, !!s.remote, !s.count_up);
      }
      if (!end) endShown = false;
      var rev = s.phase === 'reveal';
      // Draw!: the finished drawing stays in view at the reveal (the drawer's own pad, or what the others saw).
      if (rev && s.draw && fresh) { try { $('rdraw').src = $(s.draw.pid === pid ? 'dcanvas' : 'pdraw').toDataURL('image/png'); } catch (e) {} }
      $('rdraw').classList.toggle('hidden', !(rev && s.draw));
      $('ropts').innerHTML = rev && s.q ? revealOptions(s.q, m ? m.pick : null, s.draw && s.draw.pid === pid ? null : m ? (m.pts || 0) : null) : '';
      $('rpts').textContent = '';
      $('rpts').className = 'rpts ' + (m && m.got ? 'ok' : 'no');
      if (rev && s.sing) {
        // A Sing! round: show the votes instead of right or wrong.
        var mine = (s.sing.result || []).filter(function (r) { return r.pid === pid; })[0];
        $('verdict').className = 'fb verdict ' + (mine ? 'ok' : 'no');
        $('verdict').textContent = mine ? (mine.win ? 'Best singer!' : mine.votes + (mine.votes === 1 ? ' vote' : ' votes') + ' for you') : 'You didn’t sing this one';
        $('ropts').innerHTML = (s.sing.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
        $('rpts').textContent = ptsText(mine ? mine.pts : 0) + (mine && mine.ccb ? ' · Flag bonus ×2!' : '');
        $('rpts').className = 'rpts ' + (mine ? 'ok' : 'no');
      }
      if (rev && s.best) {
        // Best drawing: the votes per drawing, and the winning picture.
        var bw = s.best.wins || [], iw = bw.some(function (i) { return s.best.pids[i] === pid; }), qz = !!s.best.quip, shownOpts = (qz && s.q.reveal) || s.q.options;
        var bn = bw.map(function (i) { return qz ? (shownOpts[i].split('  —  ')[1] || '') : s.q.options[i]; });
        var myI = s.best.pids.indexOf(pid);
        $('verdict').className = 'fb verdict ' + (iw || (s.best.bluff && m && m.pts) ? 'ok' : '');
        $('verdict').textContent = s.best.bluff ? (m && m.pts ? '+' + m.pts + (m.pick === bw[0] ? ' · you found it!' : ' · your bluff worked') : m && m.pick != null ? 'Fooled!' : s.q.text) : qz ? (myI >= 0 ? (iw ? 'Your answer won! +' : 'Your answer: +') + (m ? m.pts || 0 : 0) : s.q.text) : !bw.length ? 'Nobody voted' : iw ? 'Your drawing won! +' + s.best.win_pts : 'Best drawing: ' + bn.join(' & ');
        $('ropts').innerHTML = shownOpts.map(function (o, i) { var n = (s.best.tally || [])[i] || 0; return '<div class="opt' + (bw.indexOf(i) >= 0 ? ' right' : ' dim') + '"><b>' + 'ABCDEFGHIJKLMNOP'[i] + '</b><span class="otext">' + esc(o) + '</span><span class="mark">' + n + (n === 1 ? ' vote' : ' votes') + '</span></div>'; }).join('');
        if (fresh && bw.length && !qz) { try { var tc = document.createElement('canvas'); tc.width = DRAW_W; tc.height = DRAW_H; drawClear(tc); (bestStore.items[bw[0]] || []).forEach(function (m2) { drawPaint(tc, m2); }); $('rdraw').src = tc.toDataURL('image/png'); } catch (e) {} }
        $('rdraw').classList.toggle('hidden', !bw.length || qz);
      }
      $('ranswer').textContent = '';   // the green bar already says it
      $('rtitle').textContent = r.title || '';
      $('rmeta').innerHTML = r.title ? esc(r.artist) + ' · <img class="metaflag" src="https://flagcdn.com/w40/' + esc(r.code) + '.png" alt=""> ' + esc(countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('rres').textContent = (s.phase === 'reveal' && r.result) || '';
      $('myscorebox').classList.toggle('hidden', !!s.hide || end);
      $('myscore').textContent = m ? m.score : 0;
      var rank = m ? s.players.filter(function (p) { return p.score > m.score; }).length + 1 : 0;
      $('myrank').textContent = rank ? 'Place ' + rank + ' of ' + s.players.length : '';
    }
  }


  // ---------- The Unlucky Draw ----------
  // Your envelope, HOLD or SWAP (changeable until zero), and, for Insiders (or ghosts in the finale), where the bombs are.
  var udMap = null, udPick = {}, udKey = '', udTimerT = null, udEnd = 0, udAsk = 0, udResend = 0;
  function udName(s, k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }
  function udNames(s, a) { var n = a.map(function (k) { return udName(s, k); }).filter(Boolean); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || ''; }
  function udEnvHtml(sym, big) { var y = UD_SYMS[sym] || ['?', '#fff']; return '<span class="udenv' + (big ? ' big' : '') + '" style="--c:' + y[1] + '"><b>' + y[0] + '</b></span>'; }
  function udOnMap(m) { if (!m || !m.to || m.to.indexOf(pid) < 0) return; if (udMap && udMap.key === m.key) return; udMap = m; if (state && state.phase === 'bomb' && state.bomb) bombView(state); }
  function udSend(b) { if (!net) return; net.send('bomb', { pid: pid, key: b.key, c: udPick[b.key] || 'hold' }); udResend = Date.now(); }
  function bombView(s) {
    var b = s.bomb, box = $('bombui'), alive = b.alive.indexOf(pid) >= 0, ghost = b.out.indexOf(pid) >= 0, ins = b.ins.indexOf(pid) >= 0;
    var mine = b.env.filter(function (e) { return e.h === pid; })[0], knows = (b.fin ? ghost : ins);
    show('v-wait'); $('waitlabel').textContent = '';
    if (knows && (!udMap || udMap.key !== b.key) && Date.now() - udAsk > 2000 && net && ['ins', 'ghosts', 'decide', 'lock', 'swap', 'tense'].indexOf(b.st) >= 0) { udAsk = Date.now(); net.send('bomb', { pid: pid, want: 'map', key: b.key }); }
    var map = knows && udMap && udMap.key === b.key ? udMap.map : null;
    var choice = udPick[b.key] || 'hold';
    if (b.st === 'decide') {
      udEnd = Date.now() + (b.left || 0);
      if (alive && Date.now() - udResend > 3000) udSend(b);   /* (sent again now and then: a lost message would otherwise count as HOLD) */
    }
    var head = '', sub = '', body = '';
    var mapHtml = map ? '<div class="udmap"><div class="udmapt">' + (b.fin ? '👻 Only the ghosts know:' : '🕵️ Top secret: where the bombs are') + '</div>' + b.env.map(function (e) { var bm = map.indexOf(e.s) >= 0; return '<span class="udm' + (bm ? ' bomb' : '') + '">' + udEnvHtml(e.s) + '<i>' + esc(e.h === pid ? 'You' : udName(s, e.h)) + '</i><em>' + (bm ? '💣' : '🏳️') + '</em></span>'; }).join('') + '</div>' : (knows ? '<div class="udmap"><div class="udmapt">Receiving the secret map…</div></div>' : '');
    if (b.st === 'win') { var w = b.alive.indexOf(pid) >= 0; head = w ? '🏆 You survived!' : '🏆 ' + udNames(s, b.alive) + (b.alive.length > 1 ? ' survive!' : ' wins!'); sub = w ? 'The last one standing in The Unlucky Draw!' : 'Watch the big screen!'; }
    else if (b.st === 'boom') {
      var hit = b.boomed.indexOf(pid) >= 0;
      head = hit ? '💥 BOOM! You are out' : alive ? '🏳️ Phew, a flag!' : '💥 BOOM!';
      sub = hit ? 'You’re a ghost now 👻 If there’s a Ghost Finale, you’ll know where the bomb is!' : alive ? 'You survive this round.' : udNames(s, b.boomed) + (b.boomed.length > 1 ? ' are' : ' is') + ' out!';
      if (mine) body = '<div class="udme">' + udEnvHtml(mine.s, true) + '<span class="udopen">' + (hit ? '💥' : '🏳️') + '</span></div>';
    }
    else if (ghost) {
      head = '👻 You are a ghost'; sub = b.fin ? (b.st === 'deal' ? 'The Ghost Finale is starting… you’ll see where the bomb is!' : 'You know where the bomb is. Whisper it to the finalists… or lie! 😈') : 'Watch the others sweat on the big screen.';
      body = mapHtml;
    }
    else if (!alive) { head = '💣 The Unlucky Draw'; sub = 'Watch the big screen!'; }
    else {
      var sym = mine ? mine.s : -1;
      if (b.st === 'deal') { head = b.fin ? '👻 Ghost Finale!' : '💌 Round ' + b.round; sub = 'This is your envelope. ' + b.nb + (b.nb === 1 ? ' bomb is' : ' bombs are') + ' hidden in this round…'; }
      else if (b.st === 'ins' || b.st === 'ghosts') { head = ins ? '🕵️ You are an Insider!' : b.fin ? '👻 The ghosts know…' : '🕵️ Insiders: ' + udNames(s, b.ins); sub = ins ? 'You know where the bombs are. Tell the truth… or not! 😏' : b.fin ? 'The ghosts know where the bomb is. Do you trust them?' : 'They know where the bombs are. Do you trust them?'; }
      else if (b.st === 'decide') { head = 'HOLD or SWAP?'; sub = ins ? 'You know where the bombs are. Bluff away!' : 'You can change your mind until zero.'; }
      else if (b.st === 'lock') { head = '🔒 Locked: ' + (choice === 'swap' ? '🔀 SWAP' : '✋ HOLD'); sub = 'Watch the big screen…'; }
      else if (b.st === 'swap') { var mv = b.moves.filter(function (m) { return m.to === pid; })[0]; head = mv ? '🔀 You got a new envelope!' : '✋ You keep your envelope'; sub = 'Watch the big screen…'; }
      else if (b.st === 'tense') { head = '😬 Opening…'; sub = 'Fingers crossed!'; }
      body = '<div class="udme">' + (sym >= 0 ? udEnvHtml(sym, true) : '') + '<small>Your envelope</small></div>';
      if (b.st === 'decide') body += '<div class="udcount">' + Math.max(0, Math.ceil((udEnd - Date.now()) / 1000)) + '</div><div class="udbtns"><button type="button" class="udb hold' + (choice === 'hold' ? ' on' : '') + '" data-c="hold">✋ HOLD</button><button type="button" class="udb swap' + (choice === 'swap' ? ' on' : '') + '" data-c="swap">🔀 SWAP</button></div><p class="udnow">Your choice: <b>' + (choice === 'swap' ? 'SWAP' : 'HOLD') + '</b></p>';
      if (ins) body += mapHtml;
    }
    $('waittitle').textContent = head; $('waitsub').textContent = sub;
    var key = b.key + '|' + b.st + '|' + choice + '|' + (map ? 1 : 0) + '|' + (mine ? mine.s : '') + '|' + b.alive.length;
    box.classList.toggle('hidden', !body);
    if (box.getAttribute('data-k') !== key) {
      box.setAttribute('data-k', key); box.innerHTML = body;
      [].forEach.call(box.querySelectorAll('.udb'), function (btn) { btn.onclick = function () {
        var st = state && state.bomb; if (!st || st.st !== 'decide' || st.key !== b.key) return;
        udPick[b.key] = btn.getAttribute('data-c'); udSend(st); try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
        bombView(state);
      }; });
    }
    clearInterval(udTimerT);
    if (b.st === 'decide' && alive) udTimerT = setInterval(function () {
      var c = box.querySelector('.udcount'); if (!c || !state || state.phase !== 'bomb') { clearInterval(udTimerT); return; }
      var sec = Math.max(0, Math.ceil((udEnd - Date.now()) / 1000)); c.textContent = sec; c.classList.toggle('hot', sec <= 5);
    }, 250);
  }

  // ---------- Where the Hell Is Edgar? ----------
  // A right answer brings a secret clue: it pops up on the phone. At the end, the notebook: pick who, where and with what
  // (what your clues ruled out is crossed off), and accuse.
  var clueToasted = '', clueSel = {}, clueSentId = '';
  function clueToast(s) {
    var c = s.clue; if (!c || !c.freshKey || clueToasted === c.freshKey) return;
    if (s.phase !== 'reveal') return;
    clueToasted = c.freshKey;
    var mine = (c.fresh || {})[pid]; if (!mine || !mine.length) return;
    ptoast('🔍 Secret clue' + (mine.length > 1 ? 's' : '') + ': ' + mine.map(clueText).join(' '));
    var e = $('ptoast'); clearTimeout(ptoastT); ptoastT = setTimeout(function () { e.classList.add('hidden'); }, 7000);   // (a little longer: worth reading)
  }
  // After each clue question: the notebook, read only. What your clues ruled out is crossed off; the new ones glow.
  function clueNotes(s) {
    var c = s.clue, box = $('clueui'), known = (c.known || {})[pid] || [], fresh = (c.fresh || {})[pid] || [];
    show('v-wait');
    $('waittitle').textContent = fresh.length ? '🔍 ' + fresh.length + ' new clues!' : '🔍 No new clues';
    $('waitsub').textContent = '';   // (nothing else on the screen: every card in view while the new clues come in)
    box.classList.remove('hidden'); box.classList.add('compact');
    var key = 'notes|' + c.id + '|' + c.n + '|' + known.join(',');
    if (box.getAttribute('data-k') === key && box.innerHTML) return; box.setAttribute('data-k', key);
    var lab = { who: 'Who took Edgar?', where: 'Where is he hidden?', what: 'What is he hidden inside?' };
    // The cards you already knew are crossed off; the new ones are still open, and come in one by one:
    // a green border, then half a second later grey and crossed off like the rest.
    box.innerHTML = ['where', 'what', 'who'].map(function (k) {
      return '<div class="clset"><span>' + lab[k] + '</span><div>' + CLUE_SETS[k].map(function (x) { var id = k + ':' + x.id, isNew = fresh.indexOf(id) >= 0, out = known.indexOf(id) >= 0 && !isNew; return '<div class="clbtn ro' + (out ? ' out' : '') + '" data-c="' + id + '"><i>' + x.icon + '</i>' + esc(x.name) + '</div>'; }).join('') + '</div></div>';
    }).join('');
    var order = ['where', 'what', 'who'], seq = fresh.slice().sort(function (a, b) { return order.indexOf(a.split(':')[0]) - order.indexOf(b.split(':')[0]); });
    seq.forEach(function (id, i) {
      setTimeout(function () { var el = box.querySelector('[data-c="' + id + '"]'); if (!el || box.getAttribute('data-k') !== key) return; el.classList.add('new'); try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {} }, 700 + i * 650);
      setTimeout(function () { var el = box.querySelector('[data-c="' + id + '"]'); if (!el || box.getAttribute('data-k') !== key) return; el.classList.remove('new'); el.classList.add('out'); }, 700 + i * 650 + 500);
    });
  }
  function clueView(s) {
    var c = s.clue, box = $('clueui'), known = (c.known || {})[pid] || [];
    box.classList.remove('compact');
    show('v-wait');
    if (s.phase === 'clueacc') {
      if (clueSentId === c.id || (c.acc || {})[pid]) {
        box.classList.add('hidden');
        $('waittitle').textContent = '🔍 Accusation sent!'; $('waitsub').textContent = 'Waiting for the other detectives…'; return;
      }
      $('waittitle').textContent = '🔍 Find Edgar'; $('waitsub').textContent = 'Who took him, where is he hidden, and what is he hidden inside? What your clues ruled out is crossed off. You have ' + Math.round(CLUE_ACC_MS / 1000) + ' seconds.';
      box.classList.remove('hidden');
      if (clueSel.id !== c.id) clueSel = { id: c.id };
      var key = c.id + '|' + known.join(',') + '|' + clueSel.who + clueSel.where + clueSel.what;
      if (box.getAttribute('data-k') === key && box.innerHTML) return; box.setAttribute('data-k', key);
      var lab = { who: 'Who took Edgar?', where: 'Where is he hidden?', what: 'What is he hidden inside?' };
      box.innerHTML = ['where', 'what', 'who'].map(function (k) {   // (the place on top, who did it at the bottom, like the big screen)
        return '<div class="clset"><span>' + lab[k] + '</span><div>' + CLUE_SETS[k].map(function (x) { var out = known.indexOf(k + ':' + x.id) >= 0; return '<button type="button" class="clbtn' + (out ? ' out' : '') + (clueSel[k] === x.id ? ' sel' : '') + '" data-k="' + k + '" data-id="' + x.id + '"><i>' + x.icon + '</i>' + esc(x.name) + '</button>'; }).join('') + '</div></div>';
      }).join('') + '<button type="button" class="btn big" id="clueaccuse"' + (clueSel.who && clueSel.where && clueSel.what ? '' : ' disabled') + '>🔍 Accuse!</button>';
      [].forEach.call(box.querySelectorAll('.clbtn'), function (b) { b.onclick = function () { clueSel[b.getAttribute('data-k')] = b.getAttribute('data-id'); clueView(state); }; });
      $('clueaccuse').onclick = function () {
        if (!net || !(clueSel.who && clueSel.where && clueSel.what)) return;
        clueSentId = c.id; var msg = { pid: pid, id: c.id, who: clueSel.who, where: clueSel.where, what: clueSel.what };
        net.send('clue', msg); setTimeout(function () { if (state && state.phase === 'clueacc') net.send('clue', msg); }, 1500);
        clueView(state);
      };
      return;
    }
    box.classList.add('hidden');   // the answer comes out
    var sol = c.sol || {}, parts = [];
    if (sol.where) parts.push('Hidden ' + clueCard('where:' + sol.where).c.in);
    if (sol.what) parts.push('inside the ' + clueCard('what:' + sol.what).c.name);
    if (sol.who) parts.push('by ' + clueCard('who:' + sol.who).c.name);
    var r = c.res && c.res[pid];
    $('waittitle').textContent = r ? (r.n === 3 ? '🏆 You found Edgar!' : r.none ? 'No accusation…' : '🔍 ' + r.n + ' of 3 right') : '🔍 Who took Edgar…?';
    $('waitsub').textContent = (parts.length ? parts.join(' ') + (parts.length === 3 ? '!' : '…') : 'Watch the big screen!') + (r && r.pts ? ' +' + r.pts + ' points' : '') + (c.gift && c.gift.pid === pid ? ' 🎁 Lynda gave you the ' + shopName(c.gift.item) + '! It’s in your bag.' : '');
  }

  // ---------- Turquoise Carpet ----------
  // Watch the runway; after each parade, the question with four answers (20 seconds).
  var tcSent = {}, tcTimerT = null, tcEnd = 0;
  function carpetView(s) {
    var c = s.carpet, box = $('carpetui');
    show('v-wait'); $('waitlabel').textContent = c.sec ? 'Parade ' + c.sec + ' of 5' : '';
    var mineT = (c.tot || {})[pid] || { n: 0 }, score = '⭐ ' + mineT.n + ' right so far';
    clearInterval(tcTimerT);
    if (c.st === 'ready' || c.st === 'walk') {
      box.classList.add('hidden'); box.innerHTML = ''; box.removeAttribute('data-k');
      $('waittitle').textContent = '👀 Watch the runway!'; $('waitsub').textContent = (c.st === 'walk' && c.n ? c.n + ' contestants in this parade. ' : '') + 'Remember hats, sunglasses, outfits, colours and shoes!' + (c.sec > 1 ? ' ' + score : '');
      return;
    }
    if (c.st === 'win') {
      box.classList.add('hidden'); var w = (c.win || []).indexOf(pid) >= 0;
      var names = (c.win || []).map(function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }).filter(Boolean);
      $('waittitle').textContent = w ? '🏆 You win the Turquoise Carpet!' : names.length ? '🏆 ' + names.join(' & ') + (names.length > 1 ? ' win!' : ' wins!') : 'Nobody got one right…';
      $('waitsub').textContent = 'You got ' + mineT.n + ' of 5 right.';
      return;
    }
    var q = c.q; if (!q) return;
    var sent = tcSent[c.qid], done = (c.done || {})[pid] || sent != null;
    if (c.st === 'ask') tcEnd = Date.now() + (c.left || 0);
    var mine = c.mine && c.mine[pid] ? c.mine[pid].a : sent;
    $('waittitle').textContent = c.st === 'reveal' ? (mine === q.ans ? '✅ Right!' : mine != null ? '❌ It was ' + q.opts[q.ans] : '⏰ It was ' + q.opts[q.ans]) : q.text;
    $('waitsub').textContent = c.st === 'reveal' ? q.text : done ? 'Answer locked! Waiting for the others…' : '';
    var key = c.qid + '|' + c.st + '|' + (done ? 1 : 0) + '|' + mine;
    box.classList.remove('hidden');
    if (box.getAttribute('data-k') !== key) {
      box.setAttribute('data-k', key);
      box.innerHTML = (c.st === 'ask' ? '<div class="tccount"></div>' : '') + q.opts.map(function (o, i) { return '<button type="button" class="tcbtn' + (mine === i ? ' mine' : '') + (c.st === 'reveal' ? (i === q.ans ? ' right' : ' wrong') : '') + '" data-i="' + i + '" style="--i:' + i + '"' + (done || c.st !== 'ask' ? ' disabled' : '') + '><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button>'; }).join('');
      [].forEach.call(box.querySelectorAll('.tcbtn:not([disabled])'), function (b) { b.onclick = function () {
        var cc = state && state.carpet; if (!net || !cc || cc.st !== 'ask' || cc.qid !== c.qid || tcSent[c.qid] != null) return;
        var a = +b.getAttribute('data-i'); tcSent[c.qid] = a; var msg = { pid: pid, qid: c.qid, a: a };
        net.send('carpet', msg); setTimeout(function () { var c2 = state && state.carpet; if (c2 && c2.st === 'ask' && c2.qid === msg.qid && !(c2.done || {})[pid]) net.send('carpet', msg); }, 1500);
        try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
        carpetView(state);
      }; });
    }
    if (c.st === 'ask') { var tick = function () { var e = box.querySelector('.tccount'); if (!e) return; var sec = Math.max(0, Math.ceil((tcEnd - Date.now()) / 1000)); e.textContent = sec; e.classList.toggle('hot', sec <= 5); }; tick(); tcTimerT = setInterval(function () { if (!state || state.phase !== 'carpet') { clearInterval(tcTimerT); return; } tick(); }, 250); }
  }

  // ---------- Zero Gravity ----------
  // Hold LEFT or RIGHT to keep your balance; the meter shows how far you lean (the red ends: you fall).
  var zgLive = null, zgU = 0, zgUT = null, zgHeld = {};
  function zgSendU() { var z = state && state.zg; if (!net || !z || z.st !== 'play') return; net.send('zg', { pid: pid, id: z.id, u: zgU }); }
  function zgSet() {
    var u = (zgHeld.r ? 1 : 0) - (zgHeld.l ? 1 : 0); if (u === zgU) return; zgU = u; zgSendU();
    clearInterval(zgUT); if (u) zgUT = setInterval(zgSendU, 700);   /* (repeated while held, in case a message got lost) */
  }
  function zgOnLive(m) { var z = state && state.zg; if (!m || !m.x || !z || m.id !== z.id) return; zgLive = m; zgMeter(); }
  function zgMeter() {
    var box = $('zgui'), z = state && state.zg; if (!box || !z) return;
    var src = zgLive && zgLive.id === z.id ? zgLive : z, x = (src.x || {})[pid], out = (src.out || {})[pid];
    var nd = box.querySelector('.zgneedle'); if (nd && x != null) { nd.style.left = (50 + x / 2) + '%'; nd.classList.toggle('risky', Math.abs(x) > 60); }
    var sc = box.querySelector('.zgsc b'); if (sc) sc.textContent = (src.sc || {})[pid] || 0;
    var tm = box.querySelector('.zgsc i'); if (tm && src.left != null) tm.textContent = Math.ceil(src.left / 1000) + 's';
    if (out != null && !box.classList.contains('fell') && z.st === 'play') zgView(state);
  }
  function zgView(s) {
    var z = s.zg, box = $('zgui'), fell = (z.out || {})[pid] != null || (zgLive && zgLive.id === z.id && (zgLive.out || {})[pid] != null), mine = z.order.indexOf(pid) >= 0;
    show('v-wait');
    if (z.st === 'end') {
      box.classList.add('hidden'); zgHeld = {}; zgSet();
      var w = (z.win || []).indexOf(pid) >= 0, names = (z.win || []).map(function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }).filter(Boolean);
      $('waittitle').textContent = w ? '🏆 You win Zero Gravity!' : names.length ? '🏆 ' + names.join(' & ') + (names.length > 1 ? ' win!' : ' wins!') : 'Everyone fell into space…';
      $('waitsub').textContent = mine ? 'Your score: ' + ((z.sc || {})[pid] || 0) + (fell ? ' (you fell)' : ' (still standing!)') : '';
      return;
    }
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🌌 Zero Gravity'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (fell) { box.classList.add('hidden'); box.classList.add('fell'); zgHeld = {}; zgSet(); $('waittitle').textContent = '🚀 You fell into space!'; $('waitsub').textContent = 'Your score so far stays: ' + (((zgLive && zgLive.sc) || z.sc || {})[pid] || 0) + '. Watch the others wobble…'; return; }
    box.classList.remove('fell');
    $('waittitle').textContent = z.st === 'ready' ? '🌌 Get ready…' : '🌌 Keep your balance!';
    $('waitsub').textContent = 'Leaning right? Hold LEFT. Leaning left? Hold RIGHT. Lean further for more points, but don’t fall!';
    box.classList.remove('hidden');
    if (box.getAttribute('data-id') !== z.id) {
      box.setAttribute('data-id', z.id); zgHeld = {}; zgU = 0; clearInterval(zgUT);
      box.innerHTML = '<div class="zgsc"><span>⭐ <b>0</b></span><i></i></div><div class="zgmeter"><span class="zgdz l"></span><span class="zgdz r"></span><span class="zgmid"></span><span class="zgneedle"></span></div>' +
        '<div class="zgbtns"><button type="button" class="zgb" data-d="l">◀<small>LEFT</small></button><button type="button" class="zgb" data-d="r">▶<small>RIGHT</small></button></div>';
      [].forEach.call(box.querySelectorAll('.zgb'), function (b) {
        var d = b.getAttribute('data-d');
        var on = function (e) { e.preventDefault(); zgHeld[d] = true; b.classList.add('on'); zgSet(); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} };
        var off = function (e) { if (e) e.preventDefault(); zgHeld[d] = false; b.classList.remove('on'); zgSet(); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      });
    }
    zgMeter();
  }

  // ---------- We Will Rule the World ----------
  // A cross-shaped D-pad: hold a direction to keep moving (one tile per second). Stunned: the pad dims, 3-2-1 in the middle.
  var ruLive = null, ruD = '', ruDT = null, ruStunEnd = 0, ruStunT = null;
  function ruSendD() { var r = state && state.rule; if (!net || !r || r.st !== 'play') return; net.send('rule', { pid: pid, id: r.id, d: ruD }); }
  function ruSet(d) { if (d === ruD) return; ruD = d; ruSendD(); clearInterval(ruDT); if (d) ruDT = setInterval(ruSendD, 700); }
  function ruOnLive(m) { var r = state && state.rule; if (!m || !m.cnt || !r || m.id !== r.id) return; ruLive = m; if ((m.stun || {})[pid]) ruStunEnd = Date.now() + m.stun[pid]; ruPad(); }
  function ruPad() {
    var box = $('ruui'), r = state && state.rule; if (!box || !r) return;
    var src = ruLive && ruLive.id === r.id ? ruLive : r, n = (src.cnt || {})[pid] || 0;
    var c = box.querySelector('.rucnt b'); if (c) c.textContent = n;
    var tm = box.querySelector('.rucnt i'); if (tm && src.left != null) { var s = Math.ceil(src.left / 1000); tm.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
    var left = ruStunEnd - Date.now(), pad = box.querySelector('.rupad'); if (!pad) return;
    pad.classList.toggle('stun', left > 0); pad.querySelector('.ruc').textContent = left > 0 ? Math.ceil(left / 1000) : '';
    clearTimeout(ruStunT); if (left > 0) ruStunT = setTimeout(ruPad, Math.min(250, left));
  }
  function ruView(s) {
    var r = s.rule, box = $('ruui'), mine = r.order.indexOf(pid) >= 0;
    show('v-wait');
    if (r.st === 'count') { box.classList.add('hidden'); ruSet(''); $('waittitle').textContent = '🪩 Counting the tiles…'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (r.st === 'end') {
      box.classList.add('hidden'); ruSet('');
      var w = (r.win || []).indexOf(pid) >= 0, names = (r.win || []).map(function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }).filter(Boolean);
      $('waittitle').textContent = w ? '👑 You rule the world!' : names.length ? '👑 ' + names.join(' & ') + (names.length > 1 ? ' rule the world!' : ' rules the world!') : 'The end!';
      $('waitsub').textContent = mine ? 'You had ' + ((r.cnt || {})[pid] || 0) + ' tiles.' : '';
      return;
    }
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🪩 We Will Rule the World'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    var col = (r.cols || {})[pid] || '#888';
    $('waittitle').textContent = r.st === 'play' ? '🪩 Claim the floor!' : r.st === 'rise' ? '✨ Here she comes…' : '🪩 Get ready…'; $('waitsub').textContent = 'Hold a direction to keep dancing. Your colour:';
    box.classList.remove('hidden'); box.style.setProperty('--c', col);
    if (box.getAttribute('data-id') !== r.id) {
      box.setAttribute('data-id', r.id); ruD = ''; clearInterval(ruDT); ruStunEnd = 0;
      box.innerHTML = '<div class="rucnt"><span><span class="rusw"></span> <b>0</b> tiles</span><i></i></div><div class="rupad"><button type="button" class="rub u" data-d="u">▲</button><button type="button" class="rub l" data-d="l">◀</button><span class="ruc"></span><button type="button" class="rub r" data-d="r">▶</button><button type="button" class="rub d" data-d="d">▼</button></div>';
      [].forEach.call(box.querySelectorAll('.rub'), function (b) {
        var d = b.getAttribute('data-d');
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} [].forEach.call(box.querySelectorAll('.rub'), function (x) { x.classList.toggle('on', x === b); }); ruSet(d); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} });
        var off = function (e) { if (e) e.preventDefault(); b.classList.remove('on'); if (ruD === d) ruSet(''); };
        b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      });
    }
    ruPad();
  }

  // ---------- Sja-la-lie Sja-la-Mayhem! ----------
  // Your station's repair job: turn the crank (SPEED), slide the pipes into the dashed lines (PITCH), or unplug the wrong
  // cables and plug them into the socket of their own colour (SOUND EFFECTS). Each phone gets its own puzzle.
  var orKey = '', orD = 0, orSentD = 0, orPz = null, OR_COLS = ['#e53950', '#2f80ed', '#f2c12e', '#27ae60', '#9b51e0'];
  var OR_HELP = { speed: 'Turn the brass crank: drag the handle round and round!', pitch: 'Slide each pipe up or down until its top sits in the dashed band.', fx: 'Tap a wrongly plugged cable to unplug it, then drag it to the socket of its own colour.' };
  var OR_TITLE = { speed: '⚙️ Speed', pitch: '🎵 Pitch', fx: '🔌 Sound effects' };
  function orReport(o) { var g = state && state.organ; if (!net || !g || g.st !== 'fix') return; net.send('organ', { pid: pid, id: g.id, ph: g.ph, d: orD }); orSentD = orD; }
  function orStep(d) { if (d <= orD) return; orD = d; try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} Music.plop(d); orReport(); var c = $('orui').querySelector('.orcount'); if (c) c.textContent = orD + ' / ' + orPz.of; if (orD >= orPz.of) setTimeout(function () { if (state) orView(state); }, 400); }
  function orView(s) {
    var g = s.organ, box = $('orui'), sta = g.sta[pid], mine = g.order.indexOf(pid) >= 0;
    show('v-wait');
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🎡 Sja-la-lie Sja-la-Mayhem!'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (g.st === 'intro') { box.classList.add('hidden'); $('waittitle').textContent = '🎡 Get your tools ready…'; $('waitsub').textContent = ''; return; }
    if (g.st === 'end') {
      box.classList.add('hidden'); var w = (g.win || []).indexOf(pid) >= 0;
      $('waittitle').textContent = w ? '🏆 Best repairer!' : '🎡 The organ is saved!'; $('waitsub').textContent = 'Your repair points: ' + ((g.pts || {})[pid] || 0); return;
    }
    if (g.st === 'fixed') { box.classList.add('hidden'); $('waittitle').textContent = g.fixed ? '🎶 The organ is fixed!' : '💨 Time’s up!'; $('waitsub').textContent = (g.last && g.last[pid] != null ? '+' + g.last[pid] + ' repair points this phase. ' : '') + (g.ph < 3 ? 'Next phase coming up…' : ''); return; }
    var key = g.id + '|' + g.ph;
    if (orKey !== key) { orKey = key; orD = 0; orSentD = 0; orPz = orMake(sta, g.ph); box.removeAttribute('data-k'); }
    if (g.st === 'brief') { box.classList.add('hidden'); $('waittitle').textContent = 'Phase ' + g.ph + ': ' + OR_TITLE[sta]; $('waitsub').textContent = OR_HELP[sta]; return; }
    var pr = (g.prog || {})[pid]; if (pr && pr[0] < orD && orD > 0) orReport();   /* (the host missed a step: send it again) */
    if (orD >= orPz.of) { box.classList.add('hidden'); $('waittitle').textContent = '✅ ' + OR_TITLE[sta] + ' fixed!'; $('waitsub').textContent = 'Great job! Now cheer on the others… 🔧'; return; }
    $('waittitle').textContent = OR_TITLE[sta]; $('waitsub').textContent = OR_HELP[sta];
    box.classList.remove('hidden');
    if (box.getAttribute('data-k') === key) return;
    box.setAttribute('data-k', key);
    box.innerHTML = '<div class="orcount">0 / ' + orPz.of + '</div><div class="orpz"></div>';
    var pz = box.querySelector('.orpz');
    if (sta === 'speed') orSpeed(pz); else if (sta === 'pitch') orPitch(pz); else orFx(pz);
  }
  function orMake(sta, ph) {
    var of = { speed: [3, 5, 8], pitch: [3, 4, 6], fx: [1, 2, 3] }[sta][ph - 1];
    if (sta === 'pitch') { var tol = [7, 5, 3.5][ph - 1], pipes = []; for (var i = 0; i < of; i++) { var t = 25 + Math.random() * 55, h; do { h = 12 + Math.random() * 80; } while (Math.abs(h - t) < tol * 2 + 8); pipes.push({ t: t, h: h, ok: false }); } return { of: of, tol: tol, pipes: pipes }; }
    if (sta === 'fx') {
      var m = of + 2, cab = []; for (var c = 0; c < m; c++) cab.push({ col: c, at: -1 });
      var socks = shuffle(cab.map(function (x) { return x.col; }).concat([-1]));   // the sockets (−1: the grey spare)
      var wrong = shuffle(cab.map(function (x, i) { return i; })).slice(0, of);
      cab.forEach(function (x, i) { x.at = socks.indexOf(i); });
      wrong.forEach(function (w, i) { cab[w].at = i < of - 1 ? socks.indexOf(wrong[i + 1]) : socks.indexOf(-1); });
      return { of: of, cab: cab, socks: socks, base: m - of };
    }
    return { of: of };
  }
  function orAng(e, el) { var r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); }
  function orSpeed(pz) {
    pz.innerHTML = '<svg class="orwh" viewBox="-110 -110 220 220"><circle r="100" fill="#3a2010"/><circle r="92" fill="none" stroke="#ffd23f" stroke-width="10"/><g class="orrot"><path d="M0 -88 V88 M-88 0 H88 M-62 -62 L62 62 M62 -62 L-62 62" stroke="#ffd23f" stroke-width="7"/><circle r="18" fill="#ffe27a"/><circle class="orknob" cx="0" cy="-76" r="20" fill="#c8102e" stroke="#fff" stroke-width="4"/></g></svg><p class="orhint">↻ Drag the red handle round!</p>';
    var sv = pz.querySelector('.orwh'), rot = pz.querySelector('.orrot'), acc = 0, last = null;
    sv.addEventListener('pointerdown', function (e) { e.preventDefault(); try { sv.setPointerCapture(e.pointerId); } catch (x) {} last = orAng(e, sv); });
    sv.addEventListener('pointermove', function (e) {
      if (last == null) return; var a = orAng(e, sv), d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; last = a; acc += d;
      rot.setAttribute('transform', 'rotate(' + (acc * 180 / Math.PI).toFixed(1) + ')');
      var n = Math.floor(Math.abs(acc) / (2 * Math.PI)); if (n > orD) orStep(Math.min(n, orPz.of));
    });
    var up = function () { last = null; }; sv.addEventListener('pointerup', up); sv.addEventListener('pointercancel', up);
  }
  function orPitch(pz) {
    pz.innerHTML = '<div class="orpipes">' + orPz.pipes.map(function (p, i) { return '<div class="orpp" data-i="' + i + '"><div class="ortg" style="bottom:' + (p.t - orPz.tol) + '%;height:' + (orPz.tol * 2) + '%"></div><div class="orpb" style="height:' + p.h + '%"><i></i></div></div>'; }).join('') + '</div>';
    [].forEach.call(pz.querySelectorAll('.orpp'), function (col) {
      var p = orPz.pipes[+col.getAttribute('data-i')], body = col.querySelector('.orpb'), drag = false;
      var set = function (e) { var r = col.getBoundingClientRect(); p.h = Math.max(6, Math.min(97, (r.bottom - e.clientY) / r.height * 100)); body.style.height = p.h + '%'; col.classList.toggle('near', Math.abs(p.h - p.t) <= orPz.tol); };
      col.addEventListener('pointerdown', function (e) { if (p.ok) return; e.preventDefault(); drag = true; try { col.setPointerCapture(e.pointerId); } catch (x) {} set(e); });
      col.addEventListener('pointermove', function (e) { if (drag) set(e); });
      var up = function () { if (!drag) return; drag = false; if (Math.abs(p.h - p.t) <= orPz.tol) { p.ok = true; col.classList.add('ok'); orStep(orPz.pipes.filter(function (x) { return x.ok; }).length); } };
      col.addEventListener('pointerup', up); col.addEventListener('pointercancel', up);
    });
  }
  function orFx(pz) {
    var z = orPz, m = z.cab.length, ns = z.socks.length;
    pz.innerHTML = '<div class="orfx"><svg class="orwires" viewBox="0 0 300 300" preserveAspectRatio="none"></svg>' + z.cab.map(function (c, i) { return '<span class="orsrc" style="left:' + ((i + 0.5) / m * 100) + '%;--c:' + OR_COLS[c.col] + '"></span>'; }).join('') +
      z.socks.map(function (c, j) { return '<span class="orsock' + (c < 0 ? ' spare' : '') + '" style="left:' + ((j + 0.5) / ns * 100) + '%;--c:' + (c < 0 ? '#666' : OR_COLS[c]) + '"></span>'; }).join('') +
      z.cab.map(function (c, i) { return '<span class="orplug" data-i="' + i + '" style="--c:' + OR_COLS[c.col] + '"></span>'; }).join('') + '</div><p class="orhint">Tap a wrong plug to unplug it, then drag it home.</p>';
    var box = pz.querySelector('.orfx'), wires = pz.querySelector('.orwires');
    var pos = function (c, i) { if (c.drag) return c.drag; if (c.at >= 0) return [(c.at + 0.5) / ns * 300, 262]; return [(i + 0.5) / m * 300, 160 + (i % 2) * 22]; };
    var draw = function () {
      var ok = 0;
      wires.innerHTML = z.cab.map(function (c, i) { var a = [(i + 0.5) / m * 300, 30], b = pos(c, i); return '<path d="M' + a[0] + ' ' + a[1] + ' C' + a[0] + ' ' + (a[1] + 90) + ' ' + b[0] + ' ' + (b[1] - 90) + ' ' + b[0] + ' ' + b[1] + '" stroke="' + OR_COLS[c.col] + '" stroke-width="7" fill="none" stroke-linecap="round"/>'; }).join('');
      [].forEach.call(box.querySelectorAll('.orplug'), function (el) { var i = +el.getAttribute('data-i'), c = z.cab[i], p = pos(c, i); el.style.left = (p[0] / 3) + '%'; el.style.top = (p[1] / 3) + '%'; var home = c.at >= 0 && z.socks[c.at] === c.col; el.classList.toggle('loose', c.at < 0); el.classList.toggle('bad', c.at >= 0 && !home); el.classList.toggle('home', home); if (home) ok++; });
      orStep(Math.max(0, ok - z.base));
    };
    [].forEach.call(box.querySelectorAll('.orplug'), function (el) {
      var i = +el.getAttribute('data-i'), c = z.cab[i], dragging = false;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (c.at >= 0) { c.at = -1; el.classList.add('pop'); setTimeout(function () { el.classList.remove('pop'); }, 300); draw(); return; }   // unplug first (a tap)
        dragging = true; try { el.setPointerCapture(e.pointerId); } catch (x) {}
      });
      el.addEventListener('pointermove', function (e) { if (!dragging) return; var r = box.getBoundingClientRect(); c.drag = [(e.clientX - r.left) / r.width * 300, (e.clientY - r.top) / r.height * 300]; draw(); });
      var up = function () {
        if (!dragging) return; dragging = false; var p = c.drag; c.drag = null;
        if (p) { var j = Math.round(p[0] / 300 * ns - 0.5), free = j >= 0 && j < ns && !z.cab.some(function (o) { return o.at === j; });
          if (free && p[1] > 200 && z.socks[j] === c.col) { c.at = j; try { navigator.vibrate && navigator.vibrate(30); } catch (x) {} } else { el.classList.add('nope'); setTimeout(function () { el.classList.remove('nope'); }, 400); } }
        draw();
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    draw();
  }

  // ---------- Where the Hell Is Edgar?: the four rooms on the phone ----------
  var ED_R = [{ id: 'green', name: 'Green Room', icon: '🛋️', max: 2 }, { id: 'club', name: 'Euroclub', icon: '🪩', max: 3 }, { id: 'back', name: 'Backstage', icon: '🔌', max: 2 }, { id: 'boud', name: 'Woodruff’s Boudoir', icon: '👗', max: 3 }];
  var edCur = '', edGame = '', edSeen = '', edT = [], edAc = null;
  function edLater(f, ms) { edT.push(setTimeout(f, ms)); }
  function edClear() { edT.forEach(clearTimeout); edT = []; }
  function edTone(i) {   // a short tone for each sound symbol (its own pitch)
    try { if (!edAc) edAc = new (window.AudioContext || window.webkitAudioContext)(); var t = edAc.currentTime + .01, o = edAc.createOscillator(), g = edAc.createGain(); o.type = ['sine', 'square', 'triangle', 'sawtooth'][i % 4]; o.frequency.value = 262 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12, 14, 16][i % 10] / 12); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .5); o.connect(g); g.connect(edAc.destination); o.start(t); o.stop(t + .55); } catch (e) {}
  }
  function edSend(room, score) {
    var c = state && state.clue; if (!net || !c) return; var msg = { pid: pid, id: c.id, room: room, score: score };
    net.send('clue', msg); setTimeout(function () { var c2 = state && state.clue; if (c2 && c2.st === 'rooms' && c2.rooms && c2.rooms[pid] && c2.rooms[pid].done.indexOf(room) < 0) net.send('clue', msg); }, 1500);
  }
  function edView(s) {
    var c = s.clue, box = $('edui'), me = c.rooms && c.rooms[pid];
    show('v-wait');
    if (edGame !== c.id) { edGame = c.id; edCur = ''; edSeen = ''; edClear(); }
    if (!me) { box.classList.add('hidden'); $('clueui').classList.add('hidden'); $('waittitle').textContent = '🔍 Searching the building…'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (edCur) return;   // (a room task is running: it draws itself)
    var last = (c.last || {})[pid];
    if (last && edSeen !== last.k) {   // just finished a room: the new clues
      box.classList.add('hidden');
      var fresh = last.c.concat(last.b);
      clueNotes({ clue: { id: c.id, n: last.k, known: c.known, fresh: (function () { var o = {}; o[pid] = fresh; return o; })() } });
      $('waittitle').textContent = fresh.length ? '🔍 ' + fresh.length + ' new clue' + (fresh.length > 1 ? 's' : '') + '!' + (last.b.length ? ' (' + last.b.length + ' bonus!)' : '') : '🔍 No clues this time…';
      var nb = $('clueui'); if (!nb.querySelector('.ednext')) nb.insertAdjacentHTML('beforeend', '<button type="button" class="btn big ednext">' + (me.done.length >= 4 ? '✅ All rooms searched!' : '🚪 Next room') + '</button>');
      nb.querySelector('.ednext').onclick = function () { edSeen = last.k; $('clueui').classList.add('hidden'); edView(state); };
      return;
    }
    $('clueui').classList.add('hidden');
    if (me.done.length >= 4) { box.classList.add('hidden'); $('waittitle').textContent = '✅ All four rooms searched!'; $('waitsub').textContent = 'Wait for the others… then make your accusation.'; return; }
    $('waittitle').textContent = '🚪 Pick a room'; $('waitsub').textContent = 'Every room only once. Time left: ' + Math.ceil((c.left || 0) / 1000) + 's';
    box.classList.remove('hidden');
    var key = 'pick|' + me.done.join(',');
    if (box.getAttribute('data-k') === key) return; box.setAttribute('data-k', key);
    box.innerHTML = '<div class="eddoors">' + ED_R.map(function (r) { var d = me.done.indexOf(r.id) >= 0; return '<button type="button" class="eddoor' + (d ? ' done' : '') + '" data-r="' + r.id + '"' + (d ? ' disabled' : '') + '><span>' + r.icon + '</span><b>' + r.name + '</b><small>' + (d ? '✔ ' + (me.score[r.id] || 0) + ' clue' + ((me.score[r.id] || 0) === 1 ? '' : 's') : 'up to ' + r.max + ' clues') + '</small></button>'; }).join('') + '</div>';
    [].forEach.call(box.querySelectorAll('.eddoor:not([disabled])'), function (b) { b.onclick = function () {
      var r = b.getAttribute('data-r'); edCur = r; box.removeAttribute('data-k');
      if (net) net.send('clue', { pid: pid, id: c.id, room: r, enter: 1 });
      edRun(r);
    }; });
  }
  function edFinish(room, score) {   // the task is done: the score goes to the host; the clues come back in the next update
    edClear(); edCur = ''; edSend(room, score);
    var box = $('edui'); box.innerHTML = '<div class="edwait">🔍 Searching for clues…</div>'; box.removeAttribute('data-k');
    $('waittitle').textContent = ED_R.filter(function (r) { return r.id === room; })[0].icon + ' Done!'; $('waitsub').textContent = '';
  }
  function edRun(room) {
    var box = $('edui'); edClear(); box.classList.remove('hidden'); $('clueui').classList.add('hidden');
    var safety = setTimeout(function () { if (edCur === room) { var f = box._score; edFinish(room, typeof f === 'function' ? f() : 0); } }, 42000); edT.push(safety);
    box._score = null;
    if (room === 'green') edGreen(box); else if (room === 'club') edClub(box); else if (room === 'back') edBack(box); else edBoud(box);
  }
  // Green Room: four contestants on six seats; a fridge on wheels keeps rolling past. Then: who sat where?
  function edGreen(box) {
    var ppl = shuffle([['🎤', 'Zara', '#ff5a8a'], ['🎸', 'Milo', '#3fb6ff'], ['🥁', 'Ines', '#ffd23f'], ['🎹', 'Bram', '#3ddc84'], ['🎻', 'Noor', '#c58bff'], ['🎷', 'Kai', '#ff9f1c']]).slice(0, 4);
    var seats = shuffle([0, 1, 2, 3, 4, 5]).slice(0, 4), placed = {}, sel = -1;
    $('waittitle').textContent = '🛋️ Green Room'; $('waitsub').textContent = 'Remember who sits where! (Watch out for the fridge…)';
    var seatHtml = function (show) { var h = ''; for (var i = 0; i < 6; i++) { var w = show ? seats.indexOf(i) : -1, pl = !show ? Object.keys(placed).filter(function (k) { return placed[k] === i; })[0] : null, pp = w >= 0 ? ppl[w] : pl != null ? ppl[pl] : null; h += '<button type="button" class="edseat" data-s="' + i + '">' + (pp ? '<span class="edpp" style="--c:' + pp[2] + '">' + pp[0] + '<b>' + pp[1] + '</b></span>' : '') + '</button>'; } return h; };
    box.innerHTML = '<div class="edbar"><i></i></div><div class="edsofa">' + seatHtml(true) + '<div class="edfridge">🧊<b>FRIDGE</b></div></div>';
    box.querySelector('.edbar i').style.animation = 'edbar 7s linear forwards';
    edLater(function () {
      $('waitsub').textContent = 'Who sat where? Tap a contestant, then a seat.';
      var draw = function () {
        box.innerHTML = '<div class="edsofa">' + seatHtml(false) + '</div><div class="edchips">' + ppl.map(function (p, i) { return '<button type="button" class="edchip' + (sel === i ? ' sel' : '') + (placed[i] != null ? ' used' : '') + '" data-i="' + i + '" style="--c:' + p[2] + '">' + p[0] + ' ' + p[1] + '</button>'; }).join('') + '</div><button type="button" class="btn big eddone"' + (Object.keys(placed).length === 4 ? '' : ' disabled') + '>✅ Done</button>';
        [].forEach.call(box.querySelectorAll('.edchip'), function (b) { b.onclick = function () { sel = +b.getAttribute('data-i'); draw(); }; });
        [].forEach.call(box.querySelectorAll('.edseat'), function (b) { b.onclick = function () { var st = +b.getAttribute('data-s'); Object.keys(placed).forEach(function (k) { if (placed[k] === st) delete placed[k]; }); if (sel >= 0) { placed[sel] = st; sel = -1; } draw(); }; });
        box.querySelector('.eddone').onclick = function () { edFinish('green', box._score()); };
      };
      box._score = function () { var ok = ppl.filter(function (p, i) { return placed[i] === seats[i]; }).length; return ok === 4 ? 2 : ok >= 2 ? 1 : 0; };
      draw();
    }, 7000);
  }
  // Euroclub: DJ Konstantin dances, the disco ball warns, then five sound symbols, one at a time. Play them back in order.
  var ED_SYM = ['🎺', '🥁', '🎸', '🎹', '🎻', '🔔', '👏', '🎷', '📯', '🪇'];
  function edClub(box) {
    var seq = []; for (var i = 0; i < 5; i++) seq.push(Math.floor(Math.random() * ED_SYM.length));
    $('waittitle').textContent = '🪩 Euroclub'; $('waitsub').textContent = 'DJ Konstantin is warming up… watch the square below him!';
    box.innerHTML = '<div class="edclub"><div class="eddjw dance">' + ED_DJ + '</div><div class="edballw">🪩</div><div class="edsq"></div></div>';
    var sq = box.querySelector('.edsq'), ball = box.querySelector('.edballw');
    edLater(function () { ball.classList.add('warn'); $('waitsub').textContent = '⚠️ Here it comes…'; }, 8000);
    seq.forEach(function (x, i) { edLater(function () { sq.textContent = ED_SYM[x]; sq.classList.remove('pop'); void sq.offsetWidth; sq.classList.add('pop'); edTone(x); }, 10000 + i * 1300); edLater(function () { sq.textContent = ''; }, 10000 + i * 1300 + 1000); });
    edLater(function () {
      var got = [];
      $('waitsub').textContent = 'Tap the five symbols in the same order!';
      var draw = function () {
        box.innerHTML = '<div class="edslots">' + [0, 1, 2, 3, 4].map(function (i) { return '<span>' + (got[i] != null ? ED_SYM[got[i]] : '') + '</span>'; }).join('') + '</div><div class="edsyms">' + ED_SYM.map(function (sy, i) { return '<button type="button" class="edsym" data-i="' + i + '">' + sy + '</button>'; }).join('') + '</div><div class="edrow2"><button type="button" class="btn alt edundo">↩️ Undo</button><button type="button" class="btn eddone"' + (got.length === 5 ? '' : ' disabled') + '>✅ Done</button></div>';
        [].forEach.call(box.querySelectorAll('.edsym'), function (b) { b.onclick = function () { if (got.length >= 5) return; var i = +b.getAttribute('data-i'); got.push(i); edTone(i); draw(); }; });
        box.querySelector('.edundo').onclick = function () { got.pop(); draw(); };
        box.querySelector('.eddone').onclick = function () { edFinish('club', box._score()); };
      };
      box._score = function () { var ok = seq.filter(function (x, i) { return got[i] === x; }).length; return ok === 5 ? 3 : ok >= 3 ? 2 : ok >= 1 ? 1 : 0; };
      draw();
    }, 10000 + 5 * 1300 + 300);
  }
  // Backstage: the wiring plan is on the wall for a moment; then connect mic, speaker, guitar and lights to the right sockets.
  function edBack(box) {
    var dev = [['🎤', 'Mic'], ['🔊', 'Speaker'], ['🎸', 'Guitar'], ['💡', 'Lights']], sym = ['▲', '●', '■', '★', '◆', '✚'], plan = shuffle([0, 1, 2, 3, 4, 5]).slice(0, 4), plug = {}, sel = -1;
    $('waittitle').textContent = '🔌 Backstage'; $('waitsub').textContent = 'Remember the wiring plan!';
    box.innerHTML = '<div class="edbar"><i></i></div><div class="edplan">' + dev.map(function (d, i) { return '<div><span>' + d[0] + ' ' + d[1] + '</span><b>→</b><em>' + sym[plan[i]] + '</em></div>'; }).join('') + '</div>';
    box.querySelector('.edbar i').style.animation = 'edbar 6s linear forwards';
    edLater(function () {
      $('waitsub').textContent = 'Tap a device, then its socket. Two sockets stay empty.';
      var draw = function () {
        box.innerHTML = '<div class="edchips">' + dev.map(function (d, i) { return '<button type="button" class="edchip' + (sel === i ? ' sel' : '') + (plug[i] != null ? ' used' : '') + '" data-i="' + i + '">' + d[0] + ' ' + d[1] + '</button>'; }).join('') + '</div><div class="edsocks">' + sym.map(function (y, j) { var who = Object.keys(plug).filter(function (k) { return plug[k] === j; })[0]; return '<button type="button" class="edsock" data-j="' + j + '"><b>' + y + '</b>' + (who != null ? '<span>' + dev[who][0] + '</span>' : '') + '</button>'; }).join('') + '</div><button type="button" class="btn big eddone"' + (Object.keys(plug).length === 4 ? '' : ' disabled') + '>✅ Done</button>';
        [].forEach.call(box.querySelectorAll('.edchip'), function (b) { b.onclick = function () { sel = +b.getAttribute('data-i'); draw(); }; });
        [].forEach.call(box.querySelectorAll('.edsock'), function (b) { b.onclick = function () { var j = +b.getAttribute('data-j'); Object.keys(plug).forEach(function (k) { if (plug[k] === j) delete plug[k]; }); if (sel >= 0) { plug[sel] = j; sel = -1; try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} } draw(); }; });
        box.querySelector('.eddone').onclick = function () { edFinish('back', box._score()); };
      };
      box._score = function () { var ok = dev.filter(function (d, i) { return plug[i] === plan[i]; }).length; return ok === 4 ? 2 : ok >= 2 ? 1 : 0; };
      draw();
    }, 6000);
  }
  // Woodruff's Boudoir: a woman, a man and a child walk around behind the folding screen and the clothes rack. Then: what did they wear?
  function edBoud(box) {
    var HAIR = [['blonde', '#f0d070'], ['brown', '#6b3a1e'], ['black', '#1d1410'], ['red', '#c8402a']], OUT = [['red', '#e0283a'], ['blue', '#2f6ff0'], ['green', '#2fb35a'], ['yellow', '#f2c12e']], SHOE = [['white', '#fafafa'], ['black', '#15151c'], ['red', '#e0283a'], ['gold', '#d9a520']];
    var who = [['woman', 1], ['man', 1], ['child', .7]].map(function (w) { return { n: w[0], s: w[1], h: Math.floor(Math.random() * 4), o: Math.floor(Math.random() * 4), f: Math.floor(Math.random() * 4) }; });
    var fig = function (p) { return '<svg viewBox="0 0 60 130" class="edfig" style="height:' + (p.s * 100) + '%"><rect x="20" y="96" width="8" height="26" fill="#e8b890"/><rect x="32" y="96" width="8" height="26" fill="#e8b890"/><rect x="17" y="118" width="13" height="8" rx="3" fill="' + SHOE[p.f][1] + '" stroke="#555"/><rect x="31" y="118" width="13" height="8" rx="3" fill="' + SHOE[p.f][1] + '" stroke="#555"/>' + (p.n === 'woman' ? '<path d="M18 40 L42 40 L50 100 L10 100 Z" fill="' + OUT[p.o][1] + '"/>' : '<rect x="16" y="40" width="28" height="60" rx="6" fill="' + OUT[p.o][1] + '"/>') + '<circle cx="30" cy="24" r="14" fill="#f0c8a8"/><path d="' + (p.n === 'woman' ? 'M15 26 Q14 6 30 8 Q46 6 45 26 L46 44 L40 44 L40 22 L20 22 L20 44 L14 44 Z' : 'M16 22 Q16 8 30 8 Q44 8 44 22 Q38 14 30 15 Q22 14 16 22 Z') + '" fill="' + HAIR[p.h][1] + '"/></svg>'; };
    $('waittitle').textContent = '👗 Woodruff’s Boudoir'; $('waitsub').textContent = 'Look closely: hair, outfit and shoes!';
    box.innerHTML = '<div class="edbar"><i></i></div><div class="edboud">' + who.map(function (p, i) { return '<div class="edwalk" style="--i:' + i + '">' + fig(p) + '</div>'; }).join('') + '<div class="edscreen"></div><div class="edrack"></div></div>';
    box.querySelector('.edbar i').style.animation = 'edbar 9s linear forwards';
    var attrs = shuffle(['h', 'o', 'f']), qs = who.map(function (p, i) { var a = attrs[i]; return { p: p, a: a, opts: a === 'h' ? HAIR : a === 'o' ? OUT : SHOE, ans: p[a] }; }), qi = 0, right = 0;
    var ask = function () {
      if (qi >= qs.length) { edFinish('boud', right); return; }
      var q = qs[qi], what = q.a === 'h' ? 'hair' : q.a === 'o' ? 'outfit' : 'shoes';
      $('waitsub').textContent = 'Question ' + (qi + 1) + ' of 3';
      box.innerHTML = '<div class="edq">What colour ' + (q.a === 'f' ? 'were' : 'was') + ' the ' + q.p.n + '’s ' + what + '?</div><div class="edopts">' + q.opts.map(function (o, i) { return '<button type="button" class="edopt" data-i="' + i + '"><i style="background:' + o[1] + '"></i>' + o[0] + '</button>'; }).join('') + '</div>';
      [].forEach.call(box.querySelectorAll('.edopt'), function (b) { b.onclick = function () { if (+b.getAttribute('data-i') === q.ans) right++; qi++; ask(); }; });
    };
    box._score = function () { return right; };
    edLater(ask, 9000);
  }

  // ---------- Hold That Note! ----------
  // First predict how long the note lasts (10 s to 1 min) and lock it in; then, before she sings, everyone who locked in
  // gets the controls (the power slider and the Power Boost / Cooling Fan toggles).
  var noteSent = '', noteMine = null, ntCtl = { p: 0, t: 0 }, ntCtlId = '', ntCtlAt = 0, ntShutEnd = 0, ntShutT = null;
  function ntTime(s, tenths) { var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + (tenths ? r.toFixed(1) : Math.floor(r)); }
  $('ntrange').addEventListener('input', function () { $('ntv').textContent = ntTime(+this.value); });
  $('ntgo').addEventListener('click', function () {
    var s = state; if (!net || !s || !s.note || s.note.st !== 'guess' || noteSent === s.note.id) return;
    noteSent = s.note.id; noteMine = Math.round(+$('ntrange').value);
    var msg = { pid: pid, id: s.note.id, guess: noteMine };
    net.send('note', msg); setTimeout(function () { if (state && state.note && state.note.st === 'guess' && !(state.note.locked || {})[pid]) net.send('note', msg); }, 1500);
    noteView(state);
  });
  function ntSendCtl() { var s = state; if (!net || !s || !s.note || s.note.st !== 'ctl') return; net.send('note', { pid: pid, id: s.note.id, ctl: { p: ntCtl.p, t: ntCtl.t } }); ntCtlAt = Date.now(); }
  function ntCtlBox() {
    var c = $('ntctl'); if (c) return c;
    c = document.createElement('div'); c.id = 'ntctl'; c.className = 'ntctl hidden';
    c.innerHTML = '<div class="ntcl">⚡ Power</div><input type="range" id="ntpow" min="0" max="100" step="1" value="0"><div class="ntends"><span>Normal</span><span>High 🔥</span></div>' +
      '<div class="ntgl"><button type="button" class="ntt" data-t="1">🚀 Power Boost<small>breaks down sooner</small></button><button type="button" class="ntt" data-t="-1">🌀 Cooling Fan<small>keeps it going longer</small></button></div>' +
      '<div class="ntcd"></div>';
    $('noteui').parentNode.insertBefore(c, $('noteui').nextSibling);
    var thr = null;
    c.querySelector('#ntpow').addEventListener('input', function () { ntCtl.p = Math.round(+this.value) / 100; clearTimeout(thr); thr = setTimeout(ntSendCtl, 120); });
    [].forEach.call(c.querySelectorAll('.ntt'), function (b) { b.addEventListener('click', function () {
      var t = +b.getAttribute('data-t'); ntCtl.t = ntCtl.t === t ? 0 : t;   /* tap the active one again: off (both may be off) */
      [].forEach.call(c.querySelectorAll('.ntt'), function (x) { x.classList.toggle('on', +x.getAttribute('data-t') === ntCtl.t); });
      try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
      ntSendCtl();
    }); });
    return c;
  }
  function noteView(s) {
    var n = s.note, box = $('noteui'), cb = ntCtlBox(), mine = noteSent === n.id || (n.locked || {})[pid];
    show('v-wait');
    if (box.getAttribute('data-id') !== n.id) { box.setAttribute('data-id', n.id); $('ntrange').value = 35; $('ntv').textContent = ntTime(35); noteMine = null; }
    if (ntCtlId !== n.id) { ntCtlId = n.id; ntCtl = { p: 0, t: 0 }; cb.querySelector('#ntpow').value = 0; [].forEach.call(cb.querySelectorAll('.ntt'), function (x) { x.classList.remove('on'); }); }
    if (n.st === 'guess' || n.st === 'ctl') ntShutEnd = Date.now() + (n.left || 0);
    var g = noteMine != null ? noteMine : null;
    clearInterval(ntShutT);
    var cd = function () { var sec = Math.max(0, Math.ceil((ntShutEnd - Date.now()) / 1000)); var e = cb.querySelector('.ntcd'); if (e) e.textContent = 'Controls close in ' + sec + 's'; };
    if (n.st === 'intro') { box.classList.add('hidden'); cb.classList.add('hidden'); $('waittitle').textContent = '🎤 Hold That Note!'; $('waitsub').textContent = 'Watch the big screen: the diva is getting ready…'; return; }
    if (n.st === 'guess' && !mine) {
      cb.classList.add('hidden'); box.classList.remove('hidden');
      $('waittitle').textContent = '🎤 How long will the note last?'; $('waitsub').textContent = 'Between 10 seconds and one minute. Lock it in to get the controls!';
      return;
    }
    box.classList.add('hidden');
    if (n.st === 'guess') { cb.classList.add('hidden'); $('waittitle').textContent = '🔒 Locked in: ' + (g != null ? ntTime(g) : ''); $('waitsub').textContent = 'Waiting for the others… then you get the controls! 🎛️'; return; }
    if (n.st === 'ctl' && mine) {
      cb.classList.remove('hidden');
      $('waittitle').textContent = '🎛️ Your prediction: ' + (g != null ? ntTime(g) : '🔒'); $('waitsub').textContent = 'Steer the singer! More power and the boost break it sooner, the fan keeps it going longer.';
      cd(); ntShutT = setInterval(function () { if (!state || !state.note || state.note.st !== 'ctl') { clearInterval(ntShutT); return; } cd(); if (Date.now() - ntCtlAt > 2500) ntSendCtl(); }, 250);   /* (sent again now and then, in case a message got lost) */
      return;
    }
    cb.classList.add('hidden');
    if (n.st === 'ctl') { $('waittitle').textContent = '🎛️ The others are at the controls'; $('waitsub').textContent = 'You didn’t lock in a prediction this time. Watch the big screen!'; return; }
    if (n.st === 'sing') { $('waittitle').textContent = '🎶 Hold it… hold it…'; $('waitsub').textContent = g != null ? 'Your prediction: ' + ntTime(g) + '.' : 'Watch the big screen!'; return; }
    var gg = n.guess && n.guess[pid] != null ? n.guess[pid] : g;
    var won = n.win && n.win.indexOf(pid) >= 0;
    $('waittitle').textContent = won ? '🏆 Closest prediction!' : '💥 Kaboom at ' + ntTime(n.len, true);
    $('waitsub').textContent = gg != null ? 'The note lasted ' + ntTime(n.len, true) + '. You predicted ' + ntTime(gg) + ': ' + Math.abs(gg - n.len).toFixed(1) + ' seconds off.' : 'The note lasted ' + ntTime(n.len, true) + '.';
  }

  // ---------- Lost in Verona (Juliet's maze) ----------
  // Four arrows: tap the route Juliet called out, step by step, from memory.
  var jmKey = '', jmN = 0, jmLog = [], jmBarKey = '', jmSent = '', jmAuto = null, JM_ARW = ['⬅️', '⬆️', '➡️', '⬇️', '🚗'];
  /* the route goes in step by step (shown in the ten boxes above the arrows); Reset clears it, Send hands it in */
  function jmSend(qq, auto) {
    if (!net || !qq || qq.st !== 'input' || jmSent === jmKey) return;
    if (!auto && jmLog.length < qq.round) return;
    jmSent = jmKey; var msg = { pid: pid, id: qq.id, round: qq.round, route: jmLog.slice(0, qq.round) };
    net.send('qj', msg); setTimeout(function () { var q2 = state && state.qj; if (q2 && q2.st === 'input' && q2.id === msg.id && q2.round === msg.round && !(q2.fail || {})[pid] && ((q2.prog || {})[pid] || 0) < q2.round) net.send('qj', msg); }, 1100);
  }
  function qjView(s) {
    var q = s.qj, box = $('qjui'), key = q.id + ':' + q.round, alive = (q.alive || []).indexOf(pid) >= 0, failed = (q.fail || {})[pid];
    show('v-wait');
    if (jmKey !== key) { jmKey = key; jmN = 0; jmLog = []; clearTimeout(jmAuto); }
    if (box.getAttribute('data-b') !== 'jm2') {
      box.setAttribute('data-b', 'jm2');
      box.innerHTML = '<div class="jmbar"><i></i></div><div class="jmtell"><b></b><span></span></div><div class="jmlog"></div>' +
        '<div class="jmacts"><button type="button" class="btn alt jmreset">↩️ Reset</button><button type="button" class="btn jmsend">✅ Send</button></div>' +
        '<div class="jmpad"><button type="button" class="vrbtn jmb" data-dir="1">⬆️</button><button type="button" class="vrbtn jmb" data-dir="0">⬅️</button><button type="button" class="vrbtn jmb" data-dir="2">➡️</button><button type="button" class="vrbtn jmb" data-dir="3">⬇️</button><button type="button" class="vrbtn jmb jmjmp" data-dir="4">🚗<small>CAR</small></button></div>';
      [].forEach.call(box.querySelectorAll('.jmb'), function (b) { b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var qq = state && state.qj; if (!qq || qq.st !== 'input' || (qq.alive || []).indexOf(pid) < 0 || jmSent === jmKey) return;
        if (jmLog.length >= qq.round) return;
        jmLog.push(+b.getAttribute('data-dir')); jmN = jmLog.length;
        b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
        qjView(state);
      }); });
      box.querySelector('.jmreset').addEventListener('click', function () { if (jmSent === jmKey) return; jmLog = []; jmN = 0; qjView(state); });
      box.querySelector('.jmsend').addEventListener('click', function () { jmSend(state && state.qj, false); qjView(state); });
    }
    var log = ''; for (var i = 0; i < 10; i++) log += i >= q.round ? '<i class="off"></i>' : i < jmLog.length ? '<i class="on">' + JM_ARW[jmLog[i]] + '</i>' : '<i></i>';
    box.querySelector('.jmlog').innerHTML = log;   /* (the ten boxes show as soon as the pad does) */
    var sent = jmSent === key, full = jmLog.length >= q.round;
    box.querySelector('.jmsend').disabled = sent || !full; box.querySelector('.jmreset').disabled = sent || !jmLog.length;
    box.querySelector('.jmsend').classList.toggle('ready', full && !sent);
    var bar = box.querySelector('.jmbar i');
    box.classList.toggle('jumps', !!q.jump);   /* from round 5 on: the jump button in the middle */
    if (q.st === 'intro' && q.pad) {   /* Juliet mentions the phone: the pad shows up already, greyed out */
      box.classList.remove('hidden', 'fin'); box.classList.add('play', 'wait'); bar.style.transition = 'none'; bar.style.width = '100%';
      var tl = box.querySelector('.jmtell'); tl.querySelector('b').textContent = '👀 Listen to Juliet!'; tl.querySelector('span').textContent = 'Her steps go in here, then Send.';
      return;
    }
    if (q.st === 'intro') { box.classList.add('hidden'); box.classList.remove('play'); $('waittitle').textContent = '🌹 Lost in Verona'; $('waitsub').textContent = 'Watch Juliet on the big screen and remember her route!'; return; }
    if (!alive && !(q.st === 'done')) { box.classList.add('hidden'); box.classList.remove('play'); $('waittitle').textContent = '😵 Lost in Verona!'; $('waitsub').textContent = 'You took a wrong step. Watch the others try…'; return; }
    var tell = box.querySelector('.jmtell');
    if (q.st === 'show') {
      box.classList.remove('hidden', 'fin'); box.classList.add('play', 'wait'); jmBarKey = '';
      bar.style.transition = 'none'; bar.style.width = '100%';
      tell.querySelector('b').textContent = '👀 Watch the big screen!'; tell.querySelector('span').textContent = 'Remember Juliet’s route: ' + q.round + ' step' + (q.round === 1 ? '' : 's') + '. Then tap it here.';
      return;
    }
    if (q.st === 'input' && !failed && !sent) {
      box.classList.remove('hidden', 'wait', 'fin'); box.classList.add('play');
      if (jmBarKey !== key) {   /* the timer bar: starts where the time left is, runs down to zero */
        jmBarKey = key; var tot = 4500 + q.round * 1300, lft = Math.max(0, q.left || 0);
        bar.style.transition = 'none'; bar.style.width = Math.min(100, lft / tot * 100) + '%'; void bar.offsetWidth;
        bar.style.transition = 'width ' + lft + 'ms linear'; bar.style.width = '0%';
        clearTimeout(jmAuto); jmAuto = setTimeout(function () { jmSend(state && state.qj, true); }, Math.max(0, lft - 700));   /* time's nearly up: whatever you have goes in */
      }
      tell.querySelector('b').textContent = full ? '✅ Happy with it? Send!' : '👆 Tap Juliet’s route!'; tell.querySelector('span').textContent = full ? 'Or Reset if you made a mistake.' : 'Step ' + (jmLog.length + 1) + ' of ' + q.round + ': which way next?';
      return;
    }
    if (q.st === 'input') {   /* done tapping (or a wrong step): the pad stays in view, greyed out, with what you tapped */
      box.classList.remove('hidden', 'wait'); box.classList.add('play', 'fin');
      tell.querySelector('b').textContent = '📨 Route sent!'; tell.querySelector('span').textContent = 'Waiting for the others… watch the big screen.';
      return;
    }
    box.classList.remove('play', 'fin');
    box.classList.add('hidden');
    if (q.st === 'input') { $('waittitle').textContent = failed ? '😵 Wrong way!' : '✅ Route done!'; $('waitsub').textContent = failed ? 'Lost in Verona…' : 'Waiting for the others…'; return; }
    if (q.st === 'res') { $('waittitle').textContent = failed || ((q.prog || {})[pid] || 0) < q.round ? '😵 Lost!' : '✅ Still in!'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    var won = q.win && q.win.indexOf(pid) >= 0;
    $('waittitle').textContent = won ? '🎬 You found the way back to the studio!' : '🗺️ Lost in Verona forever…'; $('waitsub').textContent = won ? 'Bravissimo!' : 'Better luck next time!';
  }

  // ---------- Eurofan Shop ----------
  // Shopping: pick the free items (the same one twice is fine). Afterwards the bag button in the corner holds
  // them: pick an item, then who gets it; it lands just before the next question.
  var shopKey = '', shopSel = [], bagOpen = false, bagItem = null;
  function shopName(id) { var it = (typeof shopItem === 'function') && shopItem(id); return it ? it.icon + ' ' + it.name : id; }
  function shopView(s) {
    var sh = s.shop, mine = sh.done[pid], box = $('shopui');
    show('v-wait'); $('waittitle').textContent = '🛍️ Woodruff’s Boutique';
    if (sh.who && sh.who.indexOf(pid) < 0) { var sw = s.players.filter(function (x) { return sh.who.indexOf(x.pid) >= 0; }).map(function (x) { return x.name; }); $('waitsub').textContent = sw.join(' and ') + (sw.length > 1 ? ' are' : ' is') + ' shopping… win a party game to go shopping too!'; box.classList.add('hidden'); return; }
    var free = !sh.buy || (sh.free || []).indexOf(pid) >= 0, myPts = (me() || {}).score || 0;   // after a party game: the winner's item is free, the rest pay with points
    if (mine && !mine.length) { $('waitsub').textContent = 'No shopping this time. Maybe next time!'; box.classList.add('hidden'); return; }
    if (mine || sh.over) { $('waitsub').textContent = mine ? 'You got: ' + mine.map(shopName).join(' and ') + '. Use ' + (mine.length > 1 ? 'them' : 'it') + ' with the 🛍️ button whenever you like.' : 'The shop is closed.'; box.classList.add('hidden'); return; }
    $('waitsub').textContent = !free ? 'Buy one with your points (you have ' + myPts + '), or skip.' : (sh.n > 1 ? 'Take ' + sh.n + ' of these (tap one twice to take two)' : 'Take one of these') + (sh.buy ? '. It’s free: you won! 🏆' : '. It’s free!');
    box.classList.remove('hidden');
    if (shopKey !== sh.id) { shopKey = sh.id; shopSel = []; }
    var mineOffer = sh.offer && sh.offer[pid];   // your own selection of two
    var drawKey = sh.id + '|' + shopSel.join(',') + '|' + (mineOffer || []).join(',') + '|' + free + '|' + myPts + '|' + (sh.sold || []).join(',');
    if (box.getAttribute('data-k') === drawKey && box.innerHTML) return;   // nothing changed: leave the buttons alone (no flicker on every update)
    box.setAttribute('data-k', drawKey);
    box.innerHTML = '<p id="shoptime" class="shoptime" data-free="' + (free ? 1 : 0) + '"></p><p class="shoppts">💰 You have <b>' + myPts + '</b> points</p>' + sh.items.filter(function (it) { return !mineOffer || mineOffer.indexOf(it.id) >= 0; }).map(function (it) {
      var n = shopSel.filter(function (x) { return x === it.id; }).length, pr = it.price || 0, gone = (sh.sold || []).indexOf(it.id) >= 0, poor = gone || (!free && pr > myPts);
      return '<button type="button" class="shopbtn' + (n ? ' on' : '') + (poor ? ' poor' : '') + (gone ? ' sold' : '') + '" data-id="' + it.id + '"' + (poor ? ' disabled' : '') + '><span class="si">' + it.icon + '</span><span><b>' + esc(it.name) + (n > 1 ? ' ×' + n : '') + (gone ? ' <em class="price sold">Sold out</em>' : free ? ' <em class="price free"><s>' + pr + ' pts</s> free</em>' : ' <em class="price">' + pr + ' pts</em>') + '</b><small class="imode m-' + itemMode(it).id + '">' + itemMode(it).icon + ' ' + esc(itemMode(it).label) + '</small><small>' + esc(gone ? 'Sold out! Someone was quicker' : poor ? 'Not enough points for this one' : it.desc) + '</small></span></button>';
    }).join('') + (free ? '<button type="button" class="btn big" id="shopbuy"' + (shopSel.length < sh.n ? ' disabled' : '') + '>' + (shopSel.length < sh.n ? 'Pick ' + (sh.n - shopSel.length) + ' more' : 'Take ' + (sh.n > 1 ? 'them' : 'it') + '!') + '</button>'
      : '<button type="button" class="btn big" id="shopbuy"' + (!shopSel.length ? ' disabled' : '') + '>' + (!shopSel.length ? 'Pick one to buy' : 'Buy for ' + ((sh.items.filter(function (it) { return it.id === shopSel[0]; })[0] || {}).price || 0) + ' points') + '</button><button type="button" class="btn alt" id="shopskip">No thanks</button>');
    [].forEach.call(box.querySelectorAll('.shopbtn'), function (b) { b.onclick = function () {
      var id = b.getAttribute('data-id'), have = shopSel.filter(function (x) { return x === id; }).length;
      if (shopSel.length < sh.n) shopSel.push(id); else if (have) shopSel.splice(shopSel.indexOf(id), 1); else { shopSel.shift(); shopSel.push(id); }
      shopView(state);
    }; });
    $('shopbuy').onclick = function () {
      if (!net || (free ? shopSel.length < sh.n : !shopSel.length)) return; var msg = { pid: pid, id: sh.id, items: free ? shopSel.slice() : shopSel.slice(0, 1) };
      net.send('shop', msg); setTimeout(function () { if (state && state.shop && !state.shop.done[pid]) net.send('shop', msg); }, 1500);
      $('shopbuy').disabled = true; $('shopbuy').textContent = 'Wrapping it up…';
    };
    if ($('shopskip')) $('shopskip').onclick = function () {
      if (!net) return; var msg = { pid: pid, id: sh.id, items: [], skip: 1 };
      net.send('shop', msg); setTimeout(function () { if (state && state.shop && !state.shop.done[pid]) net.send('shop', msg); }, 1500);
      $('shopskip').disabled = true;
    };
  }
  function bagUpdate(s) {
    var m = me(), inv = (m && m.inv) || [], ok = s.cfg && s.cfg.atype === 'party' && inv.length && ['lobby', 'end', 'brief', 'intro', 'chase', 'shop'].indexOf(s.phase) < 0;
    $('bagbtn').classList.toggle('hidden', !ok); $('bagn').textContent = inv.length || '';
    document.body.classList.toggle('hasdock', !!ok);   /* (room at the bottom, so nothing hides behind the bag button) */
    if (!ok) { bagOpen = false; bagItem = null; }
    $('bagpanel').classList.toggle('hidden', !bagOpen);
    if (!bagOpen) return;
    var p = $('bagpanel'), bagKey = inv.join(',') + '|' + (bagItem || '') + '|' + (s.phase === 'guess') + '|' + !!s.itemBusy + '|' + !!s.mg + '|' + JSON.stringify((m && m.uses) || {}) + '|' + (s.q && s.q.options ? s.q.options.length : 0) + '|' + s.players.map(function (x) { return x.pid + (x.off ? 0 : 1) + (x.sit ? 's' : '') + (s.hide ? '' : x.score); }).join(',');
    if (p.getAttribute('data-k') === bagKey && p.innerHTML) return;   // nothing changed: no redraw (no flicker)
    p.setAttribute('data-k', bagKey);
    if (!bagItem) {
      var seen = {}; p.innerHTML = '<h3>Your items</h3><p class="bagrule">' + (s.itemBusy ? '🚨 An item is going off right now: wait until it’s over.' : s.mg ? '🎉 A party game is on: only 📦 delivery and 🤫 secret items can be used now.' : '⚡ Instant items work only while a question is open. 📦 Deliveries can go any time and land before the next question.') + '</p>' + inv.filter(function (id) { if (seen[id]) { seen[id]++; return false; } seen[id] = 1; return true; }).sort(function (a, b) { var r = function (id) { var k = (shopItem(id) || {}).kind; return k === 'bribe' ? 0 : k === 'smoke' ? 1 : k === 'heel' ? 2 : k === 'shield' || k === 'skates' ? 4 : 3; }; return r(a) - r(b); }).map(function (id) {   /* (the envelope for the EBU on top, then the deliveries, then the instant items) */
        var it = shopItem(id) || { icon: '?', name: id, desc: '' }, later = (it.kind === 'bribe' || it.kind === 'smoke') && !s.itemBusy, mgw = !!s.mg && !later && it.kind !== 'shield' && it.kind !== 'skates', wait = mgw || (['skip', 'sit', 'fan', 'blow', 'lose', 'steal', 'thief', 'flag', 'half', 'card', 'tab'].indexOf(it.kind) >= 0 && s.phase !== 'guess') || (it.kind === 'fan' && !(s.q && s.q.type === 'mc' && s.q.options && s.q.options.length === 4)) || it.kind === 'shield' || it.kind === 'skates' || it.kind === 'heel' || !!s.itemBusy;   // the mic only breaks while a question is open; the smoke goes up before one
        return '<button type="button" class="shopbtn" data-id="' + id + '"' + (wait ? ' disabled' : '') + '><span class="si">' + it.icon + '</span><span><b>' + esc(it.name) + (it.uses ? (function () { var u = ((m && m.uses) || {})[id] || seen[id] * it.uses; return ' · ' + u + ' use' + (u === 1 ? '' : 's') + ' left'; })() : seen[id] > 1 ? ' ×' + seen[id] : '') + '</b><small class="imode m-' + itemMode(it).id + '">' + itemMode(it).icon + ' ' + esc(itemMode(it).label) + '</small><small>' + esc(it.kind === 'shield' ? 'Protects you by itself: nobody can aim an item at you, and the smoke and the champagne can’t touch you. A wristband can steal it, though!' : it.kind === 'skates' ? 'Work by themselves: keep them in your bag, and you glide 2 spaces ahead at the start of the Grand Final' : mgw ? 'Not during a party game: wait for the next question' : wait ? (it.kind === 'fan' && s.phase === 'guess' ? 'Only on a question with four answers' : 'Only while a question is open') : it.desc) + '</small></span></button>';
      }).join('') + '<button type="button" class="btn alt" id="bagclose">Close</button>';
      [].forEach.call(p.querySelectorAll('.shopbtn'), function (b) { b.onclick = function () {
        var id = b.getAttribute('data-id');
        if ((shopItem(id) || {}).kind === 'bribe') {   // no one to pick, and nothing to see yet
          var bm = { pid: pid, use: id, target: pid, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', bm); setTimeout(function () { net.send('shop', bm); }, 1200); }
          ptoast('✉️ Your envelope is on its way to the EBU… Shh! 🤫'); bagOpen = false; bagUpdate(state); return;
        }
        if ((shopItem(id) || {}).kind === 'fan') {   // no one to pick: it works on your own phone, right now
          var fm = { pid: pid, use: id, target: pid, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', fm); setTimeout(function () { net.send('shop', fm); }, 1200); }
          ptoast('🪭 Whoosh! Half of the wrong answers blow away…'); bagOpen = false; bagUpdate(state); return;
        }
        if ((shopItem(id) || {}).kind === 'tab') {   // no one to pick: it is everyone else's bill
          var cm = { pid: pid, use: id, target: pid, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', cm); setTimeout(function () { net.send('shop', cm); }, 1200); }
          ptoast('🍾 Pop! The champagne is on everyone else…'); bagOpen = false; bagUpdate(state); return;
        }
        if ((shopItem(id) || {}).kind === 'smoke') {   // no one to pick: it is for the next question
          var msg = { pid: pid, use: id, target: pid, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', msg); setTimeout(function () { net.send('shop', msg); }, 1200); }
          ptoast('🌫️ The smoke goes up before the next question. Only you will see its answers!'); bagOpen = false; bagUpdate(state); return;
        }
        bagItem = id; bagUpdate(state);
      }; });
    } else if ((shopItem(bagItem) || {}).kind === 'skip') {   /* the CD player: are you sure? Skip or cancel */
      var cdi = shopItem(bagItem);
      p.innerHTML = '<h3>' + cdi.icon + ' ' + esc(cdi.name) + '</h3><p class="mute" style="margin:0 0 12px">Skip this question? Nobody scores it, and a different one comes up straight away.</p><button type="button" class="btn big" id="cdskip" style="width:100%">⏭️ Skip</button><button type="button" class="btn alt" id="bagclose">Cancel</button>';
      $('cdskip').onclick = function () {
        var km = { pid: pid, use: bagItem, target: pid, key: Math.random().toString(36).slice(2, 9) };
        if (net) { net.send('shop', km); setTimeout(function () { net.send('shop', km); }, 1200); }
        ptoast('💿 Skip! On to a different question…'); bagOpen = false; bagItem = null; bagUpdate(state);
      };
    } else {
      var others = s.players.filter(function (x) { return x.pid !== pid && !x.off && !((shopItem(bagItem) || {}).kind === 'sit' && x.sit); });
      p.innerHTML = '<h3>' + esc(shopName(bagItem)) + ': on who?</h3>' + others.map(function (x) { var sh = (x.inv || []).indexOf('umbrella') >= 0 && (shopItem(bagItem) || {}).kind !== 'heel'; var lw = !sh && (shopItem(bagItem) || {}).kind === 'blow' && !s.players.some(function (y) { return !y.off && y.score < x.score; }); return '<button type="button" class="shopbtn who' + (sh || lw ? ' poor' : '') + '" data-pid="' + esc(x.pid) + '"' + (sh || lw ? ' disabled' : '') + '>' + charSvg(x.char) + '<span><b>' + esc(x.name) + (sh ? ' ☂️' : '') + '</b><small>' + (sh ? 'Protected by an umbrella' : lw ? 'Has the fewest points already' : s.hide ? '' : x.score + ' points') + '</small></span></button>'; }).join('') + '<button type="button" class="btn alt" id="bagclose">Back</button>';
      [].forEach.call(p.querySelectorAll('.shopbtn.who'), function (b) { b.onclick = function () {
        var t = b.getAttribute('data-pid'), msg = { pid: pid, use: bagItem, target: t, key: Math.random().toString(36).slice(2, 9) };
        if (net) { net.send('shop', msg); setTimeout(function () { net.send('shop', msg); }, 1200); }
        var tn = (s.players.filter(function (x) { return x.pid === t; })[0] || {}).name || '';
        ptoast((shopItem(bagItem) || {}).kind === 'sit' ? '🎤 You broke ' + tn + '’s mic: no points for them this question!' : shopName(bagItem) + ' is on its way to ' + tn + '! It lands before the next question.');
        bagOpen = false; bagItem = null; bagUpdate(state);
      }; });
    }
    $('bagclose').onclick = function () { if (bagItem) bagItem = null; else bagOpen = false; bagUpdate(state); };
  }
  $('bagbtn').addEventListener('click', function () { bagOpen = !bagOpen; bagItem = null; if (state) bagUpdate(state); });
  var ptoastT = null;
  /* the Euroclub Wristband: a big message on the phone of whoever was robbed (and of the thief: what they got) */
  var robSeen = '', lootSeen = '', hitSeen = '';
  function robCheck(s) {
    var m = me(); if (!m) return;
    var big = function (icon, title, sub) {
      var e = $('probbed'); if (!e) { e = document.createElement('div'); e.id = 'probbed'; e.className = 'probbed'; document.body.appendChild(e); }
      e.innerHTML = '<div class="pr"><div class="pri">' + icon + '</div><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>';
      e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(function () { e.classList.remove('on'); }, 4500);
    };
    var nm = function (id) { var it = (typeof shopItem === 'function') && shopItem(id); return it ? it : { icon: '❓', name: id }; };
    if (m.robbed && m.robbed.k !== robSeen) { var first = !robSeen; robSeen = m.robbed.k; if (!first || Date.now() - (window.__pStart || 0) > 8000) { var a = nm(m.robbed.it); big('🎟️' + a.icon, 'Robbed!', m.robbed.by + ' sneaked into the Euroclub and stole your ' + a.name + '!'); } }
    if (m.hit && m.hit.k !== hitSeen) { var f3 = !hitSeen; hitSeen = m.hit.k; if (!f3 || Date.now() - (window.__pStart || 0) > 8000) big(m.hit.icon, 'Item alert!', m.hit.txt); }   /* an item someone used on you */
    if (m.loot && m.loot.k !== lootSeen) { var f2 = !lootSeen; lootSeen = m.loot.k; if (!f2 || Date.now() - (window.__pStart || 0) > 8000) { var b2 = nm(m.loot.it); big('🎟️' + b2.icon, 'Got it!', 'You left the Euroclub with ' + m.loot.from + '’s ' + b2.name + '!'); } }
  }
  window.__pStart = Date.now();
  function ptoast(t) { var e = $('ptoast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(ptoastT); ptoastT = setTimeout(function () { e.classList.add('hidden'); }, 3500); }

  // ---------- Sing! ----------
  // Voting (for the song, then for the best singer) and recording up to 10 seconds of audio.
  var REC_MAX = 10000, sKey = '', rec = null, recStream = null, recChunks = [], recBlob = null, recTick = null, recT0 = 0, recSent = '';
  function recRelease() { if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; } }
  function recReset() {
    clearInterval(recTick);
    if (rec && rec.state !== 'inactive') { try { rec.onstop = null; rec.stop(); } catch (e) {} }
    rec = null; recBlob = null; recChunks = [];
    $('srecbtn').textContent = '🎤 Ready!'; $('srecbtn').disabled = false; $('srecbtn').classList.remove('live'); $('srecbtn').classList.remove('hidden');
    $('sprev').classList.add('hidden'); $('srecdone').classList.add('hidden'); $('srecstate').textContent = ''; $('scount').classList.remove('hidden'); $('scount').classList.remove('live', 'counting'); $('scount').textContent = '3';
  }
  function renderSing(s, m) {
    var sg = s.sing, key = s.phase + ':' + s.round, fresh = key !== sKey;
    sKey = key;
    show('v-sing');
    $('sround').textContent = 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total) + ' · Key Change!';
    var poll = s.phase === 'svote' || s.phase === 'sbest', recPhase = s.phase === 'srec' && !(m && m.in);
    $('sopts').classList.toggle('hidden', !poll); $('srec').classList.toggle('hidden', !recPhase);
    // While listening or recording: ask for another part of the song (a few times per round at most).
    $('sbad').classList.add('hidden');   // taken out: the song that wins the vote is the song
     if (fresh || sg.rerolls_left !== lastRerolls) { $('sbad').disabled = false; lastRerolls = sg.rerolls_left; }
    if (s.phase === 'slisten' && $('sbad').disabled && sg.bad) { $('sfb').className = 'fb close'; $('sfb').textContent = 'You voted to skip this song: ' + sg.bad + ' of ' + sg.bad_need + ' needed.'; }
    if (fresh) { $('sfb').textContent = ''; $('sfb').className = 'fb'; if (s.phase !== 'srec') { recReset(); recRelease(); } }
    var name = sg.song ? sg.song.title + ' – ' + sg.song.artist : '';
    /* Key Change!: the lyrics */
    var lyOn = !!sg.song && (s.phase === 'slisten' || (s.phase === 'srec' && !(m && m.in) && !recBlob));
    $('slywrap').classList.toggle('hidden', !lyOn);
    if (sg.song && $('slyrics').getAttribute('data-id') !== sg.song.id) {
      $('slyrics').setAttribute('data-id', sg.song.id || '');
      var ly = LYRICS[sg.song.id];
      $('slyrics').innerHTML = '<b class="slyt">' + esc(sg.song.title) + '</b><small class="slya">' + esc(sg.song.artist) + '</small>' + (ly ? String(ly).split('\n').map(function (l) { return '<p>' + (esc(l) || '&nbsp;') + '</p>'; }).join('') : '<p class="slynone">🎶 No lyrics for this one yet: sing along with what you remember!</p>');
    }
    $('slywrap').classList.toggle('dim', s.phase === 'srec' && !(rec && rec.state === 'recording'));
    var recArea = $('srec'); if (lyOn && s.phase === 'srec' && recArea.parentNode !== $('slyover')) $('slyover').appendChild($('srecbtn')), $('slyover').appendChild($('scount'));
    if (!(lyOn && s.phase === 'srec') && $('srecbtn').parentNode !== recArea) { recArea.insertBefore($('srecbtn'), recArea.firstChild); recArea.insertBefore($('scount'), recArea.firstChild); }
    if (sg.rec_ms >= 5000) REC_MAX = sg.rec_ms;   // as long as the clip that was played
    if (poll && m && m.in && $('sfb').textContent === 'Sending your vote…') $('sfb').textContent = 'Vote received. You can still change it.';
    if (s.phase === 'svote') {
      $('stitle').textContent = 'Which song shall we sing?'; $('ssub').textContent = 'Vote for one. The most votes wins.';
      if (fresh) $('sopts').innerHTML = (sg.options || []).map(function (o, i) { return '<div class="optcol"><button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button></div>'; }).join('');   // the votes only show on the big screen
    } else if (s.phase === 'sbest') {
      $('stitle').textContent = 'Who sang it best?'; $('ssub').textContent = 'You can’t vote for yourself.';
      if (fresh) $('sopts').innerHTML = (sg.order || []).map(function (o, i) { return o.pid === pid ? '' : '<button type="button" class="opt" data-i="' + i + '">' + esc(o.name) + '</button>'; }).join('');
    } else if (s.phase === 'srec') {
      $('stitle').textContent = m && m.in ? 'Got it!' : 'Your turn to sing!';
      $('ssub').textContent = m && m.in ? 'Waiting for the others…' : recBlob ? 'Listen back, then send it or try again.' : 'Press Ready when you are, then sing!';
      if (fresh) { recReset(); recSent = ''; }
    } else if (s.phase === 'sann' || s.phase === 'svotes') {
      $('stitle').textContent = 'And our 12 points go to…'; $('ssub').textContent = 'Watch the big screen.';
    } else if (s.phase === 'sroll') {
      if (sg.one) { $('stitle').textContent = 'Everyone agrees!'; $('ssub').textContent = 'Watch the big screen: that is the song.'; } else {
        $('stitle').textContent = 'It’s a tie!'; $('ssub').textContent = 'Watch the big screen: the roulette decides.'; }
    } else if (s.phase === 'splay') {
      $('stitle').textContent = sg.now ? (sg.pass === 2 ? 'Once more: ' : 'Now singing: ') + sg.now : 'Showtime!'; $('ssub').textContent = 'Listen on the big screen.';
    } else {
      $('stitle').textContent = s.phase === 'slisten' ? '🎶 Listen and read along' : 'We’re singing'; $('ssub').textContent = name ? name + '. Listen first, then it’s your turn.' : 'Get ready…';
    }
  }
  $('sopts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || !net) return;
    [].forEach.call($('sopts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    var choice = +b.getAttribute('data-i'), vk = sKey, seq = ++voteSeq;
    net.send('poll', { pid: pid, choice: choice });
    // Messages over the room connection can get lost, so the vote is repeated a few times (the host just overwrites it).
    [700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (seq === voteSeq && sKey === vk && net) net.send('poll', { pid: pid, choice: choice }); }, ms); });
    $('sfb').className = 'fb close'; $('sfb').textContent = 'Sending your vote…';
  });
  var voteSeq = 0, sendTry = null, lastRerolls = -1;
  function recStop() { clearInterval(recTick); if (rec && rec.state !== 'inactive') rec.stop(); }
  $('srecbtn').addEventListener('click', function () {
    if (rec && rec.state === 'recording') { recStop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $('srecstate').className = 'fb no'; $('srecstate').textContent = 'This browser can’t record sound. You can still vote.'; return; }
    $('srecstate').className = 'fb'; $('srecstate').textContent = 'Allow the microphone…';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream; recChunks = []; recBlob = null;
      var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'], mime = '';
      for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
      var opt = { audioBitsPerSecond: 32000 }; if (mime) opt.mimeType = mime;
      rec = new MediaRecorder(stream, opt);
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      rec.onstop = function () {
        recBlob = new Blob(recChunks, { type: (rec && rec.mimeType) || mime || 'audio/webm' });
        recRelease();
        $('srecbtn').classList.add('hidden'); $('srecbtn').classList.remove('live'); $('scount').classList.add('hidden'); $('slywrap').classList.add('hidden'); $('slywrap').classList.remove('recording');
        $('sprev').src = URL.createObjectURL(recBlob); $('sprev').classList.remove('hidden'); $('srecdone').classList.remove('hidden');
        $('srecstate').className = 'fb'; $('srecstate').textContent = 'Happy with it?';
      };
      // Three, two, one: time to take a breath before the recording starts.
      var mine = rec, n = 3;
      $('srecbtn').disabled = true; $('srecbtn').classList.add('hidden'); $('srecstate').className = 'fb close'; $('srecstate').textContent = 'Get ready…';
      var count = function () {
        if (rec !== mine) { $('srecbtn').disabled = false; $('scount').textContent = '3'; return; }   // taken back in the meantime
        // a giant circle counts 3, 2, 1, 0: at 0 the recording starts
        $('scount').classList.remove('hidden'); $('scount').classList.add('counting'); $('scount').classList.remove('live'); $('scount').textContent = String(n);
        if (n > 0) { n--; setTimeout(count, 1000); return; }
        $('srecbtn').disabled = false; $('srecbtn').classList.remove('hidden'); $('scount').classList.add('live'); $('slywrap').classList.remove('dim'); $('slywrap').classList.add('recording');
        rec.start(); recT0 = Date.now();
        $('srecbtn').textContent = 'Stop'; $('srecbtn').classList.add('live');
        recTick = setInterval(function () {
          var left = REC_MAX - (Date.now() - recT0);
          $('srecstate').textContent = 'Recording… ' + Math.max(0, Math.ceil(left / 1000)) + ' s left'; $('scount').textContent = String(Math.max(0, Math.ceil(left / 1000)));
          if (left <= 0) recStop();
        }, 100);
      };
      count();
    }).catch(function () { $('srecstate').className = 'fb no'; $('srecstate').textContent = 'No access to the microphone. Allow it in your browser, or skip this one.'; });
  });
  $('sredo').addEventListener('click', function () { recReset(); $('slywrap').classList.remove('hidden', 'recording'); $('slywrap').classList.add('dim'); });
  $('sbad').addEventListener('click', function () { if (!net) return; $('sbad').disabled = true; net.send('poll', { pid: pid, reroll: true }); $('sfb').className = 'fb close'; $('sfb').textContent = 'You voted to skip this song.'; });
  $('sskip').addEventListener('click', function () { recReset(); recRelease(); if (net) net.send('clip', { pid: pid, skip: true }); });
  $('ssend').addEventListener('click', function () {
    if (!recBlob || !net || recSent === sKey) return;
    recSent = sKey; $('srecstate').className = 'fb'; $('srecstate').textContent = 'Sending…';
    var fr = new FileReader();
    fr.onload = function () {
      // Sent in small pieces: the room connection has a size limit per message.
      var b64 = String(fr.result).split(',')[1] || '', size = 40000, n = Math.max(1, Math.ceil(b64.length / size)), key = Math.random().toString(36).slice(2), i = 0;
      if (n > 30) { recSent = ''; $('srecstate').className = 'fb no'; $('srecstate').textContent = 'That recording is too large. Please record again.'; return; }
      var mime = recBlob.type, sk = sKey, tries = 0;
      var step = function () {
        if (sKey !== sk || !net) return;
        net.send('clip', { pid: pid, key: key, i: i, n: n, mime: mime, data: b64.slice(i * size, (i + 1) * size) });
        if (++i < n) setTimeout(step, 150);
      };
      step();
      // The host confirms through the game state. No confirmation: send everything again, twice at most.
      clearInterval(sendTry);
      sendTry = setInterval(function () {
        var mm = me();
        if (sKey !== sk || !state || state.phase !== 'srec' || (mm && mm.in)) { clearInterval(sendTry); return; }
        if (i < n) return;   // still sending
        if (++tries > 2) { clearInterval(sendTry); recSent = ''; $('srecstate').className = 'fb no'; $('srecstate').textContent = 'Your recording did not arrive. Tap “Send it” to try again.'; return; }
        $('srecstate').textContent = 'Still sending…'; i = 0; step();
      }, 4000);
    };
    fr.readAsDataURL(recBlob);
  });


  // ---------- playing without a shared screen ----------
  // Every phone plays the clip itself. The host only says which video and where to start; the
  // phone loads it silently, reports when it is ready, and plays when the guessing starts.
  var introTry = 0;
  function clipSecs() { return Math.max(5, Math.round(((state && state.total_ms) || 20000) / 1000) - 5); }   // the host's Video length setting
  var yt = null, ytWanted = false, ytReady = false, clipKey = '', clipStart = 0, vStage = 'idle', vPoll = null, vWatch = null, vPlayed = '';
  function vCover(on, icon, text) { $('cover').classList.toggle('hidden', !on); if (on) { $('covericon').textContent = icon; $('covertext').textContent = text || ''; } }
  function vMasks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  function vStop() { if (vAdOn) vAd(false); document.querySelector('#pstage .shield').classList.remove('hidden'); clearInterval(vPoll); clearTimeout(vWatch); $('tapplay').classList.add('hidden'); try { if (yt && ytReady) yt.pauseVideo(); } catch (e) {} }
  function ytLoad() {
    if (ytWanted) return;
    ytWanted = true;
    window.onYouTubeIframeAPIReady = function () {
      yt = new YT.Player('yt', { width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
        events: { onReady: function () { ytReady = true; if (state) remoteVideo(state); },
          onError: function () {
            // The fanfare video refuses to play here: try the next spare.
            if ((vStage === 'intro' || vStage === 'primed') && ++introTry < INTRO.ids.length) { try { yt.loadVideoById(INTRO.ids[introTry]); if (vStage === 'intro') { yt.unMute(); yt.playVideo(); } } catch (e) {} return; }
            if (vStage === 'probe' || vStage === 'seek') { vStop(); vStage = 'bad'; if (net) net.send('ready', { pid: pid, key: clipKey, bad: true }); } } } });
    };
    var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  }
  var vLate = '';
  function vPrepare(clip) {
    vStop(); vStage = 'probe'; vPlayed = '';
    vCover(true, '♪', 'Selecting song'); vMasks(true);
    // A question without a clip: the video is not loaded at all until the answer, so nothing can be glimpsed.
    vLate = clip.noclip ? clip.id : '';
    if (vLate) { try { yt.stopVideo(); } catch (e) {} vStage = 'ready'; if (net) net.send('ready', { pid: pid, key: clipKey }); setTimeout(function () { if (state) remoteVideo(state); }, 0); return; }
    yt.mute(); yt.loadVideoById(clip.id);
    vWatch = setTimeout(function () { if (vStage === 'probe' || vStage === 'seek') { vStage = 'slow'; if (net) net.send('ready', { pid: pid, key: clipKey, slow: true }); } }, 10000);
    var seekAt = 0, loadAt = Date.now(), got = false;
    vAd(false);
    // An ad before the video cannot be skipped from here: keep jumping until the real video is at the
    // right spot, and uncover the player so the ad can be skipped by hand.
    vPoll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0, late = Date.now() - loadAt;
      // A question without a clip never shows the player before the answer: slow or behind an ad, just carry on.
      if (clip.noclip && late > 6000) { clearInterval(vPoll); clearTimeout(vWatch); try { yt.pauseVideo(); } catch (e) {} vStage = 'ready'; if (net) net.send('ready', { pid: pid, key: clipKey }); if (state) remoteVideo(state); return; }
      if (late > 6000) vAd(true);   // stuck for whatever reason: show the player, so an ad or an error is visible and can be clicked
      if (st !== 1 || d <= 0) return;
      if (d < 100 && late < 40000) { if (late > 2500) vAd(true); return; }   // shorter than any song
      var cs = d < 45 ? 0 : Math.floor(15 + clip.frac * (d - 15 - 20 - clipSecs()));   // same spot on every phone
      if (!got || cs !== clipStart) { got = true; clipStart = cs; seekAt = 0; }
      if (t >= clipStart && t < clipStart + 5) {
        clearInterval(vPoll); clearTimeout(vWatch); yt.pauseVideo(); vStage = 'ready'; vAd(false);
        if (net) net.send('ready', { pid: pid, key: clipKey, rem: Math.round(d - clipStart) });
        if (state) remoteVideo(state);
      } else if (Date.now() - seekAt > 1500) {
        seekAt = Date.now(); yt.seekTo(clipStart, true);
        if (late > 6000) vAd(true);
      }
    }, 120);
  }
  var vAdOn = false;
  function vAd(on) {
    if (on && state && state.clip && state.clip.noclip) return;   // never uncover the video of a question that has no clip
    if (on === vAdOn) return;
    vAdOn = on;
    document.querySelector('#pstage .shield').classList.toggle('hidden', on);
    if (on) { vCover(false); $('mb').classList.add('hidden'); $('tapplay').classList.add('hidden'); if (net) net.send('ready', { pid: pid, key: clipKey, ad: true }); }
    else $('mb').classList.remove('hidden');   // the bottom mask comes back: it hides the caption with the country
    $('adnote').textContent = on ? AD_TEXT : '';
  }
  function vPlay(full) {
    clearInterval(vPoll); vStage = full ? 'full' : 'clip';
    // At the reveal the video carries on from where the clip stopped; only the clip itself starts from its mark.
    if (full && vLate) { clipStart = Math.floor(35 + Math.random() * 50); try { yt.unMute(); yt.setVolume(100); yt.loadVideoById({ videoId: vLate, startSeconds: clipStart }); } catch (e) {} vLate = ''; }
    else try { var tNow = yt.getCurrentTime() || 0; if (!full || !(tNow >= clipStart - 1 && tNow <= clipStart + clipSecs() + 2)) yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    vCover(false); vMasks(!full);
    // Phones may refuse to start sound without a touch: offer a button if nothing is playing.
    clearTimeout(vWatch);
    vWatch = setTimeout(function () { try { if (yt.getPlayerState() !== 1) $('tapplay').classList.remove('hidden'); } catch (e) {} }, 1800);
    if (full) {
      // while an ad plays instead of the song, the player can be tapped (Skip ad)
      var sh = document.querySelector('#pstage .shield'); sh.classList.add('hidden');
      vPoll = setInterval(function () {
        if (vStage !== 'full') { clearInterval(vPoll); sh.classList.toggle('hidden', vAdOn); return; }
        sh.classList.add('hidden');
      }, 400);
      return;
    }
    vPoll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipSecs()) { clearInterval(vPoll); yt.pauseVideo(); vStage = 'paused'; $('tapplay').classList.add('hidden'); if (state && state.phase === 'guess') vCover(true, '?', ''); }
    }, 100);
  }
  $('tapplay').addEventListener('click', function () { $('tapplay').classList.add('hidden'); try { yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {} });
  function remoteVideo(s) {
    var m = me();
    if (s.remote && m && s.phase === 'intro' && ytReady) {
      $('pstage').classList.remove('hidden'); $('pstage').classList.add('audioonly');   // the fanfare is sound only
      if (vStage !== 'intro') { vStage = 'intro'; clipKey = ''; try { yt.loadVideoById(INTRO.ids[introTry] || INTRO.ids[0]); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {} }
      return;
    }
    if (vStage === 'primed' && s.phase === 'brief') { try { if (yt.getPlayerState() === 1) yt.pauseVideo(); } catch (e) {} }
    $('pstage').classList.remove('audioonly');
    var on = !!(s.remote && s.clip && m && (s.phase === 'loading' || s.phase === 'guess' || s.phase === 'qall' || s.phase === 'reveal'));
    $('pstage').classList.toggle('hidden', !on);
    // The chat bar sits at the bottom of the screen in games without a shared screen.
    var chatOn = !!(s.remote && m) && !(document.body.classList.contains('embed') && (s.phase === 'lobby' || s.phase === 'brief'));
    $('chatbar').classList.toggle('hidden', !chatOn); document.body.classList.toggle('haschat', chatOn);
    if (!s.remote) return;
    ytLoad();
    if (!on) { if (vStage !== 'idle') { vStop(); vStage = 'idle'; clipKey = ''; } return; }
    if (!ytReady) return;
    var key = s.clip.id + ':' + s.round;
    if (key !== clipKey) { clipKey = key; vPrepare(s.clip); return; }
    var ready = vStage === 'ready' || vStage === 'clip' || vStage === 'paused' || vStage === 'full';
    if (!ready) return;
    if ((s.phase === 'guess' || (s.phase === 'reveal' && s.q && s.q.subject === 'trivia')) && s.q && s.q.noclip) { if (vPlayed !== 'none') { vPlayed = 'none'; vStage = 'paused'; var art = noClipArt(s.q); vCover(true, art[0], art[1]); } }   // odd one out: nothing plays until the answer
    else if ((s.phase === 'guess' || s.phase === 'qall') && vPlayed !== 'clip' && vPlayed !== 'full') { vPlayed = 'clip'; vPlay(false); }   // qall: Quip!, the clip plays while you write
    else if (s.phase === 'reveal' && vPlayed !== 'full') { vPlayed = 'full'; vPlay(true); }
  }

  // ---------- chat (games without a shared screen) ----------
  var chatOpen = false, chatLog = [];
  function chatAdd(c) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) return;
    chatLog.push({ name: String(c.name || '?').slice(0, 16), char: c.char, text: c.text.slice(0, 200), mine: c.pid === pid });
    if (chatLog.length > 100) chatLog.shift();
    var el = $('chatlog');
    el.innerHTML = chatLog.map(function (x) { return '<div class="msg' + (x.mine ? ' mine' : '') + '">' + charSvg(x.char) + '<div><b>' + esc(x.name) + '</b><span>' + esc(x.text) + '</span></div></div>'; }).join('');
    el.scrollTop = el.scrollHeight;
    if (!chatOpen && c.pid !== pid) {
      // A new message pops up just above the bar for a few seconds; the ring marks it as unread.
      $('chatbtn').classList.add('lit');
      var x = chatLog[chatLog.length - 1], pop = document.createElement('div');
      pop.className = 'pop'; pop.innerHTML = charSvg(x.char) + '<span><b>' + esc(x.name) + '</b>' + esc(x.text) + '</span>';
      $('chatpop').appendChild(pop);
      while ($('chatpop').children.length > 3) $('chatpop').removeChild($('chatpop').firstChild);
      setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 5200);
    }
  }
  function rowUpdate() { $('stagerow').classList.toggle('hidden', $('pstage').classList.contains('hidden')); $('pstage').classList.toggle('novideo', !!(state && (state.draw || (state.clip && state.clip.noclip)) && (state.phase !== 'reveal' || !!(state.q && state.q.subject === 'trivia')))); $('stagerow').classList.toggle('flat', $('pstage').classList.contains('audioonly') || !!(state && state.draw && state.phase === 'guess')); }
  function chatToggle(open) {
    chatOpen = open; $('chat').classList.toggle('hidden', !open);
    if (open) $('chatpop').innerHTML = '';
    if (open) { $('chatbtn').classList.remove('lit'); $('chatlog').scrollTop = $('chatlog').scrollHeight; }
  }
  $('chatbtn').addEventListener('click', function () { chatToggle(!chatOpen); });
  $('chatclose').addEventListener('click', function () { chatToggle(false); });
  $('chatform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('chatin').value.trim(), m = me();
    if (!t || !net || !m) return;
    var c = { pid: pid, name: name, char: m.char, text: t.slice(0, 200) };
    net.send('chat', c); chatAdd(c); $('chatin').value = '';
  });

  var pickKey = '';
  $('lobbystart').addEventListener('click', function () { if (net && state && state.phase === 'lobby' && state.all_ready) net.send('go', { pid: pid, start: true }); });
  var readySeq = 0;
  $('lobbyready').addEventListener('click', function () {
    if (!net || !state || state.phase !== 'lobby') return;
    var mm = me(), off = !!(mm && mm.in), msg = { pid: pid, off: off };
    $('lobbyready').classList.toggle('on', !off); $('lobbyreadytext').textContent = off ? 'Ready' : 'Ready!';
    var seq = ++readySeq;
    net.send('go', msg);
    setTimeout(function () { var m2 = me(); if (seq === readySeq && net && state && state.phase === 'lobby' && m2 && !!m2.in === off) net.send('go', msg); }, 1200);   // in case the first one got lost
  });
  $('readybtn').addEventListener('click', function () {
    if (!net) return;
    net.send('go', { pid: pid });
    $('readybtn').classList.add('hidden'); $('briefwait').textContent = 'You’re ready. Waiting for the others…';
    // Without a shared screen this tap also wakes up the phone's own video player, so sound can start later.
    if (state && state.remote && yt && ytReady) { try { yt.mute(); yt.loadVideoById(INTRO.ids[0]); vStage = 'primed'; } catch (e) {} }
  });
  /* the giant flag covers the whole question: from the question text down to the last answer */
  function flagFit() {
    var vg = $('v-guess'), fl = vg && vg.querySelector('.pflag'); if (!fl || !fl.classList.contains('on')) return;
    var top = $('qtext').getBoundingClientRect().top, ob = $('opts'), gf = $('guessform');
    var low = !ob.classList.contains('hidden') ? ob : !gf.classList.contains('hidden') ? gf : $('qtext');
    var r0 = vg.getBoundingClientRect(), bot = low.getBoundingClientRect().bottom;
    fl.style.top = Math.round(top - r0.top - 10) + 'px'; fl.style.height = Math.max(120, Math.round(bot - top + 16)) + 'px';
    /* a bit narrower than the answers: their left and right ends peek out, so you can still tap them (blind) */
    var ro = (low === ob ? ob : $('qtext')).getBoundingClientRect(); fl.style.left = Math.round(ro.left - r0.left + 16) + 'px'; fl.style.right = Math.round(r0.right - ro.right + 16) + 'px';
    var fmg = $('flagmsg'), fr0 = fl.getBoundingClientRect(); if (fmg) { fmg.style.top = Math.round(fr0.top - r0.top + fr0.height - 14) + 'px'; fmg.style.left = Math.round(fr0.left - r0.left + 30) + 'px'; fmg.style.right = Math.round(r0.right - fr0.right + 18) + 'px'; }   /* the message on the flag itself */
    var fb = fl.getBoundingClientRect().bottom, pole = fl.querySelector('.pole'); if (pole) pole.style.bottom = -Math.max(30, Math.round(window.innerHeight - fb)) + 'px';   /* the pole goes all the way down to the bottom of the screen, as if someone below is holding it */
  }
  window.addEventListener('resize', flagFit); setInterval(flagFit, 1000);
  function renderPicker(s, m) {
    var taken = {};
    s.players.forEach(function (p) { if (p.pid !== pid && p.char) taken[p.char] = p.name; });
    // Only redraw when something changed, so the photos do not reload on every update.
    var k = JSON.stringify(taken) + '|' + (m ? m.char : '') + '|' + (Date.now() < pickUntil ? want : '') + '|' + (myPic ? myPic.length : 0);
    if (k !== pickKey) {
      pickKey = k;
      var myId = 'u:' + pid, sel = Date.now() < pickUntil ? want : (m && m.char);
      $('chars').innerHTML = (myPic ? '<button type="button" data-char="' + myId + '"' + (sel === myId ? ' class="mine"' : '') + '>' + charSvg(myId) + '<span>Your photo</span></button>' : '') + CHARS.map(function (c) {
        return '<button type="button" data-char="' + c.id + '"' + (taken[c.id] ? ' disabled title="Taken by ' + esc(taken[c.id]) + '"' : '') +
          ((Date.now() < pickUntil ? want : (m && m.char)) === c.id ? ' class="mine"' : '') + '>' + charSvg(c.id) + '<span>' + esc(c.name) + '</span></button>';
      }).join('');
    }
    /* the fan flag: one country per player (the flag you wave with the Giant Eurovision Flag) */
    var tcc = {}; s.players.forEach(function (p) { if (p.pid !== pid && p.cc) tcc[p.cc] = p.name; });
    var mine = Date.now() < pickUntil && wantCC ? wantCC : (m && m.cc);
    var fk = JSON.stringify(tcc) + '|' + mine;
    if (fk !== flagKey) {
      flagKey = fk;
      var list2 = FAN_FLAGS.slice().sort(function (a, b) { return String(countries[a] || a).localeCompare(String(countries[b] || b)); });
      $('ccs').innerHTML = list2.map(function (c) { return '<button type="button" data-cc="' + c + '"' + (tcc[c] ? ' disabled title="Taken by ' + esc(tcc[c]) + '"' : '') + (mine === c ? ' class="mine"' : '') + '><img src="https://flagcdn.com/w80/' + c + '.png" alt=""><span>' + esc(countries[c] || c.toUpperCase()) + '</span></button>'; }).join('');
    }
    var left = CHARS.filter(function (c) { return !taken[c.id]; }).length;
    $('pickerr').textContent = left ? (want && taken[want] ? 'Too slow, ' + taken[want] + ' just took that one. Pick another!' : '') : 'All other avatars are taken.';
    if (want && taken[want]) want = null;
  }
  var flagKey = '', myPick = { key: '', i: -1 }, joinFlow = 0, pickMode = '';
  $('ccs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cc]');
    if (!b || b.disabled) return;
    wantCC = b.getAttribute('data-cc'); pickUntil = Date.now() + 3000;
    try { sessionStorage.setItem('esc-cc', wantCC); } catch (err) {}
    hi(); if (state) onState(state);
  });
  $('chars').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-char]');
    if (!b || b.disabled) return;
    want = b.getAttribute('data-char'); pickUntil = Date.now() + 3000;   // give the host a moment to confirm; "Done" closes the editor
    try { sessionStorage.setItem('esc-char', want); } catch (err) {}
    $('pickerr').textContent = ''; hi(); if (state) onState(state);
  });
  // Two separate edit screens: one for the name, one for the avatar.
  function pickOpen(mode) {
    picking = true; pickMode = mode; $('editname').value = name;
    $('picktitle').textContent = mode === 'name' ? 'Your name' : mode === 'flag' ? (joinFlow ? 'Step 2 of 2: which country do you represent?' : 'Your fan flag') : (joinFlow ? 'Step 1 of 2: choose your avatar' : 'Your avatar');
    $('pickerr').textContent = '';
    $('pickname').classList.toggle('hidden', mode !== 'name');
    $('pickavnote').classList.toggle('hidden', mode !== 'avatar'); $('chars').classList.toggle('hidden', mode !== 'avatar'); $('mypicrow').classList.toggle('hidden', mode !== 'avatar'); $('ccwrap').classList.toggle('hidden', mode !== 'flag');
    if (state) onState(state);
    if (mode === 'name') { try { $('editname').focus(); $('editname').select(); } catch (e) {} }
  }
  $('changechar').addEventListener('click', function () { pickOpen('avatar'); });
  $('changecc').addEventListener('click', function () { pickOpen('flag'); });
  $('changename').addEventListener('click', function () { pickOpen('name'); });
  $('pickdone').addEventListener('click', function () {
    var cur = me();
    if (pickMode === 'avatar' && joinFlow && !want && !(cur && cur.char)) { $('pickerr').textContent = 'Choose an avatar first (or use your own photo!)'; return; }
    if (pickMode === 'flag' && joinFlow && !wantCC && !(cur && cur.cc)) { $('pickerr').textContent = 'Choose the country you represent first'; return; }
    if (pickMode === 'avatar' && joinFlow === 1) { joinFlow = 2; hi(); pickOpen('flag'); return; }   /* step 2: the country */
    if (joinFlow) joinFlow = 3;
    var n = $('editname').value.trim().slice(0, 16);
    if (n) { n = n.charAt(0).toUpperCase() + n.slice(1); name = n; store.set('esc-name', name); $('name').value = name; }
    picking = false; hi(); if (state) onState(state);
  });

  function onResult(r) {
    if (r.pid !== pid) return;
    var fb = $('fb');
    if (r.res === 'ok') return; // a state update follows
    fb.className = 'fb ' + (r.res === 'close' ? 'close' : 'no');
    fb.textContent = r.res === 'close' ? 'So close! Check your spelling.' : 'Nope, that’s not it. Try again!';
    if (r.res !== 'close') $('guess').value = '';
    $('guess').focus();
  }

  // Multiple choice: a tap holds the answer; whether it was right only shows at the reveal.
  // ---------- Draw!: the drawer's pad ----------
  // Best drawing: the drawings come in as packets of lines; they are kept, and painted on the buttons.
  var bestStore = { id: '', items: {} };
  function bestTake(d) {
    if (bestStore.id !== d.best) bestStore = { id: d.best, items: {} };
    if (d.first || !bestStore.items[d.i]) bestStore.items[d.i] = [];
    bestStore.items[d.i] = bestStore.items[d.i].concat(d.batch);
    var cv = $('opts').querySelector('canvas[data-g="' + d.i + '"]');
    if (cv) { if (d.first) drawClear(cv); d.batch.forEach(function (m) { drawPaint(cv, m); }); }
  }
  function bestPaint() {
    [].forEach.call($('opts').querySelectorAll('canvas[data-g]'), function (cv) { drawClear(cv); (bestStore.items[+cv.getAttribute('data-g')] || []).forEach(function (m) { drawPaint(cv, m); }); });
  }
  // Quip!: send the finished line (a few times, in case a message gets lost; the host takes the first).
  var quipKey = '', quipSent = false;
  $('quipform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('quipin').value.replace(/\s+/g, ' ').trim();
    if (!t) { $('quipfb').className = 'fb no'; $('quipfb').textContent = 'Type something first.'; return; }
    if (!net || !state || state.phase !== 'qall') return;
    quipSent = true; var qk = quipKey;
    [0, 700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (quipKey === qk && state && state.phase === 'qall' && net) net.send('quip', { pid: pid, text: t }); }, ms); });
    show('v-wait'); $('waittitle').textContent = 'Answer sent!'; $('waitsub').textContent = 'Waiting for the others…';
  });
  var padPicked = -1, padDone = false, padSkipped = false;
  // The pad screen: first the four songs (and a way out), then the canvas.
  function drawView(go, gc) {
    var picked = gc >= 0 && !!go[gc];
    $('dtitle').textContent = picked ? 'Draw: ' + go[gc] : 'Pick a song to draw';
    $('dopts').classList.toggle('hidden', picked); $('dpass').classList.toggle('hidden', picked); $('dpad').classList.toggle('hidden', !picked);
  }
  // Tell the host a few times, in case a message gets lost; it only takes the first.
  function drawTell(m) { var dk = dKey; m.pid = pid; [0, 700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (dKey === dk && state && state.phase === 'dall' && net) net.send('draw', m); }, ms); }); }
  function drawFinish(skip) { padFlush(); padShip(); padDone = true; padSkipped = !!skip; drawTell(skip ? { skip: 1 } : { done: 1 }); show('v-wait'); $('waittitle').textContent = padSkipped ? 'No drawing this time' : 'Drawing sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
  $('dpass').addEventListener('click', function () { drawFinish(true); });
  $('ddone').addEventListener('click', function () { drawFinish(false); });
  var dKey = '', padColor = 0, padWidth = DRAW_SIZES[1], padBg = 0, padBgPick = false, padAll = [], padBuf = [], padDown = false, padLast = null, padTick = null;
  function padTools() {
    var er = DRAW_COLORS.length - 1;
    $('dtools').innerHTML = DRAW_COLORS.map(function (c, i) {
      return '<button type="button" data-c="' + i + '" class="' + (i === padColor && !padBgPick ? 'on' : '') + (padBgPick && i !== er ? ' pickme' : '') + '" style="background:' + (i === er ? drawBg(padBg) : c) + (i === er && padBg === 1 ? ';color:#fff' : '') + '" aria-label="' + (i === er ? 'Eraser' : 'Colour') + '">' + (i === er ? '⌫' : '') + '</button>';
    }).join('') + '<span class="toolbreak"></span>' + DRAW_SIZES.map(function (w, i) {
      return '<button type="button" data-w="' + w + '" class="size' + (w === padWidth ? ' on' : '') + '" aria-label="' + ['Thin', 'Medium', 'Thick'][i] + ' line"><i style="width:' + (w + 3) + 'px;height:' + (w + 3) + 'px"></i></button>';
    }).join('') + '<button type="button" data-bg="1" class="wide' + (padBgPick ? ' on' : '') + '"><i class="paper" style="background:' + drawBg(padBg) + '"></i>' + (padBgPick ? 'Pick a colour' : 'Background') + '</button><button type="button" data-clear="1" class="wide">Clear</button>';
  }
  // Nobody watches the drawing live, so the lines are not sent one by one: they are collected and go
  // out together every second and a half (and at once when time is nearly up, or on Done).
  var padOut = [], padOutAt = 0;
  function padSend(m) { padOut.push(m); if (m.clear) padAll = []; else padAll.push(m); }
  function padShip() { if (!padOut.length || !net) return; net.send('draw', { pid: pid, lines: padOut }); padOut = []; padOutAt = Date.now(); }
  setInterval(function () {
    if (!padOut.length || !state || state.phase !== 'dall') return;
    if (Date.now() - padOutAt > 1500 || endsAt - Date.now() < 2500) padShip();
  }, 300);
  function padFlush() {
    if (padBuf.length < 2) return;
    var m = { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: padBuf };
    padSend(m); padBuf = padDown && padLast ? [padLast[0], padLast[1]] : [];   // the next batch continues from the last point
  }
  function padReset() { padOut = []; padAll = []; padBg = 0; padBgPick = false; padBuf = []; padDown = false; padLast = null; drawClear($('dcanvas')); padTools(); clearInterval(padTick); padTick = setInterval(function () { if (padBuf.length > 2) padFlush(); }, 400); }
  function padPoint(e) { var r = $('dcanvas').getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * DRAW_W), Math.round((e.clientY - r.top) / r.height * DRAW_H)]; }
  function padLocal(a, b) { drawPaint($('dcanvas'), { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: b ? [a[0], a[1], b[0], b[1]] : [a[0], a[1]] }); }
  $('dcanvas').addEventListener('pointerdown', function (e) {
    if (!state || state.phase !== 'dall' || padDone) return;
    e.preventDefault(); try { $('dcanvas').setPointerCapture(e.pointerId); } catch (x) {}
    padDown = true; padLast = padPoint(e); padBuf = [padLast[0], padLast[1]]; padLocal(padLast);
  });
  $('dcanvas').addEventListener('pointermove', function (e) {
    if (!padDown) return;
    e.preventDefault(); var p = padPoint(e);
    if (Math.abs(p[0] - padLast[0]) + Math.abs(p[1] - padLast[1]) < 3) return;
    padLocal(padLast, p); padLast = p; padBuf.push(p[0], p[1]);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { $('dcanvas').addEventListener(ev, function () {
    if (!padDown) return;
    padDown = false; if (padBuf.length >= 2) { var m = { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: padBuf }; padSend(m); } padBuf = [];
  }); });
  $('dtools').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-c')) {
      var ci = +b.getAttribute('data-c');
      if (padBgPick && ci !== DRAW_COLORS.length - 1) {
        // "Background" was tapped first: this colour becomes the paper. The page is painted again in it, with
        // everything drawn so far on top.
        padFlush(); padBg = ci + 1; padBgPick = false;
        var keep = padAll.slice(); drawClear($('dcanvas'), padBg); padSend({ clear: 1, bg: padBg });
        keep.forEach(function (m) { drawPaint($('dcanvas'), m); padSend(m); });
      } else { padColor = ci; padBgPick = false; }
    }
    else if (b.hasAttribute('data-w')) padWidth = +b.getAttribute('data-w');
    else if (b.hasAttribute('data-clear')) { drawClear($('dcanvas'), padBg); padSend({ clear: 1, bg: padBg }); }
    else if (b.hasAttribute('data-bg')) padBgPick = !padBgPick;   // next: tap one of the colours
    padTools();
  });
  $('dopts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || !net) return;
    padPicked = +b.getAttribute('data-i'); padSkipped = false;
    drawTell({ pick: padPicked });
    if (state && state.gallery) drawView(state.gallery.opts[pid] || [], padPicked);   // straight to the pad
  });
  // Postcard: 12, 10 and 8 points for the three best drawings, in the order you tap them (tap again to take it back)
  var rankSel = [], rankKey = '';
  function rankPaint() {
    var RP = [12, 10, 8];
    [].forEach.call($('opts').querySelectorAll('button[data-i]'), function (x) {
      var r = rankSel.indexOf(+x.getAttribute('data-i')), bd = x.querySelector('.rankpts');
      if (!bd) { bd = document.createElement('span'); bd.className = 'rankpts'; x.appendChild(bd); }
      x.classList.toggle('picked', r >= 0); bd.textContent = r >= 0 ? RP[r] : ''; bd.classList.toggle('hidden', r < 0);
    });
  }
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || b.disabled || !net) return;
    if (state && state.best && state.best.ranked) {
      if (rankKey !== state.best.id) { rankKey = state.best.id; rankSel = []; }
      var i = +b.getAttribute('data-i'), at = rankSel.indexOf(i), can = $('opts').querySelectorAll('button[data-i]:not([disabled])').length, need = Math.min(3, can);
      if (at >= 0) rankSel.splice(at, 1); else if (rankSel.length < need) rankSel.push(i);
      rankPaint();
      $('fb').className = 'fb close'; $('fb').textContent = rankSel.length < need ? 'Next: ' + [12, 10, 8][rankSel.length] + ' points' : 'Points sent! Tap one to change.';
      if (rankSel.length >= need) net.send('guess', { pid: pid, ranks: rankSel.slice() });
      return;
    }
    if (state && state.q && state.q.peel && !state.best && !state.draw) { peelPick(b); return; }
    [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked'); myPick = { key: state ? state.phase + ':' + state.round : '', i: +b.getAttribute('data-i') };
    var final = !!(state && (state.draw || state.best));   // Draw!: the first guess counts, and so does a vote
    if (final) [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.disabled = true; });
    $('fb').className = 'fb close'; $('fb').textContent = state && state.best ? 'Vote in!' : final ? 'Answer in. No changing this one!' : 'Answer in. You can still change it until everyone has answered.';
    net.send('guess', { pid: pid, choice: +b.getAttribute('data-i') });
  });
  /* Behind the curtain / Out of focus: your answer locks after 3 seconds; tap the same one again before then to take it back */
  var peelLock = { key: '', i: -1, until: 0, t: null };
  function peelPaint() {
    var k = state ? state.phase + ':' + state.round : '', on = peelLock.key === k, left = on && peelLock.until ? peelLock.until - Date.now() : 0, locked = on && peelLock.i >= 0 && left <= 0;
    [].forEach.call($('opts').querySelectorAll('button[data-i]'), function (x) { var mine = on && +x.getAttribute('data-i') === peelLock.i; x.classList.toggle('picked', mine); x.classList.toggle('locked', locked && mine); if (locked) x.disabled = true; });
    if (!on || peelLock.i < 0) return;
    $('fb').className = 'fb close'; $('fb').textContent = locked ? '🔒 Locked in!' : '⏳ Locking in ' + Math.ceil(left / 1000) + '… tap it again to take it back';
  }
  function peelPick(b) {
    var k = state.phase + ':' + state.round, i = +b.getAttribute('data-i'), now = Date.now();
    if (peelLock.key === k && peelLock.i >= 0 && now >= peelLock.until) return;   // (locked)
    clearInterval(peelLock.t);
    if (peelLock.key === k && peelLock.i === i) {   // the same answer again: taken back
      peelLock = { key: k, i: -1, until: 0, t: null }; myPick = { key: '', i: -1 };
      net.send('guess', { pid: pid, choice: i, cancel: 1 }); peelPaint(); $('fb').className = 'fb'; $('fb').textContent = 'Taken back. Pick again!'; return;
    }
    peelLock = { key: k, i: i, until: now + 3000, t: null }; myPick = { key: k, i: i };
    net.send('guess', { pid: pid, choice: i });
    peelPaint(); peelLock.t = setInterval(function () { peelPaint(); if (Date.now() >= peelLock.until) clearInterval(peelLock.t); }, 250);
  }
  $('guessform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('guess').value.trim();
    if (!t || !net) return;
    net.send('guess', { pid: pid, text: t.slice(0, 80) });
    $('fb').className = 'fb'; $('fb').textContent = '…';
  });

  setInterval(function () {
    var cd = revealAt ? Math.max(0, Math.ceil((revealAt - Date.now()) / 1000)) : 0;
    var inGuess = !!(state && state.phase === 'guess');
    $('allin').textContent = cd && !inGuess ? 'Everyone has voted. Continuing in ' + cd : '';
    $('allinq').textContent = cd && inGuess ? (state.players.length > 1 ? 'Everyone answered, revealing in ' : 'Revealing in ') + cd : '';   // below the answer bars
    var nx = nextAt ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : 0;
    $('rnext').textContent = nx && state ? (state.round >= state.total || state.last ? 'Final scores in ' : 'Next question in ') + clock(nx) : '';   // same line as "All players answered"

    if (!state) return;
    if (state.phase === 'shop' && $('shoptime')) { var stl = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); $('shoptime').textContent = '⏱ ' + stl + ' s · ' + ($('shoptime').getAttribute('data-free') === '1' ? 'then Lynda picks one for you' : 'then the boutique closes'); $('shoptime').classList.toggle('hurry', stl <= 10); }
    if (state.phase === 'intro') $('briefwait').textContent = 'Starting in ' + Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
    var ms = state.bar_ms || state.total_ms, f = ms ? Math.max(0, Math.min(1, ((state.frozen ? state.left : endsAt - Date.now())) / ms)) : 0;   // (frozen while an item lands)
    if (state.phase === 'qall') $('qbar').style.transform = 'scaleX(' + f + ')';
    if (state.gallery && state.phase === 'dall') $('dbar').style.transform = 'scaleX(' + f + ')';
    if (state.phase === 'guess') $('pbar').style.transform = 'scaleX(' + f + ')';
    else if (state.sing) $('sbar').style.transform = 'scaleX(' + (state.phase === 'loading' || state.phase === 'splay' ? 0 : f) + ')';
  }, 100);
})();
