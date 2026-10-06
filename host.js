(function () {
  var $ = function (id) { return document.getElementById(id); };
  var AFTER = 5;            // seconds to answer after the clip has ended
  function clipSecs() { return Math.max(5, Math.round(G.guessMs / 1000) - AFTER); }   // clip length (the Video time setting)
  var room = '', net, songs = [], countries = {}, chorus = {};
  var REMOTE = new URLSearchParams(location.search).get('screen') === '0';   // a game without a shared screen
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 20000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true, era: '1956-2100', cat: 'all', atype: 'mc', subject: 'random', q: null, sing: null, barMs: 30000, scoring: 'speed', showScore: 'always', revealAt: 0, draw: null, drawTurn: 0 };
  var yt = null, ytReady = false, clipStart = 0, stage = 'idle', poll = null, watchdog = null, endTimer = null, fails = 0;

  // ---------- room ----------
  // The room code lives in the address bar, so refreshing the page rehosts the same game.
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var asked = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  var resumed = asked.length === 4, recovering = false, adopted = false;
  if (resumed) room = asked; else for (var i = 0; i < 4; i++) room += A[Math.floor(Math.random() * A.length)];
  try { history.replaceState(null, '', location.pathname + '?room=' + room + (REMOTE ? '&screen=0' : '')); } catch (e) {}
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
      if (!free) {
        // No avatar chosen (or it is taken): hand out a random one that is still free.
        var left = CHARS.filter(function (c) { return !list().some(function (x) { return x.char === c.id; }); });
        if (!left.length) { sayHello(); return; }   // every avatar is in use: the game is full
        want = pick(left).id; free = true;
      }
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
    remoteCheck();
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
      if (G.draw && (m.pid === G.draw.pid || p.pick != null)) return;   // Draw!: the drawer does not guess, and a first guess is final
      p.pick = m.choice; p.pickMs = (G.barMs || G.guessMs) - (G.endsAt - Date.now());
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
  var ALLIN_MS = 5000;
  function isIn(p) {
    if (G.phase === 'brief') return !!(G.go && G.go[p.pid]); return G.sing ? !!G.sing.in[p.pid] : (p.got || p.pick != null || !!(G.draw && p.pid === G.draw.pid)); }
  function allIn() {
    var act = list().filter(function (x) { return !x.off; });
    var ph = G.phase;
    if (!act.length || !act.every(isIn)) return;
    // A quiz question: tell everyone, count down from 5, then show the answer.
    var slow = ph === 'guess' || ph === 'svote' || ph === 'sbest';   // these say so on screen and count down from 5
    var wait = slow ? ALLIN_MS : 1200;
    if (slow) { if (G.revealAt) return; G.revealAt = Date.now() + wait; push(); }
    setTimeout(function () {
      var now = list().filter(function (x) { return !x.off; });
      if (G.phase !== ph) return;
      if (!now.length || !now.every(isIn)) { if (slow) { G.revealAt = 0; push(); } return; }
      G.revealAt = 0;
      if (ph === 'guess') reveal();
      else if (ph === 'svote') singVoteEnd();
      else if (ph === 'srec') singPlayAll();
      else if (ph === 'sbest') singReveal();
    }, wait);
  }

  function list() { return Object.keys(players).map(function (k) { return players[k]; }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); }
  function snapshot() {
    var s = { phase: G.phase, round: G.round, total: G.total, total_ms: G.guessMs, bar_ms: G.barMs, left: Math.max(0, G.endsAt - Date.now()),
      cfg: { era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, scoring: G.scoring, showScore: G.showScore },
      players: list().map(function (p) { return { pid: p.pid, name: p.name, char: p.char, score: p.score, got: p.got, done: !!p.done, picked: p.pick != null, in: isIn(p), pick: G.phase === 'reveal' ? p.pick : null, pts: p.pts }; }) };
    if (G.sing) s.sing = singSnapshot();
    if (hideScores()) s.hide = true;
    if (G.phase === 'brief' || G.phase === 'intro') s.brief = G.brief;
    if (G.phase === 'intro') s.intro = INTRO.ids[0];
    if (G.phase === 'reveal' && autoTick && $('autolen').value !== 'end') s.next_in = Math.max(0, autoEnd - Date.now());   // phones show the autoplay countdown too
    if (G.revealAt && (G.phase === 'guess' || G.phase === 'svote' || G.phase === 'sbest')) s.reveal_in = Math.max(0, G.revealAt - Date.now());
    if (REMOTE) { s.remote = true; if (G.clip && (G.phase === 'loading' || G.phase === 'guess' || G.phase === 'reveal')) s.clip = G.clip; }
    // Phones get the question and the options, never which option is right (until the reveal).
    if (G.q && (G.phase === 'guess' || G.phase === 'reveal')) s.q = { subject: G.q.subject, type: G.q.type, text: G.q.text, hint: G.q.hint, options: G.q.options, noclip: !!G.q.noclip };
    if (G.q && G.phase === 'reveal') { s.q.correct = G.q.correct; s.q.answer = G.q.answer; s.q.explain = G.q.explain; }
    if (G.draw && G.phase !== 'end' && G.phase !== 'lobby') {
      var dp = players[G.draw.pid];
      s.draw = { id: G.draw.id, pid: G.draw.pid, name: dp ? dp.name : '?', options: G.phase === 'dpick' ? G.draw.options.map(songLabel) : null, song: G.draw.chosen != null ? songLabel(G.draw.options[G.draw.chosen]) : '' };
    }
    if ((G.phase === 'reveal' || G.phase === 'end') && G.song) s.reveal = { year: G.song[0], code: G.song[1], artist: G.song[2], title: G.song[3], result: resultText(G.song) };
    return s;
  }
  function push() { if (!recovering) net.send('state', snapshot()); save(); render(); }

  // ---------- save & restore ----------
  function save() {
    try {
      localStorage.setItem(SAVE, JSON.stringify({ t: Date.now(), phase: G.phase, round: G.round, total: G.total, guessMs: G.guessMs,
        era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, scoring: G.scoring, showScore: G.showScore, used: Object.keys(G.used),
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
    if (c.showScore === 'always' || c.showScore === 'end') G.showScore = c.showScore;
    $('s-scoring').value = G.scoring; $('s-show').value = G.showScore;
    if (G.atype === 'open' || G.atype === 'mix') G.atype = 'mc';   // typed answers were removed; older saved games fall back to multiple choice
    if (G.subject === 'sing') { G.atype = 'sing'; G.subject = 'country'; }   // games saved before Sing! moved to Category
    $('s-era').value = G.era; $('s-cat').value = G.cat;
    $('s-atype').value = G.atype; $('s-subject').value = G.subject; $('s-subject').disabled = $('s-scoring').disabled = G.atype === 'sing' || G.atype === 'draw'; scoreHelp();
    if ([5, 10, 15, 20].indexOf(G.total) >= 0) $('s-rounds').value = G.total;
    if ([5, 10, 15, 30].indexOf(G.guessMs / 1000 - AFTER) < 0) G.guessMs = (15 + AFTER) * 1000;   // games saved with the old Guessing time setting
    $('s-time').value = G.guessMs / 1000 - AFTER;
    buildPool();
  }
  function adopt(last) {
    adopted = true;
    G.total = +last.total || 10; G.guessMs = +last.total_ms || 20000;
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
  var endShown = false;
  function ptsLabel(n) { return n + (n === 1 ? ' point' : ' points'); }
  function show(id) { ['v-lobby', 'v-brief', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want(id === 'v-lobby' || (id === 'v-brief' && G.phase === 'brief')); }   // menu music until the fanfare
  // "Show score: at the end of the round" keeps every total secret until the final scoreboard.
  function hideScores() { return G.showScore === 'end' && G.phase !== 'end' && G.phase !== 'lobby' && G.phase !== 'brief'; }
  function boardHtml(showGot) {
    var hide = hideScores();
    var ps = hide ? list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) : list();   // no order to read the ranking from
    return ps.map(function (p) {
      return '<li class="' + (showGot && p.got && !hide ? 'got ' : '') + (p.off ? 'off' : '') + '"><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span>' + (hide ? '?' : p.score +
        (showGot && p.got ? '<span class="pts">+' + p.pts + '</span>' : '')) + '</span></li>';
    }).join('') || '<li class="mute">No players yet</li>';
  }
  var joinSeen = {}, joinQuiet = Date.now() + 2500;   // players restored when the page opens do not pop
  function render() {
    var ps = list();
    // A player who has just joined pops in with a chime, so nobody misses it.
    var nowT = Date.now(), fresh = false;
    ps.forEach(function (p) { if (!joinSeen[p.pid]) { joinSeen[p.pid] = nowT > joinQuiet ? nowT : 1; if (nowT > joinQuiet) fresh = true; } });
    if (fresh && G.phase === 'lobby') Music.blip();
    $('players').innerHTML = ps.map(function (p) {
      var age = nowT - joinSeen[p.pid], pop = age < 700;
      return '<span class="chip' + (p.off ? ' off' : '') + (pop ? ' pop' : '') + '"' + (pop ? ' style="animation-delay:-' + age + 'ms"' : '') + '>' + charSvg(p.char) + esc(p.name) + '</span>';
    }).join('') || '<span class="mute">Waiting for players…</span>';
    $('pcount').textContent = ps.length ? '(' + ps.length + ')' : '';
    $('board').innerHTML = boardHtml(G.phase === 'guess' || G.phase === 'reveal');
    $('boardtitle').textContent = hideScores() ? 'Scores at the end' : 'Scores';
    $('newgame').classList.toggle('hidden', G.phase === 'lobby');
    var noCtrl = G.phase === 'lobby' || G.phase === 'brief' || G.phase === 'intro' || G.phase === 'end';
    $('ctrl').classList.toggle('hidden', noCtrl); $('next').classList.toggle('hidden', noCtrl);
    $('hostmain').classList.toggle('ingame', G.phase !== 'lobby' && G.phase !== 'end' && G.phase !== 'brief' && G.phase !== 'intro');
    $('hostmain').classList.toggle('briefing', G.phase === 'brief' || G.phase === 'intro');
    // The fanfare is sound only: its player stays out of sight (but not display:none, or it would not play).
    $('v-game').classList.toggle('audioonly', G.phase === 'intro');
    if (G.phase === 'intro') $('v-game').classList.remove('hidden');
    if (window.selfSize) window.selfSize();
    if (G.phase !== 'end') endShown = false;
    if (G.phase === 'lobby') show('v-lobby');
    else if (G.phase === 'brief' || G.phase === 'intro') { show('v-brief'); renderBrief(); }
    else if (G.phase === 'end') {
      show('v-end');
      // Count the scores up once; the winner is only named when the counting is done.
      if (!endShown) {
        endShown = true;
        $('endlead').textContent = 'Final scores'; $('winner').textContent = '…'; $('winchar').innerHTML = '';
        finalBoard($('final'), ps, null, function (wins) {
          $('endlead').textContent = wins.length ? 'And the winner is…' : 'Final scores';
          $('winner').textContent = wins.length ? wins.map(function (w) { return w.name; }).join(' & ') + ' · ' + ptsLabel(wins[0].score) : 'Nobody scored';
          $('winchar').innerHTML = wins.length === 1 ? charSvg(wins[0].char) : '';
        });
      }
    } else {
      show('v-game');
      $('roundlabel').textContent = 'Song ' + G.round + ' / ' + G.total;
      renderQuestion(); renderAnswered();
      var between = G.phase === 'reveal' || G.phase === 'paused';
      $('guessui').classList.toggle('hidden', between);
      $('revealui').classList.toggle('hidden', !between);
      $('next').disabled = !(ytReady && songs.length) || !between;
      if (G.phase === 'paused') {
        cover(true, '↻', 'Game restored', false);
        $('rtitle').textContent = G.round ? 'Song ' + G.round + ' of ' + G.total + ' done' : 'Ready for song 1';
        $('rmeta').textContent = G.round >= G.total ? 'Only the final scores are left.' : 'Press continue when everyone is back.';
        $('rres').textContent = ''; $('ranswer').textContent = '';
        $('next').textContent = G.round >= G.total ? 'Final scores' : 'Continue';
      }
      $('rwhy').textContent = G.phase === 'reveal' && G.q && G.q.explain ? G.q.explain : '';   // why it is the odd one out, right under the video
      // "Continue" moves a Sing! round along; otherwise the button only appears when YouTube will not play anything.
      $('skip').disabled = !(G.phase === 'guess' || (G.sing && G.phase !== 'reveal' && G.phase !== 'loading'));
      var adWait = adShown && G.phase === 'loading';   // waiting on an ad: offer a way out
      if (adWait) $('skip').disabled = false;
      $('skip').textContent = adWait ? 'Skip this song' : $('skip').textContent;
      $('skip').classList.toggle('hidden', $('skip').disabled || !(G.sing || stuck || adWait));
      if (G.phase === 'reveal' && G.song) {
        $('rtitle').textContent = G.song[3];
        $('rmeta').textContent = G.song[2] + ' · ' + flag(G.song[1]) + ' ' + (countries[G.song[1]] || G.song[1]) + ' ' + G.song[0];
        $('rres').textContent = resultText(G.song);
        $('ranswer').textContent = '';   // the green bar already says it
        $('next').textContent = G.round >= G.total ? 'Final scores' : 'Next';
      }
      renderSing();
    }
    if (G.phase === 'intro') $('v-game').classList.remove('hidden');
  }
  // The question (and, for multiple choice, the four options) on the big screen.
  function renderQuestion() {
    var q = G.q, on = q && (G.phase === 'guess' || G.phase === 'reveal');
    var dp = G.draw && players[G.draw.pid];
    $('qtext').textContent = on && G.phase === 'guess' ? q.text : G.phase === 'dpick' ? (dp ? dp.name : 'Someone') + ' is choosing a song to draw' : '';
    $('qopts').innerHTML = on && q.options ? q.options.map(function (o, i) {
      return '<div class="opt' + (G.phase === 'reveal' ? (i === q.correct ? ' right' : ' dim') : '') + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</div>';
    }).join('') : '';
    $('qopts').classList.remove('votelist');
  }
  // Everyone's character under the video, with a green ring once their answer is in.
  function renderAnswered() {
    var on = G.phase === 'guess' || (G.sing && (G.phase === 'srec' || G.phase === 'sbest'));   // during the song vote the voters show behind each song instead
    var play = G.sing && G.phase === 'splay';
    $('answered').classList.toggle('hidden', !on && !play);
    if (play) {
      // The singers in playing order; the one being heard right now lights up.
      $('answered').innerHTML = G.sing.order.map(function (pid) { var p = players[pid]; return p ? '<div class="pl' + (pid === G.sing.now ? ' now' : '') + '">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></div>' : ''; }).join('');
      return;
    }
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
    $('drawview').classList.toggle('hidden', !(G.draw && G.phase === 'guess'));
    $('briefcd').textContent = G.phase === 'intro' ? 'Starting in ' + Math.max(1, Math.ceil((G.endsAt - Date.now()) / 1000)) : '';
    var voteCd = G.phase === 'svote' || G.phase === 'sbest';
    var cd = (G.phase === 'guess' || voteCd) && G.revealAt ? Math.max(0, Math.ceil((G.revealAt - Date.now()) / 1000)) : 0;
    $('allin').textContent = cd ? (voteCd ? 'Everyone has voted. Continuing in ' : list().length > 1 ? 'All players answered. Revealing in ' : 'Revealing in ') + cd : '';   // alone: nobody else to wait for
    var timed = G.phase === 'guess' || G.phase === 'dpick' || (G.sing && (G.phase === 'svote' || G.phase === 'slisten' || G.phase === 'srec' || G.phase === 'sbest'));
    $('tbar').style.transform = 'scaleX(' + (timed ? Math.max(0, Math.min(1, (G.endsAt - Date.now()) / (G.barMs || G.guessMs))) : 0) + ')';
  }, 100);

  // ---------- YouTube ----------
  window.onYouTubeIframeAPIReady = function () {
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () {
        if (stage === 'probe' || stage === 'seek') { if (G.song) markBad(G.song[4]); badSong(); }
        else if (stage === 'intro' && ++introTry < INTRO.ids.length) { try { yt.loadVideoById(INTRO.ids[introTry]); } catch (e) {} }   // fanfare unavailable: try the spare
      } }
    });
  };
  if (REMOTE) {
    ytReady = true;
    document.body.classList.add('remote');
    $('joinlead').textContent = 'Let the others join on their phone at';
    $('selfplay').src = './?k=' + room + '&embed=1'; $('selfplay').classList.remove('hidden');
    // The host first picks a name and an avatar; the lobby with the code and settings opens after that.
    document.body.classList.add('selfpending');
    var selfH = 0;
    window.selfSize = function () { $('selfplay').style.height = $('hostmain').classList.contains('ingame') || !selfH ? '' : selfH + 'px'; };
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.esc === 'h') { selfH = Math.max(48, Math.min(1400, +e.data.h || 0)); selfSize(); return; }
      if (e.data.esc !== 'joined') return;
      document.body.classList.remove('selfpending'); $('selfnote').classList.remove('hidden');
    });
    var so = $('s-atype').querySelector('option[value="sing"]'); if (so) so.remove();   // Sing! needs the shared screen
  } else {
    var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  }

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); }

  function loadSong(fixed) {
    if (REMOTE) { remoteLoad(fixed); return; }
    stopTimers(); stuck = false;
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = fixed || free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    G.q = G.sing ? null : G.draw ? G.q : makeQuestion(G.song, G.subject, G.atype, songs, countries);
    stage = 'probe';
    cover(true, '', 'Selecting song', false); countStart(); masks(true);
    yt.mute(); yt.loadVideoById(G.song[4]);
    adNote(false);
    var frac = Math.random(), seekAt = 0, loadAt = Date.now();
    // Give up after 12 seconds of nothing. While something is playing (an ad, usually) wait longer.
    watchdog = setTimeout(function wd() {
      var s0 = -1; try { s0 = yt.getPlayerState(); } catch (e) {}
      // An ad (or a very slow start): leave plenty of time to watch or skip it. A real refusal by YouTube
      // comes in as an error and moves on at once; the Skip button is there for anything else.
      if ((adShown || s0 === 1 || s0 === 3) && Date.now() - loadAt < 120000) { watchdog = setTimeout(wd, 4000); return; }
      badSong();
    }, 12000);
    // Wait until the video really plays, then jump to a random point. YouTube sometimes puts an ad first:
    // it cannot be skipped or detected from here, only noticed (the jump does not take, or what plays is
    // far too short to be a song). Then the player is uncovered so the ad can be skipped on the screen,
    // and the jump is repeated until the real video is at the right spot.
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0, late = Date.now() - loadAt;
      if (late > 6000) adNote(true);   // stuck for whatever reason: show the player, so an ad or an error is visible and can be clicked
      if (st !== 1 || d <= 0) return;
      if (d < 100 && late < 40000) { if (late > 2500) adNote(true); return; }   // shorter than any song
      var cs = d < 45 ? 0 : Math.floor(15 + frac * (d - 15 - 20 - clipSecs()));
      if (G.sing) {
        // Sing! wants the chorus: an exact start from chorus.json if the song has one, otherwise the
        // stretch where a three-minute Eurovision song usually reaches its first chorus.
        var known = chorus[G.song[4]];
        if (typeof known === 'number' && known < d - 5) cs = Math.max(0, Math.floor(known));
        else if (d >= 110) cs = Math.floor(45 + frac * 30);
      }
      if (stage === 'probe' || cs !== clipStart) { clipStart = cs; stage = 'seek'; seekAt = 0; }
      if (t >= clipStart && t < clipStart + 5) {
        clearInterval(poll); clearTimeout(watchdog); fails = 0; adNote(false);
        yt.pauseVideo(); stage = 'ready'; clipReady = true;   // the countdown starts the clip
      } else if (Date.now() - seekAt > 2500) {
        seekAt = Date.now(); yt.seekTo(clipStart, true);
        if (late > 6000) adNote(true);
      }
    }, 120);
  }
  // An ad seems to be playing: show the player (title bar stays masked) so it can be skipped by hand.
  var adShown = false;
  function adNote(on) {
    if (on === adShown) return;
    adShown = on;
    document.querySelector('#v-game .shield').classList.toggle('hidden', on);
    if (on) { cover(false); $('mb').classList.add('hidden'); $('err').textContent = AD_TEXT; }
    else if ($('err').textContent === AD_TEXT) $('err').textContent = '';
    render();   // shows or hides the Skip button
  }
  var stuck = false;   // six songs in a row would not play
  function badSong() {
    stopTimers(); fails++; adNote(false);
    if (fails >= 6) {
      stuck = true;
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
    if (G.draw) { fails = 0; stage = 'idle'; clipReady = true; return; }   // Draw! does not need the video: carry on, the drawing starts after the countdown
    loadSong();
  }
  function playClip() {
    clearInterval(poll);
    stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipSecs()) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (G.phase === 'guess') cover(true, '?', '', false);   // the question itself stays below the video
        if (G.sing && G.phase === 'slisten') singRecord();
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    var ms = G.draw ? DRAW_MS : G.guessMs;
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms;
    if (G.q && G.q.noclip) { clearInterval(poll); stage = 'paused'; cover(true, G.draw ? '✏️' : '?', '', false); }   // odd one out and Draw!: no clip
    else playClip();
    push();
    endTimer = setTimeout(reveal, ms);
  }
  function reveal() {
    if (G.phase !== 'guess') return;
    stopTimers(); G.phase = 'reveal'; stage = 'reveal'; G.revealAt = 0;
    // Multiple choice is scored now, from the answer each player was holding.
    // For "order" scoring the right answers are ranked by when they were put in.
    var right = G.q && G.q.type === 'mc' ? list().filter(function (p) { return p.pick === G.q.correct && !(G.draw && p.pid === G.draw.pid); })
      .sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); }) : [];
    right.forEach(function (p, rank) { p.pts = pointsFor(G.draw ? 'order' : G.scoring, p.pickMs, G.guessMs, rank); p.score += p.pts; p.got = true; });
    // Draw!: the first to guess gets 12, then 10, 8…; the drawer gets 12 as soon as anyone guessed it.
    var artist = G.draw && players[G.draw.pid];
    if (artist && right.length) { artist.pts = 12; artist.score += 12; artist.got = true; }
    cover(false); masks(false);
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    push(); autoStart();
  }
  function startRound() {
    G.round++; G.phase = 'loading';
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; });
    G.q = null; G.revealAt = 0; singClear(); G.draw = null; clearTimeout(drawTimer);
    if (G.atype === 'sing' && !REMOTE) { singStart(); return; }
    if (G.atype === 'draw') { drawStart(); return; }
    push(); loadSong();
  }

  // ---------- hosting without a shared screen ----------
  // There is no video on this page: every phone plays its own. The host still decides the song,
  // the question and the timing, and plays along in the frame at the bottom of the page.
  var LOAD_MIN = 5000, LOAD_MAX = 13000, remoteTimer = null, remoteT0 = 0;
  function remoteLoad(fixed) {
    stopTimers(); clearTimeout(remoteTimer);
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = fixed || free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    if (!G.draw) G.q = makeQuestion(G.song, G.subject, G.atype, songs, countries);
    G.clip = { id: G.song[4], frac: Math.random() }; G.ready = {}; G.badVotes = 0; G.remain = 0; G.adWait = 0;
    G.phase = 'loading'; remoteT0 = Date.now(); push();
    remoteTimer = setTimeout(remoteGo, LOAD_MAX);
  }
  // Start once every connected phone has the clip loaded (but not before the short countdown).
  function remoteCheck() {
    if (!REMOTE || G.phase !== 'loading') return;
    var act = list().filter(function (x) { return !x.off; });
    if (!act.length || !act.every(function (p) { return G.ready[p.pid]; })) return;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(remoteGo, Math.max(0, LOAD_MIN - (Date.now() - remoteT0)));
  }
  function remoteGo() {
    if (G.phase !== 'loading') return;
    clearTimeout(remoteTimer);
    var ms = G.draw ? DRAW_MS : G.guessMs;
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms; push();
    endTimer = setTimeout(reveal, ms);
  }

  // ---------- Draw! ----------
  // Players take turns. The drawer picks one of four songs and draws it on their phone; the lines show
  // live on the big screen and on the other phones, and everyone else guesses which of the four it is.
  var drawTimer = null;
  function drawStart() {
    var ps = list().filter(function (p) { return !p.off; }).sort(function (a, b) { return a.pid < b.pid ? -1 : 1; });
    if (!ps.length) ps = list();
    if (!ps.length) { push(); loadSong(); return; }
    var who = ps[G.drawTurn++ % ps.length].pid;
    fourSongs(function (four) { drawStart2(who, four); });
  }
  function drawStart2(who, four) {
    G.draw = { pid: who, options: four, chosen: null, id: Math.random().toString(36).slice(2, 8) };
    G.phase = 'dpick'; G.barMs = DRAW_PICK_MS; G.endsAt = Date.now() + DRAW_PICK_MS;
    drawClear($('drawview'));
    if (!REMOTE) { cover(true, '✏️', 'Draw!', false); masks(true); }
    clearTimeout(drawTimer); drawTimer = setTimeout(function () { drawPicked(Math.floor(Math.random() * G.draw.options.length)); }, DRAW_PICK_MS);
    push();
  }
  function drawPicked(i) {
    if (!G.draw || G.phase !== 'dpick' || !G.draw.options[i]) return;
    clearTimeout(drawTimer);
    G.draw.chosen = i;
    var labels = G.draw.options.map(songLabel), dp = players[G.draw.pid];
    G.q = { subject: 'draw', type: 'mc', text: 'What is ' + (dp ? dp.name : 'the artist') + ' drawing?', hint: '', options: labels, correct: i, answer: labels[i], noclip: true };
    G.phase = 'loading'; push();
    loadSong(G.draw.options[i]);
  }
  net.on('draw', function (m) {
    if (!m || !G.draw || m.pid !== G.draw.pid) return;
    if (typeof m.pick === 'number') { drawPicked(m.pick); return; }
    if (G.phase === 'guess') drawPaint($('drawview'), m);
  });
  net.on('ready', function (m) {
    var p = m && players[m.pid];
    if (!REMOTE || !p || G.phase !== 'loading' || !G.clip || m.key !== G.clip.id + ':' + G.round) return;
    if (m.ad) {   // that phone is stuck behind an ad: give everyone up to a minute before starting without it
      if (!G.adWait) { G.adWait = 1; clearTimeout(remoteTimer); remoteTimer = setTimeout(remoteGo, Math.max(0, 60000 - (Date.now() - remoteT0))); push(); }
      return;
    }
    if (m.bad && !G.draw) {
      // The video will not play on that phone: take another song (a few times at most).
      if (++fails < 6) { G.round--; startRound(); }
      return;
    }
    if (m.rem > 0 && m.rem < 900) G.remain = Math.max(G.remain || 0, +m.rem);   // how long the song still runs from the clip start
    G.ready[p.pid] = 1; remoteCheck();
  });


  // ---------- before the first song ----------
  // A briefing with the settings and the scoring; every player presses Ready. When all are ready the
  // Eurovision fanfare plays under a countdown, and then the first song starts.
  var introTimer = null, introTry = 0;
  function optText(id) { var el = $(id); return el.options[el.selectedIndex] ? el.options[el.selectedIndex].textContent : ''; }
  function briefInfo() {
    var sing = G.atype === 'sing' || G.atype === 'draw';
    var rows = [['Songs', G.total], ['Video time', optText('s-time')], ['Years', optText('s-era')], ['Entries', optText('s-cat')], ['Category', optText('s-atype')]];
    if (!sing) rows.push(['Answers', optText('s-subject')], ['Scoring', optText('s-scoring')]);
    rows.push(['Show score', optText('s-show')]);
    return { rows: rows, scoring: G.atype === 'draw' ? DRAW_HELP : sing ? 'Sing!: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : SCORING_HELP[G.scoring] };
  }
  function briefStart() {
    stopTimers(); clearTimeout(introTimer);
    G.phase = 'brief'; G.go = {}; G.brief = briefInfo(); push();
  }
  function briefCheck() {
    if (G.phase !== 'brief') return;
    var act = list().filter(function (x) { return !x.off; });
    if (act.length && act.every(function (p) { return G.go[p.pid]; })) introStart();
  }
  function introStart() {
    if (G.phase !== 'brief') return;
    G.phase = 'intro'; G.barMs = INTRO.ms; G.endsAt = Date.now() + INTRO.ms; introTry = 0; stage = 'intro';
    list().forEach(function (p) { G.go[p.pid] = 1; });
    if (!REMOTE) {
      cover(false); masks(false);
      try { yt.loadVideoById(INTRO.ids[0]); yt.unMute(); yt.setVolume(100); } catch (e) {}
    }
    push();
    introTimer = setTimeout(introEnd, INTRO.ms);
  }
  // The fanfare is over, or the host pressed "Start now": on to the first song.
  function introEnd() {
    if (G.phase !== 'intro') return;
    clearTimeout(introTimer);
    try { if (!REMOTE) yt.pauseVideo(); } catch (e) {}
    stage = 'idle'; startRound();
  }
  $('introgo').addEventListener('click', introEnd);
  net.on('go', function (m) {
    var p = m && players[m.pid];
    if (!p || G.phase !== 'brief') return;
    G.go[p.pid] = 1; push(); briefCheck();
  });
  $('briefgo').addEventListener('click', introStart);
  function renderBrief() {
    var b = G.brief || briefInfo();
    $('briefset').innerHTML = b.rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    $('briefscore').textContent = b.scoring;
    var ps = list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    $('briefplayers').innerHTML = ps.map(function (p) { return '<div class="pl' + (G.go[p.pid] ? ' in' : '') + (p.off ? ' off' : '') + '">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></div>'; }).join('') || '<span class="mute">No players yet</span>';
    var n = ps.filter(function (p) { return G.go[p.pid]; }).length;
    $('introgo').classList.toggle('hidden', G.phase !== 'intro');
    $('briefgo').classList.toggle('hidden', G.phase === 'intro'); $('briefhint').classList.toggle('hidden', G.phase === 'intro');
    $('briefcount').textContent = ps.length ? '(' + n + ' of ' + ps.length + ' ready)' : '';
  }

  // ---------- Sing! ----------
  // A song round without a quiz question: vote for one of four songs, listen to it, record up to
  // 10 seconds on the phone, hear every recording over the muted video, then vote for the best.
  // Recordings travel phone -> host as chunks over the room connection and are never stored.
  var SING = { vote: 20000, rec: 45000, best: 45000 }, singTimer = null, bestTimer = null, singAudio = null;
  function stopAudio() { if (singAudio) { try { singAudio.onended = singAudio.onerror = null; singAudio.pause(); } catch (e) {} singAudio = null; } }
  function singClear() {
    clearTimeout(singTimer); clearTimeout(bestTimer); stopAudio();
    if (G.sing) Object.keys(G.sing.clips).forEach(function (k) { try { URL.revokeObjectURL(G.sing.clips[k]); } catch (e) {} });
    G.sing = null;
  }
  // YouTube sometimes comes back with sound after a seek, so during playback of the recordings the
  // video is silenced repeatedly: muted and at volume 0.
  var silenceTick = null;
  function silence() {
    try { yt.mute(); yt.setVolume(0); } catch (e) {}
    if (!silenceTick) silenceTick = setInterval(function () {
      if (G.sing && (G.phase === 'splay' || G.phase === 'sbest' || G.sing.loop)) { try { yt.mute(); yt.setVolume(0); } catch (e) {} }
      else { clearInterval(silenceTick); silenceTick = null; }
    }, 150);
  }
  function singPhase(phase, ms) { G.revealAt = 0; G.phase = phase; G.sing.in = {}; G.barMs = ms; G.endsAt = Date.now() + ms; clearTimeout(singTimer); }
  // Sing! and Draw! let players choose a song, so the four on offer are tested first: each video is
  // started muted in a tiny hidden player. Ones YouTube refuses are dropped (and remembered), so the
  // song that wins the vote is the song that plays.
  var probeRun = 0;
  function probeSongs(cands, need, cb) {
    var run = ++probeRun, ok = [], i = 0, active = 0, done = false, box = $('probebox'), all;
    var finish = function () {
      if (done) return; done = true; clearTimeout(all); box.innerHTML = '';
      if (run !== probeRun) return;
      cands.forEach(function (s) { if (ok.length < need && ok.indexOf(s) < 0 && !BAD_VIDEOS[s[4]]) ok.push(s); });   // not enough tested ones: top up with untested
      cb(ok.slice(0, need));
    };
    var launch = function () {
      while (!done && active < 4 && i < cands.length && ok.length + active < need) start(cands[i++]);
      if (!done && !active) finish();
    };
    var start = function (song) {
      active++;
      var el = document.createElement('div'), settled = false, pl = null;
      box.appendChild(el);
      var settle = function (good) {
        if (settled) return; settled = true; clearTimeout(to); active--;
        try { pl.destroy(); } catch (e) {}
        if (good) ok.push(song); else if (good === false) markBad(song[4]);
        if (ok.length >= need) finish(); else launch();
      };
      var to = setTimeout(function () { settle(null); }, 6000);
      try {
        pl = new YT.Player(el, { width: 160, height: 90, videoId: song[4], playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1 },
          events: { onReady: function (e) { try { e.target.mute(); e.target.playVideo(); } catch (x) {} }, onStateChange: function (e) { if (e.data === 1) settle(true); }, onError: function () { settle(false); } } });
      } catch (e) { settle(null); }
    };
    all = setTimeout(finish, 12000);
    launch();
  }
  function fourSongs(cb) {
    var free = G.pool.filter(function (s) { return !G.used[s[4]] && !BAD_VIDEOS[s[4]]; });
    if (free.length < 4) { G.used = {}; free = G.pool.filter(function (s) { return !BAD_VIDEOS[s[4]]; }); }
    var cands = shuffle(free.slice()).slice(0, 12), round = G.round;
    if (REMOTE || !ytReady || !window.YT || !YT.Player) { cb(cands.slice(0, 4)); return; }   // no player on this page: nothing to test with
    G.phase = 'loading'; cover(true, '', 'Picking songs…', false); masks(true); push();
    probeSongs(cands, 4, function (four) { if (G.round === round && G.phase === 'loading' && four.length) cb(four); else if (G.round === round && G.phase === 'loading') cb(cands.slice(0, 4)); });
  }
  function singStart() { fourSongs(singStart2); }
  function singStart2(four) {
    G.sing = { options: four, chosen: null, tried: {}, votes: {}, parts: {}, clips: {}, order: [], idx: -1, now: null, best: {}, result: null, in: {} };
    singPhase('svote', SING.vote);
    cover(true, '🎤', 'Sing!', false); masks(true);
    singTimer = setTimeout(singVoteEnd, SING.vote); push();
  }
  function singVoteEnd() {
    if (!G.sing || G.phase !== 'svote') return;
    clearTimeout(singTimer); G.revealAt = 0;
    var c = G.sing.options.map(function () { return 0; }), pid, top = [];
    for (pid in G.sing.votes) c[G.sing.votes[pid]]++;
    var max = Math.max.apply(null, c);
    c.forEach(function (n, i) { if (n === max) top.push(i); });
    G.sing.chosen = pick(top); G.sing.tried[G.sing.chosen] = 1;
    G.phase = 'loading'; G.sing.in = {}; push();
    loadSong(G.sing.options[G.sing.chosen]);
  }
  function singListen() {
    G.phase = 'slisten'; G.barMs = clipSecs() * 1000; G.endsAt = Date.now() + G.barMs;
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
    G.sing.idx = -1; G.sing.pass = 1; G.phase = 'splay'; G.sing.in = {};
    singNext();
  }
  function singNext() {
    if (!G.sing || (G.phase !== 'splay' && G.phase !== 'sbest')) return;
    clearTimeout(singTimer); stopAudio();
    var pid = G.sing.order[++G.sing.idx];
    // Everyone is heard once; then the vote opens and the recordings keep going round in the same order.
    if (!pid && G.phase === 'splay' && G.sing.order.length > 1) { singBest(); return; }
    if (!pid && G.phase === 'sbest' && G.sing.order.length) { G.sing.idx = 0; pid = G.sing.order[0]; }
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
    singPhase('sbest', SING.best); G.sing.now = null; G.sing.idx = -1; G.sing.pass = 2;
    clearTimeout(bestTimer); bestTimer = setTimeout(singReveal, SING.best);
    singNext();
  }
  function singReveal() {
    if (!G.sing || G.phase === 'reveal') return;
    clearTimeout(singTimer); clearTimeout(bestTimer); stopAudio(); stopTimers(); G.revealAt = 0;
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
    // The winning recording keeps playing over the (silent) video, which jumps back to the same spot every time.
    var best = G.sing.result.filter(function (r) { return r.win && G.sing.clips[r.pid]; })[0] || (G.sing.result.length === 1 && G.sing.clips[G.sing.result[0].pid] ? G.sing.result[0] : null);
    if (best) { G.sing.loop = best.pid; G.sing.loopFails = 0; winnerLoop(); }
    else { try { if (G.sing.chosen != null) { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {} }
    push(); autoStart();
  }
  function winnerLoop() {
    if (!G.sing || G.phase !== 'reveal' || !G.sing.loop) return;
    clearTimeout(singTimer); stopAudio(); silence();
    try { yt.seekTo(clipStart, true); yt.playVideo(); } catch (e) {}
    silence();
    var a = singAudio = new Audio(G.sing.clips[G.sing.loop]), done = false;
    var again = function () { if (done) return; done = true; clearTimeout(singTimer); singTimer = setTimeout(winnerLoop, 900); };
    // A recording that will not start is tried again a few times, not forever.
    var retry = function () { if (done) return; if (++G.sing.loopFails > 4) { done = true; return; } again(); };
    a.onended = function () { G.sing.loopFails = 0; again(); }; a.onerror = retry;
    var pr = a.play(); if (pr && pr.catch) pr.catch(retry);
    singTimer = setTimeout(again, 13000);
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
    if (part.done) return;   // a repeat of a recording that already arrived
    if (part.data[m.i] == null) { part.data[m.i] = m.data; part.got++; }
    if (part.got !== part.n) return;
    part.done = true;
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
      now: sg.now && players[sg.now] ? players[sg.now].name : null, result: sg.result, pass: sg.pass || 1,
      tally: G.phase === 'svote' ? sg.options.map(function (o, i) { var n = 0, k; for (k in sg.votes) if (sg.votes[k] === i) n++; return n; }) : null };
  }
  function renderSing() {
    var sg = G.sing;
    $('skip').textContent = sg && G.phase !== 'reveal' ? 'Continue' : 'Show answer';
    if (!sg) return;
    var song = sg.chosen != null ? sg.options[sg.chosen] : null, name = song ? song[3] + ' – ' + song[2] : '', t = '', opts = '';
    if (G.phase === 'svote') { t = 'Sing! Vote for the song'; opts = sg.options.map(function (o, i) {
      // Under each song: who voted for it so far.
      var who = list().filter(function (p) { return sg.votes[p.pid] === i; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return '<div class="optcol"><div class="opt"><b>' + 'ABCD'[i] + '</b>' + esc(o[3] + ' – ' + o[2]) + '</div><div class="voters">' +
        (who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (p) { return '<span>' + charSvg(p.char) + esc(p.name) + '</span>'; }).join('') : '<span class="mute">No votes yet</span>') + '</div></div>';
    }).join(''); }
    else if (G.phase === 'loading') t = 'We’re singing: ' + name;
    else if (G.phase === 'slisten') t = 'Listen first: ' + name;
    else if (G.phase === 'srec') t = 'Sing it! Record up to 10 seconds on your phone';
    else if (G.phase === 'splay') t = (sg.pass === 2 ? 'Once more: ' : 'Now singing: ') + (players[sg.now] ? players[sg.now].name : '');
    else if (G.phase === 'sbest') { t = 'Who sang it best? Vote on your phone'; opts = sg.order.map(function (pid) { var p = players[pid]; return p ? '<div class="opt' + (pid === sg.now ? ' singing' : '') + '">' + charSvg(p.char) + esc(p.name) + (pid === sg.now ? ' <span class="note">♪ singing now</span>' : '') + '</div>' : ''; }).join(''); }
    else if (G.phase === 'reveal') {
      var wins = (sg.result || []).filter(function (r) { return r.win; }).map(function (r) { return r.name; });
      $('ranswer').textContent = !sg.result || !sg.result.length ? 'Nobody sang this time' : wins.length ? 'Best singer: ' + wins.join(' & ') : 'Thanks for singing!';
      opts = (sg.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + charSvg(r.char) + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
    }
    $('qtext').textContent = t; $('qopts').innerHTML = opts;
    $('qopts').classList.toggle('votelist', G.phase === 'svote');   // the song vote: one song per row, its voters behind it
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
  function singToggle() { var on = $('s-atype').value === 'sing' || $('s-atype').value === 'draw'; $('s-subject').disabled = on; $('s-scoring').disabled = on; scoreHelp(); }
  $('s-atype').addEventListener('change', singToggle);
  function scoreHelp() {
    var show = $('s-show').value === 'end' ? ' Totals stay hidden until the final scoreboard.' : '';
    $('scorehelp').textContent = ($('s-atype').value === 'draw' ? DRAW_HELP : $('s-atype').value === 'sing' ? 'Sing!: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : (SCORING_HELP[$('s-scoring').value] || '')) + show;
  }
  $('s-scoring').addEventListener('change', scoreHelp); $('s-show').addEventListener('change', scoreHelp); scoreHelp();
  ['s-era', 's-cat'].forEach(function (id) { $(id).addEventListener('change', function () { G.era = $('s-era').value; G.cat = $('s-cat').value; ready(); }); });
  function toLobby() {
    stopTimers(); autoStop(); singClear(); G.draw = null; clearTimeout(drawTimer); probeRun++; $('probebox').innerHTML = ''; clearTimeout(introTimer); clearTimeout(remoteTimer); G.clip = null; clearInterval(loadTick); loadT0 = 0; stage = 'idle';
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
  // Without a shared screen the scoreboard is tucked behind a button; tap it again to close.
  $('boardbtn').addEventListener('click', function () { $('v-game').classList.add('showboard'); });
  $('v-game').querySelector('aside').addEventListener('click', function () { $('v-game').classList.remove('showboard'); });
  $('rehostbtn').addEventListener('click', function () {
    $('rehostform').classList.toggle('hidden'); $('rehosthelp').classList.toggle('hidden');
    if (!$('rehostform').classList.contains('hidden')) $('rehostcode').focus();
  });
  $('rehostform').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = $('rehostcode').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length === 4) location.href = location.pathname + '?room=' + c + (REMOTE ? '&screen=0' : '');
  });
  $('start').addEventListener('click', function () {
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.atype = $('s-atype').value; G.subject = $('s-subject').value; G.scoring = $('s-scoring').value; G.showScore = $('s-show').value;
    if (!buildPool()) return;
    G.total = +$('s-rounds').value; G.guessMs = (+$('s-time').value + AFTER) * 1000;   // the clip, then 5 seconds more to answer
    G.round = 0; G.used = {}; fails = 0; note('');
    list().forEach(function (p) { p.score = 0; });
    briefStart();
  });
  // Autoplay: with the box ticked the next song starts by itself, after 10, 20 or 30 seconds or when
  // the song that is playing has finished ("Until the end").
  var autoTick = null, autoEnd = 0;
  try { $('auto').checked = localStorage.getItem('esc-auto') === '1'; var al = localStorage.getItem('esc-autolen'); if (al && $('autolen').querySelector('option[value="' + al + '"]')) $('autolen').value = al; } catch (e) {}
  // Seconds left of the song that is playing, or null when that cannot be told right now.
  function songLeft() {
    try { var st = yt.getPlayerState(), d = yt.getDuration() || 0, t = yt.getCurrentTime() || 0; if (st === 0) return 0; if (st === 1 && d > 0) return Math.max(0, d - t); } catch (e) {}
    return null;
  }
  function autoStop() { clearInterval(autoTick); autoTick = null; $('autoleft').textContent = ''; }
  function autoStart() {
    autoStop();
    if (!$('auto').checked || G.phase !== 'reveal') return;
    var toEnd = $('autolen').value === 'end';
    // Until the end: follow the player. If nothing is playing (or it cannot be read), fall back to a fixed wait.
    autoEnd = Date.now() + (toEnd ? REMOTE ? (G.remain > 0 ? G.remain + 1 : 30) : 20 : +$('autolen').value) * 1000;
    var draw = function () {
      if (toEnd && !REMOTE && !(G.sing && G.sing.loop)) { var rem = songLeft(); if (rem != null) autoEnd = Date.now() + rem * 1000; }
      var left = Math.ceil((autoEnd - Date.now()) / 1000);
      if (G.phase !== 'reveal') { autoStop(); return; }
      if (left <= 0) { autoStop(); goNext(); return; }
      if (toEnd) $('autoleft').textContent = ''; else $('autoleft').textContent = (G.round >= G.total ? 'Final scores in ' : 'Playing next song in ') + clock(left);
    };
    draw(); autoTick = setInterval(draw, 200);
    if (!recovering) net.send('state', snapshot());
  }
  $('auto').addEventListener('change', function () {
    try { localStorage.setItem('esc-auto', $('auto').checked ? '1' : '0'); } catch (e) {}
    autoStart();
    if (!recovering) net.send('state', snapshot());
  });
  $('autolen').addEventListener('change', function () {
    try { localStorage.setItem('esc-autolen', $('autolen').value); } catch (e) {}
    autoStart();
    if (!recovering) net.send('state', snapshot());
  });
  $('skip').addEventListener('click', function () { if (adShown && G.phase === 'loading' && !G.sing && !G.draw) { fails = 0; badSong(); } else if (G.sing) singSkip(); else reveal(); });
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (G.round >= G.total) { try { yt.stopVideo(); } catch (e) {} G.phase = 'end'; push(); } else startRound();
  }
  $('again').addEventListener('click', toLobby);

  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    ready();
  }).catch(function () { $('start').textContent = 'Could not load songs'; });
  fetch('chorus.json?v=43').then(function (r) { return r.json(); }).then(function (d) { chorus = d || {}; }).catch(function () {});
  restore();
  render();
})();
