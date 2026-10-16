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
      var wait = c.st === 'ready' && c.rwait > 0 && !rd;   // (listen to the rules first: Ready works once they've been said)
      $('chready').classList.remove('hidden'); $('chready').classList.toggle('on', rd); $('chready').disabled = wait; $('chready').classList.toggle('wait', wait); $('chready').setAttribute('aria-pressed', rd ? 'true' : 'false'); $('chreadytext').textContent = rd ? 'Ready!' : wait ? '👂 Listen…' : 'Ready';
      clearTimeout(chWaitT); if (wait) chWaitT = setTimeout(function () { if (state && state.chase && state.chase.st === 'ready') { state.chase.rwait = 0; chaseView(state.chase); } }, c.rwait + 100);
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
  var chWaitT = null;
  $('chready').addEventListener('click', function () {
    if ($('chready').disabled) return;
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
    net.on('zg', zgOnLive); net.on('fake', fkOnPriv);
    net.on('rule', ruOnLive);
    // Each hello carries what this phone last knew, so a host that reconnects can restore the game.
    hi = function () {
      if (kicked) return;
      var m = me();
      net.send('hi', { pid: pid, was: wasPid, name: name, char: want, cc: wantCC, sd: SV_MY, pk: picking && joinFlow && joinFlow < 3 ? 1 : 0, score: m ? m.score : null,
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
    SV_STREAM = s && s.sync_on && SV_MY != null ? SV_MY : 0;
    if ($('svvote') && (!s || s.phase !== 'sv')) $('svvote').classList.add('hidden');
    try { document.body.classList.toggle('svplay', !!(s && s.phase === 'sv' && s.sv && ['intro', 'ready', 'play', 'count'].indexOf(s.sv.st) >= 0)); } catch (e) {}   // (dancing: the screen stays put, no scrolling)   // (the extra-arrows vote: only during Serving)   // (the host turned the stream delay on with a sync)
    if (s && s.phase !== 'clueacc') $('v-wait').classList.remove('accmode');
    if (kicked) return;
    if (s && s.players) charCC(s.players);
    onState2(s);
    if (s.phase !== 'shop') $('shopui').classList.add('hidden');
    if (s.phase !== 'bomb' || !s.bomb) $('bombui').classList.add('hidden');
    if (s.phase !== 'carpet' || !s.carpet) $('carpetui').classList.add('hidden');
    if (s.phase !== 'finale' || !s.fin || s.fin.st !== 'pick' || s.fin.pid !== pid) { $('finui').classList.add('hidden'); $('finui').removeAttribute('data-k'); }
    if (s.phase !== 'organ' || !s.organ) $('orui').classList.add('hidden');
    if (s.phase !== 'rule' || !s.rule) { $('ruui').classList.add('hidden'); if (ruD) ruSet(''); document.body.classList.remove('rufrozen'); }
    if (s.phase !== 'zg' || !s.zg) { $('zgui').classList.add('hidden'); zgStop(); }
    if (s.phase !== 'sv' || !s.sv) { if ($('svui')) $('svui').classList.add('hidden'); svStop(); }
    calView(s);
    if (s.phase !== 'fake' || !s.fake) $('fkui').classList.add('hidden');
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
    $('waitlabel').textContent = ing && s.round && s.phase !== 'bomb' && s.phase !== 'fake' && s.phase !== 'note' && s.phase !== 'carpet' && s.phase !== 'zg' && s.phase !== 'sv' && s.phase !== 'rule' && s.phase !== 'organ' && s.phase !== 'cluerooms' && s.phase !== 'clueacc' ? 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total) : '';
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
      $('lobbystart').classList.remove('hidden'); $('lobbystart').disabled = !s.all_ready || !!s.cal_on; var lsy = s.all_ready && s.all_sync === false; $('lobbystart').textContent = s.cal_on ? '🌐 Syncing…' : lsy ? '🌐 Sync everyone' : 'Start game'; $('lobbystart').classList.toggle('sync', lsy || !!s.cal_on);   // (everyone ready, but someone online isn't synced: first the sync, for everyone; then Start)   // always there, greyed out until everyone is ready
      show('v-wait'); $('waittitle').textContent = emb ? '' : 'You’re in!'; $('waitsub').textContent = emb ? '' : s.all_ready ? (s.cal_on ? 'Syncing everyone…' : s.all_sync === false ? 'Everyone is ready! First a quick sync.' : 'Everyone is ready. Anyone can start the game.') : m.in ? 'You’re ready. Waiting for the others (' + nrdy + ' of ' + s.players.length + ')…' : 'Press Ready when you’re set. Start unlocks when everyone is ready.';
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
      var tr = s.quips.truth && s.quips.truth[pid];
      if (tr && quipSent && tr === quipLast) { quipSent = false; quipLast = ''; $('quipfb').className = 'fb no'; $('quipfb').textContent = 'Sneaky! That is the real translation 😉 Make up a fake one to fool the others.'; }
      if (!qp) {} else if (s.quips.done[pid] || quipSent) { show('v-wait'); $('waittitle').textContent = 'Answer sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
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
    else if (s.phase === 'sv' && s.sv) svView(s);
    else if (s.phase === 'fake' && s.fake) fkView(s);
    else if (s.phase === 'rule' && s.rule) ruView(s);
    else if (s.phase === 'organ' && s.organ) orView(s);
    else if (s.phase === 'qj' && s.qj) qjView(s);
    else if (s.phase === 'finale') finView(s);
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
    else if (s.phase === 'guess' && s.best && s.best.only && s.best.only !== pid) { show('v-wait'); $('waittitle').textContent = '🎉 Party game!'; $('waitsub').textContent = (s.q && s.q.text) || ''; }
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
        var cn = $('ccnote'), ck = m && m.cc ? m.cc : ''; if (cn.getAttribute('data-cc') !== ck) { cn.setAttribute('data-cc', ck); cn.innerHTML = ck ? '<img src="https://flagcdn.com/w40/' + ck + '.png" alt=""><span>' + (countries[ck] ? esc(countries[ck]) + '! ' : '') + 'This one is about your country: double points! ✨</span>' : ''; }
        cn.classList.toggle('hidden', !(ck && m.cch)); cn.classList.toggle('cchit', !!(ck && m.cch));   /* (only when the question is about your own country) */
        $('opts').classList.toggle('flagged', !!(m && m.flag) && q.type === 'mc'); $('flagmsg').classList.toggle('hidden', !(m && m.flag && q.type === 'mc')); if (m && m.flag) { var fmt = '🚩 ' + (m.flagby ? m.flagby + '’s flag! ' : '') + 'Your answers are scrambled behind it… What do you press? Who knows! 🤷'; if ($('flagmsg').textContent !== fmt) $('flagmsg').textContent = fmt; }   /* the flag hides every answer: only the outlines are left, so you pick blind */
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
            return '<button type="button" class="opt' + (bq ? ' bestopt' : '') + '" data-i="' + i + '"' + (own ? ' disabled' : '') + '>' + (q.shots && q.shots[i] ? '<img class="gshot" src="' + q.shots[i] + '" alt="">' : '') + (bq ? '<canvas data-g="' + i + '" width="' + DRAW_W + '" height="' + DRAW_H + '"></canvas>' : '') + '<b>' + 'ABCDEFGHIJKLMNOP'[flagged ? pos : i] + '</b><span class="otx">' + esc(o) + (own ? ' (yours)' : '') + '</span></button>';
          }).join('') : '';
          $('opts').classList.toggle('bestgrid', !!bq); $('opts').classList.toggle('shotgrid', !!q.shots);
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
  var clueAccEnd = 0, clueAccId = '', clueAccT = null;
  function clueAccTick() {   // the timer bar above the cards
    var t = document.querySelector('#clueui .clacct'), bar = document.querySelector('#clueui .claccbar em');
    if (!t || !state || state.phase !== 'clueacc') { clearInterval(clueAccT); return; }
    var left = Math.max(0, clueAccEnd - Date.now()), sec = Math.ceil(left / 1000);
    t.textContent = Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); t.classList.toggle('hot', sec <= 10);
    bar.style.width = (100 * left / CLUE_ACC_MS).toFixed(1) + '%';
  }
  function clueView(s) {
    var c = s.clue, box = $('clueui'), known = (c.known || {})[pid] || [];
    box.classList.remove('compact'); box.classList.remove('acc'); box.classList.remove('sentacc'); $('v-wait').classList.remove('accmode');
    show('v-wait');
    if (s.phase === 'clueacc') {
      if (clueSentId === c.id || (c.acc || {})[pid]) {   // sent: your three cards stay on screen
        $('waittitle').textContent = '🔍 Accusation sent!'; $('waitsub').textContent = 'Waiting for the other detectives…';
        if (clueSel.id === c.id && clueSel.who && clueSel.where && clueSel.what) {
          var lab2 = { where: 'Hidden where?', what: 'Hidden inside?', who: 'Who took him?' }, k2 = 'sent|' + c.id + clueSel.who + clueSel.where + clueSel.what;
          box.classList.remove('hidden'); box.classList.add('sentacc');
          if (box.getAttribute('data-k') !== k2) { box.setAttribute('data-k', k2); box.innerHTML = '<div class="clsent">' + ['where', 'what', 'who'].map(function (k) { var x = CLUE_SETS[k].filter(function (y) { return y.id === clueSel[k]; })[0]; return x ? '<div class="clsentc"><small>' + lab2[k] + '</small><i>' + x.icon + '</i><b>' + esc(x.name) + '</b></div>' : ''; }).join('') + '</div>'; }
        } else box.classList.add('hidden');
        return;
      }
      $('waittitle').textContent = ''; $('waitsub').textContent = ''; $('waitlabel').textContent = '';   // (everything on one screen: the timer bar on top, all the cards, the button)
      box.classList.remove('hidden'); box.classList.add('compact'); box.classList.add('acc'); $('v-wait').classList.add('accmode');
      var endNew = Date.now() + (c.left || 0); if (!clueAccEnd || clueAccId !== c.id || Math.abs(endNew - clueAccEnd) > 1500) { clueAccEnd = endNew; clueAccId = c.id; }
      clearInterval(clueAccT); clueAccT = setInterval(clueAccTick, 250);
      if (clueSel.id !== c.id) clueSel = { id: c.id };
      ['who', 'where', 'what'].forEach(function (k) { if (clueSel[k]) return; var open = CLUE_SETS[k].filter(function (x) { return known.indexOf(k + ':' + x.id) < 0; }); if (open.length === 1) clueSel[k] = open[0].id; });   // (only one card left in a row: it's picked for you)
      var key = c.id + '|' + known.join(',') + '|' + clueSel.who + clueSel.where + clueSel.what;
      if (box.getAttribute('data-k') === key && box.innerHTML) return; box.setAttribute('data-k', key);
      var lab = { who: 'Who took Edgar?', where: 'Where is he hidden?', what: 'What is he hidden inside?' };
      box.innerHTML = '<div class="clacctop"><span>🔍 Who? Where? Inside what?</span><b class="clacct"></b><i class="claccbar"><em></em></i></div>' + ['where', 'what', 'who'].map(function (k) {   // (the place on top, who did it at the bottom, like the big screen)
        return '<div class="clset"><span>' + lab[k] + '</span><div>' + CLUE_SETS[k].map(function (x) { var out = known.indexOf(k + ':' + x.id) >= 0; return '<button type="button" class="clbtn' + (out ? ' out' : '') + (clueSel[k] === x.id ? ' sel' : '') + '" data-k="' + k + '" data-id="' + x.id + '"><i>' + x.icon + '</i>' + esc(x.name) + '</button>'; }).join('') + '</div></div>';
      }).join('') + '<button type="button" class="btn big" id="clueaccuse"' + (clueSel.who && clueSel.where && clueSel.what ? '' : ' disabled') + '>🔍 Accuse!</button>';
      clueAccTick();
      [].forEach.call(box.querySelectorAll('.clbtn'), function (b) { b.onclick = function () { clueSel[b.getAttribute('data-k')] = b.getAttribute('data-id'); clueView(state); }; });
      $('clueaccuse').onclick = function () {
        if (!net || !(clueSel.who && clueSel.where && clueSel.what)) return;
        clueSentId = c.id; var msg = { pid: pid, id: c.id, who: clueSel.who, where: clueSel.where, what: clueSel.what };
        net.send('clue', msg); setTimeout(function () { if (state && state.phase === 'clueacc') net.send('clue', msg); }, 1500);
        clueView(state);
      };
      return;
    }
    var sol = c.sol || {}, parts = [];
    // the answer comes out: your notebook stays on screen, the right card in each row turns green, a wrong pick gets a red cross
    var pickd = clueSel.id === c.id ? clueSel : {}, rk = 'rev|' + c.id + '|' + known.join(',') + '|' + (sol.where || '') + (sol.what || '') + (sol.who || '') + '|' + (pickd.who || '') + (pickd.where || '') + (pickd.what || '');
    box.classList.remove('hidden');
    if (pickd.who && pickd.where && pickd.what) {   // you accused: your three cards stay on screen, and each turns green or red as the answer comes out
      box.classList.add('sentacc');
      if (box.getAttribute('data-k') !== rk) {
        box.setAttribute('data-k', rk);
        var lab3 = { where: 'Hidden where?', what: 'Hidden inside?', who: 'Who took him?' };
        box.innerHTML = '<div class="clsent">' + ['where', 'what', 'who'].map(function (k) {
          var x = CLUE_SETS[k].filter(function (y) { return y.id === pickd[k]; })[0], open = !!sol[k], ok = open && sol[k] === pickd[k], right = open && !ok ? CLUE_SETS[k].filter(function (y) { return y.id === sol[k]; })[0] : null;
          return x ? '<div class="clsentc' + (open ? (ok ? ' ok' : ' bad') : '') + '"><small>' + lab3[k] + (right ? ' · it was ' + right.icon + ' ' + esc(right.name) : '') + '</small><i>' + x.icon + '</i><b>' + esc(x.name) + '</b></div>' : '';
        }).join('') + '</div>';
      }
    } else box.classList.add('compact');
    if (!(pickd.who && pickd.where && pickd.what) && box.getAttribute('data-k') !== rk) {
      box.setAttribute('data-k', rk);
      var labr = { who: 'Who took Edgar?', where: 'Where is he hidden?', what: 'What is he hidden inside?' };
      box.innerHTML = ['where', 'what', 'who'].map(function (k) {
        return '<div class="clset"><span>' + labr[k] + '</span><div>' + CLUE_SETS[k].map(function (x) {
          var out = known.indexOf(k + ':' + x.id) >= 0, mine = pickd[k] === x.id, open = !!sol[k], ok = open && sol[k] === x.id, bad = open && mine && !ok;
          return '<div class="clbtn ro' + (out ? ' out' : '') + (mine ? ' sel' : '') + (ok ? ' ok' : '') + (bad ? ' bad' : '') + '"><i>' + x.icon + '</i>' + esc(x.name) + '</div>';
        }).join('') + '</div></div>';
      }).join('');
    }
    if (sol.where) parts.push('Hidden ' + clueCard('where:' + sol.where).c.in);
    if (sol.what) parts.push('inside the ' + clueCard('what:' + sol.what).c.name);
    if (sol.who) parts.push('by ' + clueCard('who:' + sol.who).c.name);
    var r = c.res && c.res[pid];
    $('waittitle').textContent = r ? (r.n === 3 ? '🏆 You found Edgar!' : r.none ? 'No accusation…' : '🔍 ' + r.n + ' of 3 right') : '🔍 Who took Edgar…?';
    $('waitsub').textContent = (parts.length ? parts.join(' ') + (parts.length === 3 ? '!' : '…') : 'Watch the big screen!') + (r && r.pts ? ' +' + r.pts + ' points' : '') + (c.gift && c.gift.pid === pid ? ' 🎁 Lynda gave you the ' + shopName(c.gift.item) + '! It’s in your bag.' : '');
  }

  // ---------- Turquoise Carpet ----------
  // Watch the runway; after each act, the question with four answers (20 seconds).
  var tcSent = {}, tcTimerT = null, tcEnd = 0;
  // The finale: the winner picks the victory song (any Eurovision song from their country), the others watch
  var finSent = '', finEnds = 0, finTickT = null;
  function finView(s) {
    var f = s.fin, box = $('finui'); show('v-wait'); $('waitlabel').textContent = '';
    clearInterval(finTickT);
    if (f && f.st === 'pick' && f.pid === pid && finSent !== f.id) {   // the 60 seconds to choose (or a random song is picked)
      finEnds = Date.now() + (f.left || 0);
      var tk = function () { var sec = Math.max(0, Math.ceil((finEnds - Date.now()) / 1000)); $('waitlabel').textContent = '⏱ ' + sec + 's to choose, or a random song plays'; };
      tk(); finTickT = setInterval(function () { if (!state || state.phase !== 'finale' || finSent === f.id) { clearInterval(finTickT); $('waitlabel').textContent = ''; return; } tk(); }, 500);
    }
    if (!f) { $('waittitle').textContent = '🏆 The winner of EuroQuizion!'; $('waitsub').textContent = 'Watch the big screen.'; return; }
    if (f.st === 'pick' && f.pid === pid && finSent !== f.id) {
      $('waittitle').textContent = '🎶 Pick your victory song!'; $('waitsub').textContent = 'Any Eurovision song from your country. It plays on the big screen.';
      if (box.getAttribute('data-k') !== f.id) {
        box.setAttribute('data-k', f.id);
        var list = function () { box.innerHTML = f.opts.map(function (o, i) { return '<button type="button" class="finopt" data-i="' + i + '">' + esc(o) + '</button>'; }).join(''); };
        list();
        box.onclick = function (e) {   // tap a song, then confirm it (or go back to the list)
          var b = e.target.closest('.finopt'), yes = e.target.closest('.finyes'), back = e.target.closest('.finback');
          if (back) { list(); return; }
          if (yes) { if (!net) return; var i = +yes.getAttribute('data-i'); finSent = f.id; net.send('fin', { pid: pid, id: f.id, i: i, v: (f.ids || [])[i] || '' }); box.classList.add('hidden'); $('waittitle').textContent = '🎶 Great choice!'; $('waitsub').textContent = f.opts[i] + ' · it will play in a moment!'; return; }
          if (!b) return; var k = +b.getAttribute('data-i');
          box.innerHTML = '<div class="finconf"><b>Play this one?</b><span>' + esc(f.opts[k]) + '</span><button type="button" class="finyes" data-i="' + k + '">✔ Yes, play it!</button><button type="button" class="finback">✖ Back to the list</button></div>';
        };
      }
      box.classList.remove('hidden'); return;
    }
    box.classList.add('hidden');
    if (f.mon) { $('waittitle').textContent = '👹 ' + f.name + ' stole the trophy!'; $('waitsub').textContent = 'Nobody could stop it… watch the big screen.'; return; }
    if (f.st === 'pick') { $('waittitle').textContent = f.pid === pid ? '🎶 Great choice!' : '🎶 ' + f.name + ' is picking the victory song…'; $('waitsub').textContent = f.pid === pid ? 'Your song will play in a moment!' : 'Watch the big screen.'; }
    else { $('waittitle').textContent = '🎶 Victory song'; $('waitsub').textContent = f.song || ''; }
  }
  function carpetView(s) {
    var c = s.carpet, box = $('carpetui');
    show('v-wait'); $('waitlabel').textContent = c.sec ? 'Eurovision act ' + c.sec + ' of 5' : '';
    var mineT = (c.tot || {})[pid] || { n: 0 }, score = '⭐ ' + mineT.n + ' right so far';
    clearInterval(tcTimerT);
    if (c.st === 'ready' || c.st === 'walk') {
      box.classList.add('hidden'); box.innerHTML = ''; box.removeAttribute('data-k');
      $('waittitle').textContent = '👀 Watch the runway!'; $('waitsub').textContent = (c.st === 'walk' && c.n ? (c.n > 1 ? c.n + ' contestants in this act. ' : 'A solo act! ') : '') + 'Remember hats, sunglasses, outfits, colours, shoes and flags!' + (c.sec > 1 ? ' ' + score : '');
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

  // ---------- Say Na Na Na! ----------
  // My card comes privately: the secret word (or "you're guessing"). Then: my one-word clue, or (if I'm guessing) my guess,
  // and judging a guess that wasn't spelled quite right.
  var fkMe = null, fkAsked = '', fkSent = {};
  function fkOnPriv(m) { if (!m || m.to !== pid || !m.id) return; fkMe = m; if (state && state.phase === 'fake') fkView(state); }
  function fkSend(o) { var f = state && state.fake; if (!net || !f) return; o.pid = pid; o.id = f.id; net.send('fake', o); }
  var fkEndAt = 0;   // (the countdown on the phone: for the clues, the check, the guess and the vote)
  setInterval(function () {
    var el = $('fktimer'); if (!el) { el = document.createElement('div'); el.id = 'fktimer'; document.body.appendChild(el); }
    var on = !!(state && state.phase === 'fake' && state.fake && fkEndAt > Date.now()); el.classList.toggle('on', on);
    if (on) { var sec = Math.ceil((fkEndAt - Date.now()) / 1000), t = '⏱️ ' + sec; if (el.textContent !== t) el.textContent = t; el.classList.toggle('hot', sec <= 5); }
  }, 250);
  function fkView(s) {
    var f = s.fake, box = $('fkui'), mine = f.order.indexOf(pid) >= 0, me = fkMe && fkMe.id === f.id ? fkMe : null, isG = f.guesser === pid;
    fkEndAt = f.left > 0 ? Date.now() + f.left : 0;
    show('v-wait'); box.classList.remove('hidden');
    if (mine && !me && fkAsked !== f.id) { fkAsked = f.id; fkSend({ ask: 1 }); }
    var nm = function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; };
    var card = !mine || f.st === 'end' ? '' : isG ? '<div class="fkcard fake"><b>☝️ You’re guessing!</b><span>Don’t look at the others’ phones… The clues appear on the big screen.</span></div>'
      : !me ? '<div class="fkcard wait">🤫 Getting the secret word…</div>' : '<div class="fkcard"><small>The secret word</small><b>' + esc(me.song.t) + '</b><span>Give ' + esc(nm(f.guesser)) + ' a clue: ' + (f.per > 1 ? 'TWO words' : 'ONE word') + '</span></div>';
    var key = f.id + '|' + f.st + '|' + (me ? me.role : '') + '|' + JSON.stringify(f.clues) + '|' + (f.guess || '') + '|' + (f.done ? 1 : 0) + '|' + JSON.stringify(f.judged || {}) + '|' + JSON.stringify(me && me.check ? me.check.out : null);
    if (box.getAttribute('data-k') === key) return; box.setAttribute('data-k', key);
    var body = '';
    if (!mine) { $('waittitle').textContent = '📰 Say Na Na Na!'; $('waitsub').textContent = 'Watch the big screen!'; }
    else if (f.st === 'secret') { $('waittitle').textContent = isG ? '☝️ Your turn to guess!' : '🤫 The secret word'; $('waitsub').textContent = isG ? 'Get ready…' : 'Keep it to yourself!'; }
    else if (f.st === 'clues') {
      if (isG) { $('waittitle').textContent = '⏳ They’re writing clues…'; $('waitsub').textContent = 'The same clues cancel each other out!'; }
      else if (f.clues[pid + '#0'] || fkSent[f.id + ':w']) { $('waittitle').textContent = '✅ Clue sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
      else { $('waittitle').textContent = '✍️ Your clue'; $('waitsub').textContent = (f.per > 1 ? 'TWO clues, one word each.' : 'ONE word.') + ' Be different: the same clues cancel each other out!'; body = '<form class="fkform' + (f.per > 1 ? ' two' : '') + '">' + (f.per > 1 ? '<input type="text" maxlength="24" placeholder="Clue 1" autocomplete="off" autocapitalize="words"><input type="text" maxlength="24" placeholder="Clue 2" autocomplete="off" autocapitalize="words">' : '<input type="text" maxlength="24" placeholder="One word" autocomplete="off" autocapitalize="words">') + '<button type="submit" class="btn">Send</button></form>'; }
    } else if (f.st === 'check') {
      var chk = me && me.check, isC = chk && chk.checker === pid;
      if (isG || !chk) { $('waittitle').textContent = '🔍 Checking the clues…'; $('waitsub').textContent = isG ? 'No peeking! The clues appear in a moment.' : 'Watch the big screen!'; }
      else {
        $('waittitle').textContent = isC ? '🔍 You check the clues!' : '🔍 ' + nm(chk.checker) + ' is checking the clues'; $('waitsub').textContent = isC ? 'The same ones are crossed out already. Tap a clue to cross it out (typos, nearly the same, the word itself…) or to bring it back.' : 'The crossed-out ones won’t be shown.';
        body = '<div class="fkchk">' + Object.keys(chk.clues).filter(function (k) { return chk.clues[k]; }).map(function (k) { var o = chk.out[k]; return '<button type="button" class="fkck' + (o ? ' out' : '') + '" data-k="' + esc(k) + '"' + (isC ? '' : ' disabled') + '><b>' + esc(chk.clues[k]) + '</b><small>' + esc(nm(k.split('#')[0])) + (o === 'twin' ? ' · the same as another' : o === 'title' ? ' · gives the word away' : o === 'check' ? ' · crossed out' : '') + '</small></button>'; }).join('') + '</div>' + (isC ? '<button type="button" class="btn big fkckdone">✅ Done: show the clues</button>' : '');
      }
    }
    else if (f.st === 'guess') {
      if (isG && !fkSent[f.id + ':g']) { $('waittitle').textContent = '🤔 What’s the word?'; $('waitsub').textContent = 'Look at the clues on the big screen. One guess!'; body = '<form class="fkform fkgf"><input type="text" maxlength="40" placeholder="Your guess" autocomplete="off" autocapitalize="words"><button type="submit" class="btn">Guess</button></form>'; }
      else { $('waittitle').textContent = '🤔 ' + nm(f.guesser) + ' is guessing…'; $('waitsub').textContent = 'Fingers crossed!'; }
    } else if (f.st === 'judge') {
      if (isG) { $('waittitle').textContent = '🤞 The others are judging…'; $('waitsub').textContent = 'You said: “' + f.guess + '”'; }
      else if ((f.judged || {})[pid] || fkSent[f.id + ':j']) { $('waittitle').textContent = '✅ Vote sent'; $('waitsub').textContent = 'Waiting for the others…'; }
      else { $('waittitle').textContent = nm(f.guesser) + ' says:'; $('waitsub').textContent = 'Close enough to the secret word?'; body = '<div class="fkguess">“' + esc(f.guess) + '”</div><div class="fkjudge"><button type="button" class="btn big fkj" data-v="1">✅ Right</button><button type="button" class="btn big alt fkj" data-v="0">❌ Wrong</button></div>'; }
    } else if (f.st === 'end') {
      var won = (f.win || []).indexOf(pid) >= 0, pts = (f.res || {})[pid] || 0;
      if (f.done) { $('waittitle').textContent = won ? '🏆 You win Say Na Na Na!' : '📰 Say Na Na Na! is over!'; $('waitsub').textContent = 'Your total: ' + ((f.tot || {})[pid] || 0) + ' points over ' + f.of + ' rounds.'; box.innerHTML = ''; return; }
      var c = f.clues[pid + '#0'] && f.clues[pid + '#0'].x ? f.clues[pid + '#0'] : f.clues[pid + '#1'];
      $('waittitle').textContent = (pts ? '⭐ +' + pts + ' points' : f.right ? '🎉 Right!' : '😅 Not this time') + (f.rnd < f.of ? ' · next round coming up!' : '');
      $('waitsub').textContent = (f.song ? 'The word was: ' + f.song.t + '. ' : '') + (c && c.x === 'twin' ? 'Your clue was cancelled: someone wrote the same!' : c && c.x === 'title' ? 'Your clue gave the word away, so it didn’t count.' : '');
    }
    box.innerHTML = card + body;
    var gf = box.querySelector('.fkgf'); if (gf) { var gi = gf.querySelector('input'); setTimeout(function () { try { gi.focus(); } catch (e) {} }, 50); gf.onsubmit = function (e) { e.preventDefault(); var w = gi.value.trim(); if (!w) return; fkSent[f.id + ':g'] = 1; fkSend({ guess: w }); box.removeAttribute('data-k'); fkView(state); }; }
    [].forEach.call(box.querySelectorAll('.fkj'), function (b) { b.onclick = function () { fkSent[f.id + ':j'] = 1; fkSend({ judge: +b.getAttribute('data-v') }); box.removeAttribute('data-k'); fkView(state); }; });
    [].forEach.call(box.querySelectorAll('.fkck:not([disabled])'), function (b) { b.onclick = function () { fkSend({ toggle: b.getAttribute('data-k') }); b.classList.toggle('out'); }; });
    var cd = box.querySelector('.fkckdone'); if (cd) cd.onclick = function () { cd.disabled = true; fkSend({ checked: 1 }); };
    [].forEach.call(box.querySelectorAll('.fkform input'), function (x) { x.oninput = function () { var v = x.value, c = v.charAt(0).toLocaleUpperCase(); if (v && v.charAt(0) !== c) { var at = x.selectionStart; x.value = c + v.slice(1); try { x.setSelectionRange(at, at); } catch (e) {} } }; });   // (every clue and guess starts with a capital, already while typing)
    var fm = box.querySelector('.fkform:not(.fkgf)'); if (fm) { var inp = fm.querySelector('input'); setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50); fm.onsubmit = function (e) { e.preventDefault(); var ws = [].map.call(fm.querySelectorAll('input'), function (x) { return x.value.trim().split(/\s+/)[0]; }); if (ws.some(function (x) { return !x; })) return; fkSent[f.id + ':w'] = 1; fkSend({ words: ws }); box.removeAttribute('data-k'); fkView(state); }; }
  }

  // ---------- Zero Gravity ----------
  // The poles follow a path set by the game (zgPath, the same on every device). Keep your finger on the glowing zone:
  // off it for too long and you fall. The phone checks all this itself; it only tells the host when your level changes
  // (0 on target, 1 a bit off, 2 about to fall), when you fall, and your accuracy at the end.
  var zgS = null;
  function zgOnLive() {}
  // ---------- Serving! (the dance-off test game): DDR-style arrows scroll up; hit the matching pad as they reach the top ----------
  var svS = null, SV_STREAM = 0, SV_MY = null;   // (my delay, measured with the host's sync: used only when the host has the stream delay on)
  try { var d0 = localStorage.getItem('eq_delay'), a0 = +localStorage.getItem('eq_delay_at') || 0; if (d0 != null && Date.now() - a0 < 12 * 3600000) SV_MY = +d0; } catch (e) {}   // (measured earlier tonight: still counts after a rejoin)
  function svView(s) {
    var z = s.sv, box = $('svui'), mine = z.order.indexOf(pid) >= 0;
    show('v-wait');
    if (!svS || svS.id !== z.id) { svStop(); svS = { id: z.id, t0: 0, bt: z.bt, done: {}, q: {}, raf: 0, fbAt: 0, sent: false, pf: 0, balls: 0, pp: 0, pdown: false }; }
    svS.g = (z.grp || {})[pid] || 'A';
    box.classList.toggle('tB', svS.g === 'B' && z.order.length > 1);   // (the pump ball in the team colour)
    var S = svS;
    if ((z.st === 'count' || z.st === 'end') && mine && !S.sent && S.chart) {   // the song is over: send my results (once)
      S.sent = true; var zid = z.id, send = function () { var res = S.chart.map(function (n, i) { return String(S.q[i] || 0); }).join(''); if (net) (net.toHost || net.send)('sv', { pid: pid, id: zid, res: res, pump: S.pdone || 0 }); };
      var lastT = S.t0 + (S.chart.length ? S.chart[S.chart.length - 1][0] : 0) * S.bt + 700, wait = Math.max(0, lastT - Date.now());   // (with a stream delay the phone's song ends later: finish first)
      S.sent = 'wait'; S.lastT = lastT; setTimeout(function () { S.sent = true; send(); if (svS === S) { svStop(); S.st = 'count'; if (state) svView(state); } }, wait);
      clearInterval(S.rs); S.rs = setInterval(function () { if (S.sent !== true) return; var z2 = state && state.sv; if (!z2 || z2.id !== zid || z2.st === 'end' || (z2.rcv || []).indexOf(pid) >= 0) { clearInterval(S.rs); return; } send(); }, 900);   // (sent again until the big screen has it: a message can get lost)
    }
    if (z.st === 'count' && S.sent === 'wait') { S.st = 'play'; return; }   // (my song is still going: keep dancing)
    if (z.st === 'count') { svStop(); box.classList.add('hidden'); $('waittitle').textContent = '🪩 Counting the steps…'; $('waitsub').textContent = 'Look at the big screen!'; return; }
    if (z.st === 'end') {
      svStop(); box.classList.add('hidden');
      var w = (z.win || []).indexOf(pid) >= 0, names = (z.win || []).map(function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }).filter(Boolean);
      $('waittitle').textContent = w ? '🏆 You served the most!' : names.length ? '🏆 ' + names.join(' & ') + (names.length > 1 ? ' win!' : ' wins!') : 'The end!';
      var R = (z.res || {})[pid]; $('waitsub').textContent = mine && R ? 'Perfect ' + R.p + ' · Good ' + R.g + ' · Miss ' + R.m + ' · ' + R.pts + ' points' : '';
      return;
    }
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🍑 Serving'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (z.nb || z.nk) { var est = Date.now() + z.nb - z.nk * z.bt + SV_STREAM; if (!S.t0 || est < S.t0 || est - S.t0 > 400) S.t0 = est; }   // (the earliest estimate: the least network delay)
    var stn = ['', 'Green team', 'Purple team', 'Everyone together'][z.stage || 1];
    $('waittitle').textContent = z.st === 'play' ? 'Stage ' + (z.stage || 1) + ': ' + stn : z.st === 'ready' ? '🪩 Get ready…' : '🍑 Serving';
    var tm = svS.g === 'B' ? 'purple' : 'green';
    $('waitsub').textContent = z.st === 'intro' ? 'Listen to the presenters…' : (z.order.length > 1 ? 'You’re in the ' + tm + ' team. ' : '') + (z.stage !== 3 ? 'First a step every four beats, then every two. Every arrow is a step!' : z.stage === 3 ? 'A step on every beat, double points!' : 'Hit the arrow as it reaches the top: every hit is a step!');
    if (z.st === 'intro') { box.classList.add('hidden'); svVoteUI(z, -99, false); return; }   // (the arrows only when the presenters are done)
    box.classList.remove('hidden');
    if (box.getAttribute('data-id') !== z.id) {   // the chart: arrows scroll up to the receptors; four big pads below
      box.setAttribute('data-id', z.id); S.chart = z.chart || []; S.notes = null;
      var A = '<svg viewBox="0 0 100 100"><path d="M50 8 L92 52 L66 52 L66 92 L34 92 L34 52 L8 52 Z" stroke-width="6" stroke-linejoin="round"/></svg>';
      box.innerHTML = '<div class="svfield">' + [0, 1, 2, 3].map(function (c) { return '<i class="svrec c' + c + '">' + A + '</i>'; }).join('') + S.chart.map(function (n, i) { return '<i class="svn c' + n[1] + (n[2] ? ' gold' : '') + '" data-i="' + i + '">' + A + '</i>'; }).join('') + '<div class="svfb"></div><div class="svwt"></div><div class="svpump"><div class="svpick"><b>Pick the colour of your skippy ball!</b><div>' + ['#e0102a', '#1f6fe8', '#ffc61a', '#22b45a', '#ff4fa8', '#8a3ad8', '#ff8a1f', '#c8ccd8'].map(function (c, k) { return '<button type="button" data-bc="' + k + '" style="--bc:' + c + '"></button>'; }).join('') + '</div></div><div class="svpball"><i></i></div><div class="svpump2"><i class="svph"></i><i class="svpcyl"></i></div><b class="svpn"></b><em>Pump it up! 20 pumps, as fast as you can!</em></div></div><div class="svpads">' + [0, 1, 2, 3].map(function (c) { return '<button type="button" class="svpadb c' + c + '" data-d="' + c + '">' + A + '</button>'; }).join('') + '</div><div class="svme"></div>';
      (function () {   // while the other team dances: pump up a skippy ball (slide a finger up and down); every full ball is a bonus
        var pu = box.querySelector('.svpump'), y0 = 0, p0 = 0;
        var paint = function () { var S2 = svS; if (!S2) return; pu.style.setProperty('--p', S2.pp.toFixed(3)); pu.style.setProperty('--f', S2.pf.toFixed(3)); pu.querySelector('.svpn').textContent = S2.pdone ? '🎈 Full in ' + (S2.pdone / 1000).toFixed(1) + 's!' : S2.pn ? S2.pn + ' / 20' : ''; pu.classList.toggle('done', !!S2.pdone); };
        [].forEach.call(pu.querySelectorAll('.svpick button'), function (bt) { bt.addEventListener('click', function (e) { e.stopPropagation(); var S2 = svS, z2 = state && state.sv; if (!S2 || !z2) return; S2.bc = +bt.getAttribute('data-bc'); pu.style.setProperty('--bc', bt.style.getPropertyValue('--bc')); pu.classList.add('picked'); if (net) (net.toHost || net.send)('sv', { pid: pid, id: z2.id, bc: S2.bc }); }); });   // (first a colour, then pump)
        pu.addEventListener('pointerdown', function (e) { e.preventDefault(); y0 = e.clientY; p0 = svS ? svS.pp : 0; try { pu.setPointerCapture(e.pointerId); } catch (x) {} });
        pu.addEventListener('pointermove', function (e) {
          var S2 = svS; if (!S2 || !(e.buttons || e.pressure)) return;
          S2.pp = Math.max(0, Math.min(1, p0 + (e.clientY - y0) / (pu.clientHeight * .75)));
          if (S2.pp > .92 && !S2.pdown && !S2.pdone) { S2.pdown = true; if (!S2.pn) S2.pt0 = Date.now(); S2.pn = (S2.pn || 0) + 1; S2.pf = Math.min(1, S2.pn / 20); try { navigator.vibrate && navigator.vibrate(10); } catch (x) {} if (S2.pn >= 20) { S2.pdone = Math.max(1, Date.now() - S2.pt0); pu.classList.remove('full'); void pu.offsetWidth; pu.classList.add('full'); try { navigator.vibrate && navigator.vibrate([30, 40, 60]); } catch (x) {} } }   // (a full stroke down: a puff of air; 20 to fill the ball, the faster the better)
          if (S2.pp < .08) S2.pdown = false;   // (a long stroke: almost all the way up and down)
          paint();
        });
        paint();
      })();
      [].forEach.call(box.querySelectorAll('.svpadb'), function (bt) { bt.addEventListener('pointerdown', function (e) { e.preventDefault(); svTap(+bt.getAttribute('data-d')); bt.classList.remove('hit'); void bt.offsetWidth; bt.classList.add('hit'); }); bt.addEventListener('contextmenu', function (e) { e.preventDefault(); }); });
    }
    var tally = { 2: 0, 1: 0, 0: 0 }; Object.keys(S.q).forEach(function (i) { tally[S.q[i]]++; });
    box.querySelector('.svme').textContent = 'Perfect ' + tally[2] + ' · Good ' + tally[1] + ' · Miss ' + tally[0];
    S.st = z.st;
    if (!S.raf) { var loop = function () { if (!svS) return; svFrame(); svS.raf = requestAnimationFrame(loop); }; S.raf = requestAnimationFrame(loop); }
  }
  // the host's sync for online players: tap on every flash and click as it comes through the stream
  var calS = null;
  function calView(s) {
    var c = s.cal, ov = $('calui');
    if (!c) { if (ov) { if (calS && calS.res && !calS.shown) { calS.shown = true; setTimeout(function () { var o = $('calui'); if (o) o.remove(); }, 2500); } else ov.remove(); } if (!ov) calS = null; return; }
    if (!calS || calS.id !== c.id) calS = { id: c.id, t0: 0, taps: [], res: null };
    if (!c.wait) { var est = Date.now() + c.dt; if (!calS.t0 || est < calS.t0) calS.t0 = est; }   // (the earliest estimate: the least network delay)
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'calui'; document.body.appendChild(ov);
      { ov.innerHTML = '<div class="calp"><b>🌐 Sync</b><p>Tap anywhere on every flash and click, the moment you see and hear it (on the TV or on the stream)!</p><i class="calpad">TAP</i><em></em></div>'; ov.addEventListener('pointerdown', function (e) { e.preventDefault(); if (!calS || calS.res) return; calS.taps.push(Date.now()); var pd = ov.querySelector('.calpad'); pd.classList.remove('hit'); void pd.offsetWidth; pd.classList.add('hit'); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} }); }
    }
    var em0 = ov.querySelector('.calp em'); if (em0 && !calS.res) { var emx = c.wait ? 'Get ready… the countdown starts in a moment!' : ''; if (em0.textContent !== emx) em0.textContent = emx; }   // (waiting for the host to press Sync)
    if (c.done && !calS.res) {
      {
        var taps = calS.taps.filter(function (tt) { return tt > calS.t0 - 300; }), offs = [];   // (the 1st tap goes with the 1st click, the 2nd with the 2nd…: so even a delay of seconds is measured right)
        taps.slice(0, c.n).forEach(function (tt, k) { var o = tt - (calS.t0 + k * c.gap); if (o > -300 && o < 6000) offs.push(o); });
        offs.sort(function (a, b) { return a - b; });
        if (offs.length >= 3) { var d = Math.max(0, Math.min(6000, Math.round(offs[Math.floor(offs.length / 2)] / 10) * 10)); calS.res = d; SV_MY = d; SV_STREAM = d; try { localStorage.setItem('eq_delay', String(d)); localStorage.setItem('eq_delay_at', String(Date.now())); } catch (x) {} ov.querySelector('em').textContent = '✅ Your delay: ' + (d / 1000).toFixed(2) + 's'; var cm = { pid: pid, id: c.id, d: d }; if (net) (net.toHost || net.send)('cal', cm); [700, 1800].forEach(function (ms) { setTimeout(function () { if (net) (net.toHost || net.send)('cal', { pid: pid, id: cm.id, d: d }); }, ms); }); setTimeout(function () { try { hi(); } catch (x) {} }, 2600); }   // (sent again, in case one got lost; and with the next hello it counts for later too)
        else { calS.res = -2; ov.querySelector('em').textContent = 'Not enough taps: ask the host to sync again.'; if (net) (net.toHost || net.send)('cal', { pid: pid, id: c.id, d: -2 }); }
      }
    }
  }
  function svMine(n) { if (n[6]) { var z6 = state && state.sv; return !!(z6 && z6.extra && z6.extra[n[5]] === pid); } return !n[5] || n[5] === '*' || (svS && svS.g) === n[5]; }   // (an extra arrow: only if my team voted for me)
  // While my team isn't dancing: vote for the teammate who gets the extra arrows in our double time (locks 5 s before it)
  function svVoteUI(z, b, soon) {
    var w = $('svvote'); if (!w) { w = document.createElement('div'); w.id = 'svvote'; w.className = 'svvote hidden'; var ref = $('svui'); ref.parentNode.insertBefore(w, ref); w.addEventListener('click', function (e) { var bt = e.target.closest('button[data-k]'); var z2 = state && state.sv; if (!bt || !z2 || !net) return; w._mine = bt.getAttribute('data-k'); (net.toHost || net.send)('sv', { pid: pid, id: z2.id, vote: w._mine }); w._h = ''; svVoteUI(z2, w._b, false); }); }
    w._b = b; var g = svS && svS.g, T = g || (z.grp && z.grp[pid]);
    if (!z || z.order.length < 2 || !T || ['intro', 'ready', 'play'].indexOf(z.st) < 0 || (z.extra && z.extra[T] && b > (z.vlock ? z.vlock[T] : 0) + 6)) { w.classList.add('hidden'); return; }
    var hx;
    if (z.extra && z.extra[T]) { var k = z.extra[T]; hx = '<b>' + (k === pid ? '⭐ You get the extra arrows! An arrow on every beat: watch out!' : '⭐ ' + esc(nameOf(k)) + ' gets the extra arrows!') + '</b>'; }
    else if (soon || (z.vlock && b >= z.vlock[T])) { w.classList.add('hidden'); return; }
    else { var vt = z.vt || {}, team = z.order.filter(function (k) { return z.grp[k] === T; }); hx = '<b>🗳️ Who gets extra arrows in your fast part?</b><div>' + team.map(function (k) { return '<button type="button" data-k="' + esc(k) + '" class="' + (w._mine === k ? 'on' : '') + '">' + esc(k === pid ? 'Me!' : nameOf(k)) + (vt[k] ? ' <i>' + vt[k] + '</i>' : '') + '</button>'; }).join('') + '</div><small>Votes lock 5 seconds before it starts</small>'; }
    if (w._h !== hx) { w._h = hx; w.innerHTML = hx; } w.classList.remove('hidden');
  }
  function nameOf(k) { var pl = state && state.players && state.players.filter(function (x) { return x.pid === k; })[0]; return pl ? pl.name : '?'; }   // (the arrows for my team, or for everyone)
  function svStop() { if (svS && svS.raf) cancelAnimationFrame(svS.raf); if (svS) svS.raf = 0; }
  function svFrame() {
    var S = svS, box = $('svui'); if (!S || !box || !S.t0 || !S.chart) return;
    var b = (Date.now() - S.t0) / S.bt, on = S.st === 'play' || S.st === 'ready';
    if (!S.notes) S.notes = [].slice.call(box.querySelectorAll('.svn'));
    var soon = false; S.chart.forEach(function (n) { if (svMine(n) && n[0] > b - .3 && n[0] < b + 3.2) soon = true; });
    if (state && state.sv) svVoteUI(state.sv, b, soon);
    if (!S.partSent && S.st === 'play') {   // my team's round is over: one score update for the big screen (not every arrow)
      var lastMine = 0; S.chart.forEach(function (n) { if (n[5] && n[5] !== '*' && svMine(n)) lastMine = Math.max(lastMine, n[0]); });
      if (lastMine && b > lastMine + 1) { S.partSent = true; var zid2 = state && state.sv && state.sv.id, snd = function () { var res = S.chart.map(function (n, i) { return String(S.q[i] || 0); }).join(''); if (net && zid2) (net.toHost || net.send)('sv', { pid: pid, id: zid2, part: 1, res: res }); }; snd(); setTimeout(snd, 1500); }
    }
    var wt = box.querySelector('.svwt'), nxt = null; S.chart.forEach(function (n) { if (!nxt && n[0] > b) nxt = n; }); var mine0 = S.chart.some(function (n) { return n[0] <= b && svMine(n); }), pumping = (S.st === 'play' || S.st === 'ready') && !soon && !!(nxt && nxt[5] && nxt[5] !== '*' && !svMine(nxt)), wtx = (S.st === 'play' || S.st === 'ready') && !soon ? (pumping ? (mine0 ? '👀 The other team is dancing… watch the big screen!' : '😌 Relax, it’s not your turn yet. Enjoy the show!') : S.st === 'play' && nxt ? '💃 Get ready… watch the big screen!' : '') : '';   /* (not the starting team: no controls, just relax) */   /* (no pumping any more: just watch) */ if (wt && wt.textContent !== wtx) wt.textContent = wtx; box.classList.toggle('pumping', pumping);   // (the other team's turn: pump!)
    if (S.st === 'play') S.chart.forEach(function (n, i) { if (!S.done[i] && svMine(n) && b - n[0] > .55) { S.done[i] = 1; S.q[i] = 0; svFb(0); } });   // (an arrow that went by: a miss)
    S.notes.forEach(function (n) { var i = +n.getAttribute('data-i'), dk = S.chart[i][0] - b; if (!on || S.done[i] || !svMine(S.chart[i]) || dk < -.5 || dk > 3) { if (n._v !== 0) { n._v = 0; n.style.opacity = 0; } return; } n._v = 1; n.style.opacity = 1; n.style.transform = 'translateY(' + (dk * 22).toFixed(2) + 'vh)'; });   // (22vh per bounce: up to the receptors)
    var fb = box.querySelector('.svfb'); if (S.fbAt && Date.now() - S.fbAt > 700) { fb.textContent = ''; S.fbAt = 0; }
  }
  function svFb(q) { var S = svS, fb = $('svui').querySelector('.svfb'); if (!fb) return; fb.textContent = q === 2 ? 'PERFECT!' : q ? 'GOOD' : 'MISS'; fb.className = 'svfb q' + q; fb.classList.remove('pop'); void fb.offsetWidth; fb.classList.add('pop'); S.fbAt = Date.now(); var t = { 2: 0, 1: 0, 0: 0 }; Object.keys(S.q).forEach(function (i) { t[S.q[i]]++; }); var me = $('svui').querySelector('.svme'); if (me) me.textContent = 'Perfect ' + t[2] + ' · Good ' + t[1] + ' · Miss ' + t[0]; }   // (the tally right away)
  function svTap(d) {
    var S = svS, z = state && state.sv; if (!S || !z || !S.t0 || (z.st !== 'play' && S.st !== 'play') || !S.chart) return;   // (with a stream delay my song can still be going while the big screen is done)
    var now = Date.now(), b = (now - S.t0) / S.bt, best = -1, bd = 9;
    S.chart.forEach(function (n, i) { if (S.done[i] || n[1] !== d || !svMine(n)) return; var x = Math.abs(n[0] - b); if (x < bd) { bd = x; best = i; } });   // (the nearest open arrow in this column)
    var any = -1, ad = 9; S.chart.forEach(function (n, i) { if (S.done[i] || !svMine(n)) return; var x = Math.abs(n[0] - b); if (x < ad) { ad = x; any = i; } });
    var i = best >= 0 && bd < .4 ? best : any >= 0 && ad < .3 ? any : -1; if (i < 0) return;   // (nothing near: no harm done)
    var n = S.chart[i], dt = (b - n[0]) * S.bt, q = n[1] !== d ? 0 : Math.abs(dt) < 110 ? 2 : Math.abs(dt) < 230 ? 1 : 0; S.done[i] = 1; S.q[i] = q;   // (kept on the phone, sent at the end)
    var rec = $('svui').querySelector('.svrec.c' + d); if (rec) { rec.classList.remove('flash', 'f0', 'f1', 'f2'); void rec.offsetWidth; rec.classList.add('flash', 'f' + q); }
    svFb(q);
    try { navigator.vibrate && navigator.vibrate(q === 2 ? 25 : 12); } catch (x) {}
  }

  function zgStop() { if (zgS) { cancelAnimationFrame(zgS.raf); zgS.raf = 0; } }
  function zgTell(o) { var z = state && state.zg; if (!net || !z) return; o.pid = pid; o.id = z.id; (net.toHost || net.send)('zg', o); }
  function zgAcc() { return zgS && zgS.tot > 0 ? Math.round(100 * zgS.inT / zgS.tot) : 100; }
  function zgFrame() {
    var S = zgS, z = state && state.zg; if (!S || !z || z.id !== S.id) return;
    S.raf = requestAnimationFrame(zgFrame);
    if (S.fell || z.st !== 'play') return;
    var now = Date.now(), t = (now - S.start) / 1000, dt = Math.min(0.1, (now - (S.last || now)) / 1000); S.last = now;
    if (t >= ZG_LEN) return;
    var st = zgStage(t), w = zgW(t), tg = zgPath(S.seed, t), err = S.f - tg, brk = zgBreak(t), pre = t < ZG_GO, inside = pre || brk >= 0 || Math.abs(err) <= w;   // (before she starts singing: no control yet, nothing counts)   // (a break: relax, nothing counts)
    if (t > ZG_GO + 1.5 && brk < 0) { S.tot += dt; if (inside) S.inT += dt; }
    S.outFor = inside ? 0 : S.outFor + dt;
    var fall = ZG_FALL[st] || 1, lv = inside ? 0 : S.outFor < fall * 0.5 ? 1 : 2;   // (off the zone: 2 seconds to get back)
    var hit = st > 0 && brk < 0 && t > ZG_GO + 3 && zgHit(S.seed, t, S.f, S.y);   // (stages 2 and 3: an asteroid knocks you off)
    if (hit || (t > ZG_GO + 3 && S.outFor >= fall)) {   // you fall
      S.fell = true; S.hit = hit; zgTell({ out: Math.round(t * 10) / 10, acc: zgAcc(), hit: hit ? 1 : 0 }); if (hit) try { var bx = S.boom || new Audio('sounds/explosion.mp3?v=1'); bx.muted = false; bx.volume = .9; bx.currentTime = 0; var bp = bx.play(); if (bp && bp.catch) bp.catch(function () {}); } catch (e) {} try { navigator.vibrate && navigator.vibrate([80, 40, 200]); } catch (e) {}
      zgView(state); return;
    }
    if (lv !== S.sent && now - S.sentAt >= 250) { S.sent = lv; S.sentAt = now; zgTell({ l: lv, s: err < 0 ? -1 : 1 }); if (lv === 2) try { navigator.vibrate && navigator.vibrate(30); } catch (e) {} }
    // draw: the zone, your finger, the clock
    var B = S.box; if (!B) return;
    B.zone.style.left = ((tg - w + 1) / 2 * 100).toFixed(2) + '%'; B.zone.style.width = (w * 100).toFixed(2) + '%';
    B.me.style.left = ((S.f + 1) / 2 * 100).toFixed(2) + '%'; B.me.style.top = (S.y * 100).toFixed(2) + '%'; if (B.xh) { B.xh.style.top = B.me.style.top; B.xv.style.left = B.me.style.left; }   // (the crosshair: where you are, across the whole field)
    var warn = zgRockDraw(B, S.seed, t);
    B.track.setAttribute('data-l', lv); B.track.classList.toggle('brk', brk >= 0); B.track.classList.toggle('pre', pre);
    var sec = Math.max(0, Math.ceil(zgNext(t) - t)), txt = pre ? (t >= ZG_GO - 3 ? '🎤 ' + Math.ceil(ZG_GO - t) + '…' : '🎤 Get ready… you take over when she starts singing') : brk >= 0 ? '☕ Break time! Relax your fingers… ' + Math.ceil(ZG_BRK[brk][1] - t) + 's' + (brk === 0 ? ' · Next: asteroids! ☄️' : '') : warn && inside ? '☄️ Asteroids! Slide up or down to the gap!' : !inside && t > 3 ? '⚠️ Back to the zone! ' + Math.max(0, fall - S.outFor).toFixed(1) + 's' : 'Stage ' + (st + 1) + ' of 3 · ' + sec + 's';
    if (B.info.textContent !== txt) B.info.textContent = txt;
  }
  // The asteroids on the phone: a warning at the edge they come from (red where the rocks will be, the gap stays dark),
  // then the rocks themselves flying across. A small pool of elements, reused every frame.
  function zgRockDraw(B, seed, t) {
    var L = zgRocks(seed), ri = 0, wi = 0, warn = false;
    for (var i = 0; i < L.length; i++) {
      var w = L[i]; if (t < w.t0 - (w.warn || ZG_WARN) || t > w.t0 + w.dur || zgBreak(t) >= 0) continue;
      if (t < w.t0) {   // the warning
        warn = true; var e = B.warns[wi++]; if (!e) continue;
        e.className = 'zgwarn ' + (w.dir > 0 ? 'l' : 'r'); e.style.display = '';
        var a = Math.max(0, w.gy - w.gap / 2) * 100, b = Math.min(1, w.gy + w.gap / 2) * 100;
        e.style.background = 'linear-gradient(180deg,rgba(255,60,60,.85) 0 ' + a.toFixed(1) + '%,transparent ' + a.toFixed(1) + '% ' + b.toFixed(1) + '%,rgba(255,60,60,.85) ' + b.toFixed(1) + '%)';
        continue;
      }
      var ax = zgWaveX(w, t); if (ax == null) continue; if (t < w.t0 + w.dur * .5) warn = true;
      w.rocks.forEach(function (k, j) { var r = B.rocks[ri++]; if (!r) return; r.style.display = ''; r.style.left = ((ax + 1) / 2 * 100 - k.r * 100).toFixed(2) + '%'; r.style.top = ((k.y - k.r) * 100).toFixed(2) + '%'; r.style.width = r.style.height = (k.r * 200).toFixed(2) + '%'; r.style.rotate = ((t * 90 * w.dir + j * 70) % 360).toFixed(1) + 'deg'; });
    }
    for (; ri < B.rocks.length; ri++) B.rocks[ri].style.display = 'none';
    for (; wi < B.warns.length; wi++) B.warns[wi].style.display = 'none';
    return warn;
  }
  function zgView(s) {
    var z = s.zg, box = $('zgui'), mine = z.order.indexOf(pid) >= 0;
    if (z.len) ZG_LEN = z.len;   // (as long as the song)
    show('v-wait');
    if (!zgS || zgS.id !== z.id) { zgStop(); zgS = { id: z.id, seed: z.seed, start: 0, f: 0, y: 0.5, hit: false, inT: 0, tot: 0, outFor: 0, sent: 0, sentAt: 0, fell: false, fin: false, raf: 0, box: null }; }
    var S = zgS, fell = S.fell || (z.out || {})[pid] != null;
    if (z.st === 'play' && z.el != null) { var st0 = Date.now() - z.el + SV_STREAM;   /* (with the stream delay on: in step with the song as it comes through) */ if (!S.start || st0 < S.start) S.start = st0; }   /* (the earliest estimate: least network delay) */
    if (z.st === 'end') {
      zgStop(); box.classList.add('hidden');
      if (mine && !S.fin && !fell) { S.fin = true; zgTell({ acc: zgAcc() }); }
      var w = (z.win || []).indexOf(pid) >= 0, names = (z.win || []).map(function (k) { var p = s.players.filter(function (x) { return x.pid === k; })[0]; return p ? p.name : ''; }).filter(Boolean);
      $('waittitle').textContent = !z.done ? '🌌 And… stop!' : w ? '🏆 You win Zero Gravity!' : names.length ? '🏆 ' + names.join(' & ') + (names.length > 1 ? ' win!' : ' wins!') : 'Everyone fell into space…';
      $('waitsub').textContent = mine ? 'You followed the zone ' + zgAcc() + '% of the time' + (fell ? ' (until you fell)' : ', and you’re still standing!') : '';
      return;
    }
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🌌 Zero Gravity'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (fell) { zgStop(); box.classList.add('hidden'); $('waittitle').textContent = S.hit ? '☄️ Hit by an asteroid! You fell into space!' : '🚀 You fell into space!'; $('waitsub').textContent = 'You followed the zone ' + zgAcc() + '% of the time. Watch the others wobble…'; return; }
    if (z.st === 'intro') { box.classList.add('hidden'); $('waittitle').textContent = '🌌 Zero Gravity'; $('waitsub').textContent = 'Listen to the astronauts on the big screen… 👩‍🚀'; return; }
    $('waittitle').textContent = z.st === 'ready' ? '🌌 Get ready…' : '🌌 Keep your balance!';
    $('waitsub').textContent = (z.stage || 0) > 0 ? 'Stay in the glowing zone, and slide up or down to dodge the asteroids! ☄️' : 'Keep your finger on the glowing zone: it moves with the music. Stay in the zone, or you fall!';
    box.classList.remove('hidden');
    if (box.getAttribute('data-id') !== z.id || !S.box) {
      box.setAttribute('data-id', z.id);
      box.innerHTML = '<div class="zginfo">Stage 1 of 3</div><div class="zgtrack" data-l="0"><span class="zgzone"></span><i class="zgrock"></i><i class="zgrock"></i><i class="zgrock"></i><i class="zgrock"></i><i class="zgrock"></i><i class="zgrock"></i><i class="zgwarn"></i><i class="zgwarn"></i><i class="zgxh"></i><i class="zgxv"></i><span class="zgme"></span></div><div class="zghint">👆 Slide left and right to stay in the zone · from stage 2 also up and down to dodge the asteroids ☄️</div>';
      var tr = box.querySelector('.zgtrack');
      S.box = { track: tr, zone: tr.querySelector('.zgzone'), me: tr.querySelector('.zgme'), info: box.querySelector('.zginfo'), xh: tr.querySelector('.zgxh'), xv: tr.querySelector('.zgxv'), rocks: [].slice.call(tr.querySelectorAll('.zgrock')), warns: [].slice.call(tr.querySelectorAll('.zgwarn')) };
      S.box.rocks.concat(S.box.warns).forEach(function (e) { e.style.display = 'none'; });
      var mv = function (e) { e.preventDefault(); if ((Date.now() - S.start) / 1000 < ZG_GO) return; var r = tr.getBoundingClientRect(); S.f = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)); S.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); };
      tr.addEventListener('pointerdown', function (e) { try { tr.setPointerCapture(e.pointerId); } catch (x) {} mv(e);
        if (!S.boom) try { S.boom = new Audio('sounds/explosion.mp3?v=1'); S.boom.muted = true; var up = S.boom.play(); if (up && up.then) up.then(function () { S.boom.pause(); S.boom.currentTime = 0; S.boom.muted = false; }, function () {}); } catch (x) {}   /* (unlocked by this touch: phones only play sounds that a tap started) */ });
      tr.addEventListener('pointermove', function (e) { if (e.buttons || e.pointerType === 'touch') mv(e); });
      tr.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      S.box.zone.style.left = ((zgPath(S.seed, 0) - zgW(0) + 1) / 2 * 100) + '%'; S.box.zone.style.width = (zgW(0) * 100) + '%'; S.box.me.style.left = '50%'; S.box.me.style.top = '50%';
    }
    if (z.st === 'play' && !S.raf) { S.last = Date.now(); S.raf = requestAnimationFrame(zgFrame); }
  }

  // ---------- We Will Rule the World ----------
  // A cross-shaped D-pad: tap a direction and you keep dancing that way, hop after hop, until you tap another one
  // (tap the same one again to stand still).
  // The chosen arrow glows. Stunned: the pad turns grey, 3-2-1 in the middle; you can still pick (or stop) a direction, and off you go when it ends.
  var ruLive = null, ruD = '', ruDT = null, ruStunEnd = 0, ruStunT = null;
  function ruSendD() { var r = state && state.rule; if (!net || !r || r.st !== 'play') return; (net.toHost || net.send)('rule', { pid: pid, id: r.id, d: ruD }); }
  function ruSet(d) { if (d === ruD) return; ruD = d; ruSendD(); clearInterval(ruDT); }   // (only when the direction changes or you let go: nothing is sent while you just hold it)
  function ruOnLive(m) { var r = state && state.rule; if (!m || !m.cnt || !r || m.id !== r.id) return; ruLive = m; m.at = Date.now(); if ((m.stun || {})[pid]) ruStunEnd = Date.now() + m.stun[pid]; ruPad(); }
  setInterval(function () { if (state && state.phase === 'rule' && state.rule) ruPad(); }, 1000);   // (the clock and the count on the phone stay fresh between updates)
  function ruPad() {
    var box = $('ruui'), r = state && state.rule; if (!box || !r) return;
    var src = ruLive && ruLive.id === r.id ? ruLive : r, n = (src.cnt || {})[pid] || 0;
    var c = box.querySelector('.rucnt b'); if (c) c.textContent = n;
    var tm = box.querySelector('.rucnt i'); if (tm && src.left != null) { var s = Math.max(0, Math.ceil((src.left - (src.at ? Date.now() - src.at : 0)) / 1000));   /* (the clock runs on by itself between updates) */ tm.textContent = Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
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
    if (r.vote) {   // first the vote: which act (and song) do we dance to?
      var my = (r.vote.votes || {})[pid];
      $('waittitle').textContent = r.vote.on ? '🗳️ Which song do we dance to?' : '🎶 ' + (r.vote.won ? 'Discoteque' : 'We Will Rule the World') + '!'; $('waitsub').textContent = r.vote.on ? (my != null ? 'Vote sent! You can still change your mind. ⏱️ ' + Math.ceil((r.vote.left || 0) / 1000) + 's' : 'Tap your favourite act.') : 'Get ready to dance…';
      if (!mine || !r.vote.on) { box.classList.add('hidden'); return; }
      box.classList.remove('hidden');
      if (box.getAttribute('data-id') !== r.id + 'v') {
        box.setAttribute('data-id', r.id + 'v');
        box.innerHTML = '<div class="ruvote2"><button type="button" class="ruvb a0" data-v="0"><b>✨🪩</b>We Will Rule the World<small>the singer in silver</small></button><button type="button" class="ruvb a1" data-v="1"><b>💛🤖</b>Discoteque<small>the act in yellow</small></button></div>';
        [].forEach.call(box.querySelectorAll('.ruvb'), function (b) { b.onclick = function () { var v = +b.getAttribute('data-v'); [].forEach.call(box.querySelectorAll('.ruvb'), function (x) { x.classList.toggle('on', x === b); }); if (net) (net.toHost || net.send)('rule', { pid: pid, id: r.id, vote: v }); }; });
      }
      [].forEach.call(box.querySelectorAll('.ruvb'), function (x) { x.classList.toggle('on', my != null && +x.getAttribute('data-v') === my); });
      return;
    }
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🪩 We Will Rule the World'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    var col = (r.cols || {})[pid] || '#888';
    var rLeft = Math.max((r.fast || {})[pid] || 0, (r.frz || {})[pid] || 0); clearTimeout(ruView._t); if (rLeft) ruView._t = setTimeout(function () { var st0 = state; if (st0 && st0.rule) { if (st0.rule.fast) delete st0.rule.fast[pid]; if (st0.rule.frz) delete st0.rule.frz[pid]; ruView(st0); } }, rLeft + 100);   // (back to normal when it wears off)
    $('waittitle').textContent = r.st === 'play' ? ((r.frz || {})[pid] ? '🧊 Frozen solid!' : (r.fast || {})[pid] ? '⭐ Star power! Triple speed, unstoppable!' : '🪩 Claim the floor!') : r.st === 'rise' ? '✨ Here comes the star…' : '🪩 Get ready…'; $('waitsub').textContent = 'Tap an arrow and you keep dancing that way. Tap it again to stop. Close a loop of your tiles: everything inside is yours!';
    box.classList.remove('hidden'); box.style.setProperty('--c', col);
    var frzMs = r.st === 'play' ? (r.frz || {})[pid] || 0 : 0; box.classList.toggle('frz', !!frzMs); document.body.classList.toggle('rufrozen', !!frzMs);   // (frozen: the whole phone turns to ice, with a countdown)
    clearInterval(ruView._ft); if (frzMs) { var fEnd = Date.now() + frzMs, fTick = function () { var sec = Math.max(0, Math.ceil((fEnd - Date.now()) / 1000)), fe = box.querySelector('.rufrz'); if (fe) fe.innerHTML = '🧊<b>FROZEN!</b><span>' + sec + '</span>'; if (!sec) { clearInterval(ruView._ft); box.classList.remove('frz'); document.body.classList.remove('rufrozen'); } }; setTimeout(fTick, 0); ruView._ft = setInterval(fTick, 250); }
    if (box.getAttribute('data-id') !== r.id) {
      box.setAttribute('data-id', r.id); ruD = ''; clearInterval(ruDT); ruStunEnd = 0;
      box.innerHTML = '<div class="rupad"><button type="button" class="rub u" data-d="u">▲</button><button type="button" class="rub l" data-d="l">◀</button><span class="ruc"></span><button type="button" class="rub r" data-d="r">▶</button><button type="button" class="rub d" data-d="d">▼</button></div><div class="rufrz"></div>';
      [].forEach.call(box.querySelectorAll('.rub'), function (b) {
        var d = b.getAttribute('data-d');
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); var stop = ruD === d; [].forEach.call(box.querySelectorAll('.rub'), function (x) { x.classList.toggle('on', !stop && x === b); }); b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap'); ruSet(stop ? '' : d); try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} });
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      });
    }
    ruPad();
  }

  // ---------- Sja-la-lie Sja-la-Mayhem! ----------
  // Your station's repair job: turn the crank (SPEED), slide the pipes into the dashed lines (PITCH), or unplug the wrong
  // cables and plug them into the socket of their own colour (SOUND EFFECTS). Each phone gets its own puzzle.
  var orKey = '', orD = 0, orSentD = 0, orPz = null, OR_COLS = ['#e53950', '#2f80ed', '#f2c12e', '#27ae60', '#9b51e0', '#ff8a2a'];
  var OR_HELP = { speed: 'The gears are jammed! Turn the brass crank: drag the handle round and round.', pitch: 'The pipes slipped out of place! Slide each pipe until its top sits in the dashed band.', fx: 'Some wires came loose! Drag each loose plug to the socket of its own colour.', fire: 'The organ is on fire! Tap the flames with your extinguisher until they are all out!', sec: 'Stage invaders! Tap them to throw them off the stage before they reach the singer!' };
  var OR_TITLE = { speed: '⚙️ Gearbox', pitch: '🎺 Organ pipes', fx: '🔌 Wiring', fire: '🔥 Fire', sec: '🛡️ Security' };
  function orReport(o) { var g = state && state.organ; if (!net || !g || g.st !== 'fix') return; net.send('organ', { pid: pid, id: g.id, ph: g.ph, bn: (g.bn || {})[g.sta[pid]] || 0, d: orD }); orSentD = orD; }
  function orStep(d) { if (d <= orD) return; orD = d; try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} Music.plop(d); orReport(); var c = $('orui').querySelector('.orcount'); if (c) c.textContent = orD + ' / ' + orPz.of; if (orD >= orPz.of) setTimeout(function () { if (state) orView(state); }, 400); }
  function orView(s) {
    var g = s.organ, box = $('orui'), sta = g.sta[pid], mine = g.order.indexOf(pid) >= 0;
    show('v-wait');
    if (!mine) { box.classList.add('hidden'); $('waittitle').textContent = '🎡 Sja-la-lie Sja-la-Mayhem!'; $('waitsub').textContent = 'Watch the big screen!'; return; }
    if (g.st === 'intro') { box.classList.add('hidden'); $('waittitle').textContent = '🎡 Get your tools ready…'; $('waitsub').textContent = ''; return; }
    if (g.st === 'end') {
      box.classList.add('hidden'); var w = (g.win || []).indexOf(pid) >= 0;
      $('waittitle').textContent = w ? '🏆 Best mechanic!' : '🎡 The organ is saved!'; $('waitsub').textContent = 'Your repair points: ' + ((g.pts || {})[pid] || 0); return;
    }
    if (g.st === 'fixed') { box.classList.add('hidden'); $('waittitle').textContent = '🎶 Keep going!'; $('waitsub').textContent = g.ph < 3 ? 'Next phase coming up… 🔧' : ''; return; }
    var key = g.id + '|' + g.ph + '|' + ((g.bn || {})[sta] || 0);   /* (each breakdown: a fresh task) */
    if (orKey !== key) { orKey = key; orD = 0; orSentD = 0; orPz = orMake(sta, g.ph); box.removeAttribute('data-k'); }
    if (g.st === 'brief' || (g.st === 'fix' && !(g.open || {})[sta])) { box.classList.add('hidden'); $('waittitle').textContent = '👀 Keep an eye on: ' + OR_TITLE[sta]; $('waitsub').textContent = 'All good for now… If it breaks down, fix it here as fast as you can! (' + OR_HELP[sta] + ')'; return; }
    var pr = (g.prog || {})[pid]; if (pr && pr[0] < orD && orD > 0) orReport();   /* (the host missed a step: send it again) */
    if (orD >= orPz.of) { box.classList.add('hidden'); $('waittitle').textContent = '✅ ' + OR_TITLE[sta] + ' fixed!'; $('waitsub').textContent = 'Great job! Now cheer on the others… 🔧'; return; }
    $('waittitle').textContent = '⚠️ ' + OR_TITLE[sta] + ' broke down!'; $('waitsub').textContent = OR_HELP[sta];
    box.classList.remove('hidden');
    if (box.getAttribute('data-k') === key) return;
    box.setAttribute('data-k', key);
    box.innerHTML = '<div class="orcount">0 / ' + orPz.of + '</div><div class="orpz"></div>';
    var pz = box.querySelector('.orpz');
    if (sta === 'speed') orSpeed(pz); else if (sta === 'pitch') orPitch(pz); else if (sta === 'fire') orFireUI(pz); else if (sta === 'sec') orSecUI(pz); else orFx(pz);
  }
  function orMake(sta, ph) {
    var of = { speed: [3, 5, 10], pitch: [3, 4, 7], fx: [1, 2, 4], fire: [3, 5, 7], sec: [3, 5, 7] }[sta][ph - 1];
    if (sta === 'pitch') { var tol = [7, 5, 3.5][ph - 1], pipes = []; for (var i = 0; i < of; i++) { var t = 25 + Math.random() * 55, h; do { h = 12 + Math.random() * 80; } while (Math.abs(h - t) < tol * 2 + 8); pipes.push({ t: t, h: h, ok: false }); } return { of: of, tol: tol, pipes: pipes }; }
    if (sta === 'fx') {
      var m = of + 2, cab = []; for (var c = 0; c < m; c++) cab.push({ col: c, at: -1 });
      var socks = shuffle(cab.map(function (x) { return x.col; }).concat([-1]));   // the sockets (−1: the grey spare)
      var wrong = shuffle(cab.map(function (x, i) { return i; })).slice(0, of);
      cab.forEach(function (x, i) { x.at = socks.indexOf(i); });
      wrong.forEach(function (w) { cab[w].at = -1; });   // (the loose ones are already unplugged: just plug them in)
      return { of: of, cab: cab, socks: socks, base: m - of };
    }
    if (sta === 'sec') { var iv = []; for (var q2 = 0; q2 < of; q2++) iv.push({ y: 10 + (q2 % 4) * 20 + Math.random() * 8, left: Math.random() < .5, d: 4 + Math.random() * 3 - ph * .6, dl: q2 * (1.6 - ph * .3), e: ['🕺', '💃', '🧍', '🙋'][q2 % 4], out: false }); return { of: of, iv: iv }; }   // the invaders: they run in from both sides
    if (sta === 'fire') { var fl = [], taps = [3, 4, 5][ph - 1]; for (var q = 0; q < of; q++) fl.push({ x: 12 + Math.random() * 76, y: 18 + Math.random() * 64, hp: taps, max: taps }); return { of: of, fl: fl }; }   // the flames: a few taps each
    return { of: of };
  }
  function orSecUI(pz) {   // security: tap the invaders before they reach the singer in the middle
    var z = orPz;
    pz.innerHTML = '<div class="orsecpz"><span class="orsecst">🎤</span>' + z.iv.map(function (v, i) { return '<button type="button" class="oriv ' + (v.left ? 'l' : 'r') + '" data-i="' + i + '" style="top:' + v.y + '%;--d:' + v.d.toFixed(1) + 's;--dl:' + v.dl.toFixed(1) + 's">' + v.e + '</button>'; }).join('') + '</div>';
    [].forEach.call(pz.querySelectorAll('.oriv'), function (b) {
      var v = z.iv[+b.getAttribute('data-i')];
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); if (v.out) return; v.out = true; b.classList.add('out'); try { navigator.vibrate && navigator.vibrate(25); } catch (x) {} orStep(z.iv.filter(function (x) { return x.out; }).length); });
      b.addEventListener('animationiteration', function () { if (!v.out) { b.classList.add('reach'); setTimeout(function () { b.classList.remove('reach'); }, 400); } });   /* (got to the singer: back to the side, try again) */
    });
  }
  function orFireUI(pz) {   // put out the fire: tap each flame until it's gone
    var z = orPz;
    pz.innerHTML = '<div class="orfirepz">' + z.fl.map(function (f, i) { return '<button type="button" class="orfl" data-i="' + i + '" style="left:' + f.x + '%;top:' + f.y + '%"><span>🔥</span></button>'; }).join('') + '</div>';
    [].forEach.call(pz.querySelectorAll('.orfl'), function (b) {
      var f = z.fl[+b.getAttribute('data-i')];
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); if (f.hp <= 0) return;
        f.hp--; b.style.setProperty('--k', (f.hp / f.max).toFixed(2)); b.classList.remove('spray'); void b.offsetWidth; b.classList.add('spray');
        try { navigator.vibrate && navigator.vibrate(15); } catch (x) {}
        if (f.hp <= 0) { b.classList.add('out'); orStep(z.fl.filter(function (x) { return x.hp <= 0; }).length); }
      });
    });
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
      z.cab.map(function (c, i) { return '<span class="orplug" data-i="' + i + '" style="--c:' + OR_COLS[c.col] + '"></span>'; }).join('') + '</div><p class="orhint">Drag each loose plug to the socket of its own colour.</p>';
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
  var ED_R = [{ id: 'green', name: 'Green Room', icon: '🛋️', max: 2 }, { id: 'club', name: 'Euroclub', icon: '🪩', max: 3 }, { id: 'back', name: 'Backstage', icon: '🔌', max: 2 }, { id: 'boud', name: 'Woodruff’s Boudoir', icon: '👗', max: 2 }];
  var edNotes = false, edCur = '', edGame = '', edSeen = '', edFastSeen = '', edFinal = '', edT = [], edAc = null;
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
    if (edGame !== c.id) { edGame = c.id; edCur = ''; edSeen = ''; edNotes = false; edClear(); }
    if (!me || c.st === 'brief') { box.classList.add('hidden'); $('clueui').classList.add('hidden'); $('waittitle').textContent = c.st === 'brief' ? '🔍 Listen closely…' : '🔍 Searching the building…'; $('waitsub').textContent = c.st === 'brief' ? 'The hosts explain the four rooms. Get ready!' : 'Watch the big screen!'; return; }
    if (edCur || edNotes) return;   // (a room task is running, or the notes are open: they draw themselves)
    var dq = c.duoQ;
    if (dq && dq.pid === pid && dq.st === 'ask') {   // first through all four rooms: a question about the two stars, for a bonus clue
      $('clueui').classList.add('hidden'); box.classList.remove('hidden');
      $('waittitle').textContent = '🏃 First through all four rooms!'; $('waitsub').textContent = 'Answer this for a bonus clue (' + Math.ceil(dq.left / 1000) + 's)';
      var kq = 'duo|' + dq.text; if (box.getAttribute('data-k') === kq) return; box.setAttribute('data-k', kq);
      box.innerHTML = '<div class="edduoq"><p>' + esc(dq.text) + '</p>' + dq.opts.map(function (o, i) { return '<button type="button" class="opt eddq" data-i="' + i + '">' + esc(o.charAt(0).toUpperCase() + o.slice(1)) + '</button>'; }).join('') + '</div>';
      [].forEach.call(box.querySelectorAll('.eddq'), function (b) { b.onclick = function () { [].forEach.call(box.querySelectorAll('.eddq'), function (x) { x.disabled = true; }); b.classList.add('picked'); if (net) net.send('clue', { pid: pid, id: c.id, duo: +b.getAttribute('data-i') }); }; });
      return;
    }
    if (dq && dq.pid === pid && dq.st !== 'ask' && edSeen !== 'duo' + dq.st) {   // the answer
      box.classList.remove('hidden'); $('clueui').classList.add('hidden'); box.removeAttribute('data-k');
      $('waittitle').textContent = dq.st === 'right' ? '🎯 Right! A bonus clue' : '❌ Not quite…'; $('waitsub').textContent = dq.st === 'right' ? '' : 'It was ' + (dq.opts[dq.ans] || '?') + '. No bonus clue this time.';
      if (dq.st === 'right' && dq.got.length) clueNotes({ clue: { id: c.id, n: 'duo', known: c.known, fresh: (function () { var o = {}; o[pid] = dq.got; return o; })() } });
      box.innerHTML = '<button type="button" class="btn big ednext2">OK</button>';
      box.querySelector('.ednext2').onclick = function () { edSeen = 'duo' + dq.st; box.innerHTML = ''; edView(state); };
      return;
    }
    var last = (c.last || {})[pid], fst = c.fast;
    if (edFinal === c.id && me.done.length >= 4 && !(fst && fst.pid === pid && edFastSeen !== c.id)) { box.classList.add('hidden'); $('clueui').classList.remove('hidden'); var ob0 = $('clueui').querySelector('.ednext'); if (ob0) ob0.remove(); return; }   // (all rooms searched: the screen stays on your clues, no button)
    if (last && edSeen !== last.k && !(me.done.length >= 4 && fst && fst.pid === pid && edFastSeen !== c.id)) {   // just finished a room: the new clues
      box.classList.add('hidden');
      var fresh = last.c.concat(last.b);
      clueNotes({ clue: { id: c.id, n: last.k, known: c.known, fresh: (function () { var o = {}; o[pid] = fresh; return o; })() } });
      $('waittitle').textContent = fresh.length ? '🔍 ' + fresh.length + ' new clue' + (fresh.length > 1 ? 's' : '') + '!' + (last.b.length ? ' (' + last.b.length + ' bonus!)' : '') : '🔍 No clues this time…';
      if (me.done.length >= 4) { edFinal = c.id; var ob1 = $('clueui').querySelector('.ednext'); if (ob1) ob1.remove(); $('waitsub').textContent = '✅ All four rooms searched! Study your clues… the accusation comes next.'; return; }   // (the last room: no button, the clues stay on screen)
      var nb = $('clueui'), lbl = '🚪 Next room', ob = nb.querySelector('.ednext'); if (ob && ob.textContent !== lbl) { ob.remove(); ob = null; } if (!ob) nb.insertAdjacentHTML('beforeend', '<button type="button" class="btn big ednext">' + lbl + '</button>');
      nb.querySelector('.ednext').onclick = function () { edSeen = last.k; $('clueui').classList.add('hidden'); edView(state); };
      return;
    }
    if (fst && fst.pid === pid && edFastSeen !== c.id) {   // the fastest detective: extra clues at the reception
      $('clueui').classList.add('hidden'); box.classList.remove('hidden');
      $('waittitle').textContent = '🏆 You were the fastest detective!'; $('waitsub').textContent = 'Teya & Salena at the reception have extra clues for you… 🛎️';
      if (box.getAttribute('data-k') !== 'fast') {
        box.setAttribute('data-k', 'fast'); box.innerHTML = '';
        setTimeout(function () {   // (no button: after the message, the extra clues simply appear)
          if (box.getAttribute('data-k') !== 'fast' || edFastSeen === c.id) return;
          box.innerHTML = ''; box.removeAttribute('data-k'); box.classList.add('hidden'); edNotes = true;   // (the notes stay open until OK: state updates don't redraw this)
          if (fst.got && fst.got.length) clueNotes({ clue: { id: c.id, n: 'fast', known: c.known, fresh: (function () { var o = {}; o[pid] = fst.got; return o; })() } });
          $('waittitle').textContent = fst.got && fst.got.length ? '🗝️ ' + fst.got.length + ' extra clue' + (fst.got.length > 1 ? 's' : '') + '!' : '🗝️ No new clues left to give…'; $('waitsub').textContent = '';
          var nb = $('clueui'), ob = nb.querySelector('.ednext'); if (ob) ob.remove(); nb.classList.remove('hidden');
          edFastSeen = c.id; edFinal = c.id;   // (no OK button: the screen stays on the clues)
        }, 3000);
      }
      return;
    }
    $('clueui').classList.add('hidden');
    if (me.done.length >= 4) { box.classList.add('hidden'); $('waittitle').textContent = '✅ All four rooms searched!'; $('waitsub').textContent = 'Wait for the others… then make your accusation.'; return; }
    $('waittitle').textContent = '🚪 Pick a room'; $('waitsub').textContent = 'Every room only once. Time left: ' + Math.ceil((c.left || 0) / 1000) + 's';
    box.classList.remove('hidden');
    var key = 'pick|' + me.done.join(',');
    if (box.getAttribute('data-k') === key) return; box.setAttribute('data-k', key);
    box.innerHTML = '<button type="button" class="btn alt small ednotes">📋 My notes</button><div class="eddoors">' + ED_R.map(function (r) { var d = me.done.indexOf(r.id) >= 0; return '<button type="button" class="eddoor' + (d ? ' done' : '') + '" data-r="' + r.id + '"' + (d ? ' disabled' : '') + '><span>' + r.icon + '</span><b>' + r.name + '</b><small>' + (d ? '✔ ' + (me.score[r.id] || 0) + ' clue' + ((me.score[r.id] || 0) === 1 ? '' : 's') : 'up to ' + r.max + ' clues') + '</small></button>'; }).join('') + '</div>';
    box.querySelector('.ednotes').onclick = function () {   // all the cards, with the ones your clues ruled out crossed off
      edNotes = true; box.classList.add('hidden'); clueNotes({ clue: { id: c.id, n: 'mine', known: c.known, fresh: {} } });
      $('waittitle').textContent = '📋 My notes'; $('waitsub').textContent = 'Crossed out = ruled out by your clues.';
      var nb = $('clueui'); if (!nb.querySelector('.ednext')) nb.insertAdjacentHTML('beforeend', '<button type="button" class="btn big ednext">🚪 Back to the rooms</button>');
      nb.querySelector('.ednext').onclick = function () { edNotes = false; $('clueui').classList.add('hidden'); box.removeAttribute('data-k'); edView(state); };
    };
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
    var sc = state && state.clue && state.clue.scene; box._score = null;
    if (!sc) { edFinish(room, 0); return; }
    edQuiz(box, room, sc[room]);
  }
  // Every room: three questions about what's in that room on the big screen. The first is a little job (type the code,
  // copy the light floor, set the fuses, hang the dresses in order); then two picked from a few questions.
  var ED_NAME = { red: 'red', blue: 'blue', yellow: 'yellow', green: 'green', purple: 'purple', orange: 'orange', pink: 'pink', black: 'black', blonde: 'blonde', brown: 'brown', teal: 'turquoise', white: 'white', gold: 'gold' };
  var ED_HEX = { red: '#e53950', blue: '#2f80ed', yellow: '#f2c12e', green: '#27ae60', purple: '#9b51e0', orange: '#f2994a', pink: '#ff6fb5', black: '#26262e', blonde: '#f0d070', brown: '#7a4a2a', teal: '#1fc8c8', white: '#f4f4f8', gold: '#d9a520' };
  var ED_ORD = ['1st', '2nd', '3rd', '4th', '5th'];
  function edNums(ans, lo, hi) { var o = [ans], n = 0; while (o.length < 4 && n++ < 200) { var x = ans + [-2, -1, 1, 2, 3, -3][Math.floor(Math.random() * 6)]; if (x >= lo && x <= hi && o.indexOf(x) < 0) o.push(x); } return shuffle(o).map(String); }
  function edPickOpts(ans, pool) { var o = [ans]; shuffle(pool.slice()).forEach(function (x) { if (o.length < 4 && o.indexOf(x) < 0) o.push(x); }); return shuffle(o); }
  var ED_COLS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'pink', 'black', 'teal', 'white'];
  function edQs(room, s) {
    var mc = [];
    if (room === 'green') {
      var tm = function (h, m) { return h + ':' + (m < 10 ? '0' : '') + m; }, t0 = tm(s.clock[0], s.clock[1]), sit = pick(s.sitters);
      mc = [
        { q: 'How many cans are on top of the fridge?', a: String(s.cans.length), o: edNums(s.cans.length, 1, 9) },
        { q: 'What time does the clock say?', a: t0, o: edPickOpts(t0, [tm(s.clock[0] % 12 + 1, s.clock[1]), tm(s.clock[0], (s.clock[1] + 15) % 60), tm((s.clock[0] + 5) % 12 + 1, s.clock[1]), tm(s.clock[1] / 5 || 12, s.clock[0] * 5 % 60)]) },
        { q: 'How many slices of pizza are left?', a: String(s.pizza), o: edNums(s.pizza, 1, 8) },
        { q: 'How many gold records hang on the wall?', a: String(s.records), o: edNums(s.records, 1, 6) }
      ];
      return [{ t: 'code', q: 'Edgar’s suitcase is locked! Type the code from the sticky note on the mirror.', a: s.code }, { q: 'Where does the guest with the ' + ED_NAME[sit.hair] + ' hair sit down? (They only sit down now and then: keep watching!)', a: s.seats[sit.seat], o: edPickOpts(s.seats[sit.seat], s.seats), col: 1 }].concat(shuffle(mc).slice(0, 1));
    }
    if (room === 'club') {
      var n = Math.floor(Math.random() * 5);
      mc = [
        { q: 'How many disco balls hang from the ceiling?', a: String(s.balls), o: edNums(s.balls, 1, 7) },
        { q: 'Which song is number ' + (n + 1) + ' on the setlist?', a: s.setlist[n], o: edPickOpts(s.setlist[n], s.setlist) },
        { q: 'What does the neon sign say?', a: s.neon, o: edPickOpts(s.neon, ['DOUZE', 'PARTY', 'ENCORE', 'DANCE', 'GLAM', 'LOVE']) },
        { q: 'How many dancers (in colour) are on the dance floor? (Not in the DJ booth)', a: String(s.dancers), o: edNums(s.dancers, 1, 7) },
        { q: 'What colour is DJ Ohrmeister’s jacket?', a: s.jacket, o: edPickOpts(s.jacket, ['purple', 'blue', 'green', 'red', 'gold']), col: 1 }
      ];
      return [{ t: 'syms', q: 'Watch the DJ booth: five symbols light up, one after the other. Tap them in that order!', a: s.panel }].concat(shuffle(mc).slice(0, 2));
    }
    if (room === 'back') {
      var k = pick(s.cases), m = Math.floor(Math.random() * 5);
      mc = [
        { q: 'What code is on the ' + k.c + ' flight case?', a: k.code, o: edPickOpts(k.code, s.cases.map(function (x) { return x.code; })) },
        { q: 'How many spotlights hang from the ceiling?', a: String(s.spots), o: edNums(s.spots, 1, 9) },
        { q: 'Who is ' + ED_ORD[m] + ' in the running order?', a: s.order[m], o: edPickOpts(s.order[m], s.order) },
        { q: 'How many guitars are there?', a: String(s.guitars), o: edNums(s.guitars, 1, 5) }
      ];
      return [{ t: 'plug', q: 'Plug every cable into the same socket as on the big screen!', a: s }].concat(shuffle(mc).slice(0, 2));
    }
    var d = pick(s.rack), w = Math.floor(Math.random() * 4);
    mc = [
      { q: 'What does the ' + d.c + ' dress on the rack cost?', a: '€' + d.p, o: edPickOpts('€' + d.p, s.rack.map(function (x) { return '€' + x.p; })) },
      { q: 'What colour is the ' + ED_ORD[w] + ' wig from the left?', a: s.wigs[w], o: edPickOpts(s.wigs[w], s.wigs), col: 1 },
      { q: 'What is written in lipstick on the mirror?', a: s.word, o: edPickOpts(s.word, ['KISS', 'DIVA', 'FAB', 'WOW', 'GLAM', 'ICON']) },
      { q: 'How many perfume bottles are on the dressing table?', a: String(s.perfume), o: edNums(s.perfume, 1, 8) },
      { q: 'What colour is the woman’s feather boa?', a: s.woman.boa, o: edPickOpts(s.woman.boa, ['pink', 'white', 'teal', 'yellow']), col: 1 }
    ];
    var OUTS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], HAIRS = ['black', 'brown', 'blonde', 'red', 'orange'];
    var ppl = [   // the three guests: one simple question about them
      { q: 'What colour is the dress of the woman with the boa?', a: s.woman.dress, o: edPickOpts(s.woman.dress, OUTS), col: 1 },
      { q: 'What colour is the suit of the man with the glasses?', a: s.man.suit, o: edPickOpts(s.man.suit, OUTS), col: 1 },
      { q: 'What colour is the little girl’s dress?', a: s.child.dress, o: edPickOpts(s.child.dress, OUTS), col: 1 },
      { q: 'What colour is the hair of the woman with the boa?', a: s.woman.hair, o: edPickOpts(s.woman.hair, HAIRS), col: 1 },
      { q: 'What colour is the hair of the man with the glasses?', a: s.man.hair, o: edPickOpts(s.man.hair, HAIRS), col: 1 },
      { q: 'What colour is the little girl’s hair?', a: s.child.hair, o: edPickOpts(s.child.hair, HAIRS), col: 1 }
    ];
    var rtl = Math.random() < .5, rk = s.rack.map(function (x) { return x.c; });   // (always the dresses: left to right, or right to left)
    return [{ t: 'rack', rtl: rtl, q: 'Hang the dresses back on the rack in the same order, from ' + (rtl ? 'RIGHT to LEFT' : 'LEFT to RIGHT') + '!', a: rtl ? rk.slice().reverse() : rk }, mc[2]].concat(shuffle(ppl).slice(0, 1));   // (three puzzles: the dresses, the word on the mirror, and one about the three guests)
  }
  function edMini(p) {   // a small cartoon guest for the phone: hair colour, hair style and top
    var H = ED_HEX[p.hair] || p.hair, T = ED_HEX[p.top] || p.top, K = ' stroke="#2b1830" stroke-width="2.4" stroke-linejoin="round"', h = '';
    if (p.st === 'long') h += '<path d="M10 20 Q1 38 7 51 Q11 47 14 53 Q17 42 15 32 L35 32 Q33 42 36 53 Q39 47 43 51 Q49 38 40 20 Z" fill="' + H + '"' + K + '/>';
    if (p.st === 'pony') h += '<ellipse cx="42" cy="22" rx="5" ry="11" fill="' + H + '"' + K + ' transform="rotate(25 42 22)"/>';
    h += p.dress ? '<path d="M17 44 Q25 41 33 44 L40 70 Q25 74 10 70 Z" fill="' + T + '"' + K + '/>' : '<rect x="14" y="43" width="22" height="27" rx="9" fill="' + T + '"' + K + '/>';
    h += '<circle cx="25" cy="26" r="15" fill="#f6cfb2"' + K + '/>';
    h += p.st === 'curly' ? '<g fill="' + H + '"' + K + '>' + [[13, 18], [20, 12], [29, 12], [37, 18], [11, 26], [39, 26]].map(function (c) { return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="6"/>'; }).join('') + '</g>' : '<path d="M10 26 Q10 10 25 10 Q40 10 40 26 Q34 17 25 18 Q16 17 10 26 Z" fill="' + H + '"' + K + '/>';
    return '<svg viewBox="0 0 50 74" class="edmini">' + h + '<circle cx="20" cy="28" r="2" fill="#2b1830"/><circle cx="30" cy="28" r="2" fill="#2b1830"/></svg>';
  }
  function edQuiz(box, room, s) {
    var R = ED_R.filter(function (r) { return r.id === room; })[0], qs = edQs(room, s), qi = 0, right = 0;
    var score = function () { return qs.length <= R.max ? right : right === 3 ? 2 : right === 2 ? 1 : 0; };   // (one clue per right answer when there are as many questions as clues)
    box._score = score;
    $('waittitle').textContent = R.icon + ' ' + R.name;
    var next = function (ok) {   // a wrong answer locks the room for 10 seconds, then you try the same one again
      if (ok) { right++; qi++; try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} ask(); return; }
      try { navigator.vibrate && navigator.vibrate([60, 40, 160]); } catch (e) {}
      var n = 10, tick = function () {
        if (!edCur) return;
        if (n <= 0) { ask(); return; }
        box.innerHTML = '<div class="edlook">👀 Look at the <b>' + R.icon + ' ' + R.name + '</b> on the big screen · ' + (qi + 1) + ' / ' + qs.length + '</div><div class="edlock"><span>🔒</span><b>Wrong!</b><small>Locked… try again in</small><em>' + n + '</em></div>';
        n--; edLater(tick, 1000);
      };
      tick();
    };
    var ask = function () {
      if (qi >= qs.length) { edFinish(room, score()); return; }
      var q = qs[qi], head = '<div class="edlook">👀 Look at the <b>' + R.icon + ' ' + R.name + '</b> on the big screen · ' + (qi + 1) + ' / ' + qs.length + '</div><div class="edq">' + q.q + '</div>';
      $('waitsub').textContent = '';
      if (q.t === 'code') {
        var got = '';
        var draw = function () {
          box.innerHTML = head + '<div class="edcode">' + [0, 1, 2, 3].map(function (i) { return '<span>' + (got[i] || '') + '</span>'; }).join('') + '</div><div class="edpad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✅'].map(function (k) { return '<button type="button" class="edkey' + (k === '✅' ? ' ok' : '') + '" data-k="' + k + '"' + (k === '✅' && got.length < 4 ? ' disabled' : '') + '>' + k + '</button>'; }).join('') + '</div>';
          [].forEach.call(box.querySelectorAll('.edkey'), function (b) { b.onclick = function () { var k = b.getAttribute('data-k'); if (k === '⌫') got = got.slice(0, -1); else if (k === '✅') { next(got === q.a); return; } else if (got.length < 4) got += k; draw(); }; });
        };
        draw(); return;
      }
      if (q.t === 'syms') {
        var all = shuffle(Object.keys(ED_SYMS2)), got2 = [], sv = function (k) { return '<svg viewBox="0 0 40 40">' + edSym(k, 0, 0, 40) + '</svg>'; };
        var drawS = function () {
          box.innerHTML = head + '<div class="edslots2">' + [0, 1, 2, 3, 4].map(function (i) { return '<span>' + (got2[i] ? sv(got2[i]) : '') + '</span>'; }).join('') + '</div><div class="edsyms2">' + all.map(function (k) { return '<button type="button" class="edsym2" data-k="' + k + '">' + sv(k) + '</button>'; }).join('') + '</div><div class="edrow2"><button type="button" class="btn alt edundo">↩️ Undo</button><button type="button" class="btn eddone"' + (got2.length === 5 ? '' : ' disabled') + '>✅ Done</button></div>';
          [].forEach.call(box.querySelectorAll('.edsym2'), function (b) { b.onclick = function () { if (got2.length < 5) got2.push(b.getAttribute('data-k')); drawS(); }; });
          box.querySelector('.edundo').onclick = function () { got2.pop(); drawS(); };
          box.querySelector('.eddone').onclick = function () { next(got2.join() === q.a.join()); };
        };
        drawS(); return;
      }
      if (q.t === 'plug') {
        var sc2 = q.a, cab = shuffle(sc2.plug.map(function (p) { return p.c; })), plug = {}, sel = '';
        var drawP = function () {
          box.innerHTML = head + '<div class="edcab">' + cab.map(function (c) { return '<button type="button" class="edcb' + (sel === c ? ' sel' : '') + (plug[c] != null ? ' used' : '') + '" data-c="' + c + '"><i style="background:' + ED_HEX[c] + '"></i>' + ED_NAME[c] + '</button>'; }).join('') + '</div><div class="edpanel">' + sc2.socks.map(function (k, i) { var c = Object.keys(plug).filter(function (x) { return plug[x] === i; })[0]; return '<button type="button" class="edsk" data-i="' + i + '"><svg viewBox="0 0 40 40">' + edSock(k, 2, 2, 36) + '</svg><i style="' + (c ? 'background:' + ED_HEX[c] + ';box-shadow:0 0 0 3px #3ddc84' : '') + '"></i></button>'; }).join('') + '</div><button type="button" class="btn big eddone"' + (Object.keys(plug).length === cab.length ? '' : ' disabled') + '>✅ Done</button>';
          [].forEach.call(box.querySelectorAll('.edcb'), function (b) { b.onclick = function () { sel = b.getAttribute('data-c'); drawP(); }; });
          [].forEach.call(box.querySelectorAll('.edsk'), function (b) { b.onclick = function () { var i = +b.getAttribute('data-i'); Object.keys(plug).forEach(function (x) { if (plug[x] === i) delete plug[x]; }); if (sel) { plug[sel] = i; sel = ''; try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} } drawP(); }; });
          box.querySelector('.eddone').onclick = function () { next(sc2.plug.every(function (p) { return plug[p.c] === p.s; })); };
        };
        drawP(); return;
      }
      if (q.t === 'looks') {   // hair and outfit for the three people in the boudoir
        var S3 = q.a, who3 = [{ id: 'woman', n: 'The one with the boa', o: S3.woman.dress, h: S3.woman.hair, st: 'long', dress: 1 }, { id: 'man', n: 'The one with glasses', o: S3.man.suit, h: S3.man.hair, st: 'short' }, { id: 'child', n: 'The little one', o: S3.child.dress, h: S3.child.hair, st: 'curly', dress: 1 }];
        var HAIRS = ['black', 'brown', 'blonde', 'red', 'orange'], OUTS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], ch = {}, three = function (a, all) { return shuffle([a].concat(shuffle(all.filter(function (x) { return x !== a; })).slice(0, 2))); };
        who3.forEach(function (w) { w.ho = three(w.h, HAIRS); w.oo = three(w.o, OUTS); });   // (three choices each: the right one and two others)
        var drawL = function () {
          box.innerHTML = head + '<div class="edlooks">' + who3.map(function (w) { var c = ch[w.id] || {}; return '<div class="edlk"><div class="edlkf">' + edMini({ hair: c.h || '#bbb', top: c.o || '#bbb', st: w.st, dress: w.dress }) + '<small>' + w.n + '</small></div><div class="edlkc"><div>' + w.ho.map(function (x) { return '<button type="button" class="edsw hair' + (c.h === x ? ' on' : '') + '" data-w="' + w.id + '" data-h="' + x + '" style="background:' + ED_HEX[x] + '" aria-label="' + x + ' hair"></button>'; }).join('') + '</div><div>' + w.oo.map(function (x) { return '<button type="button" class="edsw' + (c.o === x ? ' on' : '') + '" data-w="' + w.id + '" data-o="' + x + '" style="background:' + ED_HEX[x] + '" aria-label="' + x + ' outfit"></button>'; }).join('') + '</div></div></div>'; }).join('') + '</div>' +
            '<button type="button" class="btn big eddone"' + (who3.every(function (w) { return ch[w.id] && ch[w.id].h && ch[w.id].o; }) ? '' : ' disabled') + '>✅ Done</button>';
          [].forEach.call(box.querySelectorAll('.edsw'), function (b) { b.onclick = function () { var w = b.getAttribute('data-w'), c = ch[w] = ch[w] || {}; if (b.hasAttribute('data-h')) c.h = b.getAttribute('data-h'); else c.o = b.getAttribute('data-o'); drawL(); }; });
          box.querySelector('.eddone').onclick = function () { next(who3.every(function (w) { return ch[w.id].h === w.h && ch[w.id].o === w.o; })); };
        };
        drawL(); return;
      }
      if (q.t === 'rack') {
        var cols = shuffle(q.a.concat([['red', 'blue', 'yellow', 'green', 'purple', 'black'].filter(function (c) { return q.a.indexOf(c) < 0; })[0]])), seq = [];
        var drawR = function () {
          box.innerHTML = head + '<div class="edrack2">' + [0, 1, 2, 3, 4].map(function (i) { var j = q.rtl ? 4 - i : i; return '<span>' + (seq[j] ? '<i style="background:' + ED_HEX[seq[j]] + '"></i>' : '') + '</span>'; }).join('') + '</div><div class="eddress">' + cols.map(function (c) { return '<button type="button" class="eddr' + (seq.indexOf(c) >= 0 ? ' used' : '') + '" data-c="' + c + '"><i style="background:' + ED_HEX[c] + '"></i>' + ED_NAME[c] + '</button>'; }).join('') + '</div><div class="edrow2"><button type="button" class="btn alt edundo">↩️ Undo</button><button type="button" class="btn eddone"' + (seq.length === 5 ? '' : ' disabled') + '>✅ Done</button></div>';
          [].forEach.call(box.querySelectorAll('.eddr'), function (b) { b.onclick = function () { var c = b.getAttribute('data-c'); if (seq.length < 5 && seq.indexOf(c) < 0) seq.push(c); drawR(); }; });
          box.querySelector('.edundo').onclick = function () { seq.pop(); drawR(); };
          box.querySelector('.eddone').onclick = function () { next(seq.join() === q.a.join()); };
        };
        drawR(); return;
      }
      q.o = shuffle(q.o.slice());   /* (a new order after a wrong answer) */
      box.innerHTML = head + '<div class="edopts">' + q.o.map(function (o) { return '<button type="button" class="edopt" data-o="' + esc(o) + '">' + (q.col ? '<i style="background:' + (ED_HEX[o] || '#888') + '"></i>' + (ED_NAME[o] || o) : esc(o)) + '</button>'; }).join('') + '</div>';
      [].forEach.call(box.querySelectorAll('.edopt'), function (b) { b.onclick = function () { next(b.getAttribute('data-o') === q.a); }; });
    };
    ask();
  }

  // ---------- Hold That Note! ----------
  // Predict how long the note lasts (10 s to 1 min) and lock it in. That's all: then watch her sing.
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
      $('waittitle').textContent = '🎤 How long will the note last?'; $('waitsub').textContent = 'Between 10 seconds and one minute. The closest guess wins, but if her note lasts longer than your guess, you lose!';
      return;
    }
    box.classList.add('hidden');
    if (n.st === 'guess') { cb.classList.add('hidden'); $('waittitle').textContent = '🔒 Locked in: ' + (g != null ? ntTime(g) : ''); $('waitsub').textContent = 'Waiting for the others… then she sings! 🎤 Remember: if her note lasts longer than your guess, you lose.'; return; }
    if (n.st === 'ctl' && false) {
      cb.classList.remove('hidden');
      $('waittitle').textContent = '🎛️ Your prediction: ' + (g != null ? ntTime(g) : '🔒'); $('waitsub').textContent = 'Steer the singer! More power and the boost break it sooner, the fan keeps it going longer.';
      cd(); ntShutT = setInterval(function () { if (!state || !state.note || state.note.st !== 'ctl') { clearInterval(ntShutT); return; } cd(); if (Date.now() - ntCtlAt > 2500) ntSendCtl(); }, 250);   /* (sent again now and then, in case a message got lost) */
      return;
    }
    cb.classList.add('hidden');
    if (n.st === 'ctl') { $('waittitle').textContent = '🎤 Here she goes…'; $('waitsub').textContent = g != null ? 'Your prediction: ' + ntTime(g) + '.' : 'Watch the big screen!'; return; }
    if (n.st === 'sing') { $('waittitle').textContent = '🎶 Hold it… hold it…'; $('waitsub').textContent = g != null ? 'Your prediction: ' + ntTime(g) + '. If she holds it longer than that, you lose!' : 'Watch the big screen!'; return; }
    var gg = n.guess && n.guess[pid] != null ? n.guess[pid] : g;
    var won = n.win && n.win.indexOf(pid) >= 0;
    $('waittitle').textContent = won ? '🏆 Closest prediction!' : '💥 Kaboom at ' + ntTime(n.len, true);
    $('waitsub').textContent = gg != null ? 'The note lasted ' + ntTime(n.len, true) + '. You predicted ' + ntTime(gg) + (gg < n.len - .05 ? ': her note lasted longer, so you’re out!' : ': ' + Math.abs(gg - n.len).toFixed(1) + ' seconds off.') : 'The note lasted ' + ntTime(n.len, true) + '.';
  }

  // ---------- Lost in Verona (Juliet's maze) ----------
  // Four arrows: tap the route Juliet called out, step by step, from memory.
  var jmKey = '', jmN = 0, jmLog = [], jmBarKey = '', jmSent = '', jmAuto = null, JM_ARW = ['⬅️', '⬆️', '➡️', '⬇️', '🚗'];
  /* the route goes in step by step (shown in the ten boxes above the arrows); Reset clears it, Send hands it in */
  function jmSend(qq, auto) {
    if (!net || !qq || qq.st !== 'input' || jmSent === jmKey) return;
    if (!auto && jmLog.length < (qq.len || qq.round)) return;
    jmSent = jmKey; var msg = { pid: pid, id: qq.id, round: qq.round, route: jmLog.slice(0, qq.len || qq.round) };
    net.send('qj', msg); setTimeout(function () { var q2 = state && state.qj; if (q2 && q2.st === 'input' && q2.id === msg.id && q2.round === msg.round && !(q2.fail || {})[pid] && ((q2.prog || {})[pid] || 0) < (q2.len || q2.round)) net.send('qj', msg); }, 1100);
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
        if (jmLog.length >= (qq.len || qq.round)) return;
        jmLog.push(+b.getAttribute('data-dir')); jmN = jmLog.length;
        b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
        qjView(state);
      }); });
      box.querySelector('.jmreset').addEventListener('click', function () { if (jmSent === jmKey) return; jmLog = []; jmN = 0; qjView(state); });
      box.querySelector('.jmsend').addEventListener('click', function () { jmSend(state && state.qj, false); qjView(state); });
    }
    var log = ''; for (var i = 0; i < 10; i++) log += i >= (q.len || q.round) ? '<i class="off"></i>' : i < jmLog.length ? '<i class="on">' + JM_ARW[jmLog[i]] + '</i>' : '<i></i>';
    box.querySelector('.jmlog').innerHTML = log;   /* (the ten boxes show as soon as the pad does) */
    var sent = jmSent === key, full = jmLog.length >= (q.len || q.round);
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
      tell.querySelector('b').textContent = '👀 Watch the big screen!'; tell.querySelector('span').textContent = 'Remember Juliet’s route: ' + (q.len || q.round) + ' step' + ((q.len || q.round) === 1 ? '' : 's') + '. Then tap it here.';
      return;
    }
    if (q.st === 'input' && !failed && !sent) {
      box.classList.remove('hidden', 'wait', 'fin'); box.classList.add('play');
      if (jmBarKey !== key) {   /* the timer bar: starts where the time left is, runs down to zero */
        jmBarKey = key; var tot = 4500 + (q.len || q.round) * 1300, lft = Math.max(0, q.left || 0);
        bar.style.transition = 'none'; bar.style.width = Math.min(100, lft / tot * 100) + '%'; void bar.offsetWidth;
        bar.style.transition = 'width ' + lft + 'ms linear'; bar.style.width = '0%';
        clearTimeout(jmAuto); jmAuto = setTimeout(function () { jmSend(state && state.qj, true); }, Math.max(0, lft - 700));   /* time's nearly up: whatever you have goes in */
      }
      tell.querySelector('b').textContent = full ? '✅ Happy with it? Send!' : '👆 Tap Juliet’s route!'; tell.querySelector('span').textContent = full ? 'Or Reset if you made a mistake.' : 'Step ' + (jmLog.length + 1) + ' of ' + (q.len || q.round) + ': which way next?';
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
  var shopKey = '', shopSel = [], bagOpen = false, bagItem = null; var goldSel = null;   // (the Golden Ticket's game, waiting for a yes)
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
      return '<button type="button" class="shopbtn' + (n ? ' on' : '') + (poor ? ' poor' : '') + (gone ? ' sold' : '') + '" data-id="' + it.id + '"' + (poor ? ' disabled' : '') + '><span class="si">' + it.icon + '</span><span><b>' + esc(it.name) + (n > 1 ? ' ×' + n : '') + (gone ? ' <em class="price sold">Sold out</em>' : free ? ' <em class="price free"><s>' + pr + ' pts</s> free</em>' : ' <em class="price">' + pr + ' pts</em>') + '</b><small class="imode m-' + itemMode(it).id + '">' + itemMode(it).icon + ' ' + esc(itemMode(it).label) + '</small><small>' + esc(it.desc) + '</small>' + (gone || poor ? '<small class="shopno">' + (gone ? '❌ Sold out! Someone was quicker' : '💸 Not enough points for this one') + '</small>' : '') + '</span></button>';   // (what it does is always explained, even when you can't have it)
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
    if (!ok) { bagOpen = false; bagItem = null; goldSel = null; }
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
        if ((shopItem(id) || {}).kind === 'golden') { bagItem = id; bagUpdate(state); return; }   // (the Golden Ticket: pick a game first)
        if ((shopItem(id) || {}).kind === 'smoke') {   // no one to pick: it is for the next question
          var msg = { pid: pid, use: id, target: pid, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', msg); setTimeout(function () { net.send('shop', msg); }, 1200); }
          ptoast('🌫️ The smoke goes up before the next question. Only you will see its answers!'); bagOpen = false; bagUpdate(state); return;
        }
        bagItem = id; bagUpdate(state);
      }; });
    } else if ((shopItem(bagItem) || {}).kind === 'golden') {   /* the Golden Ticket: choose a party game, then confirm it */
      var gl = s.pgames || [], gsel = goldSel && gl.filter(function (x) { return x.k === goldSel; })[0];
      if (gsel) {
        p.innerHTML = '<h3>🌟 Golden Ticket</h3><div class="goldsure"><span class="si">' + gsel.icon + '</span><b>' + esc(gsel.title) + '</b></div><p class="mute" style="margin:0 0 12px;text-align:center">Make this the next party game? Nobody will know until the slot machine spins. Your ticket is used up.</p>' +
          '<button type="button" class="btn" id="goldyes" style="width:100%">✅ Yes, this one!</button><button type="button" class="btn alt" id="goldno" style="width:100%;margin-top:10px">↩️ Choose another</button>';
        $('goldyes').onclick = function () {
          var gm = { pid: pid, use: bagItem, target: pid, game: gsel.k, key: Math.random().toString(36).slice(2, 9) };
          if (net) { net.send('shop', gm); setTimeout(function () { net.send('shop', gm); }, 1200); }
          ptoast('🌟 Done! ' + gsel.title + ' is the next party game… but shh, nobody knows yet. 🤫'); goldSel = null; bagOpen = false; bagItem = null; p.removeAttribute('data-k'); bagUpdate(state);
        };
        $('goldno').onclick = function () { goldSel = null; p.removeAttribute('data-k'); bagUpdate(state); };
      } else {
        p.innerHTML = '<h3>🌟 Golden Ticket</h3><p class="mute" style="margin:0 0 12px">Choose the next party game. It stays a secret until the slot machine spins!</p>' + gl.map(function (x) { return '<button type="button" class="shopbtn who gold" data-k="' + esc(x.k) + '"><span class="si">' + x.icon + '</span><span><b>' + esc(x.title) + '</b></span></button>'; }).join('') + '<button type="button" class="btn alt" id="bagclose" style="width:100%;margin-top:10px">Back</button>';
        [].forEach.call(p.querySelectorAll('.shopbtn.gold'), function (b) { b.onclick = function () { goldSel = b.getAttribute('data-k'); p.removeAttribute('data-k'); bagUpdate(state); }; });
      }
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
    if ($('bagclose')) $('bagclose').onclick = function () { if (bagItem) bagItem = null; else bagOpen = false; bagUpdate(state); };
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
      e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(function () { e.classList.remove('on'); }, 7000);   /* (as long as the item's card on the big screen) */
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
      $('slyrics').innerHTML = (ly ? String(ly).split('\n').map(function (l) { return '<p>' + (esc(l) || '&nbsp;') + '</p>'; }).join('') : '<p class="slynone">🎶 No lyrics for this one yet: sing along with what you remember!</p>');
    }
    $('slywrap').classList.toggle('dim', s.phase === 'srec' && !(rec && rec.state === 'recording'));
    ['sround', 'stitle', 'ssub'].forEach(function (id) { $(id).classList.toggle('hidden', lyOn); });   // (with the lyrics on screen: only the lyrics)
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
  $('lobbystart').addEventListener('click', function () { if (net && state && state.phase === 'lobby' && state.all_ready && !state.cal_on) net.send('go', state.all_sync === false ? { pid: pid, sync: true } : { pid: pid, start: true }); });
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
    var fmg = $('flagmsg'), fr0 = fl.getBoundingClientRect(); if (fmg) { fmg.style.top = Math.round(fr0.bottom - r0.top + 12) + 'px'; fmg.style.left = Math.round(fr0.left - r0.left + 8) + 'px'; fmg.style.right = Math.round(r0.right - fr0.right + 8) + 'px'; }   /* the message just below the flag, not on it */
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
    // the flag screen: your choice shown big on top, and the confirm button always in view at the bottom
    var ccName = mine ? (countries[mine] || mine.toUpperCase()) : '', ccH = mine ? '<img src="https://flagcdn.com/w160/' + mine + '.png" alt=""><span><small>Your country</small><b>' + esc(ccName) + '</b></span>' : '<span class="ccnone">👇 Tap a flag below to choose your country</span>';
    if ($('ccsel')._h !== ccH) { $('ccsel')._h = ccH; $('ccsel').innerHTML = ccH; }
    $('v-pick').classList.toggle('flagmode', pickMode === 'flag');
    var avNow = want || (m && m.char), avJoin = pickMode === 'avatar' && joinFlow === 1;
    var pdT = pickMode === 'flag' ? (mine ? '✅ Confirm ' + ccName : 'Choose a country first') : avJoin ? 'Next: your country ➜' : 'Done';
    if ($('pickdone').textContent !== pdT) $('pickdone').textContent = pdT; $('pickdone').classList.toggle('dim', pickMode === 'flag' && !mine);
    $('pickdone').classList.toggle('hidden', avJoin && !avNow);   // (joining: no button until you've taken a photo or picked an avatar; the three options above are the choice)
    var selNow = Date.now() < pickUntil ? want : (m && m.char), usePic = !!myPic && selNow === 'u:' + pid, pv = usePic ? '<img src="' + myPic + '" alt=""><span>✅ This is you!</span>' : '';
    if ($('mypicprev')._h !== pv) { $('mypicprev')._h = pv; $('mypicprev').innerHTML = pv; } $('mypicprev').classList.toggle('hidden', !usePic);
    pickAvVis();
    var left = CHARS.filter(function (c) { return !taken[c.id]; }).length;
    $('pickerr').textContent = left ? (want && taken[want] ? 'Too slow, ' + taken[want] + ' just took that one. Pick another!' : '') : 'All other avatars are taken.';
    if (want && taken[want]) want = null;
  }
  var flagKey = '', myPick = { key: '', i: -1 }, joinFlow = 0, pickMode = '', avList = false;
  function pickAvVis() {   // the avatars only after "No photo?" (or when you already have one of them)
    var on = pickMode === 'avatar' && avList;
    $('chars').classList.toggle('hidden', !on); $('pickavnote').classList.toggle('hidden', !on); $('nopic').classList.toggle('hidden', on || pickMode !== 'avatar');
    $('mypicrow').classList.toggle('avmode', on); $('backpic').classList.toggle('hidden', !on);   // (picking an avatar: the selfie and upload options go away)
  }
  $('backpic').addEventListener('click', function () { avList = false; pickAvVis(); });
  $('nopic').addEventListener('click', function () { avList = true; $('pickerr').textContent = ''; pickAvVis(); setTimeout(function () { try { $('chars').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 50); });
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
    avList = false;   // (always the choice first: a selfie, a picture, or an avatar)
    $('mypicrow').classList.toggle('hidden', mode !== 'avatar'); $('ccwrap').classList.toggle('hidden', mode !== 'flag'); pickAvVis();
    if (state) onState(state);
    if (mode === 'name') { try { $('editname').focus(); $('editname').select(); } catch (e) {} }
  }
  $('changechar').addEventListener('click', function () { pickOpen('avatar'); });
  $('changecc').addEventListener('click', function () { pickOpen('flag'); });
  $('changename').addEventListener('click', function () { pickOpen('name'); });
  $('pickdone').addEventListener('click', function () {
    var cur = me();
    if (pickMode === 'avatar' && joinFlow && !want && !(cur && cur.char)) { $('pickerr').textContent = avList ? 'Choose an avatar first (or use your own photo!)' : 'Take a selfie, or tap “No photo?” to pick an avatar'; return; }
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
  var quipKey = '', quipSent = false, quipLast = '';
  $('quipform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('quipin').value.replace(/\s+/g, ' ').trim();
    if (!t) { $('quipfb').className = 'fb no'; $('quipfb').textContent = 'Type something first.'; return; }
    if (!net || !state || state.phase !== 'qall') return;
    quipSent = true; quipLast = t.slice(0, 70); $('quipfb').textContent = ''; var qk = quipKey;
    [0, 700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (quipKey === qk && quipSent && quipLast === t.slice(0, 70) && state && state.phase === 'qall' && net) net.send('quip', { pid: pid, text: t }); }, ms); });
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

// 💬 Feedback (the button on the join screen): it lands in the host's ⚙️ Admin → 📝 Requests, as player feedback.
(function () {
  var b = document.getElementById('fbbtn'), ov = document.getElementById('fbov'); if (!b || !ov) return;
  var kind = 'bug', kb = document.getElementById('fbkinds');
  [].forEach.call(kb.querySelectorAll('[data-k]'), function (x) { x.onclick = function () { kind = x.getAttribute('data-k'); [].forEach.call(kb.querySelectorAll('[data-k]'), function (y) { y.classList.toggle('on', y === x); }); }; });
  var m = document.getElementById('fbmsg'), t = document.getElementById('fbtext'), nm = document.getElementById('fbname'), send = document.getElementById('fbsend');
  b.onclick = function () { m.textContent = ''; m.className = 'fb'; try { var n0 = document.getElementById('name'); if (n0 && n0.value && !nm.value) nm.value = n0.value; } catch (e) {} ov.classList.remove('hidden'); setTimeout(function () { try { t.focus(); } catch (e) {} }, 50); };
  document.getElementById('fbclose').onclick = function () { ov.classList.add('hidden'); };
  ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.add('hidden'); });
  send.onclick = function () {
    var txt = t.value.trim(); if (txt.length < 3) { m.textContent = 'Write a little more, please.'; m.className = 'fb no'; return; }
    var sb = typeof escClient === 'function' ? escClient() : null; if (!sb) { m.textContent = 'No connection: try again later.'; m.className = 'fb no'; return; }
    send.disabled = true; m.textContent = 'Sending…'; m.className = 'fb';
    sb.rpc('esc_feedback_send', { p_name: nm.value.trim(), p_kind: kind, p_body: txt }).then(function (r) {
      send.disabled = false;
      if (r.error) { m.textContent = 'That didn’t work: ' + r.error.message; m.className = 'fb no'; return; }
      t.value = ''; m.textContent = '✅ Thank you! Your feedback has been sent.'; m.className = 'fb ok';
    }, function () { send.disabled = false; m.textContent = 'That didn’t work: try again later.'; m.className = 'fb no'; });
  };
})();
