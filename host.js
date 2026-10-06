(function () {
  var $ = function (id) { return document.getElementById(id); };
  var AFTER = 5;            // seconds to answer after the clip has ended
  function clipSecs() { return Math.max(5, Math.round(G.guessMs / 1000) - AFTER); }   // clip length (the Video length setting)
  var room = '', net, songs = [], countries = {}, chorus = {};
  var REMOTE = new URLSearchParams(location.search).get('screen') === '0';   // a game without a shared screen
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 25000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true, era: '1956-2100', cat: 'all', atype: 'mc', subject: 'random', q: null, sing: null, barMs: 30000, scoring: 'correct', showScore: 'always', revealAt: 0, draw: null, drawTurn: 0, go: {} };
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
    if (m.bye) { var gone = players[m.pid]; if (gone && !gone.off) { gone.off = true; gone.last = 0; push(); allIn(); drawAllCheck(); quipAllCheck(); } return; }   // that phone closed the page
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
    if (changed) push(); else if (m.back) sayHello();   // back from the background: here is how things stand
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
      if (G.draw && (m.pid === G.draw.pid || p.pick != null)) return;
      if (G.best && (G.best.pids[m.choice] === m.pid || p.pick != null)) return;
      if (G.best && G.best.quip && G.best.pids.indexOf(m.pid) >= 0) return;   // Quip!: the two authors do not vote   // best drawing: not your own, and a vote is final   // Draw!: the drawer does not guess, and a first guess is final
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
  var ALLIN_MS = 3000, VOTE_MS = 5000;   // quiz answers: 3, 2, 1; Sing! votes keep 5 seconds
  function isIn(p) {
    if (G.phase === 'brief' || G.phase === 'lobby') return !!(G.go && G.go[p.pid]);
    if (G.phase === 'dall') return !!(G.gallery && G.gallery.items[p.pid] && G.gallery.items[p.pid].done);
    if (G.phase === 'qall') return !!(G.quips && (!G.quips.items[p.pid] || G.quips.items[p.pid].done));   // answer sent (or no line to finish)
    if (G.best && G.best.quip && G.best.pids.indexOf(p.pid) >= 0) return true;   // the authors only watch   // finished drawing
    return G.sing ? !!G.sing.in[p.pid] : (p.got || p.pick != null || !!(G.draw && p.pid === G.draw.pid)); }
  function allIn() {
    var act = list().filter(function (x) { return !x.off; });
    var ph = G.phase;
    if (!act.length || !act.every(isIn)) return;
    // A quiz question: tell everyone, count down from 5, then show the answer.
    var slow = ph === 'guess' || ph === 'svote' || ph === 'sbest';   // these say so on screen and count down from 5
    var wait = ph === 'guess' ? ALLIN_MS : slow ? VOTE_MS : 1200;
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
    if (G.phase === 'end' && G.showScore === 'end') s.count_up = true;   // the totals were hidden: count them up one by one
    if (G.phase === 'brief' || G.phase === 'intro') s.brief = G.brief;
    if (G.phase === 'intro') s.intro = INTRO.ids[0];
    if (G.phase === 'reveal' && autoTick && $('autolen').value !== 'end') s.next_in = Math.max(0, autoEnd - Date.now());   // phones show the autoplay countdown too
    if (G.revealAt && (G.phase === 'guess' || G.phase === 'svote' || G.phase === 'sbest')) s.reveal_in = Math.max(0, G.revealAt - Date.now());
    if (G.phase === 'lobby') s.all_ready = allReady();
    if (G.phase === 'reveal' && lastSong()) s.last = true;
    if (REMOTE) { s.remote = true; if (G.clip && (G.phase === 'loading' || G.phase === 'guess' || G.phase === 'reveal')) s.clip = G.clip; }
    // Phones get the question and the options, never which option is right (until the reveal).
    if (G.q && (G.phase === 'guess' || G.phase === 'reveal')) s.q = { subject: G.q.subject, type: G.q.type, text: G.q.text, hint: G.q.hint, options: G.q.options, noclip: !!G.q.noclip };
    if (G.q && G.phase === 'reveal') { s.q.correct = G.q.correct; s.q.answer = G.q.answer; s.q.explain = G.q.explain; if (G.q.reveal) s.q.reveal = G.q.reveal; }
    if (G.quips && G.phase === 'qall') {
      s.quips = { id: G.quips.id, prompts: {}, done: {} };
      Object.keys(G.quips.items).forEach(function (k) { s.quips.prompts[k] = G.quips.items[k].prompt; if (G.quips.items[k].done) s.quips.done[k] = 1; });
    }
    if (G.gallery && G.phase === 'dall') {
      // Everyone draws at once: each player gets their own four songs.
      s.gallery = { id: G.gallery.id, opts: {}, chosen: {}, done: {} };
      Object.keys(G.gallery.items).forEach(function (k) { var it = G.gallery.items[k]; s.gallery.opts[k] = it.options.map(songLabel); if (it.chosen != null) s.gallery.chosen[k] = it.chosen; if (it.done) s.gallery.done[k] = 1; });
    }
    if (G.best && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal')) s.best = { quip: !!G.best.quip, win_pts: G.best.quip ? QUIP_WIN : BEST_PTS, id: G.best.id, pids: G.best.pids, tally: G.phase === 'reveal' ? G.best.tally : null, wins: G.phase === 'reveal' ? G.best.wins : null, pts: BEST_PTS };
    if (G.draw && G.phase !== 'end' && G.phase !== 'lobby') {
      var dp = players[G.draw.pid];
      s.draw = { id: G.draw.id, pid: G.draw.pid, name: dp ? dp.name : '?', options: null, song: G.draw.chosen != null ? songLabel(G.draw.options[G.draw.chosen]) : '' };
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
    if (G.subject === 'sing') { G.atype = 'sing'; G.subject = 'country'; }
    if (G.subject === 'points') G.subject = 'random';
    if (['country', 'artist', 'title', 'year', 'place'].indexOf(G.subject) >= 0) G.subject = 'facts';   // these are one category now   // the points question was removed
    if (G.phase === 'lobby' || G.phase === 'end') G.go = {};   // games saved before Sing! moved to Category
    $('s-era').value = G.era; $('s-cat').value = G.cat;
    $('s-atype').value = G.atype; $('s-subject').value = G.subject; $('s-subject').disabled = $('s-scoring').disabled = G.atype === 'sing' || G.atype === 'draw' || G.atype === 'quip'; scoreHelp();
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
  var beatAt = 0;
  setInterval(function () {
    var now = Date.now(), ch = false;
    list().forEach(function (p) { var off = now - p.last > 25000; if (off !== !!p.off) { p.off = off; ch = true; } });
    if (ch) { push(); return; }
    // The state goes out whenever something changes; this repeat only repairs a message that got lost.
    // Every device in the room receives it, so: not without players, and less often while nothing is at stake.
    var calm = G.phase === 'lobby' || G.phase === 'reveal' || G.phase === 'end' || G.phase === 'paused';
    if (!recovering && list().length && now - beatAt >= (calm ? 10000 : 5000) - 500) { beatAt = now; net.send('state', snapshot()); }
  }, 2500);

  // ---------- rendering ----------
  var endShown = false, endFanfare = false;
  function ptsLabel(n) { return n + (n === 1 ? ' point' : ' points'); }
  function show(id) { ['v-lobby', 'v-brief', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want((id === 'v-lobby' && G.phase === 'lobby') || (id === 'v-game' && !REMOTE && ((G.phase === 'guess' && !!G.q && !!G.q.noclip) || (roundMode() === 'draw' && (G.phase === 'dall' || G.phase === 'loading')) || G.phase === 'qall'))); }   // menu music until the fanfare
  // "Show score: at the end of the round" keeps every total secret until the final scoreboard.
  function hideScores() { return G.showScore === 'end' && G.phase !== 'end' && G.phase !== 'lobby' && G.phase !== 'brief'; }
  // ---------- Ladder scoring: everyone on one ladder ----------
  // The rungs are drawn once; each player is a small avatar that keeps its element, so a change of
  // rung is a glide up or down instead of a redraw.
  var RUNG_H = 34;
  function renderLadder() {
    var el = $('ladder'), on = ladderGame() && !hideScores() && G.phase !== 'lobby' && G.phase !== 'end';
    el.classList.toggle('hidden', !on); $('board').classList.toggle('hidden', on);
    if (!on) return;
    if (!el.firstChild) {
      var html = '<div class="rails"></div>';
      for (var r = LADDER.length - 1; r >= 0; r--) html += '<div class="rung' + (r === LADDER.length - 1 ? ' top' : '') + '" style="bottom:' + (r * RUNG_H) + 'px"><span>' + (r ? LADDER[r] : 'Start') + '</span></div>';
      el.innerHTML = html + '<div class="climbers"></div>';
      el.style.height = (LADDER.length * RUNG_H + 8) + 'px';
    }
    var box = el.querySelector('.climbers'), seen = {}, byRung = {};
    var ps = list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    ps.forEach(function (p) { var r = p.rung != null ? p.rung : Math.max(0, LADDER.indexOf(p.score)); (byRung[r] = byRung[r] || []).push(p); });
    var room = Math.max(60, el.clientWidth - 64);
    ps.forEach(function (p) {
      var r = p.rung != null ? p.rung : Math.max(0, LADDER.indexOf(p.score)), mates = byRung[r], i = mates.indexOf(p), gap = Math.min(34, room / Math.max(1, mates.length));
      var n = box.querySelector('[data-pid="' + p.pid + '"]');
      if (!n) { n = document.createElement('div'); n.className = 'climber'; n.setAttribute('data-pid', p.pid); n.innerHTML = charSvg(p.char) + '<b></b>'; n.style.bottom = '0px'; n.style.left = '56px'; box.appendChild(n); n.getBoundingClientRect(); }
      n.querySelector('b').textContent = p.name; n.title = p.name;
      n.style.bottom = (r * RUNG_H + 2) + 'px'; n.style.left = (56 + i * gap) + 'px'; n.style.zIndex = 10 + i;
      n.classList.toggle('off', !!p.off);
      n.classList.toggle('up', G.phase === 'reveal' && p.moved === 'up'); n.classList.toggle('down', G.phase === 'reveal' && p.moved === 'down');
      n.classList.toggle('ans', G.phase === 'guess' && isIn(p)); n.classList.toggle('won', r === LADDER.length - 1);
      seen[p.pid] = 1;
    });
    [].forEach.call(box.querySelectorAll('.climber'), function (n) { if (!seen[n.getAttribute('data-pid')]) n.remove(); });
  }
  function boardHtml(showGot) {
    var hide = hideScores();
    var ps = hide ? list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) : list();   // no order to read the ranking from
    return ps.map(function (p) {
      return '<li class="' + (showGot && p.got && !hide ? 'got ' : '') + (G.phase === 'guess' && isIn(p) ? 'ans ' : '') + (p.off ? 'off' : '') + '"><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="tot">' + (hide ? '?' : p.score) + '</span><span class="pts">' + (!hide && showGot && p.got ? '+' + p.pts : '') + '</span></li>';   // the +points have their own column, so the totals never shift
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
      return '<span class="chip' + (p.off ? ' off' : '') + (pop ? ' pop' : '') + ((G.phase === 'lobby' || G.phase === 'intro') && G.go && G.go[p.pid] ? ' rdy' : '') + '"' + (pop ? ' style="animation-delay:-' + age + 'ms"' : '') + '>' + charSvg(p.char) + '<span class="pname">' + esc(p.name) + '</span></span>';
    }).join('') || '<span class="mute">Waiting for players…</span>';
    var nr = ps.filter(function (p) { return G.go && G.go[p.pid]; }).length;
    $('pcount').textContent = ps.length ? '(' + (G.phase === 'lobby' || G.phase === 'intro' ? nr + ' of ' + ps.length + ' ready' : ps.length) + ')' : '';
    $('board').innerHTML = boardHtml(G.phase === 'guess' || G.phase === 'reveal' || G.phase === 'dall' || G.phase === 'qall');
    $('boardtitle').textContent = hideScores() ? 'Scores at the end' : ladderGame() ? 'Ladder' : 'Scores';
    renderLadder();
    $('endgame').classList.toggle('hidden', G.phase === 'lobby' || G.phase === 'intro' || G.phase === 'paused' || G.phase === 'end');
    $('newgame').classList.toggle('hidden', !(G.phase === 'intro' || G.phase === 'paused'));   // not while a game is playing: only during the countdown and after a restore
    $('hud').textContent = G.round && G.phase !== 'lobby' && G.phase !== 'end' && G.phase !== 'brief' && G.phase !== 'intro' ? 'Song ' + G.round + ofTotal(' / ') : '';
    var noCtrl = G.phase === 'lobby' || G.phase === 'brief' || G.phase === 'intro' || G.phase === 'end';
    $('ctrl').classList.toggle('hidden', noCtrl); $('next').classList.toggle('hidden', noCtrl);
    $('hostmain').classList.toggle('ingame', G.phase !== 'lobby' && G.phase !== 'end' && G.phase !== 'brief' && G.phase !== 'intro');
    $('hostmain').classList.toggle('briefing', G.phase === 'brief' || G.phase === 'intro');
    // The fanfare is sound only: its player stays out of sight (but not display:none, or it would not play).
    if (G.phase !== 'end' && endFanfare) { endFanfare = false; try { yt.stopVideo(); } catch (e) {} }
    $('v-game').classList.toggle('audioonly', G.phase === 'intro' || endFanfare);
    if (G.phase === 'intro') $('v-game').classList.remove('hidden');
    if (window.selfSize) window.selfSize();
    if (G.phase !== 'end') endShown = false;
    // Everyone is ready: the fanfare plays, but the screen stays on the lobby with the settings locked.
    var locked = G.phase === 'intro';
    [].forEach.call($('v-lobby').querySelectorAll('.settings select'), function (el) { el.disabled = locked; });
    $('v-lobby').classList.toggle('locked', locked);
    if (!locked) { singToggle(); winnersLock(); }   // gives Answers and Scoring back unless Sing! or Draw! greys them out
    if (!locked && G.phase === 'lobby' && $('start').textContent.indexOf('Start now') === 0) ready();
    if (G.phase === 'lobby' || G.phase === 'intro') show('v-lobby');
    else if (G.phase === 'brief') { show('v-brief'); renderBrief(); }
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
        }, true, G.showScore !== 'end');   // counted up only when the totals were hidden during the game
      }
    } else {
      show('v-game');
      $('roundlabel').textContent = 'Song ' + G.round + ofTotal(' / ');
      renderQuestion(); renderAnswered();
      var between = G.phase === 'reveal' || G.phase === 'paused';
      $('guessui').classList.toggle('hidden', G.phase === 'paused');   // the question stays in place at the reveal, so nothing jumps
      $('revealui').classList.toggle('hidden', !between);
      $('next').disabled = !(ytReady && songs.length) || !between;
      if (G.phase === 'paused') {
        cover(true, '↻', 'Game restored', false);
        $('rtitle').textContent = G.round ? 'Song ' + G.round + ofTotal(' of ') + ' done' : 'Ready for song 1';
        $('rmeta').textContent = lastSong() ? 'Only the final scores are left.' : 'Press continue when everyone is back.';
        $('rres').textContent = ''; $('ranswer').textContent = '';
        $('next').textContent = lastSong() ? 'Final scores' : 'Continue';
      }
      $('rwhy').textContent = G.phase === 'reveal' && G.q && G.q.explain ? G.q.explain : '';   // why it is the odd one out, right under the video
      // "Continue" moves a Sing! round along; otherwise the button only appears when YouTube will not play anything.
      $('skip').disabled = !(G.phase === 'guess' || (G.sing && G.phase !== 'reveal' && G.phase !== 'loading'));
      $('skip').classList.toggle('hidden', $('skip').disabled || !(G.sing || stuck));
      if (G.phase === 'reveal' && G.best) {
        var bw = (G.best.wins || []).map(function (i) { return players[G.best.pids[i]]; }).filter(Boolean).map(function (p) { return p.name; });
        if (G.best.quip) bw = (G.best.wins || []).map(function (i) { var w = players[G.best.pids[i]]; return w ? w.name : QUIP_HOUSE; });
        $('rtitle').textContent = bw.length ? (G.best.quip ? 'Favourite answer: ' : 'Best drawing: ') + bw.join(' & ') : 'Nobody voted';
        $('rmeta').textContent = bw.length ? (G.best.quip ? '1 point per vote, +' + QUIP_WIN + ' for the favourite' : '+' + BEST_PTS + ' bonus points') : ''; $('rres').textContent = ''; $('ranswer').textContent = '';
        $('next').textContent = lastSong() ? 'Final scores' : 'Next';
      }
      if (G.phase === 'reveal' && G.song) {
        $('rtitle').textContent = G.song[3];
        $('rmeta').textContent = G.song[2] + ' · ' + flag(G.song[1]) + ' ' + (countries[G.song[1]] || G.song[1]) + ' ' + G.song[0];
        $('rres').textContent = resultText(G.song);
        $('ranswer').textContent = '';   // the green bar already says it
        $('next').textContent = lastSong() ? 'Final scores' : 'Next';
      }
      renderSing();
    }
    if (G.phase === 'intro') $('v-game').classList.remove('hidden');
  }
  // The question (and, for multiple choice, the four options) on the big screen.
  function renderQuestion() {
    var q = G.q, on = q && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal');
    var dp = G.draw && players[G.draw.pid];
    $('qtext').textContent = on ? q.text : G.phase === 'dall' ? 'Everyone is drawing a song!' : G.phase === 'qall' ? 'Everyone is writing an answer!' : '';
    // One answer per row. Behind it: who picked it, first one by one (G.shown), then with the points at the reveal.
    var rev = G.phase === 'reveal', shown = G.phase === 'picks' ? (G.shown || []) : rev ? list().map(function (p) { return p.pid; }) : [];
    $('qopts').innerHTML = on && q.options ? (rev && q.reveal ? q.reveal : q.options).map(function (o, i) {
      var who = shown.map(function (pid) { return players[pid]; }).filter(function (p) { return p && p.pick === i && !(G.draw && p.pid === G.draw.pid); });
      if (rev) who.sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); });
      return '<div class="optcol"><div class="opt' + (rev ? ((G.best && G.best.wins ? G.best.wins.indexOf(i) >= 0 : i === q.correct) ? ' right' : ' dim') : '') + '"><b>' + 'ABCDEFGHIJKLMNOP'[i] + '</b>' + esc(o) + '</div><div class="voters">' +
        who.map(function (p) { return '<span class="' + (p.pid === G.plopped ? 'plop' : '') + '">' + charSvg(p.char) + esc(p.name) + (rev && p.got && i === q.correct ? ' <b>+' + p.pts + '</b>' : '') + '</span>'; }).join('') + '</div></div>';
    }).join('') : '';
    G.plopped = null;   // the pop-in only plays once
    $('qopts').classList.toggle('votelist', !!(on && q.options));
  }
  // Everyone's character under the video, with a green ring once their answer is in.
  function renderAnswered() {
    var dall = (G.phase === 'dall' && !!G.gallery) || (G.phase === 'qall' && !!G.quips), busyOf = G.phase === 'qall' ? G.quips : G.gallery, on = dall || (G.sing && (G.phase === 'srec' || G.phase === 'sbest'));   // quiz rounds show who has answered in the score panel instead   // during the song vote the voters show behind each song instead
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
      // Draw!: a scribbling pencil on everyone who is still drawing, a green ring once they are done
      var pen = dall && !isIn(p) && busyOf.items[p.pid] ? '<i class="pen" aria-hidden="true">✏️</i>' : '';
      return '<div class="pl' + (isIn(p) ? ' in' : '') + (p.off ? ' off' : '') + (pen ? ' busy' : '') + '">' + charSvg(p.char) + pen + '<span>' + esc(p.name) + '</span></div>';
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
      else if (clipReady && isPair() && !yt2.ready) {   // the second song of a two-clip question is not ready yet
        $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…';
        if (Date.now() - loadT0 > 30000) badSong();   // it is not coming: take another song and question
      }
      else if (clipReady) { countStop(); if (G.sing) singListen(); else beginGuess(); }
      else { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }
    };
    draw(); loadTick = setInterval(draw, 100);
  }
  function countStop() { clearInterval(loadTick); loadT0 = 0; }
  function masks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  setInterval(function () {
    // Draw!: the drawing fills the stage while it is being made; at the reveal it sits beside the playing video.
    // Until that reveal the video itself is kept invisible, so not even a flash of it can give the song away.
    var dShow = !!G.draw && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal'), dSide = !!G.draw && G.phase === 'reveal';
    $('drawview').classList.toggle('hidden', !dShow); $('drawview').classList.toggle('side', dSide);
    bestRender();
    var stg = document.querySelector('#v-game .stage'); stg.classList.toggle('withdraw', dSide); stg.classList.toggle('novideo', (!!G.draw || !!(G.q && G.q.noclip)) && G.phase !== 'reveal');   // no clip in this question: not a glimpse of the video before the answer
    $('briefcd').textContent = '';
    if (G.phase === 'intro') { $('start').disabled = false; $('start').textContent = 'Start now · ' + Math.max(1, Math.ceil((G.endsAt - Date.now()) / 1000)); }
    var voteCd = G.phase === 'svote' || G.phase === 'sbest';
    var cd = (G.phase === 'guess' || voteCd) && G.revealAt ? Math.max(0, Math.ceil((G.revealAt - Date.now()) / 1000)) : 0;
    $('allin').textContent = cd ? (voteCd ? 'Everyone has voted. Continuing in ' : list().length > 1 ? 'Everyone answered, revealing in ' : 'Revealing in ') + cd : '';   // alone: nobody else to wait for
    var timed = G.phase === 'guess' || G.phase === 'dall' || G.phase === 'qall' || (G.sing && (G.phase === 'svote' || G.phase === 'slisten' || G.phase === 'srec' || G.phase === 'sbest'));
    $('tbar').style.transform = 'scaleX(' + (timed ? Math.max(0, Math.min(1, (G.endsAt - Date.now()) / (G.barMs || G.guessMs))) : 0) + ')';
  }, 100);

  // ---------- YouTube ----------
  var yt2 = new SecondPlayer('yt2'), pairStep = 0, pairTimer = null, loadedId = '';
  function stageEl() { return document.querySelector('#v-game .stage'); }
  function pairTag(t) { $('pairtag').textContent = t; $('pairtag').classList.toggle('hidden', !t); }
  function isPair() { return !!(G.q && G.q.pair); }
  function clipLen() { return isPair() ? PAIR_CLIP : clipSecs(); }
  window.onYouTubeIframeAPIReady = function () {
    yt2.make();
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () {
        if (stage === 'probe' || stage === 'seek') { if (loadedId) markBad(loadedId); badSong(); }
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
    ['higher', 'newer'].forEach(function (v) { var o = $('s-subject').querySelector('option[value="' + v + '"]'); if (o) o.remove(); });   // two-clip questions need the shared screen too
  } else {
    var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  }

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); clearTimeout(pairTimer); }

  var lateLoad = false;
  function loadSong(fixed) {
    if (REMOTE) { remoteLoad(fixed); return; }
    stopTimers(); stuck = false;
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = fixed || free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    G.q = G.sing ? null : G.draw ? G.q : makeQuestion(G.song, G.subject, 'mc', songs, countries, { pair: true, cat: G.cat });
    stage = 'probe';
    cover(true, '', 'Selecting song', false); countStart(); masks(true);
    // A two-clip question: the first song loads in the main player, the second in the spare one. The
    // song shown at the reveal is the one that is the right answer.
    stageEl().classList.remove('second'); pairTag(''); pairStep = 0; loadedId = G.song[4];
    stageEl().classList.toggle('novideo', noClipQ());   // no clip in this question: the video stays invisible until the answer
    if (isPair()) {
      var pr = G.q.pair, second = pr[1][4];
      loadedId = pr[0][4]; G.used[pr[0][4]] = 1; G.used[pr[1][4]] = 1; G.song = pr[G.q.correct];
      yt2.load(second, PAIR_CLIP, function () { markBad(second); if (G.phase === 'loading') badSong(); });
    } else yt2.stop();
    adNote(false);
    // A question without a clip (odd one out, a drawing): the video is not loaded at all until the answer,
    // so there is nothing in the player that could be glimpsed.
    lateLoad = noClipQ();
    if (lateLoad) { try { yt.stopVideo(); } catch (e) {} fails = 0; stage = 'ready'; clipReady = true; return; }
    yt.mute(); yt.loadVideoById(loadedId);
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
      // A question without a clip (odd one out, Draw!) never shows the player before the answer. If the
      // video is slow or behind an ad, the question simply starts; the video is only needed at the reveal.
      if (noClipQ() && late > 6000) { clearInterval(poll); clearTimeout(watchdog); fails = 0; try { yt.pauseVideo(); } catch (e) {} stage = 'ready'; clipReady = true; return; }
      if (late > 6000) adNote(true);   // stuck for whatever reason: show the player, so an ad or an error is visible and can be clicked
      if (st !== 1 || d <= 0) return;
      if (d < 100 && late < 40000) { if (late > 2500) adNote(true); return; }   // shorter than any song
      var cs = d < 45 ? 0 : Math.floor(15 + frac * (d - 15 - 20 - clipLen()));
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
  function noClipQ() { return !!G.draw || !!(G.q && G.q.noclip); }
  function adNote(on) {
    if (on && noClipQ()) return;   // never uncover the video of a question that has no clip
    if (on === adShown) return;
    adShown = on;
    document.querySelector('#v-game .shield').classList.toggle('hidden', on);
    if (on) { cover(false); $('mb').classList.add('hidden'); $('err').textContent = AD_TEXT; }
    else {
      // the wait is over: put back the bottom mask (it hides the caption with the country) and clear the note
      $('mb').classList.remove('hidden');
      if ($('err').textContent === AD_TEXT) $('err').textContent = '';
    }
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
      if ((yt.getCurrentTime() || 0) >= clipStart + clipLen()) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (isPair() && G.phase === 'guess' && pairStep === 0) {
          // on to the second song, in the spare player
          pairStep = 1; stageEl().classList.add('second'); pairTag('Song 2'); yt2.play();
          pairTimer = setTimeout(function () { yt2.pause(); pairTag(''); if (G.phase === 'guess') cover(true, '?', '', false); }, PAIR_CLIP * 1000);
          return;
        }
        if (G.phase === 'guess') cover(true, '?', '', false);   // the question itself stays below the video
        if (G.sing && G.phase === 'slisten') singRecord();
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    var ms = G.draw ? drawGuessMs() : isPair() ? PAIR_MS : G.guessMs;
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms;
    if (isPair()) { pairStep = 0; stageEl().classList.remove('second'); pairTag('Song 1'); }
    if (G.q && G.q.noclip) { clearInterval(poll); stage = 'paused'; cover(true, G.draw ? '✏️' : '?', '', false); }   // odd one out and Draw!: no clip
    else playClip();
    push(); if (G.draw) drawSend();
    endTimer = setTimeout(reveal, ms);
  }
  // Shared screen: before the answer, everyone's avatar drops in behind the answer they picked, one by one
  // with a plop, in the order the answers came in. Then the right answer lights up.
  var picksTimer = null;
  function showPicks() {
    var order = list().filter(function (p) { return p.pick != null && !(G.draw && p.pid === G.draw.pid); }).sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); });
    stopTimers(); G.revealAt = 0; G.phase = 'picks'; G.shown = []; push();
    var i = 0, step = function () {
      if (G.phase !== 'picks') return;
      if (i >= order.length) { picksTimer = setTimeout(reveal, 1100); return; }
      var p = order[i++]; G.shown.push(p.pid); G.plopped = p.pid; Music.plop(i); render();
      picksTimer = setTimeout(step, 400);
    };
    picksTimer = setTimeout(step, 500);
  }
  function roundMode() { return G.atype === 'party' ? (G.mode || 'mc') : G.atype; }   // what this round is: quiz ('mc'), 'sing' or 'draw'
  function ladderGame() { return G.atype === 'mc' && G.scoring === 'ladder'; }
  var ENDLESS = 9999;   // Ladder has no song limit: it runs until someone is at the top
  function ofTotal(sep) { return G.total >= ENDLESS ? '' : sep + G.total; }
  function lastSong() { return G.round >= G.total || !!(G.ladderWon && ladderGame()); }
  function reveal() {
    if (G.phase === 'guess' && !REMOTE && G.q && G.q.type === 'mc' && list().some(function (p) { return p.pick != null; })) { showPicks(); return; }
    if (G.phase !== 'guess' && G.phase !== 'picks') return;
    clearTimeout(picksTimer);
    stopTimers(); G.phase = 'reveal'; stage = 'reveal'; G.revealAt = 0;
    // Multiple choice is scored now, from the answer each player was holding.
    // For "order" scoring the right answers are ranked by when they were put in.
    var right = G.q && G.q.type === 'mc' ? list().filter(function (p) { return p.pick === G.q.correct && !(G.draw && p.pid === G.draw.pid); })
      .sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); }) : [];
    // Speed scoring on a two-clip question only starts counting when the second clip begins.
    if (G.best) {
      // Best drawing: the votes are counted, the drawing with the most gets the bonus (a tie: all of them).
      right = [];
      var tally = G.best.pids.map(function () { return 0; });
      list().forEach(function (p) { if (p.pick != null && tally[p.pick] != null) tally[p.pick]++; });
      var top = Math.max.apply(null, tally), tops = [];
      tally.forEach(function (n, i) { if (top > 0 && n === top) tops.push(i); });
      G.best.tally = tally; G.best.wins = tops; G.q.correct = tops.length ? tops[0] : -1;
      if (G.best.quip) {
        // Quip!: a point per vote for each author, and the favourite gets a bonus. The names come out now.
        G.best.pids.forEach(function (k, i) { var w = players[k]; if (!w) return; w.pts = tally[i] + (tops.indexOf(i) >= 0 ? QUIP_WIN : 0); w.score += w.pts; w.got = w.pts > 0; });
        G.q.reveal = G.q.options.map(function (o, i) { var w = players[G.best.pids[i]]; return o + '  —  ' + (w ? w.name : QUIP_HOUSE); });
      } else
      tops.forEach(function (i) { var w = players[G.best.pids[i]]; if (w) { w.pts = BEST_PTS; w.score += BEST_PTS; w.got = true; } });
    }
    if (ladderGame() && !G.draw && !G.best) {
      // Ladder: up a rung for a right answer, half a rung down for a wrong one or none. The score is what the last whole rung is worth.
      list().forEach(function (p) {
        if (p.rung == null) p.rung = Math.max(0, LADDER.indexOf(p.score));   // a restored game only knows the score
        var ok = right.indexOf(p) >= 0, before = LADDER[Math.floor(p.rung || 0)];
        p.rung = Math.max(0, Math.min(LADDER.length - 1, (p.rung || 0) + (ok ? 1 : -0.5)));
        p.score = LADDER[Math.floor(p.rung)]; p.pts = p.score - before; p.got = ok; p.moved = ok ? 'up' : 'down';
        if (p.rung === LADDER.length - 1) G.ladderWon = true;   // someone reached the top: this was the last song
      });
      right = [];
    }
    right.forEach(function (p, rank) { p.pts = G.draw ? 1 : pointsFor(G.scoring === 'speed' ? 'order' : G.scoring, isPair() ? Math.max(0, p.pickMs - PAIR_CLIP * 1000) : p.pickMs, G.guessMs, rank); p.score += p.pts; p.got = true; });
    // Draw!: a point for everyone who guesses it, and a point for the artist for each of them.
    var artist = G.draw && players[G.draw.pid];
    if (artist && right.length) { artist.pts = right.length; artist.score += right.length; artist.got = true; }
    if (!REMOTE && G.q) Music.ding();   // the right answer lights up
    cover(false); masks(false);
    // The video carries on from where the clip stopped (it only jumps back if it somehow is not at the clip).
    clearTimeout(pairTimer); pairTag('');
    if (G.best) { cover(true, G.best.quip ? '💬' : '🏆', '', false); }   // no song with this one
    else if (isPair()) {
      // the song that was the right answer plays on, from where its clip stopped
      var second = G.q.correct === 1;
      stageEl().classList.toggle('second', second);
      try { if (second) { yt.pauseVideo(); if (pairStep === 0) yt2.play(); else yt2.resume(); } else { yt2.pause(); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {}
    } else if (lateLoad && !REMOTE) {
      // only now does the video come in, somewhere in the middle of the song
      lateLoad = false; clipStart = Math.floor(35 + Math.random() * 50);
      try { yt.unMute(); yt.setVolume(100); yt.loadVideoById({ videoId: G.song[4], startSeconds: clipStart }); } catch (e) {}
    } else {
    try { var tNow = yt.getCurrentTime() || 0; if (!(tNow >= clipStart - 1 && tNow <= clipStart + clipSecs() + 2)) yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    }
    push(); autoStart(); revealWatch();
  }
  // At the answer: while an ad is playing instead of the song, the player can be clicked (Skip ad).
  var revealTick = null;
  function revealWatch() {
    clearInterval(revealTick);
    var sh = document.querySelector('#v-game .shield');
    sh.classList.add('hidden');
    revealTick = setInterval(function () {
      if (G.phase !== 'reveal') { clearInterval(revealTick); sh.classList.toggle('hidden', adShown); return; }
      sh.classList.add('hidden');   // the whole time the answer is up: an ad cannot always be told apart from the song
    }, 400);
  }
  function startRound() {
    G.round++; G.phase = 'loading';
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; });
    G.q = null; G.revealAt = 0; singClear(); G.draw = null; G.best = null; clearTimeout(drawTimer); clearTimeout(picksTimer);
    yt2.pause(); if (!REMOTE) { stageEl().classList.remove('second'); pairTag(''); }
    if (G.quips && G.quips.queue.length) { quipNext(); return; }   // answers that are still waiting for their vote
    G.quips = null;
    // Drawings that are still waiting to be guessed come first.
    if (G.gallery && G.gallery.queue.length) { if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} } drawNext(); return; }
    if (G.gallery && G.gallery.vote && drawVote()) return;   // and to finish: which drawing was the best?
    G.gallery = null;
    // Party: four quiz questions, then a Sing! or a Draw! round, then four quiz questions again, and so on
    // (Sing! only with a shared screen, and neither without at least two players).
    if (G.atype === 'party') {
      var special = REMOTE ? ['draw', 'quip'] : ['sing', 'draw', 'quip'], can = list().filter(function (p) { return !p.off; }).length >= 2;
      if (can && (G.quizRun || 0) >= 4) {
        // take turns, so a game of ten songs has both: four questions, one of them, four questions, the other
        var other = special.filter(function (x) { return x !== G.lastSpecial; });
        G.mode = G.lastSpecial = pick(other.length ? other : special); G.quizRun = 0;
      }
      else { G.mode = 'mc'; G.quizRun = (G.quizRun || 0) + 1; }
    } else G.mode = G.atype;
    var md = roundMode();
    if (!REMOTE && (md === 'sing' || md === 'draw')) { try { yt.pauseVideo(); } catch (e) {} }   // the previous song stops while the next one is chosen
    if (md === 'sing' && !REMOTE) { singStart(); return; }
    if (md === 'draw') { drawAll(); return; }
    if (md === 'quip') { quipAll(); return; }
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
    if (!G.draw) G.q = makeQuestion(G.song, G.subject, 'mc', songs, countries, { cat: G.cat });
    G.clip = { id: G.song[4], frac: Math.random(), noclip: !!G.draw || !!(G.q && G.q.noclip) }; G.ready = {}; G.badVotes = 0; G.remain = 0; G.adWait = 0;
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
    var ms = G.draw ? drawGuessMs() : G.guessMs;
    G.guessAt = Date.now();
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms; push(); if (G.draw) drawSend();
    endTimer = setTimeout(reveal, ms);
  }

  // ---------- Draw! ----------
  // Everyone draws at the same time: each player gets four songs of their own, picks one and draws it
  // on their phone, all within a minute. The host keeps the lines. After that every drawing is a
  // question for the others, one by one, with the artist's four songs as the answers.
  var drawTimer = null, DRAW_GUESS_MS = 20000;
  // Nobody there to guess (a game with one player): do not sit out the whole guessing time.
  function drawGuessMs() { return list().some(function (p) { return !p.off && G.draw && p.pid !== G.draw.pid; }) ? DRAW_GUESS_MS : 6000; }
  function drawFallback() { G.gallery = null; G.draw = null; G.phase = 'loading'; push(); loadSong(); }   // nothing to guess: a quiz question instead
  function drawAll() {
    var ps = list().filter(function (p) { return !p.off; });
    if (!ps.length) ps = list();
    var free = G.pool.filter(function (s) { return !G.used[s[4]] && !BAD_VIDEOS[s[4]]; });
    if (free.length < ps.length * 4) free = G.pool.filter(function (s) { return !BAD_VIDEOS[s[4]]; });
    if (!ps.length || free.length < 4) { drawFallback(); return; }   // (a single player can draw too: handy for trying it out)
    var cands = shuffle(free.slice()), items = {};
    ps.forEach(function (p, i) {
      var four = []; for (var k = 0; k < 4; k++) four.push(cands[(i * 4 + k) % cands.length]);
      items[p.pid] = { options: four, chosen: null, done: 0, strokes: [] };
    });
    G.gallery = { id: Math.random().toString(36).slice(2, 8), items: items, queue: [] };
    G.draw = null; G.q = null; G.phase = 'dall'; G.barMs = DRAW_MS; G.endsAt = Date.now() + DRAW_MS;
    if (!REMOTE) { cover(true, '✏️', 'Everyone is drawing', false); masks(true); }
    clearTimeout(drawTimer); drawTimer = setTimeout(drawAllEnd, DRAW_MS + 800);   // a moment extra for the last lines to come in
    push();
  }
  // Everyone who is still there has finished (or passed): no need to wait out the minute.
  function drawAllCheck() {
    if (G.phase !== 'dall' || !G.gallery) return;
    var act = list().filter(function (p) { return !p.off && G.gallery.items[p.pid]; });
    if (act.length && act.every(function (p) { return G.gallery.items[p.pid].done; })) { clearTimeout(drawTimer); drawTimer = setTimeout(drawAllEnd, 1200); }
  }
  function drawAllEnd() {
    if (G.phase !== 'dall' || !G.gallery) return;
    clearTimeout(drawTimer);
    var g = G.gallery;
    g.queue = shuffle(Object.keys(g.items).filter(function (k) { var it = g.items[k]; return players[k] && it.chosen != null && !it.skip && it.strokes.length; }));
    if (!g.queue.length) { drawFallback(); if (!REMOTE) $('err').textContent = 'Nobody made a drawing this time, so here is a quiz question instead.'; return; }
    // every drawing is a song of its own: a game never stops halfway through the drawings
    g.shown = g.queue.slice();
    g.vote = g.queue.length >= 2 && list().filter(function (p) { return !p.off; }).length >= 3;   // enough to choose from, and enough voters
    var need = G.round - 1 + g.queue.length + (g.vote ? 1 : 0);
    // In a Party game the whole Draw! round counts as one song, so the game is made that much longer.
    if (G.atype === 'party' && G.total < ENDLESS) G.total += g.queue.length + (g.vote ? 1 : 0) - 1;
    else if (G.total < ENDLESS && need > G.total) G.total = need;
    drawNext();
  }
  function drawNext() {
    var g = G.gallery, k = g.queue.shift(), it = g.items[k], dp = players[k];
    if (!it || !dp) { if (g.queue.length) drawNext(); else drawFallback(); return; }
    G.draw = { pid: k, options: it.options, chosen: it.chosen, id: g.id + k, strokes: it.strokes };
    var labels = it.options.map(songLabel);
    G.q = { subject: 'draw', type: 'mc', text: 'What did ' + dp.name + ' draw?', hint: '', options: labels, correct: it.chosen, answer: labels[it.chosen], noclip: true };
    drawClear($('drawview')); it.strokes.forEach(function (m) { drawPaint($('drawview'), m); });
    G.phase = 'loading'; push();
    loadSong(it.options[it.chosen]);
  }
  // ---------- Quip! ----------
  // Everyone finishes a line on their phone (a minute for it). The players are paired up on the same
  // line; a player without an opponent plays against the house answer. Then every pair is a vote.
  var quipTimer = null;
  function quipAll() {
    var ps = shuffle(list().filter(function (p) { return !p.off; }));
    if (!ps.length) { drawFallback(); return; }
    var lines = shuffle(QUIPS.slice()), items = {}, pairs = [];
    for (var i = 0; i < ps.length; i += 2) {
      var ln = lines[(i / 2) % lines.length], a = ps[i], b = ps[i + 1] || null;
      items[a.pid] = { prompt: ln.p, text: '', done: 0 }; if (b) items[b.pid] = { prompt: ln.p, text: '', done: 0 };
      pairs.push({ line: ln, a: a.pid, b: b ? b.pid : null });
    }
    G.quips = { id: Math.random().toString(36).slice(2, 8), items: items, pairs: pairs, queue: [] };
    G.draw = null; G.best = null; G.q = null; G.song = null; G.clip = null;
    G.phase = 'qall'; G.barMs = QUIP_MS; G.endsAt = Date.now() + QUIP_MS;
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, '💬', 'Everyone is writing', false); masks(true); stageEl().classList.add('novideo'); }
    clearTimeout(quipTimer); quipTimer = setTimeout(quipAllEnd, QUIP_MS + 800);
    push();
  }
  function quipAllCheck() {
    if (G.phase !== 'qall' || !G.quips) return;
    var act = list().filter(function (p) { return !p.off && G.quips.items[p.pid]; });
    if (act.length && act.every(function (p) { return G.quips.items[p.pid].done; })) { clearTimeout(quipTimer); quipTimer = setTimeout(quipAllEnd, 900); }
  }
  function quipAllEnd() {
    if (G.phase !== 'qall' || !G.quips) return;
    clearTimeout(quipTimer);
    var g = G.quips;
    // A pair needs at least one written answer; an empty side is filled in by the house.
    g.queue = g.pairs.map(function (pr) {
      var ta = g.items[pr.a].text, tb = pr.b ? g.items[pr.b].text : '';
      if (!ta && !tb) return null;
      var opts = [];
      if (ta) opts.push({ pid: pr.a, text: ta });
      if (tb) opts.push({ pid: pr.b, text: tb });
      if (opts.length < 2) opts.push({ pid: null, text: pr.line.h });
      return { prompt: pr.line.p, opts: shuffle(opts) };
    }).filter(Boolean);
    if (!g.queue.length) { G.quips = null; drawFallback(); if (!REMOTE) $('err').textContent = 'Nobody wrote anything this time, so here is a quiz question instead.'; return; }
    var need = G.round - 1 + g.queue.length;
    if (G.atype === 'party' && G.total < ENDLESS) G.total += g.queue.length - 1;   // in a Party game the whole round counts as one song
    else if (G.total < ENDLESS && need > G.total) G.total = need;
    quipNext();
  }
  function quipNext() {
    var g = G.quips, m = g.queue.shift();
    stopTimers(); G.draw = null; G.song = null; G.clip = null;
    G.best = { quip: true, id: g.id + ':' + G.round, pids: m.opts.map(function (o) { return o.pid; }), tally: null, wins: null };
    G.q = { subject: 'quip', type: 'mc', text: m.prompt, hint: '', options: m.opts.map(function (o) { return o.text; }), correct: -1, answer: '', noclip: true };
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, '💬', '', false); masks(true); stageEl().classList.add('novideo'); }
    // nobody left to vote (a very small game): only show the answers for a moment
    var voters = list().filter(function (p) { return !p.off && G.best.pids.indexOf(p.pid) < 0; }).length, ms = voters ? QUIP_VOTE_MS : 7000;
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms; push();
    endTimer = setTimeout(reveal, ms);
  }
  net.on('quip', function (m) {
    var it = m && G.quips && G.phase === 'qall' && G.quips.items[m.pid];
    if (!it || it.done) return;
    var t = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    if (!t && !m.pass) return;
    it.text = t; it.done = 1; push(); quipAllCheck();
  });
  // After the last drawing: everyone votes for the best one (not their own). All drawings are on the
  // screen side by side; the phones get them as small pictures on the buttons.
  var BEST_MS = 25000, BEST_PTS = 3, bestKey = '';
  function drawVote() {
    var g = G.gallery; g.vote = false;
    var pids = (g.shown || []).filter(function (k) { return players[k] && g.items[k]; });
    if (pids.length < 2) return false;
    stopTimers(); G.draw = null; G.song = null; G.clip = null;
    G.best = { id: g.id, pids: pids, tally: null, wins: null };
    G.q = { subject: 'best', type: 'mc', text: 'Which drawing is the best?', hint: '', options: pids.map(function (k) { return players[k].name; }), correct: -1, answer: '', noclip: true };
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, '🏆', '', false); masks(true); stageEl().classList.add('novideo'); }
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = BEST_MS; G.endsAt = Date.now() + BEST_MS; push();
    var b = G.best, go = function () {
      if (G.best !== b || G.phase !== 'guess') return;
      pids.forEach(function (k, n) { var st = g.items[k].strokes; for (var i = 0; i < st.length; i += 30) net.send('draw', { best: b.id, i: n, first: i === 0, batch: st.slice(i, i + 30) }); });
    };
    setTimeout(go, 350); setTimeout(go, 2600);
    endTimer = setTimeout(reveal, BEST_MS);
    return true;
  }
  // The drawings side by side on the big screen; the winner lights up at the answer.
  function bestRender() {
    var el = $('bestview'), on = !!G.best && !G.best.quip && !!G.gallery && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal');
    el.classList.toggle('hidden', !on);
    if (!on) { bestKey = ''; return; }
    if (bestKey !== G.best.id + ':' + G.round) {
      bestKey = G.best.id + ':' + G.round;
      el.innerHTML = G.best.pids.map(function (k, i) { return '<div class="tile"><canvas width="' + DRAW_W + '" height="' + DRAW_H + '"></canvas><span><b>' + 'ABCDEFGHIJKLMNOP'[i] + '</b> ' + esc(players[k] ? players[k].name : '?') + '</span></div>'; }).join('');
      el.className = 'bestview n' + Math.min(8, G.best.pids.length);
      [].forEach.call(el.querySelectorAll('canvas'), function (cv, i) { var it = G.gallery.items[G.best.pids[i]]; drawClear(cv); (it ? it.strokes : []).forEach(function (m) { drawPaint(cv, m); }); });
    }
    [].forEach.call(el.querySelectorAll('.tile'), function (t, i) { t.classList.toggle('win', G.phase === 'reveal' && !!G.best.wins && G.best.wins.indexOf(i) >= 0); t.classList.toggle('lose', G.phase === 'reveal' && !!G.best.wins && G.best.wins.indexOf(i) < 0); });
  }
  // The phones get the drawing as a few packets of lines (twice, in case one is still switching screens).
  function drawSend() {
    var d = G.draw; if (!d) return;
    var go = function () {
      if (G.draw !== d || G.phase !== 'guess') return;
      for (var i = 0; i < d.strokes.length; i += 30) net.send('draw', { pid: d.pid, id: d.id, first: i === 0, batch: d.strokes.slice(i, i + 30) });
    };
    setTimeout(go, 350); setTimeout(go, 2600);
  }
  net.on('draw', function (m) {
    var g = G.gallery, it = m && g && g.items[m.pid];
    if (!it || G.phase !== 'dall' || m.batch) return;
    if (typeof m.pick === 'number') { if (it.chosen == null && it.options[m.pick]) { it.chosen = m.pick; push(); } return; }
    if (m.skip) { if (!it.done) { it.skip = 1; it.done = 1; push(); drawAllCheck(); } return; }   // "I'm not drawing"
    if (m.done) { if (!it.done) { it.done = 1; push(); drawAllCheck(); } return; }
    if (it.chosen == null || it.done || !m.lines) return;
    m.lines.forEach(function (l) {   // a bundle of lines (and maybe a 'clear') in the order they were made
      if (l.clear) it.strokes = [];
      else if (l.p && l.p.length >= 2 && it.strokes.length < 4000) it.strokes.push({ c: l.c, w: l.w, p: l.p });
    });
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
    var sing = G.atype === 'sing' || G.atype === 'draw' || G.atype === 'quip';
    var rows = [['Songs', G.total >= ENDLESS ? 'Until someone reaches the top' : G.total], ['Video length', optText('s-time')], ['Years', optText('s-era')], ['Entries', optText('s-cat')], ['Game type', optText('s-atype')]];
    if (!sing) rows.push(['Category', optText('s-subject')], ['Scoring', optText('s-scoring')]);
    rows.push(['Show score', optText('s-show')]);
    return { rows: rows, scoring: G.atype === 'party' ? PARTY_HELP + ' ' + SCORING_HELP[G.scoring] : G.atype === 'draw' ? DRAW_HELP : G.atype === 'quip' ? QUIP_HELP : sing ? 'Sing!: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : SCORING_HELP[G.scoring] };
  }
  function briefStart() {
    stopTimers(); clearTimeout(introTimer);
    G.phase = 'brief'; G.go = {}; G.brief = briefInfo(); push();
  }
  // Everyone presses Ready in the lobby; when all connected players are ready the game starts by itself.
  function allReady() { var act = list().filter(function (x) { return !x.off; }); return act.length > 0 && act.every(function (p) { return G.go && G.go[p.pid]; }); }
  function briefCheck() {
    if (G.phase !== 'lobby') return;
    var act = list().filter(function (x) { return !x.off; });
    if (act.length && act.every(function (p) { return G.go[p.pid]; })) beginGame();
  }
  function introStart() {
    if (G.phase !== 'lobby') return;
    stopTimers(); clearTimeout(introTimer);
    if (!G.go) G.go = {};
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
    if (!p || G.phase !== 'lobby') return;
    if (!G.go) G.go = {};
    if (m.off) { delete G.go[p.pid]; push(); return; }   // pressed Ready again: not ready after all
    if (m.start) { if (allReady()) beginGame(); return; }   // "Start game" on a phone, only once everyone is ready
    G.go[p.pid] = 1; push();
  });

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
    var chosen = pick(top);
    var go = function () {
      if (!G.sing) return;
      G.sing.chosen = chosen; G.sing.tried[chosen] = 1; G.sing.roll = null;
      G.phase = 'loading'; G.sing.in = {}; push();
      loadSong(G.sing.options[chosen]);
    };
    if (top.length < 2) { go(); return; }
    // A tie: a roulette like a party-game minigame picker. The light jumps between the tied songs, fast at
    // first and slower and slower, and stops on the winner.
    G.phase = 'sroll'; G.sing.in = {}; G.sing.tied = top; G.barMs = 0;
    var hops = 16 + Math.floor(Math.random() * top.length), start = (top.indexOf(chosen) - (hops % top.length) + top.length * 8) % top.length, n = 0;
    var hop = function () {
      if (!G.sing || G.phase !== 'sroll') return;
      G.sing.roll = top[(start + n) % top.length]; Music.plop(n); render();
      if (n >= hops) { G.sing.rollDone = true; Music.ding(); render(); singTimer = setTimeout(go, 1400); return; }
      n++; singTimer = setTimeout(hop, 70 + Math.pow(n / hops, 2.4) * 520);
    };
    G.sing.rollDone = false; push(); singTimer = setTimeout(hop, 500);
  }
  function singListen() {
    G.phase = 'slisten'; G.barMs = clipSecs() * 1000; G.endsAt = Date.now() + G.barMs;
    playClip(); masks(false); push();
  }
  // "This clip isn't viable" on a phone: the part that played is no good for singing along (an intro, a
  // speech, an instrumental break). Another part of the same song is picked and everyone listens again.
  var SING_REROLLS = 3;
  function singReroll() {
    if (!G.sing || (G.phase !== 'slisten' && G.phase !== 'srec') || (G.sing.rerolls || 0) >= SING_REROLLS) return;
    G.sing.rerolls = (G.sing.rerolls || 0) + 1;
    clearTimeout(singTimer); clearInterval(poll); stopAudio();
    Object.keys(G.sing.clips).forEach(function (k) { try { URL.revokeObjectURL(G.sing.clips[k]); } catch (e) {} });
    G.sing.clips = {}; G.sing.parts = {}; G.sing.in = {};
    var d = 0, old = clipStart, lo = 15, pickAt = old;
    try { d = yt.getDuration() || 0; } catch (e) {}
    var hi = Math.max(lo + 1, d - 20 - clipSecs());
    for (var i = 0; i < 20 && Math.abs(pickAt - old) < 20; i++) pickAt = Math.floor(lo + Math.random() * (hi - lo));   // at least 20 seconds away from the last try
    clipStart = pickAt;
    cover(false); singListen();
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
    else if (G.phase === 'sroll') return;   // the roulette finishes by itself
    else if (G.phase === 'slisten') { clearInterval(poll); try { yt.pauseVideo(); } catch (e) {} singRecord(); }
    else if (G.phase === 'srec') singPlayAll();
    else if (G.phase === 'splay') singNext();
    else if (G.phase !== 'loading') singReveal();
  }
  net.on('poll', function (m) {
    var p = m && players[m.pid];
    if (p && G.sing && m.reroll) { singReroll(); return; }
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
      now: sg.now && players[sg.now] ? players[sg.now].name : null, result: sg.result, pass: sg.pass || 1, rerolls_left: SING_REROLLS - (sg.rerolls || 0),
      tally: G.phase === 'svote' ? sg.options.map(function (o, i) { var n = 0, k; for (k in sg.votes) if (sg.votes[k] === i) n++; return n; }) : null };
  }
  function renderSing() {
    var sg = G.sing;
    $('skip').textContent = sg && G.phase !== 'reveal' ? 'Continue' : 'Show answer';
    if (!sg) return;
    var song = sg.chosen != null ? sg.options[sg.chosen] : null, name = song ? song[3] + ' – ' + song[2] : '', t = '', opts = '';
    if (G.phase === 'sroll') {
      t = sg.rollDone ? 'We’re singing: ' + (sg.options[sg.roll][3] + ' – ' + sg.options[sg.roll][2]) : 'It’s a tie!';
      opts = sg.options.map(function (o, i) {
        var tied = sg.tied.indexOf(i) >= 0, n = 0, k; for (k in sg.votes) if (sg.votes[k] === i) n++;
        return '<div class="optcol"><div class="opt' + (i === sg.roll ? (sg.rollDone ? ' right' : ' rolling') : tied ? '' : ' dim') + '"><b>' + 'ABCD'[i] + '</b>' + esc(o[3] + ' – ' + o[2]) + '</div><div class="voters"><b>' + n + (n === 1 ? ' vote' : ' votes') + '</b></div></div>';
      }).join('');
    }
    else if (G.phase === 'svote') { t = 'Sing! Vote for the song'; opts = sg.options.map(function (o, i) {
      // Under each song: who voted for it so far.
      var who = list().filter(function (p) { return sg.votes[p.pid] === i; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return '<div class="optcol"><div class="opt"><b>' + 'ABCD'[i] + '</b>' + esc(o[3] + ' – ' + o[2]) + '</div><div class="voters">' +
        (who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (p) { return '<span>' + charSvg(p.char) + esc(p.name) + '</span>'; }).join('') : '<span class="mute">No votes yet</span>') + '</div></div>';
    }).join(''); }
    else if (G.phase === 'loading') t = 'We’re singing: ' + name;
    else if (G.phase === 'slisten') t = 'Listen first: ' + name;
    else if (G.phase === 'srec') t = 'Sing it! Record up to 10 seconds on your phone';
    else if (G.phase === 'splay') t = (sg.pass === 2 ? 'Once more: ' : 'Now singing: ') + (players[sg.now] ? players[sg.now].name : '');
    else if (G.phase === 'sbest') {
      // The vote is open while the recordings keep playing: behind each singer, who has voted for them so far.
      t = 'Who sang it best? Vote on your phone';
      opts = sg.order.map(function (pid) {
        var p = players[pid]; if (!p) return '';
        var who = list().filter(function (v) { return sg.best[v.pid] === pid; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        return '<div class="optcol"><div class="opt' + (pid === sg.now ? ' singing' : '') + '">' + charSvg(p.char) + esc(p.name) + (pid === sg.now ? ' <span class="note">♪ singing now</span>' : '') + '</div><div class="voters">' +
          (who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (v) { return '<span>' + charSvg(v.char) + esc(v.name) + '</span>'; }).join('') : '<span class="mute">No votes yet</span>') + '</div></div>';
      }).join('');
    }
    else if (G.phase === 'reveal') {
      var wins = (sg.result || []).filter(function (r) { return r.win; }).map(function (r) { return r.name; });
      $('ranswer').textContent = !sg.result || !sg.result.length ? 'Nobody sang this time' : wins.length ? 'Best singer: ' + wins.join(' & ') : 'Thanks for singing!';
      opts = (sg.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + charSvg(r.char) + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
    }
    $('qtext').textContent = t; $('qopts').innerHTML = opts;
    $('qopts').classList.toggle('votelist', G.phase === 'svote' || G.phase === 'sroll' || G.phase === 'sbest');   // the song vote: one song per row, its voters behind it
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
  function singToggle() { var on = $('s-atype').value === 'sing' || $('s-atype').value === 'draw' || $('s-atype').value === 'quip'; $('s-subject').disabled = on; $('s-scoring').disabled = on;
    // Party has Sing! and Draw! rounds with their own points, so the Ladder cannot be used there.
    var party = $('s-atype').value === 'party', lo = $('s-scoring').querySelector('option[value="ladder"]');
    if (lo) lo.disabled = party;
    if (party && $('s-scoring').value === 'ladder') $('s-scoring').value = 'correct';
    // Party needs ten songs to fit both Sing! and Draw!: five is not on offer there.
    var five = $('s-rounds').querySelector('option'); if (five) five.disabled = party; if (party && $('s-rounds').value === '5') $('s-rounds').value = '10';
    var lad = !on && $('s-scoring').value === 'ladder';   // Ladder: no song count and no hidden scores
    $('s-rounds').disabled = lad; $('s-show').disabled = lad; scoreHelp(); }
  // Only winners in play: "Higher or lower" would always be the winner, so it cannot be chosen.
  function winnersLock() {
    var win = $('s-cat').value === 'win', o = $('s-subject').querySelector('option[value="higher"]');
    if (o) o.disabled = win;
    if (win && $('s-subject').value === 'higher') $('s-subject').value = 'random';
  }
  $('s-cat').addEventListener('change', winnersLock); winnersLock();
  $('s-atype').addEventListener('change', singToggle); $('s-scoring').addEventListener('change', singToggle);
  function scoreHelp() {
    var show = $('s-show').value === 'end' ? ' Totals stay hidden until the final scoreboard.' : '';
    $('scorehelp').textContent = ($('s-atype').value === 'party' ? PARTY_HELP + ' ' + (HOST_SCORING_HELP[$('s-scoring').value] || '') : $('s-atype').value === 'draw' ? DRAW_HELP : $('s-atype').value === 'quip' ? QUIP_HELP : $('s-atype').value === 'sing' ? 'Sing!: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : (HOST_SCORING_HELP[$('s-scoring').value] || '')) + show;
  }
  $('s-scoring').addEventListener('change', scoreHelp); $('s-show').addEventListener('change', scoreHelp); scoreHelp();
  ['s-era', 's-cat'].forEach(function (id) { $(id).addEventListener('change', function () { G.era = $('s-era').value; G.cat = $('s-cat').value; ready(); }); });
  function toLobby() {
    G.ladderWon = false; G.gallery = null; G.best = null; G.quips = null; clearTimeout(quipTimer); list().forEach(function (p) { p.rung = 0; p.moved = ''; });
    clearTimeout(picksTimer); stopTimers(); autoStop(); yt2.stop(); singClear(); G.draw = null; clearTimeout(drawTimer); probeRun++; $('probebox').innerHTML = ''; clearTimeout(introTimer); clearTimeout(remoteTimer); G.clip = null; clearInterval(loadTick); loadT0 = 0; stage = 'idle';
    try { yt.stopVideo(); } catch (e) {}
    G.go = {};
    list().forEach(function (p) { p.score = 0; });   // a game that is over leaves no scores behind
    $('endask').classList.add('hidden');
    G.phase = 'lobby'; G.round = 0; G.song = null; G.q = null; note(''); push();
  }
  // "End game" in the corner: back to the menu, after a yes.
  $('endgame').addEventListener('click', function () { $('endask').classList.remove('hidden'); $('endno').focus(); });
  $('endno').addEventListener('click', function () { $('endask').classList.add('hidden'); });
  $('endask').addEventListener('click', function (e) { if (e.target === $('endask')) $('endask').classList.add('hidden'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('endask').classList.add('hidden'); });
  $('endyes').addEventListener('click', toLobby);
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
  // Take the settings as they stand and start: the fanfare first, then song 1.
  function ytReadyOrRemote() { return REMOTE || ytReady; }
  function beginGame() {
    if (G.phase !== 'lobby') return false;
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.atype = $('s-atype').value; G.subject = $('s-subject').value; G.scoring = $('s-scoring').value; G.showScore = $('s-show').value;
    if (!ytReadyOrRemote() || !buildPool()) return false;
    G.total = +$('s-rounds').value; G.guessMs = (+$('s-time').value + AFTER) * 1000;
    if (ladderGame()) { G.total = ENDLESS; G.showScore = 'always'; }   // the ladder is the score, and it goes on until someone is at the top   // the clip, then 5 seconds more to answer
    G.round = 0; G.used = {}; fails = 0; note('');
    list().forEach(function (p) { p.score = 0; p.rung = 0; p.moved = ''; }); G.ladderWon = false; G.mode = 'mc'; G.gallery = null; G.quips = null; G.quizRun = 0; G.lastSpecial = '';
    G.brief = briefInfo(); introStart();
    return true;
  }
  $('start').addEventListener('click', function () { if (G.phase === 'intro') introEnd(); else beginGame(); });
  // Autoplay: with the box ticked the next song starts by itself, after 10, 20 or 30 seconds or when
  // the song that is playing has finished ("Until the end").
  var autoTick = null, autoEnd = 0;
  try { $('auto').checked = localStorage.getItem('esc-auto') === '1'; var al = localStorage.getItem('esc-autolen'); if (al && $('autolen').querySelector('option[value="' + al + '"]')) $('autolen').value = al; } catch (e) {}
  // Seconds left of the song that is playing, or null when that cannot be told right now.
  function songLeft() {
    if (isPair() && G.q.correct === 1) return yt2.left();
    try { var st = yt.getPlayerState(), d = yt.getDuration() || 0, t = yt.getCurrentTime() || 0; if (st === 0) return 0; if (st === 1 && d > 0) return Math.max(0, d - t); } catch (e) {}
    return null;
  }
  function autoStop() { clearInterval(autoTick); autoTick = null; $('autoleft').textContent = ''; }
  function autoStart() {
    autoStop();
    if (!$('auto').checked || G.phase !== 'reveal') return;
    var toEnd = $('autolen').value === 'end';
    // Until the end: follow the player. If nothing is playing (or it cannot be read), fall back to a fixed wait.
    autoEnd = Date.now() + (toEnd ? REMOTE ? (G.remain > 0 ? Math.max(5, G.remain + 1 - (G.q && G.q.noclip ? 0 : Math.min(clipSecs(), (Date.now() - (G.guessAt || Date.now())) / 1000))) : 30) : 20 : +$('autolen').value) * 1000;
    var t0 = Date.now(), last = t0, held = false;
    var draw = function () {
      if (G.phase !== 'reveal') { autoStop(); return; }
      // An ad in front of the song (or the song has not started yet): the countdown waits for it.
      var now = Date.now(), hold = REMOTE || G.sing || (isPair() && G.q.correct === 1) ? '' : revealHold(yt, clipStart);
      if (hold && now - t0 < (hold === 'ad' ? 120000 : 12000)) {
        autoEnd = toEnd ? now + 20000 : autoEnd + (now - last); last = now; held = true;
        $('autoleft').textContent = hold === 'ad' ? 'Waiting for the ad to finish' : '';
        return;
      }
      last = now;
      if (held) { held = false; if (!recovering) net.send('state', snapshot()); }
      if (toEnd && !REMOTE && !(G.sing && G.sing.loop)) { var rem = songLeft(); if (rem != null) autoEnd = Date.now() + rem * 1000; }
      var left = Math.ceil((autoEnd - Date.now()) / 1000);
      if (left <= 0) { autoStop(); goNext(); return; }
      if (toEnd) $('autoleft').textContent = ''; else $('autoleft').textContent = (lastSong() ? 'Final scores in ' : 'Playing next song in ') + clock(left);
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
  $('skip').addEventListener('click', function () { if (G.sing) singSkip(); else reveal(); });
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (lastSong()) { try { yt.stopVideo(); } catch (e) {} G.go = {}; G.phase = 'end'; push(); } else startRound();   // nobody is 'ready' for the next game yet
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
