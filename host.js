(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CLIP = 15;            // clip length in seconds
  var room = '', net, songs = [], countries = {}, chorus = {};
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 30000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true, era: '1956-2100', cat: 'all', atype: 'mc', subject: 'random', q: null, sing: null, barMs: 30000, scoring: 'speed' };
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
      var before = list().filter(function (x) { return x.got; }).length;
      p.pts = pointsFor(G.scoring, G.guessMs - (G.endsAt - Date.now()), G.guessMs, before); p.score += p.pts; p.got = true;
    }
    net.send('result', { pid: p.pid, res: res });
    if (res === 'ok' || mc) {
      push(); allIn();
    }
  });
  // Everyone who is still connected has answered: go to the answer.
  function isIn(p) { return G.sing ? !!G.sing.in[p.pid] : (p.got || p.pick != null); }
  function allIn() {
    var act = list().filter(function (x) { return !x.off; });
    var ph = G.phase;
    if (act.length && act.every(isIn)) setTimeout(function () {
      var now = list().filter(function (x) { return !x.off; });
      if (G.phase !== ph || !now.length || !now.every(isIn)) return;
      if (ph === 'guess') reveal();
      else if (ph === 'svote') singVoteEnd();
      else if (ph === 'srec') singPlayAll();
      else if (ph === 'sbest') singReveal();
    }, 1200);
  }

  function list() { return Object.keys(players).map(function (k) { return players[k]; }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); }
  function snapshot() {
    var s = { phase: G.phase, round: G.round, total: G.total, total_ms: G.guessMs, bar_ms: G.barMs, left: Math.max(0, G.endsAt - Date.now()),
      cfg: { era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, scoring: G.scoring },
      players: list().map(function (p) { return { pid: p.pid, name: p.name, char: p.char, score: p.score, got: p.got, done: !!p.done, picked: p.pick != null, in: isIn(p), pick: G.phase === 'reveal' ? p.pick : null, pts: p.pts }; }) };
    if (G.sing) s.sing = singSnapshot();
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
        era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, scoring: G.scoring, used: Object.keys(G.used),
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
    if (c.era) G.era = c.era; if (c.cat) G.cat = c.cat;
    if (c.atype) G.atype = c.atype; if (c.subject) G.subject = c.subject; if (SCORING_HELP[c.scoring]) G.scoring = c.scoring;
    $('s-scoring').value = G.scoring;
    if (G.subject === 'sing') { G.atype = 'sing'; G.subject = 'country'; }   // games saved before Sing! moved to Category
    $('s-era').value = G.era; $('s-cat').value = G.cat;
    $('s-atype').value = G.atype; $('s-subject').value = G.subject; $('s-subject').disabled = $('s-scoring').disabled = G.atype === 'sing'; scoreHelp();
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
      $('replay').disabled = G.phase !== 'guess' || !!G.sing;
      $('skip').disabled = !(G.phase === 'guess' || (G.sing && G.phase !== 'reveal' && G.phase !== 'loading'));
      if (G.phase === 'reveal' && G.song) {
        $('rtitle').textContent = G.song[3];
        $('rmeta').textContent = G.song[2] + ' · ' + flag(G.song[1]) + ' ' + (countries[G.song[1]] || G.song[1]) + ' ' + G.song[0];
        $('rres').textContent = resultText(G.song);
        $('ranswer').textContent = G.q ? G.q.text + ' ' + G.q.answer : '';
        $('next').textContent = G.round >= G.total ? 'Final scores' : 'Next';
      }
      renderSing();
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
    var on = G.phase === 'guess' || (G.sing && (G.phase === 'svote' || G.phase === 'srec' || G.phase === 'sbest'));
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
      else if (clipReady) { countStop(); if (G.sing) singListen(); else beginGuess(); }
      else { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }
    };
    draw(); loadTick = setInterval(draw, 100);
  }
  function countStop() { clearInterval(loadTick); loadT0 = 0; }
  function masks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  setInterval(function () {
    var timed = G.phase === 'guess' || (G.sing && (G.phase === 'svote' || G.phase === 'slisten' || G.phase === 'srec' || G.phase === 'sbest'));
    $('tbar').style.transform = 'scaleX(' + (timed ? Math.max(0, Math.min(1, (G.endsAt - Date.now()) / (G.barMs || G.guessMs))) : 0) + ')';
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

  function loadSong(fixed) {
    stopTimers();
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = fixed || free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    G.q = G.sing ? null : makeQuestion(G.song, G.subject, G.atype, songs, countries);
    stage = 'probe';
    cover(true, '', 'Selecting song', false); countStart(); masks(true);
    yt.mute(); yt.loadVideoById(G.song[4]);
    watchdog = setTimeout(badSong, 12000);
    // Wait until the video really plays, then jump to a random point.
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0;
      if (stage === 'probe' && st === 1 && d > 0) {
        clipStart = d < 45 ? 0 : Math.floor(15 + Math.random() * (d - 15 - 20 - CLIP));
        if (G.sing) {
          // Sing! wants the chorus: an exact start from chorus.json if the song has one, otherwise the
          // stretch where a three-minute Eurovision song usually reaches its first chorus.
          var known = chorus[G.song[4]];
          if (typeof known === 'number' && known < d - 5) clipStart = Math.max(0, Math.floor(known));
          else if (d >= 110) clipStart = Math.floor(45 + Math.random() * 30);
        }
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
    if (G.sing) {
      // The voted song will not play: take another of the four options instead.
      var alt = -1;
      G.sing.options.forEach(function (o, i) { if (alt < 0 && !G.sing.tried[i]) alt = i; });
      if (alt < 0) { fails = 6; badSong(); return; }
      G.sing.tried[alt] = 1; G.sing.chosen = alt; push(); loadSong(G.sing.options[alt]); return;
    }
    loadSong();
  }
  function playClip() {
    clearInterval(poll);
    stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + CLIP) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (G.phase === 'guess') cover(true, '?', '', false);   // the question itself stays below the video
        if (G.sing && G.phase === 'slisten') singRecord();
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    G.phase = 'guess'; G.barMs = G.guessMs; G.endsAt = Date.now() + G.guessMs;
    playClip(); push();
    endTimer = setTimeout(reveal, G.guessMs);
  }
  function reveal() {
    if (G.phase !== 'guess') return;
    stopTimers(); G.phase = 'reveal'; stage = 'reveal';
    // Multiple choice is scored now, from the answer each player was holding.
    // For "order" scoring the right answers are ranked by when they were put in.
    if (G.q && G.q.type === 'mc') list().filter(function (p) { return p.pick === G.q.correct; })
      .sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); })
      .forEach(function (p, rank) { p.pts = pointsFor(G.scoring, p.pickMs, G.guessMs, rank); p.score += p.pts; p.got = true; });
    cover(false); masks(false);
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    push(); autoStart();
  }
  function startRound() {
    G.round++; G.phase = 'loading';
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; });
    G.q = null; singClear();
    if (G.atype === 'sing') { singStart(); return; }
    push(); loadSong();
  }
  // ---------- Sing! ----------
  // A song round without a quiz question: vote for one of four songs, listen to it, record up to
  // 10 seconds on the phone, hear every recording over the muted video, then vote for the best.
  // Recordings travel phone -> host as chunks over the room connection and are never stored.
  var SING = { vote: 20000, rec: 45000, best: 30000 }, singTimer = null, singAudio = null;
  function stopAudio() { if (singAudio) { try { singAudio.onended = singAudio.onerror = null; singAudio.pause(); } catch (e) {} singAudio = null; } }
  function singClear() {
    clearTimeout(singTimer); stopAudio();
    if (G.sing) Object.keys(G.sing.clips).forEach(function (k) { try { URL.revokeObjectURL(G.sing.clips[k]); } catch (e) {} });
    G.sing = null;
  }
  // YouTube sometimes comes back with sound after a seek, so during playback of the recordings the
  // video is silenced repeatedly: muted and at volume 0.
  var silenceTick = null;
  function silence() {
    try { yt.mute(); yt.setVolume(0); } catch (e) {}
    if (!silenceTick) silenceTick = setInterval(function () {
      if (G.sing && G.phase === 'splay') { try { yt.mute(); yt.setVolume(0); } catch (e) {} }
      else { clearInterval(silenceTick); silenceTick = null; }
    }, 150);
  }
  function singPhase(phase, ms) { G.phase = phase; G.sing.in = {}; G.barMs = ms; G.endsAt = Date.now() + ms; clearTimeout(singTimer); }
  function singStart() {
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (free.length < 4) { G.used = {}; free = G.pool.slice(); }
    G.sing = { options: shuffle(free.slice()).slice(0, 4), chosen: null, tried: {}, votes: {}, parts: {}, clips: {}, order: [], idx: -1, now: null, best: {}, result: null, in: {} };
    singPhase('svote', SING.vote);
    cover(true, '🎤', 'Sing!', false); masks(true);
    singTimer = setTimeout(singVoteEnd, SING.vote); push();
  }
  function singVoteEnd() {
    if (!G.sing || G.phase !== 'svote') return;
    clearTimeout(singTimer);
    var c = G.sing.options.map(function () { return 0; }), pid, top = [];
    for (pid in G.sing.votes) c[G.sing.votes[pid]]++;
    var max = Math.max.apply(null, c);
    c.forEach(function (n, i) { if (n === max) top.push(i); });
    G.sing.chosen = pick(top); G.sing.tried[G.sing.chosen] = 1;
    G.phase = 'loading'; G.sing.in = {}; push();
    loadSong(G.sing.options[G.sing.chosen]);
  }
  function singListen() {
    G.phase = 'slisten'; G.barMs = CLIP * 1000; G.endsAt = Date.now() + G.barMs;
    playClip(); masks(false); push();
  }
  function singRecord() {
    if (!G.sing) return;
    singPhase('srec', SING.rec);
    cover(true, '🎙', 'Your turn to sing!', true);
    singTimer = setTimeout(singPlayAll, SING.rec + 4000);   // a little slack for the last uploads
    push();
  }
  function singPlayAll() {
    if (!G.sing || G.phase !== 'srec') return;
    clearTimeout(singTimer);
    G.sing.order = shuffle(Object.keys(G.sing.clips).filter(function (pid) { return players[pid]; }));
    G.sing.idx = -1; G.phase = 'splay'; G.sing.in = {};
    singNext();
  }
  function singNext() {
    if (!G.sing || G.phase !== 'splay') return;
    clearTimeout(singTimer); stopAudio();
    var pid = G.sing.order[++G.sing.idx];
    if (!pid) { clearInterval(silenceTick); silenceTick = null; try { yt.pauseVideo(); } catch (e) {} if (G.sing.order.length > 1) singBest(); else singReveal(); return; }
    G.sing.now = pid; cover(false); masks(false);
    // The song's video runs silently; the sound is the player's recording.
    silence();
    try { yt.seekTo(clipStart, true); yt.playVideo(); } catch (e) {}
    silence();
    var a = singAudio = new Audio(G.sing.clips[pid]), done = false;
    var fin = function () { if (done) return; done = true; clearTimeout(singTimer); singTimer = setTimeout(singNext, 900); };
    a.onended = fin; a.onerror = fin;
    var pr = a.play(); if (pr && pr.catch) pr.catch(fin);
    singTimer = setTimeout(fin, 13000);
    push();
  }
  function singBest() {
    singPhase('sbest', SING.best); G.sing.now = null;
    cover(true, '🏆', '', false);
    singTimer = setTimeout(singReveal, SING.best); push();
  }
  function singReveal() {
    if (!G.sing || G.phase === 'reveal') return;
    clearTimeout(singTimer); stopAudio(); stopTimers();
    var tally = {}, v, max = 0;
    G.sing.order.forEach(function (pid) { tally[pid] = 0; });
    for (v in G.sing.best) if (tally[G.sing.best[v]] != null) tally[G.sing.best[v]]++;
    G.sing.order.forEach(function (pid) { max = Math.max(max, tally[pid]); });
    // 20 points for singing, 50 per vote, and 50 extra for the most votes.
    // Singers are ranked by votes and get 12, 10, 8 ... like a Eurovision scoreboard (equal votes share a rank).
    var ranked = G.sing.order.map(function (pid) { return tally[pid]; }).sort(function (a, b) { return b - a; });
    G.sing.result = G.sing.order.filter(function (pid) { return players[pid]; }).map(function (pid) {
      var p = players[pid], win = max > 0 && tally[pid] === max;
      p.pts = ESC_POINTS[ranked.indexOf(tally[pid])] || 1;
      p.score += p.pts; p.got = true;
      return { pid: pid, name: p.name, char: p.char, votes: tally[pid], win: win, pts: p.pts };
    }).sort(function (a, b) { return b.votes - a.votes; });
    G.phase = 'reveal'; stage = 'reveal'; G.sing.in = {}; G.sing.now = null;
    cover(false); masks(false);
    clearInterval(silenceTick); silenceTick = null;
    try { if (G.sing.chosen != null) { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {}
    push(); autoStart();
  }
  // The host's "Continue" button moves a Sing! round along when someone is stuck.
  function singSkip() {
    if (!G.sing) return;
    if (G.phase === 'svote') singVoteEnd();
    else if (G.phase === 'slisten') { clearInterval(poll); try { yt.pauseVideo(); } catch (e) {} singRecord(); }
    else if (G.phase === 'srec') singPlayAll();
    else if (G.phase === 'splay') singNext();
    else if (G.phase !== 'loading') singReveal();
  }
  net.on('poll', function (m) {
    var p = m && players[m.pid];
    if (!p || !G.sing || typeof m.choice !== 'number') return;
    if (G.phase === 'svote' && G.sing.options[m.choice]) G.sing.votes[p.pid] = m.choice;
    else if (G.phase === 'sbest' && G.sing.order[m.choice] && G.sing.order[m.choice] !== p.pid) G.sing.best[p.pid] = G.sing.order[m.choice];   // no voting for yourself
    else return;
    G.sing.in[p.pid] = 1; push(); allIn();
  });
  net.on('clip', function (m) {
    var p = m && players[m.pid];
    if (!p || !G.sing || G.phase !== 'srec') return;
    if (m.skip) { G.sing.in[p.pid] = 1; push(); allIn(); return; }
    if (typeof m.data !== 'string' || !(m.n >= 1 && m.n <= 16) || !(m.i >= 0 && m.i < m.n)) return;
    var part = G.sing.parts[p.pid];
    if (!part || part.key !== m.key) part = G.sing.parts[p.pid] = { key: m.key, n: m.n, got: 0, data: [], mime: String(m.mime || 'audio/webm').slice(0, 60) };
    if (part.data[m.i] == null) { part.data[m.i] = m.data; part.got++; }
    if (part.got !== part.n) return;
    try {
      var bin = atob(part.data.join('')), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      if (G.sing.clips[p.pid]) URL.revokeObjectURL(G.sing.clips[p.pid]);
      G.sing.clips[p.pid] = URL.createObjectURL(new Blob([u], { type: part.mime }));
      G.sing.in[p.pid] = 1; push(); allIn();
    } catch (e) {}
  });
  function singSnapshot() {
    var sg = G.sing, chosen = sg.chosen != null ? sg.options[sg.chosen] : null;
    return { options: G.phase === 'svote' ? sg.options.map(function (o) { return o[3] + ' – ' + o[2]; }) : null,
      song: chosen ? { title: chosen[3], artist: chosen[2] } : null,
      order: G.phase === 'sbest' ? sg.order.map(function (pid) { return { pid: pid, name: players[pid] ? players[pid].name : '?' }; }) : null,
      now: sg.now && players[sg.now] ? players[sg.now].name : null, result: sg.result };
  }
  function renderSing() {
    var sg = G.sing;
    $('skip').textContent = sg && G.phase !== 'reveal' ? 'Continue' : 'Show answer';
    if (!sg) return;
    var song = sg.chosen != null ? sg.options[sg.chosen] : null, name = song ? song[3] + ' – ' + song[2] : '', t = '', opts = '';
    if (G.phase === 'svote') { t = 'Sing! Vote for the song'; opts = sg.options.map(function (o, i) { return '<div class="opt"><b>' + 'ABCD'[i] + '.</b> ' + esc(o[3] + ' – ' + o[2]) + '</div>'; }).join(''); }
    else if (G.phase === 'loading') t = 'We’re singing: ' + name;
    else if (G.phase === 'slisten') t = 'Listen first: ' + name;
    else if (G.phase === 'srec') t = 'Sing it! Record up to 10 seconds on your phone';
    else if (G.phase === 'splay') t = 'Now singing: ' + (players[sg.now] ? players[sg.now].name : '');
    else if (G.phase === 'sbest') { t = 'Who sang it best? Vote on your phone'; opts = sg.order.map(function (pid) { var p = players[pid]; return p ? '<div class="opt">' + charSvg(p.char) + esc(p.name) + '</div>' : ''; }).join(''); }
    else if (G.phase === 'reveal') {
      var wins = (sg.result || []).filter(function (r) { return r.win; }).map(function (r) { return r.name; });
      $('ranswer').textContent = !sg.result || !sg.result.length ? 'Nobody sang this time' : wins.length ? 'Best singer: ' + wins.join(' & ') : 'Thanks for singing!';
      opts = (sg.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + charSvg(r.char) + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
    }
    $('qtext').textContent = t; $('qopts').innerHTML = opts;
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
  // Sing! is a category of its own: there is no question, so the Answers setting does not apply.
  function singToggle() { var on = $('s-atype').value === 'sing'; $('s-subject').disabled = on; $('s-scoring').disabled = on; scoreHelp(); }
  $('s-atype').addEventListener('change', singToggle);
  function scoreHelp() {
    $('scorehelp').textContent = $('s-atype').value === 'sing' ? 'Sing!: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : (SCORING_HELP[$('s-scoring').value] || '');
  }
  $('s-scoring').addEventListener('change', scoreHelp); scoreHelp();
  ['s-era', 's-cat'].forEach(function (id) { $(id).addEventListener('change', function () { G.era = $('s-era').value; G.cat = $('s-cat').value; ready(); }); });
  function toLobby() {
    stopTimers(); autoStop(); singClear(); clearInterval(loadTick); loadT0 = 0; stage = 'idle';
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
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.atype = $('s-atype').value; G.subject = $('s-subject').value; G.scoring = $('s-scoring').value;
    if (!buildPool()) return;
    G.total = +$('s-rounds').value; G.guessMs = +$('s-time').value * 1000;
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
  $('skip').addEventListener('click', function () { if (G.sing) singSkip(); else reveal(); });
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (G.round >= G.total) { try { yt.stopVideo(); } catch (e) {} G.phase = 'end'; push(); } else startRound();
  }
  $('again').addEventListener('click', toLobby);

  fetch('songs.json?v=32').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    ready();
  }).catch(function () { $('start').textContent = 'Could not load songs'; });
  fetch('chorus.json?v=32').then(function (r) { return r.json(); }).then(function (d) { chorus = d || {}; }).catch(function () {});
  restore();
  render();
})();
