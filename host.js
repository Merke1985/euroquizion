(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CLIP = 15;            // clip length in seconds
  var room = '', net, songs = [], countries = {};
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 30000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true, era: '1956-2100', cat: 'all', atype: 'mc', subject: 'country', q: null };
  var yt = null, ytReady = false, clipStart = 0, stage = 'idle', poll = null, watchdog = null, endTimer = null, fails = 0;

  // ---------- room ----------
  // The room code lives in the address bar, so refreshing the page rehosts the same game.
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var asked = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  var resumed = asked.length === 4, recovering = false, adopted = false;
  if (resumed) room = asked; else for (var i = 0; i < 4; i++) room += A[Math.floor(Math.random() * A.length)];
  try { history.replaceState(null, '', location.pathname + '?room=' + room); } catch (e) {}
  var SAVE = 'esc-host-' + room;
  var joinUrl = new URL('./?k=' + room, location.href).href;
  $('roomcode').textContent = room; $('codebig').textContent = room;
  $('joinurl').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\?k=.*$/, '');
  $('joinhint').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\?k=.*$/, '');
  try { var q = qrcode(0, 'M'); q.addData(joinUrl); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { $('qr').classList.add('hidden'); }

  net = escConnect(room);
  $('demo').classList.toggle('hidden', !net.demo);
  net.on('hi', function (m) {
    if (!m || !m.pid) return;
    var p = players[m.pid], isNew = !p;
    var nm = String(m.name || '').slice(0, 16) || 'Player';
    // Every character belongs to one player per room; first come, first served.
    var want = CHAR_BY_ID[m.char] ? m.char : null;
    var free = want && !list().some(function (x) { return x.char === want && x.pid !== m.pid; });
    if (!p) {
      if (!free) { sayHello(); return; }   // not in yet: just show them which characters are left
      p = players[m.pid] = { pid: m.pid, name: nm, char: want, score: 0, got: false, pts: 0 };
      // Rehosting without a saved game on this device: rebuild it from what the phones remember.
      if (recovering) {
        if (typeof m.score === 'number' && m.score > 0) p.score = Math.floor(m.score);
        if (!adopted && m.last && m.last.round > 0) adopt(m.last);
      }
    }
    var changed = isNew || p.name !== nm || p.off;
    if (free && want !== p.char && (G.phase === 'lobby' || !p.char)) { p.char = want; changed = true; }
    p.name = nm; p.last = Date.now(); p.off = false;
    if (changed) push();
  });
  var helloAt = 0;
  function sayHello() { if (recovering || Date.now() - helloAt < 700) return; helloAt = Date.now(); net.send('state', snapshot()); }
  net.on('guess', function (m) {
    var p = m && players[m.pid];
    if (!p || G.phase !== 'guess' || p.got || p.done || !G.q) return;
    var res, mc = G.q.type === 'mc';
    if (mc) {
      // Multiple choice: the answer is held and can still be changed. Nobody learns whether
      // it was right before the reveal, which comes once everyone has an answer in.
      if (typeof m.choice !== 'number' || !G.q.options[m.choice]) return;
      p.pick = m.choice; p.pickMs = G.guessMs - (G.endsAt - Date.now());
      push(); allIn(); return;
    }
    res = checkOpen(G.q, G.song, m.text, countries);
    if (res === 'ok') {
      p.pts = scoreFor(G.guessMs - (G.endsAt - Date.now()), G.guessMs); p.score += p.pts; p.got = true;
    }
    net.send('result', { pid: p.pid, res: res });
    if (res === 'ok' || mc) {
      push(); allIn();
    }
  });
  // Everyone who is still connected has answered: go to the answer.
  function isIn(p) { return p.got || p.pick != null; }
  function allIn() {
    var act = list().filter(function (x) { return !x.off; });
    if (act.length && act.every(isIn)) setTimeout(function () {
      var now = list().filter(function (x) { return !x.off; });
      if (G.phase === 'guess' && now.length && now.every(isIn)) reveal();
    }, 1200);
  }

  function list() { return Object.keys(players).map(function (k) { return players[k]; }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); }
  function snapshot() {
    var s = { phase: G.phase, round: G.round, total: G.total, total_ms: G.guessMs, left: Math.max(0, G.endsAt - Date.now()),
      cfg: { era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject },
      players: list().map(function (p) { return { pid: p.pid, name: p.name, char: p.char, score: p.score, got: p.got, done: !!p.done, picked: p.pick != null, pick: G.phase === 'reveal' ? p.pick : null, pts: p.pts }; }) };
    // Phones get the question and the options, never which option is right (until the reveal).
    if (G.q && (G.phase === 'guess' || G.phase === 'reveal')) s.q = { subject: G.q.subject, type: G.q.type, text: G.q.text, hint: G.q.hint, options: G.q.options };
    if (G.q && G.phase === 'reveal') { s.q.correct = G.q.correct; s.q.answer = G.q.answer; }
    if ((G.phase === 'reveal' || G.phase === 'end') && G.song) s.reveal = { year: G.song[0], code: G.song[1], artist: G.song[2], title: G.song[3], result: resultText(G.song) };
    return s;
  }
  function push() { if (!recovering) net.send('state', snapshot()); save(); render(); }

  // ---------- save & restore ----------
  function save() {
    try {
      localStorage.setItem(SAVE, JSON.stringify({ t: Date.now(), phase: G.phase, round: G.round, total: G.total, guessMs: G.guessMs,
        era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, used: Object.keys(G.used),
        players: list().map(function (p) { return { pid: p.pid, name: p.name, char: p.char, score: p.score }; }) }));
    } catch (e) {}
  }
  // Put a game back between songs: an interrupted song is simply replaced by a new one.
  function resumeAt(phase, round) {
    if (phase === 'end') { G.phase = 'end'; G.round = round; }
    else if (phase === 'lobby' || !round) { G.phase = 'lobby'; G.round = 0; }
    else { G.phase = 'paused'; G.round = (phase === 'reveal' || phase === 'paused') ? round : round - 1; }
  }
  function applyCfg(c) {
    if (c.era) G.era = c.era; if (c.cat) G.cat = c.cat; if (typeof c.showVideo === 'boolean') G.showVideo = c.showVideo;
    if (c.atype) G.atype = c.atype; if (c.subject) G.subject = c.subject;
    $('s-era').value = G.era; $('s-cat').value = G.cat; $('s-video').checked = G.showVideo;
    $('s-atype').value = G.atype; $('s-subject').value = G.subject;
    if ([5, 10, 15, 20].indexOf(G.total) >= 0) $('s-rounds').value = G.total;
    if ([20, 30, 45].indexOf(G.guessMs / 1000) >= 0) $('s-time').value = G.guessMs / 1000;
    buildPool();
  }
  function adopt(last) {
    adopted = true;
    G.total = +last.total || 10; G.guessMs = +last.total_ms || 30000;
    resumeAt(last.phase, +last.round);
    applyCfg(last.cfg || {});
    note('Game ' + room + ' restored from the players’ phones.');
  }
  function note(t) { $('note').textContent = t; $('note').classList.toggle('hidden', !t); }
  function restore() {
    if (!resumed) return;
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch (e) {}
    if (s && Date.now() - s.t < 24 * 3600 * 1000) {
      (s.players || []).forEach(function (p) { players[p.pid] = { pid: p.pid, name: p.name, char: p.char, score: p.score || 0, got: false, pts: 0, last: 0, off: true }; });
      G.total = s.total; G.guessMs = s.guessMs; (s.used || []).forEach(function (id) { G.used[id] = 1; });
      resumeAt(s.phase, s.round); applyCfg(s);
      if (G.phase !== 'lobby') note('Game ' + room + ' restored.');
    } else {
      // Nothing saved here (other device or browser): listen to the phones for a few seconds first.
      recovering = true;
      note('Looking for game ' + room + '…');
      setTimeout(function () {
        recovering = false;
        if (!adopted) note('Rehosting room ' + room + '. No running game was found, so this is a fresh lobby. Players who are still connected will appear here.');
        push();
      }, 6000);
    }
    net.send('sync', {});
  }
  setInterval(function () {
    var now = Date.now(), ch = false;
    list().forEach(function (p) { var off = now - p.last > 12000; if (off !== !!p.off) { p.off = off; ch = true; } });
    if (!recovering) net.send('state', snapshot()); if (ch) render();
  }, 3000);

  // ---------- rendering ----------
  function show(id) { ['v-lobby', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }
  function boardHtml(showGot) {
    return list().map(function (p) {
      return '<li class="' + (showGot && p.got ? 'got ' : '') + (p.off ? 'off' : '') + '"><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span>' + p.score +
        (showGot && p.got ? '<span class="pts">+' + p.pts + '</span>' : '') + '</span></li>';
    }).join('') || '<li class="mute">No players yet</li>';
  }
  function render() {
    var ps = list();
    $('players').innerHTML = ps.map(function (p) { return '<span class="chip' + (p.off ? ' off' : '') + '">' + charSvg(p.char) + esc(p.name) + '</span>'; }).join('') || '<span class="mute">Waiting for players…</span>';
    $('pcount').textContent = ps.length ? '(' + ps.length + ')' : '';
    $('board').innerHTML = boardHtml(G.phase === 'guess' || G.phase === 'reveal');
    $('newgame').classList.toggle('hidden', G.phase === 'lobby');
    if (G.phase === 'lobby') show('v-lobby');
    else if (G.phase === 'end') {
      show('v-end');
      var top = ps[0];
      $('winner').textContent = top ? top.name + ' · ' + top.score + ' points' : 'Nobody?!';
      $('winchar').innerHTML = top ? charSvg(top.char) : '';
      $('final').innerHTML = boardHtml(false);
    } else {
      show('v-game');
      $('roundlabel').textContent = 'Song ' + G.round + ' / ' + G.total;
      renderQuestion(); renderAnswered();
      var between = G.phase === 'reveal' || G.phase === 'paused';
      $('guessui').classList.toggle('hidden', between);
      $('revealui').classList.toggle('hidden', !between);
      $('next').disabled = !(ytReady && songs.length);
      if (G.phase === 'paused') {
        cover(true, '↻', 'Game restored', false);
        $('rtitle').textContent = G.round ? 'Song ' + G.round + ' of ' + G.total + ' done' : 'Ready for song 1';
        $('rmeta').textContent = G.round >= G.total ? 'Only the final scores are left.' : 'Press continue when everyone is back.';
        $('rres').textContent = ''; $('ranswer').textContent = '';
        $('next').textContent = G.round >= G.total ? 'Final scores' : 'Continue';
      }
      $('replay').disabled = $('skip').disabled = G.phase !== 'guess';
      if (G.phase === 'reveal') {
        $('rtitle').textContent = G.song[3];
        $('rmeta').textContent = G.song[2] + ' · ' + flag(G.song[1]) + ' ' + (countries[G.song[1]] || G.song[1]) + ' ' + G.song[0];
        $('rres').textContent = resultText(G.song);
        $('ranswer').textContent = G.q ? G.q.text + ' ' + G.q.answer : '';
        $('next').textContent = G.round >= G.total ? 'Final scores' : 'Next';
      }
    }
  }
  // The question (and, for multiple choice, the four options) on the big screen.
  function renderQuestion() {
    var q = G.q, on = q && (G.phase === 'guess' || G.phase === 'reveal');
    $('qtext').textContent = on && G.phase === 'guess' ? q.text : '';
    $('qopts').innerHTML = on && q.options ? q.options.map(function (o, i) {
      return '<div class="opt' + (G.phase === 'reveal' ? (i === q.correct ? ' right' : ' dim') : '') + '"><b>' + 'ABCD'[i] + '.</b> ' + esc(o) + '</div>';
    }).join('') : '';
  }
  // Everyone's character under the video, with a green ring once their answer is in.
  function renderAnswered() {
    var on = G.phase === 'guess';
    $('answered').classList.toggle('hidden', !on);
    if (!on) return;
    var ps = list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    $('answered').innerHTML = ps.map(function (p) {
      return '<div class="pl' + (isIn(p) ? ' in' : '') + (p.off ? ' off' : '') + '">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></div>';
    }).join('');
  }
  function cover(on, icon, text, pulse) {
    $('cover').classList.toggle('hidden', !on);
    if (on) { $('covericon').textContent = icon; $('covertext').textContent = text; $('covericon').classList.toggle('pulse', !!pulse); }
  }
  // Countdown: the video loads muted behind the cover while 5..1 counts down.
  // The clip starts as soon as both the countdown and the loading are done.
  var COUNT = 5, loadT0 = 0, loadTick = null, clipReady = false;
  function countStart() {
    clipReady = false;
    if (loadT0) return;                 // a replacement for a broken video keeps the running countdown
    loadT0 = Date.now(); clearInterval(loadTick);
    var draw = function () {
      var left = COUNT - Math.floor((Date.now() - loadT0) / 1000);
      if (left >= 1) { $('covericon').textContent = left; $('covertext').textContent = 'Selecting song'; }
      else if (clipReady) { countStop(); beginGuess(); }
      else { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }
    };
    draw(); loadTick = setInterval(draw, 100);
  }
  function countStop() { clearInterval(loadTick); loadT0 = 0; }
  function masks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  setInterval(function () {
    if (G.phase !== 'guess') return;
    $('tbar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, (G.endsAt - Date.now()) / G.guessMs)) + ')';
  }, 100);

  // ---------- YouTube ----------
  window.onYouTubeIframeAPIReady = function () {
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () { if (stage === 'probe' || stage === 'seek') badSong(); } }
    });
  };
  var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); }

  function loadSong() {
    stopTimers();
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    G.q = makeQuestion(G.song, G.subject, G.atype, songs, countries);
    stage = 'probe';
    cover(true, '', 'Selecting song', false); countStart(); masks(true);
    yt.mute(); yt.loadVideoById(G.song[4]);
    watchdog = setTimeout(badSong, 12000);
    // Wait until the video really plays, then jump to a random point.
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0;
      if (stage === 'probe' && st === 1 && d > 0) {
        clipStart = d < 45 ? 0 : Math.floor(15 + Math.random() * (d - 15 - 20 - CLIP));
        stage = 'seek'; yt.seekTo(clipStart, true);
      } else if (stage === 'seek' && st === 1 && t >= clipStart && t < clipStart + 5) {
        clearInterval(poll); clearTimeout(watchdog); fails = 0;
        yt.pauseVideo(); stage = 'ready'; clipReady = true;   // the countdown starts the clip
      }
    }, 120);
  }
  function badSong() {
    stopTimers(); fails++;
    if (fails >= 6) {
      stage = 'idle'; countStop(); cover(true, '!', 'Videos won’t start', false);
      $('err').textContent = 'YouTube isn’t playing anything. Check your connection, or click “Show answer” and try the next song.';
      G.phase = 'guess'; G.endsAt = Date.now(); push(); return;
    }
    loadSong();
  }
  function playClip() {
    clearInterval(poll);
    stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    if (G.showVideo) cover(false); else cover(true, '♪', 'Listen closely…', true);
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + CLIP) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (G.phase === 'guess') cover(true, '?', '', false);   // the question itself stays below the video
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    G.phase = 'guess'; G.endsAt = Date.now() + G.guessMs;
    playClip(); push();
    endTimer = setTimeout(reveal, G.guessMs);
  }
  function reveal() {
    if (G.phase !== 'guess') return;
    stopTimers(); G.phase = 'reveal'; stage = 'reveal';
    // Multiple choice is scored now, from the answer each player was holding.
    if (G.q && G.q.type === 'mc') list().forEach(function (p) {
      if (p.pick === G.q.correct) { p.pts = scoreFor(p.pickMs, G.guessMs); p.score += p.pts; p.got = true; }
    });
    cover(false); masks(false);
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.playVideo(); } catch (e) {}
    push(); autoStart();
  }
  function startRound() {
    G.round++; G.phase = 'loading';
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; });
    G.q = null;
    push(); loadSong();
  }

  // ---------- buttons ----------
  function buildPool() {
    G.pool = poolFor(songs, G.era, G.cat);
    return G.pool.length;
  }
  function ready() {
    if (!songs.length) return;
    var n = buildPool();
    $('songcount').textContent = n ? n + ' songs in this selection.' + (G.cat === 'nq' ? ' Semi-finals started in 2004, so non-qualifiers run from then on.' : '')
      : 'No songs match this combination. Semi-finals only started in 2004, so there are no non-qualifiers before that.';
    $('start').disabled = !(ytReady && n);
    $('start').textContent = ytReady ? 'Start game' : 'Loading player…';
    if (G.phase === 'paused') render();
  }
  ['s-era', 's-cat'].forEach(function (id) { $(id).addEventListener('change', function () { G.era = $('s-era').value; G.cat = $('s-cat').value; ready(); }); });
  function toLobby() {
    stopTimers(); autoStop(); clearInterval(loadTick); loadT0 = 0; stage = 'idle';
    try { yt.stopVideo(); } catch (e) {}
    G.phase = 'lobby'; G.round = 0; G.song = null; G.q = null; note(''); push();
  }
  // "Start new game" asks for a second click so a slip of the mouse cannot end a running game.
  var armed = null;
  $('newgame').addEventListener('click', function () {
    var b = $('newgame');
    if (G.phase === 'end' || armed) { clearTimeout(armed); armed = null; b.textContent = 'Start new game'; toLobby(); return; }
    b.textContent = 'End this game? Click again';
    armed = setTimeout(function () { armed = null; b.textContent = 'Start new game'; }, 4000);
  });
  $('rehostbtn').addEventListener('click', function () {
    $('rehostform').classList.toggle('hidden'); $('rehosthelp').classList.toggle('hidden');
    if (!$('rehostform').classList.contains('hidden')) $('rehostcode').focus();
  });
  $('rehostform').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = $('rehostcode').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length === 4) location.href = location.pathname + '?room=' + c;
  });
  $('start').addEventListener('click', function () {
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.atype = $('s-atype').value; G.subject = $('s-subject').value;
    if (!buildPool()) return;
    G.total = +$('s-rounds').value; G.guessMs = +$('s-time').value * 1000; G.showVideo = $('s-video').checked;
    G.round = 0; G.used = {}; fails = 0; note('');
    list().forEach(function (p) { p.score = 0; });
    startRound();
  });
  // Autoplay: with the box ticked, the answer stays up for 10 seconds and the next song starts by itself.
  var AUTO_SECS = 10, autoTick = null, autoEnd = 0;
  try { $('auto').checked = localStorage.getItem('esc-auto') === '1'; } catch (e) {}
  function autoStop() { clearInterval(autoTick); autoTick = null; $('autoleft').textContent = ''; }
  function autoStart() {
    autoStop();
    if (!$('auto').checked || G.phase !== 'reveal') return;
    autoEnd = Date.now() + AUTO_SECS * 1000;
    var draw = function () {
      var left = Math.ceil((autoEnd - Date.now()) / 1000);
      if (G.phase !== 'reveal') { autoStop(); return; }
      if (left <= 0) { autoStop(); goNext(); return; }
      $('autoleft').textContent = (G.round >= G.total ? 'Final scores in ' : 'Next song in ') + left;
    };
    draw(); autoTick = setInterval(draw, 200);
  }
  $('auto').addEventListener('change', function () {
    try { localStorage.setItem('esc-auto', $('auto').checked ? '1' : '0'); } catch (e) {}
    autoStart();
  });
  $('replay').addEventListener('click', function () { if (G.phase === 'guess' && (stage === 'paused' || stage === 'clip')) playClip(); });
  $('skip').addEventListener('click', reveal);
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (G.round >= G.total) { try { yt.stopVideo(); } catch (e) {} G.phase = 'end'; push(); } else startRound();
  }
  $('again').addEventListener('click', toLobby);

  fetch('songs.json?v=19').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    ready();
  }).catch(function () { $('start').textContent = 'Could not load songs'; });
  restore();
  render();
})();
