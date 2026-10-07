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
  // The handlers are also kept here, so the test bots (further down) can act exactly like a phone would.
  var H = {}, netOn = net.on; net.on = function (e, f) { H[e] = f; netOn(e, f); };
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
      if (G.best && G.best.only && m.pid !== G.best.only) return;   // one player picks the party round
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
    if (G.best && G.best.only && p.pid !== G.best.only && G.phase === 'guess') return true;   // only the chooser is waited for
    if (G.phase === 'qall') return !!(G.quips && (!G.quips.items[p.pid] || G.quips.items[p.pid].done));   // answer sent (or no line to finish)
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
    if (G.phase === 'end' && !ladderGame()) s.count_up = true;   // the totals were hidden: count them up one by one
    if (G.phase === 'brief' || G.phase === 'intro') s.brief = G.brief;
    if (G.phase === 'intro') s.intro = INTRO.ids[0];
    if (G.phase === 'reveal' && autoTick && $('autolen').value !== 'end') s.next_in = Math.max(0, autoEnd - Date.now());   // phones show the autoplay countdown too
    if (G.revealAt && (G.phase === 'guess' || G.phase === 'svote' || G.phase === 'sbest')) s.reveal_in = Math.max(0, G.revealAt - Date.now());
    if (G.phase === 'lobby') s.all_ready = allReady();
    if (G.phase === 'reveal' && lastSong()) s.last = true;
    if (REMOTE) { s.remote = true; if (G.clip && (G.phase === 'loading' || G.phase === 'guess' || G.phase === 'qall' || G.phase === 'reveal')) s.clip = G.clip; }
    // Phones get the question and the options, never which option is right (until the reveal).
    if (G.q && (G.phase === 'guess' || G.phase === 'reveal')) s.q = { subject: G.q.subject, type: G.q.type, text: G.q.text, hint: G.q.hint, options: G.q.options, noclip: !!G.q.noclip };
    if (G.q && G.phase === 'reveal') { s.q.correct = G.q.correct; s.q.answer = G.q.answer; s.q.explain = G.q.explain; if (G.q.reveal) s.q.reveal = G.q.reveal; }
    if (G.phase === 'pspin' && G.pspin) s.fun = { icon: '🎉', title: 'Party round!', sub: G.pspin.done ? 'It is ' + G.pspin.games[G.pspin.roll].title : 'Spinning…' };
    if (G.phase === 'fun' && G.fun) s.fun = { icon: G.fun.icon, title: G.fun.title, sub: G.fun.sub };
    if (G.phase === 'part' && G.part) s.part = { n: G.part.n, of: G.part.of, spin: !!G.part.eras, label: G.part.done ? G.part.label : '' };
    if (G.quips && G.phase === 'qall') {
      s.quips = { id: G.quips.id, prompts: {}, done: {} };
      Object.keys(G.quips.items).forEach(function (k) { s.quips.prompts[k] = G.quips.items[k].prompt; if (G.quips.items[k].done) s.quips.done[k] = 1; });
    }
    if (G.gallery && G.phase === 'dall') {
      // Everyone draws at once: each player gets their own four songs.
      s.gallery = { id: G.gallery.id, opts: {}, chosen: {}, done: {} };
      Object.keys(G.gallery.items).forEach(function (k) { var it = G.gallery.items[k]; s.gallery.opts[k] = it.options.map(songLabel); if (it.chosen != null) s.gallery.chosen[k] = it.chosen; if (it.done) s.gallery.done[k] = 1; });
    }
    if (G.best && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal')) s.best = { only: G.best.only || null, pick: !!G.best.pick, bluff: !!G.best.bluff, quip: !!G.best.quip, win_pts: G.best.quip ? QUIP_WIN : BEST_PTS * partyX(), id: G.best.id, pids: G.best.pids, tally: G.phase === 'reveal' ? G.best.tally : null, wins: G.phase === 'reveal' ? G.best.wins : null, pts: BEST_PTS };
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
    eraSet(G.era); catSet(G.cat);
    $('s-atype').value = G.robin ? 'robin' : G.atype; $('s-subject').value = G.subject; $('s-subject').disabled = $('s-scoring').disabled = G.atype === 'sing' || G.atype === 'draw' || G.atype === 'quip'; scoreHelp();
    if ([5, 10, 15, 20].indexOf(G.total) >= 0) $('s-rounds').value = G.total;
    if ([5, 10, 20, 30].indexOf(G.guessMs / 1000 - AFTER) < 0) G.guessMs = (20 + AFTER) * 1000;   // games saved with the old Guessing time setting
    $('s-time').value = G.guessMs / 1000 - AFTER;
    if (!$('s-time').value) { $('s-time').value = '20'; G.guessMs = (20 + AFTER) * 1000; }   // a saved game with a length that is no longer on offer (15 s)
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
  function show(id) { ['v-lobby', 'v-brief', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want((id === 'v-lobby' && G.phase === 'lobby') || (id === 'v-game' && !REMOTE && ((G.phase === 'guess' && !!G.q && (!!G.q.noclip || !!G.q.peel)) || (roundMode() === 'draw' && (G.phase === 'dall' || G.phase === 'loading')) || G.phase === 'part' || G.phase === 'fun' || G.phase === 'pspin'))); }   // menu music until the fanfare
  // "Show score: at the end of the round" keeps every total secret until the final scoreboard.
  function hideScores() {
    if (G.phase === 'end' || G.phase === 'lobby' || G.phase === 'brief' || G.phase === 'intro') return false;
    if (G.showScore === 'end') return true;
    if (G.tourFinal) return true;   // Grand tour: the last three questions are played blind
    // The very last song is played blind, so the final scoreboard still has something to reveal
    // (not on the Ladder, where the ladder itself is the score).
    return G.round > 0 && lastSong() && !ladderGame();
  }
  // ---------- Ladder scoring: everyone on one ladder ----------
  // The rungs are drawn once; each player is a small avatar that keeps its element, so a change of
  // rung is a glide up or down instead of a redraw.
  var RUNG_H = 34;
  // Where everyone stands beside the ladder: right and left in turn, further out when a spot is taken by
  // someone on the same rung or half a rung away (so no two avatars overlap).
  function ladderSpots(ps) {
    var placed = [], out = {};
    var rungOf = function (p) { return p.rung != null ? p.rung : Math.max(0, LADDER.indexOf(p.score)); };
    ps.slice().sort(function (a, b) { return rungOf(b) - rungOf(a) || a.name.localeCompare(b.name); }).forEach(function (p) {
      var r = rungOf(p), spot = null;
      var nr = placed.filter(function (q) { return q.right; }).length, sides = nr > placed.length - nr ? [false, true] : [true, false];   // the emptier side first
      for (var k = 0; k < 12 && !spot; k++) sides.forEach(function (right) {
        if (!spot && !placed.some(function (q) { return q.right === right && q.k === k && Math.abs(q.r - r) < 1; })) spot = { right: right, k: k, r: r };
      });
      spot = spot || { right: true, k: 0, r: r };
      placed.push(spot); out[p.pid] = spot;
    });
    return out;
  }
  // The end of a Ladder game: the whole ladder, big, with everyone on the rung they finished on.
  function endLadder() {
    var el = $('endladder'), on = ladderGame();
    el.classList.toggle('hidden', !on); $('final').classList.toggle('hidden', on);
    if (!on) return;
    var H2 = 50, html = '<div class="rails"></div>';
    for (var r = LADDER.length - 1; r >= 0; r--) html += '<div class="rung' + (r === LADDER.length - 1 ? ' top' : '') + '" style="bottom:' + (r * H2) + 'px"><span>' + (r ? LADDER[r] : 'Start') + '</span></div>';
    el.innerHTML = html + '<div class="climbers"></div>'; el.style.height = (LADDER.length * H2 + 10) + 'px';
    var box = el.querySelector('.climbers'), byRung = {};
    var ps = list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    ps.forEach(function (p) { var r = p.rung != null ? p.rung : Math.max(0, LADDER.indexOf(p.score)); (byRung[r] = byRung[r] || []).push(p); });
    var cx = el.clientWidth / 2, sideRoom = Math.max(160, cx - 50), spots = ladderSpots(ps), far = 0;
    ps.forEach(function (p) { far = Math.max(far, spots[p.pid].k); });
    ps.forEach(function (p) {
      var r = spots[p.pid].r, k = spots[p.pid].k, onRight = spots[p.pid].right;
      var gap = Math.min(170, sideRoom / (far + 1));
      var n = document.createElement('div'); n.className = 'climber' + (r === LADDER.length - 1 ? ' won' : '') + (onRight ? '' : ' lefty');
      n.innerHTML = charSvg(p.char) + '<b>' + esc(p.name) + '</b>'; n.style.bottom = '0px';
      if (onRight) n.style.left = (cx + 52 + k * gap) + 'px'; else n.style.right = (cx + 52 + k * gap) + 'px';   // left of the ladder: the name on the outside
      box.appendChild(n); n.getBoundingClientRect();
      n.style.bottom = (r * H2 + 3) + 'px';   // everyone climbs to their rung once more
    });
  }
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
    // The ladder stands in the middle; the players on a rung take turns to the right and to the left of it.
    var cx = el.clientWidth / 2, sideRoom = Math.max(34, cx - 30), spots = ladderSpots(ps), far = 0;
    ps.forEach(function (p) { far = Math.max(far, spots[p.pid].k); });
    ps.forEach(function (p, i) {
      var r = spots[p.pid].r, k = spots[p.pid].k, onRight = spots[p.pid].right;
      var gap = Math.min(40, Math.max(6, (cx - 68) / Math.max(1, far)));   // a little air between neighbours
      var n = box.querySelector('[data-pid="' + p.pid + '"]');
      if (!n) { n = document.createElement('div'); n.className = 'climber'; n.setAttribute('data-pid', p.pid); n.innerHTML = charSvg(p.char) + '<b></b>'; n.style.bottom = '0px'; n.style.left = (cx + 30) + 'px'; box.appendChild(n); n.getBoundingClientRect(); }
      n.querySelector('b').textContent = p.name; n.title = p.name;
      n.style.bottom = (r * RUNG_H + 2) + 'px'; n.style.left = (onRight ? cx + 34 + k * gap : cx - 64 - k * gap) + 'px'; n.style.zIndex = 10 + i;
      n.classList.toggle('off', !!p.off);
      n.classList.toggle('up', G.phase === 'reveal' && p.moved === 'up'); n.classList.toggle('down', G.phase === 'reveal' && p.moved === 'down');
      n.classList.toggle('won', r === LADDER.length - 1);
      seen[p.pid] = 1;
    });
    [].forEach.call(box.querySelectorAll('.climber'), function (n) { if (!seen[n.getAttribute('data-pid')]) n.remove(); });
  }
  function boardHtml(showGot) {
    var hide = hideScores();
    var ps = hide ? list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) : list();   // no order to read the ranking from
    return ps.map(function (p) {
      return '<li data-pid="' + esc(p.pid) + '" class="' + (showGot && p.got && !hide ? 'got ' : '') + (p.off ? 'off' : '') + '"><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="tot">' + (hide ? '?' : p.score) + '</span><span class="pts">' + (!hide && showGot && p.got ? '+' + p.pts : '') + '</span></li>';   // the +points have their own column, so the totals never shift
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
    $('clearplayers').classList.toggle('hidden', !ps.length);
    $('pcount').textContent = ps.length ? '(' + (G.phase === 'lobby' || G.phase === 'intro' ? nr + ' of ' + ps.length + ' ready' : ps.length) + ')' : '';
    // Players who change places glide to their new spot instead of jumping there.
    var was = {}; [].forEach.call($('board').querySelectorAll('li[data-pid]'), function (li) { var r = li.getBoundingClientRect(); if (r.height) was[li.getAttribute('data-pid')] = r.top; });
    $('board').innerHTML = boardHtml(G.phase === 'guess' || G.phase === 'reveal' || G.phase === 'dall' || G.phase === 'qall');
    [].forEach.call($('board').querySelectorAll('li[data-pid]'), function (li) {
      var w = was[li.getAttribute('data-pid')], r = li.getBoundingClientRect(); if (w == null || !r.height) return;
      var dy = w - r.top; if (Math.abs(dy) < 2) return;
      li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)'; li.style.zIndex = dy > 0 ? 2 : 1; li.getBoundingClientRect();
      li.style.transition = 'transform .9s cubic-bezier(.22,.8,.3,1)'; li.style.transform = '';
    });
    $('boardtitle').textContent = hideScores() ? 'Scores at the end' : ladderGame() ? 'Ladder' : 'Scores';
    renderLadder();
    $('endgame').classList.toggle('hidden', G.phase === 'lobby' || G.phase === 'intro' || G.phase === 'paused' || G.phase === 'end');
    $('newgame').classList.toggle('hidden', !(G.phase === 'intro' || G.phase === 'paused'));   // not while a game is playing: only during the countdown and after a restore
    $('hud').textContent = G.round && G.phase !== 'lobby' && G.phase !== 'end' && G.phase !== 'brief' && G.phase !== 'intro' ? (G.parts > 1 && G.partN ? 'Round ' + G.partN + ' / ' + G.parts + ' · Song ' + (G.round - (G.partStart || 1) + 1) + (ladderGame() ? '' : ' / ' + G.per) : 'Song ' + G.round + ofTotal(' / ')) : '';
    var noCtrl = G.phase === 'lobby' || G.phase === 'brief' || G.phase === 'intro' || G.phase === 'end';
    $('ctrl').classList.toggle('hidden', noCtrl); $('next').classList.toggle('hidden', noCtrl);
    $('hostmain').classList.toggle('ingame', G.phase !== 'lobby' && G.phase !== 'end' && G.phase !== 'brief' && G.phase !== 'intro');
    $('hostmain').classList.toggle('briefing', G.phase === 'brief' || G.phase === 'intro');
    // The fanfare is sound only: its player stays out of sight (but not display:none, or it would not play).
    if (G.phase !== 'end' && endFanfare) { endFanfare = false; try { yt.stopVideo(); } catch (e) {} }
    if (G.phase !== 'intro' && fanOn) fanStop();   // left the intro some other way (game ended)
    $('v-game').classList.toggle('audioonly', G.phase === 'intro' || endFanfare);
    if (G.phase === 'intro') $('v-game').classList.remove('hidden');
    if (window.selfSize) window.selfSize();
    if (G.phase !== 'end') endShown = false;
    // Everyone is ready: the fanfare plays, but the screen stays on the lobby with the settings locked.
    var locked = G.phase === 'intro';
    [].forEach.call($('v-lobby').querySelectorAll('.settings select, .settings input, .settings .multibtn'), function (el) { el.disabled = locked; });
    $('v-lobby').classList.toggle('locked', locked);
    if (!locked) { singToggle(); winnersLock(); autoMirror(); }   // gives Answers and Scoring back unless Sing! or Draw! greys them out
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
          // the winner's big avatar (with a tie: all of them), with a speech balloon above it
          $('winchar').innerHTML = wins.length ? '<div class="winballoon">Thank you Europe!</div><div class="winfaces">' + wins.slice(0, 4).map(function (w) { return charSvg(w.char); }).join('') + '</div>' : '';
        }, true, ladderGame());
        endLadder();   // counted up only when the totals were hidden during the game
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
      $('skip').classList.toggle('hidden', $('skip').disabled || !!G.sing || !stuck);   // no Continue button in Jury Show: its timers move it along
      if (G.phase === 'reveal' && G.best) {
        var bw = (G.best.wins || []).map(function (i) { return players[G.best.pids[i]]; }).filter(Boolean).map(function (p) { return p.name; });
        if (G.best.quip) bw = (G.best.wins || []).map(function (i) { var w = players[G.best.pids[i]]; return w ? w.name : QUIP_HOUSE; });
        if (G.best.bluff) bw = [G.q.options[G.best.real]];
        $('rtitle').textContent = bw.length ? (G.best.bluff ? 'It means: ' : G.best.quip ? 'Favourite answer: ' : 'Best drawing: ') + bw.join(' & ') : 'Nobody voted';
        $('rmeta').textContent = bw.length ? (G.best.bluff ? '12 points for finding it, 2 for every vote your bluff gets' : G.best.quip ? (G.best.per || 1) + (G.best.per === 1 ? ' point' : ' points') + ' per vote' : '+' + BEST_PTS * partyX() + ' bonus points') : ''; $('rres').textContent = ''; $('ranswer').textContent = '';
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
    // The minigame spin fills the screen with four big cards: the video stage steps aside for it.
    spinLayout(); $('qopts').classList.remove('notearea'); $('qopts').classList.remove('tiles'); $('qopts').classList.remove('tiles3');   // (tiles: only Jury Show with more than four singers)
    if (G.phase === 'pspin' && G.pspin) {
      var sp = G.pspin;
      $('qtext').textContent = sp.done ? 'Party round: ' + sp.games[sp.roll].title : 'Party round! Which one will it be?';
      $('qopts').innerHTML = sp.games.map(function (g, i) { return '<div class="optcol"><div class="opt' + (i === sp.roll ? (sp.done ? ' right picked' : ' rolling') : g.out ? ' dim' : '') + '"><span class="bigicon">' + g.icon + '</span><span class="bigname">' + esc(g.title) + '</span></div></div>'; }).join('');
      $('qopts').classList.remove('votelist'); $('qopts').classList.add('eras'); G.plopped = null; return;
    }
    // Green Room on the big screen: the answers are notes. Each one is shown large for a few seconds and then
    // shrinks to its place among the others, where the bars would be. The vote is held on those notes: the
    // votes land on them, and at the end each note gets the name of who wrote it.
    if (!REMOTE && q && G.best && G.best.quip && !G.best.bluff && ((G.phase === 'qshow' && G.qshow) || on)) {
      var showing = G.phase === 'qshow', cu = showing ? G.qshow.cur : null, nSmall = showing ? (cu ? cu.n - 1 : 0) : q.options.length;
      var nrev = G.phase === 'reveal', nshown = G.phase === 'picks' ? (G.shown || []) : nrev ? list().map(function (p) { return p.pid; }) : [];
      var cols = q.options.length <= 3 ? q.options.length : q.options.length <= 8 ? 4 : 6;
      $('qtext').textContent = showing ? 'Here is what you wrote: ' + G.qshow.prompt : q.text;
      $('qopts').classList.remove('votelist'); $('qopts').classList.remove('eras'); $('qopts').classList.remove('cols2'); $('qopts').classList.add('notearea');
      var bigWas = $('qopts').querySelector('.bigwrap .sheet'), bigRect = bigWas ? bigWas.getBoundingClientRect() : null, movedI = -1;   // where the big note is now: the start of its move
      $('qopts').innerHTML = '<div class="noteboard' + (cu ? ' back' : '') + '" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + q.options.map(function (o, i) {
        if (i >= nSmall) return '<div class="snote ghost"></div>';   // its place is kept free
        var who = nshown.map(function (pid) { return players[pid]; }).filter(function (p) { return p && p.pick === i; });
        var win = nrev && G.best.wins && G.best.wins.indexOf(i) >= 0, au = players[G.best.pids[i]];
        var just = (cu && cu.fresh && i === nSmall - 1) || G.noteJust === i;
        if (just) movedI = i;
        return '<div class="snote' + (win ? ' win' : nrev ? ' lost' : '') + (just && !bigRect ? ' shrunk' : '') + '" style="--tilt:' + ((i % 2 ? 1 : -1) * (0.8 + (i * 37 % 20) / 10)).toFixed(1) + 'deg"><b class="tag">' + 'ABCDEFGHIJKLMNOP'[i] + '</b><span class="scrib">' + esc(o) + '</span>' +
          '<div class="nvotes">' + who.map(function (p) { return '<span class="' + (p.pid === G.plopped ? 'plop' : '') + '" title="' + esc(p.name) + '">' + charSvg(p.char) + '</span>'; }).join('') + '</div>' +
          (nrev ? '<small class="by">' + esc(au ? au.name : QUIP_HOUSE) + (au && au.pts ? ' <b>+' + au.pts + '</b>' : '') + '</small>' : '') + '</div>';
      }).join('') + '</div>' +
        (cu ? '<div class="bigwrap"><div class="sheet' + (cu.fresh ? ' in' : '') + '" style="--tilt:' + ((cu.n % 2 ? -1 : 1) * (1 + (cu.n * 37 % 20) / 10)).toFixed(1) + 'deg"><span class="scrib">' + esc(cu.text) + '</span><small>' + cu.n + ' / ' + cu.of + '</small></div></div>' : '');
      // The note that was big travels to its place among the others: it starts where the big one was, at that
      // size, and glides and shrinks into its slot. The next big note comes in once it has landed.
      var mv = movedI >= 0 && bigRect ? $('qopts').querySelectorAll('.snote')[movedI] : null;
      if (mv) {
        var r = mv.getBoundingClientRect();
        if (r.width) {
          mv.classList.add('moving'); mv.style.transition = 'none';
          mv.style.transform = 'translate(' + ((bigRect.left + bigRect.width / 2) - (r.left + r.width / 2)).toFixed(1) + 'px,' + ((bigRect.top + bigRect.height / 2) - (r.top + r.height / 2)).toFixed(1) + 'px) scale(' + (bigRect.width / r.width).toFixed(3) + ')';
          mv.getBoundingClientRect();
          mv.style.transition = 'transform .7s cubic-bezier(.3,.8,.3,1)'; mv.style.transform = '';
          setTimeout(function () { mv.classList.remove('moving'); }, 750);
        }
      }
      if (cu) cu.fresh = false;
      G.noteJust = null; G.plopped = null; return;
    }
    if (G.phase === 'fun' && G.fun) { $('qtext').textContent = (G.fun.plain ? '' : 'Party round: ') + G.fun.title; $('qopts').innerHTML = '<p class="funsub">' + esc(G.fun.sub) + '</p>'; $('qopts').classList.remove('votelist'); $('qopts').classList.remove('eras'); G.plopped = null; return; }
    if (G.phase === 'part' && G.part) {
      var pt = G.part, head = pt.of > 1 ? 'Round ' + pt.n + ' of ' + pt.of : 'This game';
      $('qtext').textContent = pt.eras ? (pt.done ? head + ': ' + pt.label : head + ': which era will it be?') : head;
      $('qopts').innerHTML = pt.eras ? pt.eras.map(function (e, i) { return '<div class="optcol"><div class="opt' + (i === pt.roll ? (pt.done ? ' right picked' : ' rolling') : e.out ? ' dim' : '') + '">' + esc(e.label) + (e.out ? ' <span class="mute" style="font-size:.8em">played</span>' : '') + '</div></div>'; }).join('') : '';
      $('qopts').classList.remove('votelist'); $('qopts').classList.add('eras'); G.plopped = null; return;
    }
    $('qopts').classList.remove('eras');
    $('qtext').textContent = on ? q.text : G.phase === 'dall' ? 'Everyone is drawing a song!' : G.phase === 'qall' && G.quips ? (G.quips.bluff ? '' : 'Write a funny answer: ') + G.quips.line.p : G.phase === 'qshow' && G.qshow ? 'Here is what you wrote: ' + G.qshow.prompt : '';
    // One answer per row. Behind it: who picked it, first one by one (G.shown), then with the points at the reveal.
    var rev = G.phase === 'reveal', shown = G.phase === 'picks' ? (G.shown || []) : rev ? list().map(function (p) { return p.pid; }) : [];
    $('qopts').innerHTML = on && q.options ? (rev && q.reveal ? q.reveal : q.options).map(function (o, i) {
      var who = shown.map(function (pid) { return players[pid]; }).filter(function (p) { return p && p.pick === i && !(G.draw && p.pid === G.draw.pid); });
      if (rev) who.sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); });
      return '<div class="optcol"><div class="opt' + (rev ? ((G.best && G.best.wins ? G.best.wins.indexOf(i) >= 0 : i === q.correct) ? ' right' : ' dim') : '') + '"><b>' + 'ABCDEFGHIJKLMNOP'[i] + '</b>' + esc(o) + '</div><div class="voters">' +
        who.map(function (p) { return '<span class="' + (p.pid === G.plopped ? 'plop' : '') + '">' + charSvg(p.char) + esc(p.name) + (rev && p.got && i === q.correct && !G.best ? ' <b>+' + p.pts + '</b>' : '') + '</span>'; }).join('') + '</div></div>';
    }).join('') : '';
    G.plopped = null;   // the pop-in only plays once
    $('qopts').classList.toggle('votelist', !!(on && q.options));
    $('qopts').classList.toggle('cols2', !!(on && q.options && q.options.length > 4));   // up to four answers below each other, more than that side by side
  }
  // Everyone's character under the video, with a green ring once their answer is in.
  function renderAnswered() {
    var dall = (G.phase === 'dall' && !!G.gallery) || (G.phase === 'qall' && !!G.quips), busyOf = G.phase === 'qall' ? G.quips : G.gallery, on = dall || (G.sing && G.phase === 'srec');   // quiz rounds show who has answered in the score panel instead   // during the song vote the voters show behind each song instead
    var play = false;   // while the recordings play the singers are bars, with their voters behind them
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
      if (!dall && G.sing && G.phase === 'srec' && !isIn(p) && !p.off) pen = '<i class="pen" aria-hidden="true">🎤</i>';   // still recording
      return '<div class="pl' + (isIn(p) ? ' in' : '') + (p.off ? ' off' : '') + (pen ? ' busy' : '') + '">' + charSvg(p.char) + pen + '<span>' + esc(p.name) + '</span></div>';
    }).join('');
  }
  function cover(on, icon, text, pulse) {
    $('cover').classList.toggle('hidden', !on);
    if (on) { $('covericon').textContent = icon; $('covertext').textContent = text; $('covericon').classList.toggle('pulse', !!pulse); }
  }
  // Countdown: the video loads muted behind the cover while 5..1 counts down.
  // The clip starts as soon as both the countdown and the loading are done.
  var COUNT = 3, loadT0 = 0, loadTick = null, clipReady = false;
  // YouTube flashes a play/pause symbol in the middle of the picture whenever a video is started or stopped.
  // So the clip is started two seconds early, silent and behind the cover, and is uncovered once that has passed;
  // and at the end of the clip it is not stopped, only silenced and covered (see playClip).
  var PRE = 2, preAt = 0, quietAt = -1;
  function preOk() { return !REMOTE && stage === 'ready' && !lateLoad && !G.draw && !(G.q && G.q.noclip); }
  function countStart() {
    clipReady = false; preAt = 0;
    if (loadT0) return;                 // a replacement for a broken video keeps the running countdown
    loadT0 = Date.now(); clearInterval(loadTick);
    var draw = function () {
      var left = COUNT - Math.floor((Date.now() - loadT0) / 1000);
      // two seconds before the end of the countdown (or as soon as the video is ready after that): start it, unseen and unheard
      if (clipReady && !preAt && preOk() && Date.now() - loadT0 >= (COUNT - PRE) * 1000) { preAt = Date.now(); try { yt.mute(); yt.seekTo(Math.max(0, clipStart - PRE), true); yt.playVideo(); } catch (e) {} }
      if (left >= 1) { $('covericon').textContent = left; $('covertext').textContent = 'Selecting song'; }
      else if (clipReady && isPair() && !yt2.ready) {   // the second song of a two-clip question is not ready yet
        $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…';
        if (Date.now() - loadT0 > 30000) badSong();   // it is not coming: take another song and question
      }
      else if (clipReady && preAt && Date.now() - preAt < PRE * 1000) { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }   // the head start is not over yet
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
    // The last five seconds of a question: who are we still waiting for?
    var late = G.phase === 'guess' && !cd && G.endsAt && G.endsAt - Date.now() <= 5000 && G.endsAt - Date.now() > 0 && list().length > 1 ? list().filter(function (p) { return !p.off && !isIn(p); }).sort(function (a, b) { return a.name.localeCompare(b.name); }) : [];
    var qcd = G.phase === 'qall' && G.quips && G.quips.cdAt ? Math.max(1, Math.ceil((G.quips.cdAt - Date.now()) / 1000)) : 0;   // writing round: everyone has sent something in
    var key = qcd ? 'q' + qcd : cd ? 'cd' + cd + voteCd : late.length ? 'late' + late.map(function (p) { return p.pid; }).join(',') : '';
    if (key !== allinKey) {
      allinKey = key;
      if (qcd) $('allin').textContent = 'All answers received: ' + qcd;
      else if (late.length) $('allin').innerHTML = '<span class="hurry">Hurry up, still waiting for:</span>' + late.map(function (p) { return '<span class="waitfor" title="' + esc(p.name) + '">' + charSvg(p.char) + '</span>'; }).join('');
      else $('allin').textContent = cd ? (voteCd ? 'Everyone has voted. Continuing in ' : list().length > 1 ? 'Everyone answered, revealing in ' : 'Revealing in ') + cd : '';   // alone: nobody else to wait for
    }
    // What a right answer is worth right now, in the corner of the video (every trivia question; not for votes or the Ladder).
    // It stays where it was once everyone has answered, until the points are handed out at the answer.
    var worth = '', held = !REMOTE && !!G.q && !G.best && !ladderGame() && ((G.phase === 'guess' && !!G.revealAt) || G.phase === 'picks');
    if (held) worth = worthShown;
    else if (!REMOTE && G.phase === 'guess' && G.q && !G.best && !ladderGame()) {
      var x2 = G.tourFinal && !G.draw ? 2 : 1;
      if (G.draw) worth = String(partyX());
      else if (G.q.peel) worth = String(peelPoints((G.barMs || PEEL_MS) - (G.endsAt - Date.now())) * x2);
      else if (G.scoring === 'speed') worth = String((ESC_POINTS[list().filter(function (p) { return p.pick != null; }).length] || 1) * x2);   // Speedy: what the next one in can still get
      else worth = String((G.qWorth || 12) * x2);
    }
    if (worth !== worthShown) { worthShown = worth; $('worth').classList.toggle('hidden', !worth); if (worth) { $('worth').textContent = worth; $('worth').classList.remove('tick'); void $('worth').offsetWidth; $('worth').classList.add('tick'); } }
    var timed = G.phase === 'guess' || G.phase === 'dall' || G.phase === 'qall' || (G.sing && (G.phase === 'svote' || G.phase === 'slisten' || G.phase === 'srec' || G.phase === 'sbest'));
    $('tbar').style.transform = 'scaleX(' + (timed ? Math.max(0, Math.min(1, (G.endsAt - Date.now()) / (G.barMs || G.guessMs))) : 0) + ')';
  }, 100);

  // ---------- YouTube ----------
  var yt2 = ONE_PLAYER ? new SharedSecond(function () { return yt; }, function () { return { id: loadedId, start: clipStart }; }) : new SecondPlayer('yt2'), pairStep = 0, pairTimer = null, loadedId = '';
  function stageEl() { return document.querySelector('#v-game .stage'); }
  function pairTag(t) { $('pairtag').textContent = t; $('pairtag').classList.toggle('hidden', !t); }
  function isPair() { return !!(G.q && G.q.pair); }
  function clipLen() { return isPair() ? PAIR_CLIP : clipSecs(); }
  window.onYouTubeIframeAPIReady = function () {
    yt2.make();
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); fanCue(); }, onError: function () {
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
    G.q = G.sing || G.quipLoad ? null : G.draw ? G.q : makeQuestion(G.song, G.subject, 'mc', playSongs(), playCountries(), { pair: true, peel: true, cat: G.cat, pool: G.pool, types: G.types || Object.keys(TYPE_WEIGHT) });
    if (G.q && G.q.swap) { G.song = G.q.swap; G.used[G.song[4]] = 1; }   // the question brought its own song
    stage = 'probe';
    cover(true, '', 'Selecting song', false); countStart(); masks(true);
    worthSpin();
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
    stage = 'clip'; quietAt = -1;
    var rolling = false; try { var t0 = yt.getCurrentTime() || 0; rolling = !!preAt && yt.getPlayerState() === 1 && Math.abs(t0 - clipStart) < 1.5; } catch (e) {}
    preAt = 0;
    if (!rolling) yt.seekTo(clipStart, true);   // (already running at the right spot after its head start: no jump, no symbol)
    yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipLen()) {
        clearInterval(poll);
        // A plain question: the video runs on silently behind the cover until the answer, so nothing is stopped and started.
        if (G.phase === 'guess' && !isPair() && !G.sing && !G.draw && !G.quipLoad && !G.quips) { quietAt = yt.getCurrentTime() || 0; yt.mute(); } else yt.pauseVideo();
        stage = 'paused';
        if (isPair() && G.phase === 'guess' && pairStep === 0) {
          // on to the second song, in the spare player
          pairStep = 1; if (!yt2.shared) stageEl().classList.add('second'); pairTag('Song 2'); yt2.play();
          pairTimer = setTimeout(function () { yt2.pause(); pairTag(''); if (G.phase === 'guess') cover(true, '?', '', false); }, PAIR_CLIP * 1000);
          return;
        }
        if (G.phase === 'guess') cover(true, '?', '', false);   // the question itself stays below the video
        if (G.sing && G.phase === 'slisten') singRecord();
      }
    }, 100);
  }
  // "Behind the curtain": the video plays without its sound behind a curtain of tiles, which drop away a few
  // at a time; the game's own music plays meanwhile. An answer is worth less with every second that passes.
  var peelTick = null;
  function peelPlay(ms) {
    clearInterval(poll); stage = 'clip'; quietAt = -1;
    var rolling = false; try { rolling = !!preAt && yt.getPlayerState() === 1 && Math.abs((yt.getCurrentTime() || 0) - clipStart) < 1.5; } catch (e) {}
    preAt = 0;
    try { yt.mute(); if (!rolling) yt.seekTo(clipStart, true); yt.playVideo(); } catch (e) {}
    cover(false); masks(true);
    var el = $('peel'), cols = 12, rows = 7, n = cols * rows, html = '';
    for (var i = 0; i < n; i++) html += '<i style="background-position:' + (i % cols) * 100 / (cols - 1) + '% ' + Math.floor(i / cols) * 100 / (rows - 1) + '%"></i>';
    el.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)'; el.style.gridTemplateRows = 'repeat(' + rows + ',1fr)';
    el.innerHTML = html; el.classList.remove('hidden');
    var order = shuffle(Array.apply(null, { length: n }).map(function (x, k) { return k; })), t0 = Date.now(), gone = 0, tiles = el.querySelectorAll('i');
    clearInterval(peelTick);
    peelTick = setInterval(function () {
      if (G.phase !== 'guess' || !G.q || !G.q.peel) { peelStop(); return; }
      var el2 = Date.now() - t0, want = Math.min(n, Math.floor(n * el2 / (ms * 0.97)));   // slowly: the last tile goes just before the time is up
      while (gone < want) tiles[order[gone++]].classList.add('gone');
    }, 200);
  }
  function peelStop() { clearInterval(peelTick); $('peel').classList.add('hidden'); $('peel').innerHTML = ''; }
  // Standard scoring: while the song is being selected, a light runs up and down a column of the Eurovision
  // points (12, 10, 8, 7 … 1) and stops on what a right answer to this question will be worth.
  var WORTHS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1], worthTimer = null;
  function worthSpin() {
    var ok = !REMOTE && G.q && !G.draw && !G.sing && !G.quipLoad && !G.best && G.scoring === 'correct' && !ladderGame();
    if (!ok) { G.qWorth = 0; worthHide(); return; }
    if (G.worthRound === G.round && $('ptspin').innerHTML) return;   // a replacement for a broken video keeps what was spun
    // A question whose points are not fixed (Behind the curtain: they fall as time passes) lands on the question mark.
    var open = !!G.q.peel;
    G.worthRound = G.round; G.qWorth = open ? 0 : pick(WORTHS);
    var el = $('ptspin'), x2 = G.tourFinal ? 2 : 1, target = open ? 0 : WORTHS.indexOf(G.qWorth) + 1;
    el.innerHTML = '<i>?</i>' + WORTHS.map(function (v) { return '<i>' + v * x2 + '</i>'; }).join(''); el.classList.remove('hidden');
    // The light climbs from 1 at the bottom, rung by rung, up to this question's number, and pops when it gets there.
    var chips = el.querySelectorAll('i'), n = chips.length, at = n - 1, steps = n - 1 - target, gap = Math.max(110, Math.min(260, 1700 / Math.max(1, steps)));
    clearTimeout(worthTimer);
    var hop = function () {
      if (G.phase !== 'loading') { worthHide(); return; }
      [].forEach.call(chips, function (c, i) { c.className = i === at ? 'on' : i > at ? 'lit' : ''; });
      Music.plop(n - 1 - at);
      if (at <= target) { worthTimer = setTimeout(function () { if (G.phase !== 'loading') return; chips[at].className = 'on picked' + (G.qWorth === 12 ? ' douze' : ''); if (G.qWorth === 12) Music.douze(); else Music.ding(); }, 260); return; }   // twelve gets a fanfare of its own
      at--; worthTimer = setTimeout(hop, gap);
    };
    worthTimer = setTimeout(hop, 200);
  }
  function worthHide() { clearTimeout(worthTimer); $('ptspin').classList.add('hidden'); $('ptspin').innerHTML = ''; }
  function beginGuess() {
    worthHide();
    if (G.quipLoad) { quipWrite(); return; }   // Quip!: the clip comes with a question to write an answer to
    $('err').textContent = '';
    var ms = G.draw ? drawGuessMs() : isPair() ? PAIR_MS : G.q && G.q.peel ? PEEL_MS : G.guessMs;
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms;
    if (isPair()) { pairStep = 0; stageEl().classList.remove('second'); pairTag('Song 1'); }
    if (G.q && G.q.noclip) { clearInterval(poll); stage = 'paused'; var art = noClipArt(G.q); cover(true, G.draw ? '✏️' : art[0], G.draw ? '' : art[1], false); }   // odd one out and Draw!: no clip
    else if (G.q && G.q.peel) peelPlay(ms);
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
  // (a Ladder game in several rounds ends on an ordinary scoreboard: the rounds added up)
  function ladderGame() { return G.atype === 'mc' && G.scoring === 'ladder' && !(G.phase === 'end' && G.partLadder); }
  var ENDLESS = 9999;   // Ladder has no song limit: it runs until someone is at the top
  function ofTotal(sep) { return G.total >= ENDLESS ? '' : sep + G.total; }
  // Grand tour: the game is over when the last minigame is (with Postcard: when its last drawing and the vote are done).
  function tourOver() { return !!(G.tour && G.tourLast && !(G.gallery && (G.gallery.queue.length || G.gallery.vote))); }
  function lastSong() { return G.round >= G.total || !!(G.ladderWon && ladderGame() && (!G.partLadder || (G.partN || 0) >= G.parts)); }
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
      if (G.best.pick) { partyPicked(tops); return; }   // not a question: the choice of the next party round
      G.best.tally = tally; G.best.wins = tops; G.q.correct = tops.length ? tops[0] : -1;
      if (G.best.bluff) {
        // Bluff!: 12 points for finding the real meaning, 4 for every player who falls for your fake.
        var realI = G.best.real;
        G.best.wins = [realI]; G.q.correct = realI;
        list().forEach(function (p) { if (p.pick === realI) { p.pts = (p.pts || 0) + 12; p.got = true; } });
        list().forEach(function (p) { if (p.pts) p.score += p.pts; });
        // the bluffs are paid out after the real meaning is shown: 2 points per vote, one vote at a time (payTick)
        var pay = []; G.best.pids.forEach(function (k, i) { if (players[k] && i !== realI) for (var v = 0; v < tally[i]; v++) pay.push({ i: i, pid: k }); });
        clearTimeout(payTimer); G.pay = pay; G.payN = 0; G.payNow = -1;
        if (pay.length) payTimer = setTimeout(payTick, 2200);
        G.q.reveal = G.q.options.map(function (o, i) { var w = players[G.best.pids[i]]; return o + '  —  ' + (i === realI ? 'the real meaning' : w ? w.name + '’s bluff' : ''); });
      } else
      if (G.best.quip) {
        // Quip!: every vote is worth the same; how much depends on the size of the group, so that an answer
        // everyone else votes for comes to about 12 points. The names come out now.
        var voters = Math.max(1, list().filter(function (p) { return !p.off; }).length - 1);
        G.best.per = Math.max(1, Math.round(12 / voters));
        G.best.pids.forEach(function (k, i) { var w = players[k]; if (!w) return; w.pts = tally[i] * G.best.per; w.score += w.pts; w.got = w.pts > 0; });
        G.q.reveal = G.q.options.map(function (o, i) { var w = players[G.best.pids[i]]; return o + '  —  ' + (w ? w.name : QUIP_HOUSE); });
      } else
      tops.forEach(function (i) { var w = players[G.best.pids[i]]; if (w) { w.pts = BEST_PTS * partyX(); w.score += w.pts; w.got = true; } });
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
    right.forEach(function (p, rank) { p.pts = G.draw ? partyX() : (G.q && G.q.peel ? peelPoints(p.pickMs) : G.scoring === 'correct' && G.qWorth ? G.qWorth : pointsFor(G.scoring === 'speed' ? 'order' : G.scoring, isPair() ? Math.max(0, p.pickMs - PAIR_CLIP * 1000) : p.pickMs, G.guessMs, rank)) * (G.tourFinal && !G.draw ? 2 : 1); p.score += p.pts; p.got = true; });   // (the Grand tour's finale counts double)
    // Draw!: a point for everyone who guesses it, and a point for the artist for each of them.
    var artist = G.draw && players[G.draw.pid];
    // The artist: 12 points shared out over everyone who answered, for each of them who got it (all right: 12).
    var answered = G.draw ? list().filter(function (p) { return p.pick != null && p.pid !== G.draw.pid; }).length : 0;
    if (artist && right.length) { artist.pts = Math.max(1, Math.round(12 * right.length / Math.max(answered, right.length))); artist.score += artist.pts; artist.got = true; }
    if (!REMOTE && G.q) Music.ding();   // the right answer lights up
    cover(false); masks(false); peelStop();
    // After a drawing the video only starts now, and YouTube shows its title and buttons over the first seconds:
    // the top and bottom stay covered for that long (then they clear, so an ad can still be skipped by hand).
    clearTimeout(maskTimer);
    if (G.draw && !REMOTE) { masks(true); maskTimer = setTimeout(function () { if (G.phase === 'reveal') masks(false); }, 8000); }
    // The video carries on from where the clip stopped (it only jumps back if it somehow is not at the clip).
    clearTimeout(pairTimer); pairTag('');
    if (G.best && G.best.quip) { /* the song is already playing: it simply carries on, now without the masks */ }
    else if (G.best) { cover(true, '🏆', '', false); }   // no song with this one
    else if (isPair()) {
      // the song that was the right answer plays on, from where its clip stopped
      var second = G.q.correct === 1;
      stageEl().classList.toggle('second', second && !yt2.shared);
      try { if (second) { if (!yt2.shared) yt.pauseVideo(); if (pairStep === 0) yt2.play(); else yt2.resume(); } else if (yt2.shared && yt2.back()) { /* the first song is back in the one player */ } else { yt2.pause(); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {}
    } else if (G.q && G.q.peel && !REMOTE) {
      // Behind the curtain: the video simply carries on where it is, now with its sound
      try { yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    } else if (lateLoad && !REMOTE) {
      // only now does the video come in, somewhere in the middle of the song
      lateLoad = false; clipStart = Math.floor(35 + Math.random() * 50);
      try { yt.unMute(); yt.setVolume(100); yt.loadVideoById({ videoId: G.song[4], startSeconds: clipStart }); } catch (e) {}
    } else {
    try {
      var tNow = yt.getCurrentTime() || 0;
      if (quietAt >= 0 && yt.getPlayerState() === 1) { if (tNow - quietAt > 1) yt.seekTo(quietAt, true); }   // it ran on in silence: back to where the clip stopped
      else if (!(tNow >= clipStart - 1 && tNow <= clipStart + clipSecs() + 2)) yt.seekTo(clipStart, true);
      quietAt = -1; yt.unMute(); yt.setVolume(100); yt.playVideo();
    } catch (e) {}
    }
    push(); autoStart(); revealWatch();
  }
  // At the answer: while an ad is playing instead of the song, the player can be clicked (Skip ad).
  var revealTick = null;
  var maskTimer = null;
  function revealWatch() {
    // While the answer is up, the video stays covered against clicks and taps (they make YouTube show its pause
    // button and other controls), except for the bottom right corner, where "Skip ad" appears.
    clearInterval(revealTick);
    var sh = document.querySelector('#v-game .shield');
    sh.classList.remove('hidden'); sh.classList.add('peek');
    revealTick = setInterval(function () {
      if (G.phase !== 'reveal') { clearInterval(revealTick); sh.classList.remove('peek'); sh.classList.toggle('hidden', adShown); return; }
      sh.classList.remove('hidden'); sh.classList.add('peek');
    }, 400);
  }
  function startRound() {
    payFlush(); paper(null); peelStop();
    G.round++; G.phase = 'loading'; G.singSkips = 0; G.qWorth = 0; worthHide();
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; });
    G.q = null; G.revealAt = 0; singClear(); G.draw = null; G.best = null; clearTimeout(drawTimer); clearTimeout(picksTimer);
    yt2.pause(); if (!REMOTE) { stageEl().classList.remove('second'); pairTag(''); }
    G.quips = null; G.quipLoad = false; clearTimeout(quipTimer);
    // A new round of the quiz starts here: say so, and spin for its years if that is how this game is played.
    // On the Ladder a round is over when someone reaches the top: what everyone's rung is worth goes to
    // their total, and all are back on the ground for the next round.
    if (G.partLadder && G.ladderWon) {
      list().forEach(function (p) { p.bank = (p.bank || 0) + LADDER[Math.floor(p.rung || 0)]; p.rung = 0; p.score = 0; p.moved = ''; });
      G.ladderWon = false; G.partNext = true;
    }
    var due = ladderGame() ? !!G.partNext : !!G.per && (G.round - 1) % G.per === 0 && !(G.partDone || {})[G.round];
    if ((G.parts > 1 || G.eraSpin) && due) { partIntro(); return; }
    startRound2();
  }
  function startRound2() {
    G.phase = 'loading';
    // Drawings that are still waiting to be guessed come first.
    if (G.gallery && G.gallery.queue.length) { if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} } drawNext(); return; }
    if (G.gallery && G.gallery.vote && drawVote()) return;   // and to finish: which drawing was the best?
    G.gallery = null;
    // Party: four quiz questions, then a Sing! or a Draw! round, then four quiz questions again, and so on
    // (Sing! only with a shared screen, and neither without at least two players).
    if (G.atype === 'party') {
      // Party: three quiz questions, then a party round, and so on. Which party round is decided by a spin
      // over the ones that are switched on (Advanced settings); the one just played sits a turn out.
      var pOn = G.partyOn || {}, two = list().filter(function (p) { return !p.off; }).length >= 2;
      var games = ['sing', 'draw', 'quip', 'bluff'].filter(function (x) { return pOn[x] !== false && !(x === 'sing' && REMOTE) && (two || (x !== 'sing' && x !== 'draw')); });
      G.mode = 'mc';
      if (G.tour && !games.length) { G.tour = false; G.total = G.round + 9; }   // no minigame can be played with this group: a plain quiz of ten
      // Grand tour: after the last minigame come three more questions, for double points and with the scores hidden.
      if (G.tour && G.tourLast && !G.tourFinal) { G.tourFinal = true; G.total = G.round + 2; G.afterParty = false; G.quizRun = 0; funIntro('final', startRound2, 6000); return; }
      if (!G.tourFinal && (G.quizRun || 0) >= 3 && games.length) { G.quizRun = 0; if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} } partyChoose(games); return; }
      // Back from a minigame: a card says so, before the questions start again.
      if (G.afterParty) { G.afterParty = false; funIntro('quiz', startRound2, 4200); return; }
      G.quizRun = (G.quizRun || 0) + 1;
    } else G.mode = G.atype;
    var md = roundMode();
    if (!REMOTE && (md === 'sing' || md === 'draw')) { try { yt.pauseVideo(); } catch (e) {} }   // the previous song stops while the next one is chosen
    // A party round is announced first, so nobody is surprised by what is asked of them.
    var alone = { sing: singStart, draw: drawAll, quip: quipAll, bluff: bluffAll };   // (a game of only one of these)
    if (G.atype !== 'party' && alone[md] && !(md === 'sing' && REMOTE)) { funIntro(md, alone[md]); return; }
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
    if (G.quipLoad) G.q = null; else if (!G.draw) G.q = makeQuestion(G.song, G.subject, 'mc', playSongs(), playCountries(), { cat: G.cat, pool: G.pool, types: G.types });
    if (G.q && G.q.swap) { G.song = G.q.swap; G.used[G.song[4]] = 1; }
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
    if (G.quipLoad) { quipWrite(); return; }
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
    if (!REMOTE) { cover(true, '🎨', 'Everyone is drawing', false); masks(true); }
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
    g.vote = false;   // (there used to be a vote for the best drawing at the end; it is no longer played)
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
  // ---------- the title card before a party round ----------
  var FUN = {
    quip: { icon: '💬', title: 'Green Room', sub: 'A song plays with a question about it. Everyone writes a funny answer on their phone. Then you all vote for the funniest one.' },
    draw: { icon: '🎨', title: 'Postcard', sub: 'Everyone picks a song and draws it on their phone. Then guess what the others drew.' },
    bluff: { icon: '🤥', title: 'Lost in Translation', sub: 'A song title in another language. Make up a translation that fools the others, then find the real one.' },
    final: { icon: '✨', title: 'Trivia finale', sub: 'The last three questions: every point counts double! The scores stay hidden until the final reveal.' },
    quiz: { icon: '🎧', title: 'Trivia', sub: 'Trivia time: three questions coming up.' },
    sing: { icon: '🎤', title: 'Jury Show', sub: 'Vote for a song, listen, then record yourself singing it on your phone.' }
  };
  var funTimer = null;
  // Which party round is next. How that is decided is a setting: a spin (random), each in turn, a vote
  // by everyone, or one player (a different one each time) picks.
  function partyGo(kind, ms) {
    var starts = { sing: singStart, draw: drawAll, quip: quipAll, bluff: bluffAll };
    G.mode = G.lastParty = kind; G.best = null; G.q = null; G.afterParty = true;
    funIntro(kind, starts[kind], 8000);   // long enough to read what the minigame asks of you
  }
  function partyChoose(games) {
    var how = games.length < 2 ? 'single' : (G.partyPick || 'order');
    if (how === 'single' && G.tour) G.tourLast = true;   // a tour of one minigame ends with it
    if (how === 'single') { partyGo(games[0]); return; }
    if (how === 'order') {
      // Grand tour: the spin picks among the minigames that have not been played yet; the played ones are greyed
      // out. Once all have had their turn, they are all back in.
      var done = G.partyDone || (G.partyDone = []), left = games.filter(function (x) { return done.indexOf(x) < 0; });
      if (!left.length) { done.length = 0; left = games.filter(function (x) { return x !== G.lastParty; }); if (!left.length) left = games.slice(); }
      var next = pick(left); done.push(next);
      if (G.tour && games.every(function (x) { return done.indexOf(x) >= 0; })) G.tourLast = true;   // the last stop of the tour
      partySpin(left, next, function () { partyGo(next, 3000); });   // (with one minigame left the spin page still shows: it lights up at once)
      return;
    }
    if (how === 'vote' || how === 'one') { partyVote(games, how === 'one'); return; }
    var fresh = games.filter(function (x) { return x !== G.lastParty; }), chosen = pick(fresh.length ? fresh : games);
    partySpin(games, chosen, function () { partyGo(chosen, 3000); });   // random: the spin picks one of the rounds that are switched on
  }
  // A vote (or one player's choice) on the phones, with the party rounds as the answers.
  var PICK_MS = 15000;
  function partyVote(games, one) {
    var chooser = null;
    if (one) {
      var act = list().filter(function (p) { return !p.off; }).sort(function (a, b) { return a.pid < b.pid ? -1 : 1; });
      if (act.length) { chooser = act[(G.partyTurn || 0) % act.length]; G.partyTurn = (G.partyTurn || 0) + 1; }
    }
    stopTimers(); G.draw = null; G.song = null; G.clip = null;
    G.best = { pick: true, kinds: games, pids: games.map(function () { return null; }), only: chooser ? chooser.pid : null, id: 'pick' + G.round, tally: null, wins: null };
    G.q = { subject: 'pick', type: 'mc', text: chooser ? chooser.name + ' picks the party round' : 'Vote: which party round is next?', hint: '', options: games.map(function (k) { return FUN[k].icon + ' ' + FUN[k].title; }), correct: -1, answer: '', noclip: true };
    if (!REMOTE) { cover(true, '🎉', 'Party round!', false); masks(true); $('cover').classList.add('funcard'); stageEl().classList.add('novideo'); }
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = PICK_MS; G.endsAt = Date.now() + PICK_MS; push();
    endTimer = setTimeout(reveal, PICK_MS);
  }
  // The votes are in: the one with the most plays; a tie (or no votes at all) is settled by the spin.
  function partyPicked(tops) {
    var kinds = G.best.kinds, cands = tops.length ? tops.map(function (i) { return kinds[i]; }) : kinds;
    clearTimeout(picksTimer); stopTimers();
    list().forEach(function (p) { p.pick = null; });
    G.best = null; G.q = null;
    if (cands.length > 1) { var c = pick(cands); partySpin(cands, c, function () { partyGo(c, 3000); }); }
    else partyGo(cands[0]);
  }
  // More than one party round to choose from: a spin decides, like a party-game minigame picker.
  var LAND = 700;   // a spin: how long the light rests on the winner before that tile turns green
  function partySpin(games, chosen, then) {
    G.phase = 'pspin'; G.barMs = 0;
    G.pspin = { games: ['sing', 'draw', 'quip', 'bluff'].map(function (k) { return { kind: k, icon: FUN[k].icon, title: FUN[k].title, out: games.indexOf(k) < 0 }; }), roll: -1, done: false };
    var idx = function (k) { return ['sing', 'draw', 'quip', 'bluff'].indexOf(k); };
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, '🎉', 'Party round!', false); masks(true); $('cover').classList.add('funcard'); }
    var hops = games.length < 2 ? 0 : 16 + Math.floor(Math.random() * games.length), start = (games.indexOf(chosen) - (hops % games.length) + games.length * 8) % games.length, k = 0;   // only one left: no running light, straight to yellow and then green
    var hop = function () {
      if (G.phase !== 'pspin') return;
      G.pspin.roll = idx(games[(start + k) % games.length]); if (!REMOTE) Music.plop(k); render();
      if (k >= hops) { funTimer = setTimeout(function () { if (G.phase !== 'pspin') return; G.pspin.done = true; if (!REMOTE) Music.ding(); push(); funTimer = setTimeout(function () { if (G.phase !== 'pspin') return; G.pspin = null; then(); }, 1300); }, LAND); return; }   // the light lands on the winner first, then that tile turns green
      k++; funTimer = setTimeout(hop, 70 + Math.pow(k / hops, 2.4) * 520);
    };
    push(); clearTimeout(funTimer); funTimer = setTimeout(hop, 2200);   // a moment to take in the cards before the light starts running
  }
  function funIntro(kind, then, ms) {
    var f = FUN[kind];
    G.fun = { kind: kind, icon: f.icon, title: f.title, sub: f.sub, plain: kind === 'quiz' || kind === 'final' };
    G.phase = 'fun'; G.barMs = 0;
    if (!REMOTE) {
      try { yt.pauseVideo(); } catch (e) {}
      cover(true, f.icon, f.title, false); masks(true); $('cover').classList.add('funcard');
      [0, 140, 280].forEach(function (ms, i) { setTimeout(function () { if (G.phase === 'fun') Music.plop(i * 3); }, ms); });
      setTimeout(function () { if (G.phase === 'fun') Music.ding(); }, 460);
    }
    push();
    clearTimeout(funTimer);
    funTimer = setTimeout(function () { if (G.phase !== 'fun') return; $('cover').classList.remove('funcard'); G.fun = null; G.phase = 'loading'; then(); }, ms || 5200);
  }

  // ---------- rounds, and the spin for the years ----------
  var ERAS = [['1956-1969', '1956 – 1969'], ['1970-1979', 'The 70s'], ['1980-1989', 'The 80s'], ['1990-1999', 'The 90s'], ['2000-2009', 'The 2000s'], ['2010-2019', 'The 2010s'], ['2020-2100', 'The 2020s']];
  var partTimer = null;
  function partIntro() {
    G.partDone = G.partDone || {}; G.partDone[G.round] = 1;
    G.partNext = false; G.partN = (G.partN || 0) + 1; G.partStart = G.round;
    var n = G.partN;
    G.part = { n: n, of: G.parts, eras: null, roll: -1, done: false, label: '' };
    G.phase = 'part'; G.barMs = 0;
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, String(n), G.parts > 1 ? 'Round ' + n + ' of ' + G.parts : 'Spinning the era', false); masks(true); }
    var go = function () { if (G.phase !== 'part') return; startRound2(); };
    if (!G.eraSpin) { push(); clearTimeout(partTimer); partTimer = setTimeout(go, 3200); return; }
    // Which decades are still in the draw: not played yet in this game, and with enough songs in the selection.
    var ok = function (e) { return poolFor(playSongs(), e[0], G.cat).length >= Math.max(4, Math.min(G.per, 8)); };
    var open = []; ERAS.forEach(function (e, i) { if (G.eraUsed.indexOf(i) < 0 && ok(e)) open.push(i); });
    if (!open.length) { G.eraUsed = []; ERAS.forEach(function (e, i) { if (ok(e)) open.push(i); }); }   // all played: everything is back in
    if (!open.length) { G.eraNow = ''; buildPool(); push(); partTimer = setTimeout(go, 2000); return; }   // a selection too thin to split up
    G.part.eras = ERAS.map(function (e, i) { return { label: e[1], out: open.indexOf(i) < 0 }; });
    var chosen = pick(open), hops = 18 + Math.floor(Math.random() * open.length), start = (open.indexOf(chosen) - (hops % open.length) + open.length * 8) % open.length, k = 0;
    var hop = function () {
      if (G.phase !== 'part') return;
      G.part.roll = open[(start + k) % open.length]; if (!REMOTE) Music.plop(k); render();
      if (k >= hops) {
        partTimer = setTimeout(function () {
          if (G.phase !== 'part' || !G.part) return;
          G.part.done = true; G.part.label = ERAS[chosen][1]; G.eraUsed.push(chosen); G.eraNow = ERAS[chosen][0]; buildPool();
          if (!REMOTE) { Music.ding(); cover(true, String(n), ERAS[chosen][1], false); }
          push(); partTimer = setTimeout(go, 2600);
        }, LAND);
        return;
      }
      k++; partTimer = setTimeout(hop, 70 + Math.pow(k / hops, 2.4) * 520);
    };
    push(); clearTimeout(partTimer); partTimer = setTimeout(hop, 1400);
  }

  // ---------- Quip! ----------
  // A song plays, and with it comes a question about that song. Everyone writes their funniest answer
  // on their phone while the clip runs on; then all answers are shown without names and everyone
  // votes for the best one (not their own).
  var quipTimer = null;
  function quipAll() {
    G.quipLoad = true; G.quips = null; G.draw = null; G.best = null; G.q = null;
    G.phase = 'loading'; push(); loadSong();
  }
  // The song is ready (called where a quiz question would start): hand out the question and play.
  // Bluff!: the same round, but the question is what a title in another language means. Everyone makes up
  // a translation; the real one is mixed in, and everyone tries to find it. Hard languages go first.
  var EASY_LANG = { english: 1, french: 1, german: 1, dutch: 1, spanish: 1, italian: 1 };
  // Lost in Translation: every answer is shown the same way (a capital first, the rest small, no quotes or
  // full stop at the end), so the real translation cannot be told apart by how it was typed.
  function sameCase(t) {
    t = String(t).replace(/\s+/g, ' ').replace(/^[\s"'“”‘’«»]+|[\s"'“”‘’«».!]+$/g, '').toLowerCase().replace(/\bi\b/g, 'I');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  // Lost in Translation: every vote for a bluff is worth 2 points to whoever wrote it. They are counted out one
  // by one after the reveal, with a ping, and the bluff that is being paid lights up.
  var payTimer = null, BLUFF_PTS = 2;
  var worthShown = '';
  var allinKey = '';
  function payMark() {
    [].forEach.call($('qopts').querySelectorAll('.opt'), function (el, i) { el.classList.toggle('rolling', i === G.payNow); });
  }
  function payFlush() {   // the game moves on before the count is done: the rest is added at once
    clearTimeout(payTimer);
    while (G.pay && G.pay.length) { var x = G.pay.shift(), w = players[x.pid]; if (w) { w.pts = (w.pts || 0) + BLUFF_PTS; w.score += BLUFF_PTS; w.got = true; } }
    G.payNow = -1;
  }
  function payTick() {
    clearTimeout(payTimer);
    if (!G.pay || !G.pay.length) { G.payNow = -1; return; }
    var live = G.phase === 'reveal' && G.best && G.best.bluff;
    do {
      var x = G.pay.shift(), w = players[x.pid];
      if (w) { w.pts = (w.pts || 0) + BLUFF_PTS; w.score += BLUFF_PTS; w.got = true; }
      if (live) { G.payNow = x.i; if (!REMOTE) Music.plop(G.payN++); }
    } while (!live && G.pay.length);   // the game moved on: the rest is added at once
    if (!live) { G.payNow = -1; return; }
    push(); payMark();
    payTimer = setTimeout(G.pay.length ? payTick : function () { G.payNow = -1; if (G.phase === 'reveal') payMark(); }, 650);
  }
  function bluffAll() {
    var can = G.pool.filter(function (s) { return TITLE_EN[s[4]] && !G.used[s[4]] && !BAD_VIDEOS[s[4]]; });
    if (!can.length) can = G.pool.filter(function (s) { return TITLE_EN[s[4]] && !BAD_VIDEOS[s[4]]; });
    if (!can.length) { quipAll(); return; }   // nothing to translate in this selection: a Quip! instead
    var hard = can.filter(function (s) { return !EASY_LANG[String(s[10]).toLowerCase()]; });
    G.bluffSong = pick(hard.length ? hard : can);
    G.quipLoad = true; G.quips = null; G.draw = null; G.best = null; G.q = null;
    G.phase = 'loading'; push(); loadSong(G.bluffSong);
  }
  function quipWrite() {
    G.quipLoad = false;
    var ln, items = {}, bluff = null;
    if (G.bluffSong) {
      bluff = { real: TITLE_EN[G.bluffSong[4]], title: G.bluffSong[3] }; G.bluffSong = null;
      ln = { p: 'What does “' + bluff.title + '” mean? Make up a translation to fool the others.', h: bluff.real };
    } else {
    // no question twice in one game, until they have all been used
    if (!G.quipUsed || G.quipUsed.length >= QUIPS.length) G.quipUsed = [];
    var left = QUIPS.filter(function (x) { return G.quipUsed.indexOf(x.p) < 0; }); ln = pick(left);
    G.quipUsed.push(ln.p);
    }
    list().filter(function (p) { return !p.off; }).forEach(function (p) { items[p.pid] = { prompt: ln.p, text: '', done: 0 }; });
    G.quips = { id: Math.random().toString(36).slice(2, 8), items: items, line: ln, bluff: bluff };
    G.guessAt = Date.now(); G.phase = 'qall'; G.barMs = QUIP_MS; G.endsAt = Date.now() + QUIP_MS;
    $('err').textContent = '';
    if (!REMOTE) {
      // the clip plays on while everyone writes (the title stays masked until the answer)
      clearInterval(poll); stage = 'clip';
      try { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
      cover(false); masks(true);
    }
    clearTimeout(quipTimer); quipTimer = setTimeout(quipAllEnd, QUIP_MS + 800);
    push();
  }
  function quipAllCheck() {
    if (G.phase !== 'qall' || !G.quips) return;
    var act = list().filter(function (p) { return !p.off && G.quips.items[p.pid]; });
    if (act.length && act.every(function (p) { return G.quips.items[p.pid].done; }) && !G.quips.cdAt) {
      // Everyone is in: the screen says so and counts 3, 2, 1; then a sound, and on to the answers.
      clearTimeout(quipTimer); G.quips.cdAt = Date.now() + 3000; push();
      quipTimer = setTimeout(function () { if (!REMOTE) Music.ding(); quipAllEnd(); }, 3000);
    }
  }
  function quipAllEnd() {
    if (G.phase !== 'qall' || !G.quips) return;
    clearTimeout(quipTimer);
    var g = G.quips, opts = [];
    Object.keys(g.items).forEach(function (k) { if (players[k] && g.items[k].text) opts.push({ pid: k, text: g.items[k].text }); });
    if (g.bluff && opts.length) {
      // Bluff!: the made-up translations (not the real one, and no two the same) plus the real meaning
      var norm = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, ''); }, seen = {}; seen[norm(g.bluff.real)] = 1;
      opts = opts.filter(function (o) { var n = norm(o.text); if (!n || seen[n]) return false; seen[n] = 1; return true; });
      if (opts.length) {
        opts = shuffle(opts.slice(0, 11).concat([{ pid: null, text: g.bluff.real }]));
        stopTimers();
        G.best = { quip: true, bluff: true, id: g.id, pids: opts.map(function (o) { return o.pid; }), real: opts.map(function (o) { return o.pid; }).indexOf(null), tally: null, wins: null };
        G.q = { subject: 'bluff', type: 'mc', text: 'What does “' + g.bluff.title + '” really mean?', hint: '', options: opts.map(function (o) { return sameCase(o.text); }), correct: -1, answer: '' };
        var bms = list().filter(function (p) { return !p.off; }).length >= 2 ? QUIP_VOTE_MS : 7000;
        G.phase = 'guess'; G.barMs = bms; G.endsAt = Date.now() + bms; push();
        endTimer = setTimeout(reveal, bms);
        return;
      }
    }
    if (!opts.length) { G.quips = null; drawFallback(); if (!REMOTE) $('err').textContent = 'Nobody wrote anything this time, so here is a quiz question instead.'; return; }
    // Playing alone, the one answer gets a house answer next to it; with more players only their own answers count.
    if (opts.length < 2 && list().filter(function (p) { return !p.off; }).length < 2) opts.push({ pid: null, text: g.line.h });
    opts = shuffle(opts).slice(0, 12);
    stopTimers();
    G.best = { quip: true, id: g.id, pids: opts.map(function (o) { return o.pid; }), tally: null, wins: null };
    G.q = { subject: 'quip', type: 'mc', text: 'Vote for the funniest answer: ' + g.line.p, hint: '', options: opts.map(function (o) { return o.text; }), correct: -1, answer: '' };
    // nobody who could vote for someone else's answer (a game on your own): only show the answers for a moment
    var canVote = list().filter(function (p) { return !p.off; }).length >= 2, ms = canVote ? QUIP_VOTE_MS : 7000;
    var vote = function () {
      paper(null);
      G.noteJust = G.q && G.q.options ? G.q.options.length - 1 : null;   // the last note shrinks into its place
      G.qshow = null; G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms; push();
      endTimer = setTimeout(reveal, ms);
    };
    // First every answer is read out on the big screen, one at a time and without a name, as a scribbled note.
    if (REMOTE || opts.length < 2) { vote(); return; }
    var texts = G.q.options.slice(), per = texts.length > 8 ? 3500 : texts.length > 5 ? 4200 : 5000, i = 0, id = g.id;
    G.phase = 'qshow'; G.qshow = { prompt: g.line.p, n: texts.length }; G.barMs = 0; push();
    var step = function () {
      if (G.phase !== 'qshow' || !G.best || G.best.id !== id) { paper(null); return; }
      if (i >= texts.length) { vote(); return; }
      paper(texts[i], i + 1, texts.length); Music.plop(i); i++;
      quipTimer = setTimeout(step, per);
    };
    quipTimer = setTimeout(step, 500);
  }
  // One Green Room answer, as if scribbled on a piece of paper. It sits below the video, where the answer bars
  // will be once the vote starts.
  function paper(text, n, of) {
    if (text == null) { if (G.qshow) G.qshow.cur = null; return; }
    if (!G.qshow) return;
    G.qshow.cur = { text: text, n: n, of: of, fresh: true }; render();
  }
  net.on('quip', function (m) {
    var it = m && G.quips && G.phase === 'qall' && G.quips.items[m.pid];
    if (!it || it.done) return;
    var t = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    if (!t) return;
    it.text = t; it.done = 1; push(); quipAllCheck();
  });
  // After the last drawing: everyone votes for the best one (not their own). All drawings are on the
  // screen side by side; the phones get them as small pictures on the buttons.
  var BEST_MS = 25000, BEST_PTS = 3, bestKey = '';
  // In a Party game these rounds sit between 12-point quiz questions, so they are worth four times as much.
  function partyX() { return G.atype === 'party' ? 4 : 1; }
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
      if (l.clear) it.strokes = l.bg ? [{ clear: 1, bg: l.bg }] : [];   // a cleared page keeps its paper colour
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
    var rows = [['Songs', G.tour ? 'Until every minigame is played' : G.total >= ENDLESS ? 'Until someone reaches the top' : G.parts > 1 ? G.parts + ' rounds of ' + G.per : G.total], ['Video length', optText('s-time')], ['Era', optText('s-era')], ['Entries', optText('s-cat')], ['Game type', optText('s-atype')]];
    if (!sing) rows.push(['Category', optText('s-subject')], ['Scoring', optText('s-scoring')]);
    rows.push(['Show score', optText('s-show')]);
    return { rows: rows, scoring: G.atype === 'party' ? PARTY_HELP + ' ' + SCORING_HELP[G.scoring] : G.atype === 'draw' ? DRAW_HELP : G.atype === 'quip' ? QUIP_HELP : sing ? 'Jury Show: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : SCORING_HELP[G.scoring] };
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
    var ims = !REMOTE && fanEl ? INTRO.audioMs : INTRO.ms;   // the sound file plays the theme once; the YouTube clip is longer
    G.phase = 'intro'; G.barMs = ims; G.endsAt = Date.now() + ims; introTry = 0; stage = 'intro';
    list().forEach(function (p) { G.go[p.pid] = 1; });
    if (!REMOTE) {
      cover(false); masks(false);
      fanPlay();
    }
    push();
    introTimer = setTimeout(introEnd, ims);
  }
  // The fanfare is a sound file that was loaded while everyone was joining, so it starts at once. If it will
  // not play (no connection to it, or the browser refuses), the YouTube clip takes over as before.
  var fanEl = null, fanOn = false, fanUnlocked = false, fanFade = null;
  if (!REMOTE && INTRO.audio) { try { fanEl = new Audio(); fanEl.preload = 'auto'; fanEl.src = INTRO.audio; } catch (e) { fanEl = null; } }
  function fanUnlock() {   // phones and tablets only let a sound start that was started once by a touch
    if (fanUnlocked || !fanEl || fanOn) return; fanUnlocked = true;
    try { fanEl.muted = true; var p = fanEl.play(); if (p && p.then) p.then(function () { if (!fanOn) { fanEl.pause(); fanEl.muted = false; } }).catch(function () { fanEl.muted = false; }); } catch (e) {}
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, fanUnlock, { capture: true, passive: true }); });
  // The fanfare is the real Eurovision one, from YouTube. It is lined up while everyone is still joining, so
  // that it starts sooner when the game begins.
  var fanCued = false;
  function fanCue() { if (REMOTE || fanCued || !ytReady || G.phase !== 'lobby') return; try { yt.cueVideoById(INTRO.ids[0]); fanCued = true; } catch (e) {} }
  function fanYt() {
    try { if (fanCued) { yt.unMute(); yt.setVolume(100); yt.playVideo(); } else yt.loadVideoById(INTRO.ids[0]); yt.unMute(); yt.setVolume(100); } catch (e) {}
    fanCued = false;
  }
  function fanSpare() {
    if (!fanOn || G.phase !== 'intro') return;
    fanStop(); fanYt();
    G.barMs = INTRO.ms; G.endsAt = Date.now() + INTRO.ms; clearTimeout(introTimer); introTimer = setTimeout(introEnd, INTRO.ms); push();   // the YouTube clip has its own length
  }
  function fanStop() { fanOn = false; clearTimeout(fanFade); clearInterval(fanFade); try { if (fanEl) fanEl.pause(); } catch (e) {} }
  function fanPlay() {
    if (!fanEl) { fanYt(); return; }
    fanOn = true;
    try {
      fanEl.muted = false; fanEl.volume = 1; try { fanEl.currentTime = INTRO.audioAt; } catch (e) {}
      var p = fanEl.play(); if (p && p.then) p.catch(fanSpare);
    } catch (e) { fanSpare(); return; }
    fanEl.onerror = fanSpare;
    setTimeout(function () { if (fanOn && G.phase === 'intro' && (fanEl.paused || fanEl.currentTime < INTRO.audioAt + 0.5)) fanSpare(); }, 2500);   // still silent: the spare
    // the last note fades out, just before the theme would start over
    fanFade = setTimeout(function () { fanFade = setInterval(function () { try { fanEl.volume = Math.max(0, fanEl.volume - 0.15); } catch (e) {} }, 100); }, Math.max(0, INTRO.audioMs - 700));
  }
  // The fanfare is over, or the host pressed "Start now": on to the first song.
  function introEnd() {
    if (G.phase !== 'intro') return;
    clearTimeout(introTimer);
    fanStop();
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
  // Recordings are played through one audio element that is "unlocked" by the first touch or click on
  // this page: phones and tablets refuse to start sound in an element the user never touched, and a
  // fresh element per recording was cut off there after a moment.
  var recEl = new Audio(), recUnlocked = false;
  recEl.preload = 'auto';
  function recUnlock() {
    if (recUnlocked) return; recUnlocked = true;
    try {
      // a tenth of a second of silence, as a real (if tiny) sound file
      var n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), str = function (o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
      recEl.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      var pr = recEl.play(); if (pr && pr.then) pr.then(function () { if (!singAudio) recEl.pause(); }).catch(function () {});
    } catch (e) {}
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) { document.addEventListener(ev, recUnlock, { capture: true, passive: true }); });
  function recPlay(url) { stopAudio(); var a = singAudio = recEl; try { a.pause(); a.src = url; a.load(); } catch (e) {} return a; }
  function singClear() {
    clearTimeout(singTimer); clearTimeout(bestTimer); clearTimeout(annTimer); stopAudio();
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
    cover(true, '🎤', 'Jury Show', false); masks(true);
    singTimer = setTimeout(singVoteEnd, SING.vote); push();
  }
  function singVoteEnd() {
    if (!G.sing || G.phase !== 'svote') return;
    clearTimeout(singTimer); G.revealAt = 0;
    var c = G.sing.options.map(function () { return 0; }), pid, top = [];
    for (pid in G.sing.votes) c[G.sing.votes[pid]]++;
    // Every song that got a vote is in the draw, and every vote is a ticket: more votes, more chance.
    var tickets = [];
    c.forEach(function (n, i) { if (n > 0) { top.push(i); for (var k = 0; k < n; k++) tickets.push(i); } });
    if (!top.length) { G.sing.options.forEach(function (o, i) { top.push(i); tickets.push(i); }); }   // nobody voted: all four
    var chosen = pick(tickets);
    var go = function () {
      if (!G.sing) return;
      G.sing.chosen = chosen; G.sing.tried[chosen] = 1; G.sing.roll = null;
      G.phase = 'loading'; G.sing.in = {}; push();
      loadSong(G.sing.options[chosen]);
    };
    if (top.length < 2) {
      // Everyone voted for the same song: no spin needed, but it lights up green for a moment before the game moves on.
      G.phase = 'sroll'; G.sing.in = {}; G.sing.tied = top; G.barMs = 0; G.sing.roll = chosen; G.sing.rollDone = true;
      Music.ding(); push(); singTimer = setTimeout(go, 1800); return;
    }
    // More than one song in the draw: a roulette like a party-game minigame picker. The light jumps between the tied songs, fast at
    // first and slower and slower, and stops on the winner.
    G.phase = 'sroll'; G.sing.in = {}; G.sing.tied = top; G.barMs = 0;
    var hops = 16 + Math.floor(Math.random() * top.length), start = (top.indexOf(chosen) - (hops % top.length) + top.length * 8) % top.length, n = 0;
    var hop = function () {
      if (!G.sing || G.phase !== 'sroll') return;
      G.sing.roll = top[(start + n) % top.length]; Music.plop(n); render();
      if (n >= hops) { singTimer = setTimeout(function () { if (!G.sing || G.phase !== 'sroll') return; G.sing.rollDone = true; Music.ding(); render(); singTimer = setTimeout(go, 1400); }, LAND); return; }
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
  // "This clip isn't viable" on a phone, while the clip plays: a vote. When at least half of the players say
  // so, this song is dropped and everyone votes again, on four new songs (a few times per round at most).
  function singBadNeed() { return Math.max(1, Math.ceil(list().filter(function (p) { return !p.off; }).length / 2)); }
  function singBadVote(p) {
    if (!G.sing || G.phase !== 'slisten' || (G.singSkips || 0) >= SING_REROLLS) return;
    G.sing.bad = G.sing.bad || {}; G.sing.bad[p.pid] = 1;
    if (Object.keys(G.sing.bad).length < singBadNeed()) { push(); return; }
    G.singSkips = (G.singSkips || 0) + 1;
    (G.sing.options || []).forEach(function (o) { G.used[o[4]] = 1; });   // none of these four again
    clearInterval(poll); stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    singClear(); G.phase = 'fun'; G.q = null;
    cover(true, '🙅', 'Not this one! Four new songs coming up…', false); masks(true); if (!REMOTE) Music.plop(0);
    G.fun = { plain: true, icon: '🙅', title: 'Not this one!', sub: 'Half of you said this song won’t work. Four new songs to vote on…' };
    var round = G.round; push();
    singTimer = setTimeout(function () { if (G.round !== round || G.phase !== 'fun' || G.sing) return; G.fun = null; G.phase = 'loading'; singStart(); }, 3200);
  }
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
    var recMs = Math.max(SING.rec, clipSecs() * 1000 + 25000);   // time to get ready, the full clip length, and to listen back
    singPhase('srec', recMs);
    cover(true, '🎙', 'Your turn to sing!', true);
    singTimer = setTimeout(singPlayAll, recMs + 4000);   // a little slack for the last uploads
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
    var a = recPlay(G.sing.clips[pid]), done = false;
    var fin = function () { if (done || singAudio !== a || !G.sing || (G.phase !== 'splay' && G.phase !== 'sbest')) return; done = true; clearTimeout(singTimer); singTimer = setTimeout(singNext, 900); };   // (only while this recording is still the one playing)
    a.onended = fin; a.onerror = fin;
    var pr = a.play(); if (pr && pr.catch) pr.catch(fin);
    singTimer = setTimeout(fin, clipSecs() * 1000 + 3000);
    push();
  }
  function singBest() {
    singPhase('sbest', SING.best); G.sing.now = null; G.sing.idx = -1; G.sing.pass = 2;
    clearTimeout(bestTimer); bestTimer = setTimeout(singReveal, SING.best);
    singNext();
  }
  // The vote is in: the music stops and the screen says "And our 12 points go to…" before the votes are shown.
  function singReveal() {
    if (!G.sing || G.phase === 'reveal' || G.phase === 'sann' || G.phase === 'svotes') return;
    if (G.phase === 'sbest' && G.sing.order.length > 1) {
      clearTimeout(singTimer); clearTimeout(bestTimer); stopAudio(); stopTimers(); G.revealAt = 0;
      clearInterval(silenceTick); silenceTick = null; try { yt.pauseVideo(); } catch (e) {}
      G.phase = 'sann'; G.sing.now = null; G.barMs = 0;
      cover(true, '🏆', 'And our 12 points go to…', false); masks(true); Music.plop(3);
      push(); clearTimeout(annTimer); annTimer = setTimeout(singVotes, 3500);
      // a safety net: whatever happens, the result follows
      var sgNow = G.sing; setTimeout(function () { if (G.sing === sgNow && (G.phase === 'sann' || G.phase === 'svotes')) singReveal2(); }, 16000);
      return;
    }
    singReveal2();
  }
  // Then the votes pop in one by one behind the singers, like the names at a quiz answer; only when they are
  // all there does the winner turn green.
  var annTimer = null;   // its own timer: a recording that was just cut off reports back late, and must not cancel the announcement
  function singVotes() {
    if (!G.sing || G.phase !== 'sann') return;
    clearTimeout(singTimer); clearTimeout(annTimer); G.phase = 'svotes'; G.sing.shown = []; G.sing.plopped = null;
    var order = []; G.sing.order.forEach(function (pid) { list().filter(function (v) { return G.sing.best[v.pid] === pid; }).sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (v) { order.push(v.pid); }); });
    order = shuffle(order);
    var i = 0, step = function () {
      if (!G.sing || G.phase !== 'svotes') return;
      if (i >= order.length) { G.sing.plopped = null; annTimer = setTimeout(singReveal2, 1100); return; }
      G.sing.shown.push(order[i]); G.sing.plopped = order[i]; Music.plop(++i); render();
      annTimer = setTimeout(step, Math.max(260, Math.min(550, 3600 / order.length)));
    };
    push(); annTimer = setTimeout(step, 600);
  }
  function singReveal2() {
    if (!G.sing || G.phase === 'reveal') return;
    $('cover').classList.remove('funcard');
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
    // With a tie, the winners' recordings take turns.
    var bests = G.sing.result.filter(function (r) { return r.win && G.sing.clips[r.pid]; }).map(function (r) { return r.pid; });
    if (!bests.length && G.sing.result.length === 1 && G.sing.clips[G.sing.result[0].pid]) bests = [G.sing.result[0].pid];
    var best = bests.length;
    if (best) { G.sing.loops = bests; G.sing.loopI = -1; G.sing.loop = bests[0]; G.sing.loopFails = 0; winnerLoop(); }
    else { try { if (G.sing.chosen != null) { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {} }
    push(); autoStart();
  }
  function winnerLoop() {
    if (!G.sing || G.phase !== 'reveal' || !G.sing.loop) return;
    clearTimeout(singTimer); stopAudio(); silence();
    try { yt.seekTo(clipStart, true); yt.playVideo(); } catch (e) {}
    silence();
    if (G.sing.loops && G.sing.loops.length) { G.sing.loopI = (G.sing.loopI + 1) % G.sing.loops.length; G.sing.loop = G.sing.loops[G.sing.loopI]; if (G.sing.loops.length > 1) { G.sing.now = G.sing.loop; render(); } }
    var a = recPlay(G.sing.clips[G.sing.loop]), done = false;
    var again = function () { if (done || singAudio !== a || !G.sing || G.phase !== 'reveal') return; done = true; clearTimeout(singTimer); singTimer = setTimeout(winnerLoop, 900); };
    // A recording that will not start is tried again a few times, not forever.
    var retry = function () { if (done) return; if (++G.sing.loopFails > 4) { done = true; return; } again(); };
    a.onended = function () { G.sing.loopFails = 0; again(); }; a.onerror = retry;
    var pr = a.play(); if (pr && pr.catch) pr.catch(retry);
    singTimer = setTimeout(again, clipSecs() * 1000 + 3000);
  }
  // The host's "Continue" button moves a Sing! round along when someone is stuck.
  function singSkip() {
    if (!G.sing) return;
    if (G.phase === 'svote') singVoteEnd();
    else if (G.phase === 'sroll') return;   // the roulette finishes by itself
    else if (G.phase === 'slisten') { clearInterval(poll); try { yt.pauseVideo(); } catch (e) {} singRecord(); }
    else if (G.phase === 'srec') singPlayAll();
    else if (G.phase === 'splay') singNext();
    else if (G.phase === 'sann' || G.phase === 'svotes') singReveal2();
    else if (G.phase !== 'loading') singReveal();
  }
  net.on('poll', function (m) {
    var p = m && players[m.pid];
    if (p && G.sing && m.reroll) return;   // no longer offered
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
    if (typeof m.data !== 'string' || !(m.n >= 1 && m.n <= 30) || !(m.i >= 0 && m.i < m.n)) return;
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
      now: sg.now && players[sg.now] ? players[sg.now].name : null, result: sg.result, pass: sg.pass || 1, rerolls_left: 0,   // (the "this song isn't viable" button has been taken out)
       bad: Object.keys(sg.bad || {}).length, bad_need: singBadNeed(),
      one: G.phase === 'sroll' && !!sg.tied && sg.tied.length < 2,   // a unanimous song vote: no spin
      rec_ms: clipSecs() * 1000,   // a recording may be as long as the clip that was played
      tally: null };   // the votes are for the big screen only
  }
  // The big cards of the minigame spin, and the stage stepping aside for them: only while that spin is on.
  function spinLayout() {
    var on = G.phase === 'pspin' && !!G.pspin;
    if (!REMOTE) stageEl().classList.remove('offstage');   // the big "Party round!" picture stays on top, the cards spin below it
    $('qopts').classList.toggle('bigtiles', on);
  }
  function renderSing() {
    spinLayout(); $('qopts').classList.remove('cols2');
    var sg = G.sing;
    $('skip').textContent = sg && G.phase !== 'reveal' ? 'Continue' : 'Show answer';
    if (!sg) return;
    var song = sg.chosen != null ? sg.options[sg.chosen] : null, name = song ? song[3] + ' – ' + song[2] : '', t = '', opts = '';
    if (G.phase === 'sroll') {
      t = sg.rollDone ? 'We’re singing: ' + (sg.options[sg.roll][3] + ' – ' + sg.options[sg.roll][2]) : 'Which song will it be?';
      opts = sg.options.map(function (o, i) {
        var tied = sg.tied.indexOf(i) >= 0, n = 0, k; for (k in sg.votes) if (sg.votes[k] === i) n++;
        return '<div class="optcol"><div class="opt' + (i === sg.roll ? (sg.rollDone ? ' right picked' : ' rolling') : tied ? '' : ' dim') + '"><b>' + 'ABCD'[i] + '</b>' + esc(o[3] + ' – ' + o[2]) + '</div><div class="voters"><b>' + n + (n === 1 ? ' vote' : ' votes') + '</b></div></div>';
      }).join('');
    }
    else if (G.phase === 'svote') { t = 'Jury Show: vote for the song'; opts = sg.options.map(function (o, i) {
      // Under each song: who voted for it so far.
      var who = list().filter(function (p) { return sg.votes[p.pid] === i; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return '<div class="optcol"><div class="opt"><b>' + 'ABCD'[i] + '</b>' + esc(o[3] + ' – ' + o[2]) + '</div><div class="voters">' +
        (who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (p) { return '<span>' + charSvg(p.char) + esc(p.name) + '</span>'; }).join('') : '<span class="mute">No votes yet</span>') + '</div></div>';
    }).join(''); }
    else if (G.phase === 'loading') t = 'We’re singing: ' + name;
    else if (G.phase === 'slisten') { var nb = Object.keys(sg.bad || {}).length; t = 'Listen first: ' + name + (nb ? ' · ' + nb + ' of ' + singBadNeed() + ' votes to skip it' : ''); }
    else if (G.phase === 'srec') t = 'Sing it! Record up to ' + clipSecs() + ' seconds on your phone';
    else if (G.phase === 'splay' || G.phase === 'sbest' || G.phase === 'sann' || G.phase === 'svotes') {
      // The vote is open while the recordings keep playing. Who voted for whom only shows at the result.
      t = G.phase === 'splay' ? 'Now singing: ' + (players[sg.now] ? players[sg.now].name : '') : G.phase === 'sann' || G.phase === 'svotes' ? 'And our 12 points go to…' : 'Who sang it best? Vote on your phone';
      // while the votes are being counted out: the ones that have popped in so far
      var votersOf = function (pid) {
        if (G.phase !== 'svotes') return '';
        var who = list().filter(function (v) { return sg.best[v.pid] === pid && (sg.shown || []).indexOf(v.pid) >= 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        var faces = list().filter(function (v) { return sg.best[v.pid] === pid; }).length > 2 || sg.order.length > 4;   // (the same shape as at the result, so nothing jumps)
        return who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (v) { return '<span class="' + (faces ? 'face' : '') + (v.pid === sg.plopped ? ' plop' : '') + '"' + (faces ? ' title="' + esc(v.name) + '"' : '') + '>' + charSvg(v.char) + (faces ? '' : esc(v.name)) + '</span>'; }).join('') : '';
      };
      opts = sg.order.map(function (pid) {
        var p = players[pid]; if (!p) return '';
        return '<div class="optcol"><div class="opt' + (pid === sg.now ? ' singing' : '') + '">' + charSvg(p.char) + esc(p.name) + (pid === sg.now ? ' <span class="note">' + (sg.order.length > 4 ? '♪' : '♪ singing now') + '</span>' : '') + '</div><div class="voters">' + votersOf(pid) + '</div></div>';
      }).join('');
    }
    else if (G.phase === 'reveal') {
      var wins = (sg.result || []).filter(function (r) { return r.win; }).map(function (r) { return r.name; });
      $('ranswer').textContent = !sg.result || !sg.result.length ? 'Nobody sang this time' : wins.length ? 'Best singer: ' + wins.join(' & ') : 'Thanks for singing!';
      // the same bars as during the vote, in the same order: the winner turns green, the voters stay behind each singer
      opts = sg.order.map(function (pid) {
        var p = players[pid], r = (sg.result || []).filter(function (x) { return x.pid === pid; })[0]; if (!p) return '';
        var who = list().filter(function (v) { return sg.best[v.pid] === pid; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        return '<div class="optcol"><div class="opt' + (r && r.win ? ' right' : '') + '">' + charSvg(p.char) + esc(p.name) + (pid === sg.now ? ' <span class="note">♪</span>' : '') + '</div><div class="voters">' +
          (who.length ? '<b>' + who.length + (who.length === 1 ? ' vote' : ' votes') + '</b>' + who.map(function (v) { return who.length > 2 || sg.order.length > 4 ? '<span class="face" title="' + esc(v.name) + '">' + charSvg(v.char) + '</span>' : '<span>' + charSvg(v.char) + esc(v.name) + '</span>'; }).join('') : '') + '</div></div>';
      }).join('');
    }
    $('qtext').textContent = t; $('qopts').innerHTML = opts;
    var singers = G.phase === 'splay' || G.phase === 'sbest' || G.phase === 'sann' || G.phase === 'svotes' || G.phase === 'reveal' ? sg.order.length : 0;   // more than four singers: tiles side by side, so it all fits
    $('qopts').classList.toggle('tiles', singers > 4); $('qopts').classList.toggle('tiles3', singers > 8);
    $('qopts').classList.toggle('votelist', G.phase === 'svote' || G.phase === 'sroll' || G.phase === 'sbest' || G.phase === 'sann' || G.phase === 'svotes' || G.phase === 'splay' || G.phase === 'reveal');   // the song vote: one song per row, its voters behind it
  }


  // ---------- which question types and party rounds are in the game (Advanced settings) ----------
  function readPicks() {
    var types = [], party = {};
    [].forEach.call($('typebox').querySelectorAll('input:not([data-all])'), function (el) { if (el.checked) types.push(el.getAttribute('data-type')); });
    [].forEach.call($('partybox').querySelectorAll('input:not([data-all])'), function (el) { party[el.getAttribute('data-party')] = el.checked; });
    G.types = types.length ? types : null;   // nothing ticked counts as everything
    G.partyOn = party;
    try { localStorage.setItem('esc-picks', JSON.stringify({ t: types, p: party, peelSeen: 1 })); } catch (e) {}
    // the field shows what is switched on, in a few words
    var sum = function (box, on) {
      var all = box.querySelectorAll('input:not([data-all])'), names = [];
      [].forEach.call(all, function (el) { if (el.checked) names.push(el.parentNode.querySelector('b').textContent); });
      return !names.length || names.length === all.length ? 'All' : 'Custom';
    };
    $('typesum').textContent = sum($('typebox')); $('partysum').textContent = $('partybox').querySelectorAll('input:not([data-all]):checked').length ? sum($('partybox')) : 'None';
  }
  // open and close the two lists; a click anywhere else, or Escape, closes them
  function multiClose(except) { [].forEach.call(document.querySelectorAll('.multi'), function (m) { if (m === except) return; m.querySelector('.multipanel').classList.add('hidden'); m.querySelector('.multibtn').setAttribute('aria-expanded', 'false'); }); }
  [].forEach.call(document.querySelectorAll('.multi'), function (m) {
    multiAll(m);
    m.querySelector('.multibtn').addEventListener('click', function (e) {
      e.stopPropagation(); multiClose(m);
      var p = m.querySelector('.multipanel'), open = p.classList.toggle('hidden') === false;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    m.querySelector('.multipanel').addEventListener('click', function (e) { e.stopPropagation(); });
  });
  document.addEventListener('click', function () { multiClose(null); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') multiClose(null); });
  try {
    var pk = JSON.parse(localStorage.getItem('esc-picks') || 'null');
    if (pk) {
      if (pk.t && pk.t.length >= 6 && pk.t.indexOf('peel') < 0 && !pk.peelSeen) pk.t.push('peel');   // everything was on before this type existed: it joins in
      [].forEach.call($('typebox').querySelectorAll('input:not([data-all])'), function (el) { if (pk.t && pk.t.length) el.checked = pk.t.indexOf(el.getAttribute('data-type')) >= 0; });
      [].forEach.call($('partybox').querySelectorAll('input:not([data-all])'), function (el) { var v = (pk.p || {})[el.getAttribute('data-party')]; if (v === false) el.checked = false; });
    }
  } catch (e) {}
  $('typebox').addEventListener('change', readPicks); $('partybox').addEventListener('change', readPicks); readPicks();

  try { var pp = localStorage.getItem('esc-partypick2'); if (pp && $('s-partypick').querySelector('option[value="' + pp + '"]')) $('s-partypick').value = pp; } catch (e) {}
  $('s-partypick').addEventListener('change', function () { try { localStorage.setItem('esc-partypick2', $('s-partypick').value); } catch (e) {} singToggle(); });

  // ---------- test bots ----------
  // Up to eight pretend players for trying things out on the shared screen. They live on this page and
  // do what a phone would do: get ready, answer, draw a scribble, write a line, vote.
  var BOT_BLUFFS = ['My Heart Is Yours', 'Dance With Me Tonight', 'The Last Summer', 'Tell Me Why', 'Under the Stars', 'I Will Wait for You', 'A Little Bit of Love', 'Do Not Go Away', 'Song of the Sea', 'When the Morning Comes', 'One More Night', 'The Girl from the Village'];
  var bots = [], BOT_LINES = ['Beep boop, douze points', 'Even my circuits felt that', '404: talent not found', 'More glitter. Always more glitter.', 'My sensors detect a key change', 'Does not compute, but I love it', 'I was promised a wind machine', 'Zero points from the robot jury'];
  // A bot's recording for Sing!: a few seconds of a random tune, built here as a small WAV file.
  function botTune() {
    var rate = 8000, secs = 5, n = Math.floor(rate * secs), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    var str = function (o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    var scale = [262, 294, 330, 392, 440, 523, 587, 659], notes = [], len = 0.4, base = Math.random() < 0.5 ? 1 : 0.75;
    for (i = 0; i < Math.ceil(secs / len); i++) notes.push(scale[Math.floor(Math.random() * scale.length)] * base);
    for (i = 0; i < n; i++) {
      var t = i / rate, k = Math.min(notes.length - 1, Math.floor(t / len)), u = t - k * len, env = Math.min(1, u * 30) * Math.max(0, 1 - u / len * 0.85);
      var s = Math.sin(2 * Math.PI * notes[k] * t) * 0.6 + Math.sin(2 * Math.PI * notes[k] * 2 * t + Math.sin(t * 30) * 0.5) * 0.2;   // a slightly wobbly "voice"
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * env)) * 0x6fff, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  // A bot's drawing has something to do with its song's title: a picture for a word in it (a heart for love,
  // a sun, a star, fire, rain, music…). Without a word it knows, it draws the title as blanks. Colours: 0 black 1 white 2 red 3 orange 4 yellow 5 green 6 blue 7 purple 8 pink 9 brown 10 grey.
  var BOT_FLAGS = { nl: ['h', 2, 1, 6], de: ['h', 0, 2, 4], ru: ['h', 1, 6, 2], at: ['h', 2, 1, 2], hu: ['h', 2, 1, 5], bg: ['h', 1, 5, 2], ee: ['h', 6, 0, 1], lt: ['h', 4, 5, 2], lu: ['h', 2, 1, 6],
    am: ['h', 2, 6, 3], ua: ['h', 6, 4], pl: ['h', 1, 2], mc: ['h', 2, 1], lv: ['h', 9, 1, 9], es: ['h', 2, 4, 2], az: ['h', 6, 2, 5], rs: ['h', 2, 6, 1], yu: ['h', 6, 1, 2], hr: ['h', 2, 1, 6], si: ['h', 1, 6, 2],
    sk: ['h', 1, 6, 2], gr: ['h', 6, 1, 6, 1, 6], il: ['h', 1, 6, 1, 6, 1], fr: ['v', 6, 1, 2], it: ['v', 5, 1, 2], ie: ['v', 5, 1, 3], be: ['v', 0, 4, 2], ro: ['v', 6, 4, 2], md: ['v', 6, 4, 2], mt: ['v', 1, 2],
    ad: ['v', 6, 4, 2], pt: ['v', 5, 2, 2], se: ['x', 6, 4], dk: ['x', 2, 1], no: ['x', 2, 6], fi: ['x', 1, 6], is: ['x', 6, 2], ch: ['p', 2, 1], ge: ['p', 1, 2], gb: ['p', 6, 2], tr: ['o', 2, 1], cz: ['h', 1, 2], al: ['p', 2, 0], cy: ['o', 1, 3], ba: ['v', 6, 4, 6], by: ['h', 2, 2, 5], mk: ['o', 2, 4], me: ['o', 2, 4], sm: ['h', 1, 6], ma: ['o', 2, 5], cs: ['h', 6, 1, 2], au: ['p', 6, 1] };
  var BOT_WORDS = [['heart', /\b(love|loving|lover|heart|amor|amour|amore|liebe|cuore|coraz|kärlek|ljubav|aşk|kiss)/], ['sun', /\b(sun|sunshine|sunlight|summer|sol|soleil|sole|sonne|day)\b/], ['star', /\b(star|stars|étoile|stella|stern|estrella|shine|shining|light|diamond)/],
    ['moon', /\b(moon|luna|lune|night|nuit|noche|notte|nacht|dream|sleep)/], ['fire', /\b(fire|flame|burn|burning|feuer|fuego|fuoco|feu|hot|heat)/], ['rain', /\b(rain|water|sea|ocean|river|mer|mar|tear|tears|cry|crying|wave|storm)/],
    ['flower', /\b(flower|flowers|rose|roses|fleur|garden|spring|blossom)/], ['bird', /\b(bird|fly|flying|wing|wings|angel|sky|heaven|free|freedom|wind)/], ['house', /\b(home|house|heim|casa|maison|town|city|street)/],
    ['eye', /\b(eye|eyes|look|see|watch|yeux|ojos|occhi)/], ['clock', /\b(time|clock|tomorrow|forever|always|yesterday|today|hour|moment|wait|waiting)/], ['note', /\b(music|song|sing|dance|dancing|melody|rhythm|chanson|canzone|la la|ding|guitar|rock|disco|party)/],
    ['crown', /\b(king|queen|prince|princess|hero|heroes|champion|winner|crown|gold|golden)/], ['globe', /\b(world|earth|europe|universe|planet|everybody|everyone)/], ['tree', /\b(tree|trees|forest|wood|leaf|leaves|apple)/],
    ['mountain', /\b(mountain|mountains|hill|high|higher|top|rise|rising|up)\b/], ['snow', /\b(snow|winter|ice|cold|frozen|christmas)/], ['phone', /\b(call|calling|phone|telephone|ring|hello|hallo|message)/], ['boom', /\b(boom|bang|explosion|thunder|lightning|power|crazy|wild)/],
    ['cross', /\b(no|not|never|don't|dont|stop|without|goodbye|bye|end|over|lie|lies)\b/], ['qmark', /\b(why|what|who|where|how|when|maybe|if)\b|\?/], ['person', /\b(you|me|i|my|we|us|girl|boy|man|woman|he|she|her|him|baby|friend|mama|mother|father|people|alone|lonely)\b/]];
  function botDraw(song) {
    var L = [], add = function (c, w, p) { L.push({ c: c, w: w, p: p.map(Math.round) }); };
    var wob = function () { return (Math.random() - 0.5) * 8; };   // a slightly shaky hand
    var rect = function (x0, y0, x1, y1, c) { var w = Math.min(40, Math.max(10, y1 - y0)), n = Math.max(1, Math.ceil((y1 - y0) / (w * 0.8))); for (var i = 0; i < n; i++) { var y = y0 + w / 2 + (y1 - y0 - w) * (n === 1 ? 0.5 : i / (n - 1)); add(c, w, [x0 + w / 2, y, x1 - w / 2, y]); } };
    var ring = function (cx, cy, r, c, w, a0, a1) { var p = [], n = 22; a0 = a0 || 0; a1 = a1 == null ? Math.PI * 2 : a1; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; p.push(cx + Math.cos(a) * r + wob() / 2, cy + Math.sin(a) * r + wob() / 2); } add(c, w, p); };
    var disc = function (cx, cy, r, c) { for (var rr = r - 14; rr > 0; rr -= 24) ring(cx, cy, rr, c, 30); add(c, 30, [cx, cy]); };
    var flag = function (code, x, y, w, hgt) {
      var f = BOT_FLAGS[code]; if (!f) return false;
      var cs = f.slice(1), i;
      if (f[0] === 'h') for (i = 0; i < cs.length; i++) rect(x, y + hgt * i / cs.length, x + w, y + hgt * (i + 1) / cs.length, cs[i]);
      else if (f[0] === 'v') for (i = 0; i < cs.length; i++) rect(x + w * i / cs.length, y, x + w * (i + 1) / cs.length, y + hgt, cs[i]);
      else { rect(x, y, x + w, y + hgt, cs[0]); var t = Math.max(10, hgt * 0.16);
        if (f[0] === 'x') { add(cs[1], t, [x + w * 0.36, y + t / 2, x + w * 0.36, y + hgt - t / 2]); add(cs[1], t, [x + t / 2, y + hgt / 2, x + w - t / 2, y + hgt / 2]); }
        else if (f[0] === 'p') { add(cs[1], t, [x + w / 2, y + hgt * 0.2, x + w / 2, y + hgt * 0.8]); add(cs[1], t, [x + w * 0.3, y + hgt / 2, x + w * 0.7, y + hgt / 2]); }
        else ring(x + w * 0.42, y + hgt / 2, hgt * 0.22, cs[1], t * 0.7, 0.6, Math.PI * 2 - 0.6); }
      add(10, 4, [x, y, x + w, y, x + w, y + hgt, x, y + hgt, x, y]);   // an outline, so white stripes show on white paper
      return true;
    };
    var pics = {
      heart: function () { var p = []; for (var i = 0; i <= 40; i++) { var a = Math.PI * 2 * i / 40, sx = 16 * Math.pow(Math.sin(a), 3), sy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); p.push(430 + sx * 11 + wob(), 300 - sy * 11 + wob()); } add(2, 14, p); for (var k = 9; k > 1; k -= 2.2) { var q = []; for (i = 0; i <= 30; i++) { a = Math.PI * 2 * i / 30; q.push(430 + 16 * Math.pow(Math.sin(a), 3) * k, 300 - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * k); } add(2, 30, q); } add(2, 40, [430, 290]); },
      sun: function () { disc(430, 300, 100, 4); for (var i = 0; i < 10; i++) { var a = Math.PI * 2 * i / 10; add(3, 12, [430 + Math.cos(a) * 130, 300 + Math.sin(a) * 130, 430 + Math.cos(a) * 200 + wob(), 300 + Math.sin(a) * 200 + wob()]); } },
      star: function () { var p = []; for (var i = 0; i <= 10; i++) { var a = -Math.PI / 2 + Math.PI * 2 * i / 10, r = i % 2 ? 80 : 190; p.push(430 + Math.cos(a) * r + wob(), 310 + Math.sin(a) * r + wob()); } add(4, 16, p); disc(430, 310, 70, 4); },
      moon: function () { rect(40, 40, 760, 560, 6); ring(430, 290, 120, 4, 34, Math.PI * 0.35, Math.PI * 1.65); ring(430, 290, 95, 4, 30, Math.PI * 0.45, Math.PI * 1.55); [[150, 130], [640, 150], [600, 430], [200, 450]].forEach(function (s) { add(1, 16, [s[0], s[1]]); }); },
      fire: function () { add(2, 34, [330, 480, 300, 360, 380, 250, 400, 330, 450, 150, 520, 300, 560, 260, 580, 380, 540, 480, 330, 480]); add(2, 40, [380, 440, 500, 440]); add(3, 34, [390, 450, 400, 370, 450, 290, 490, 380, 500, 450]); add(4, 30, [430, 450, 445, 390, 465, 450]); },
      rain: function () { ring(330, 190, 70, 10, 30); ring(430, 160, 85, 10, 30); ring(530, 195, 70, 10, 30); rect(280, 190, 580, 250, 10); for (var i = 0; i < 6; i++) add(6, 12, [300 + i * 55, 300, 280 + i * 55, 360]); for (i = 0; i < 2; i++) { var p = []; for (var x = 120; x <= 740; x += 40) p.push(x, 470 + i * 50 + Math.sin(x / 45) * 16); add(6, 14, p); } },
      flower: function () { add(5, 14, [430, 330, 440, 560]); add(5, 14, [436, 450, 500, 410]); for (var i = 0; i < 6; i++) { var a = Math.PI * 2 * i / 6; disc(430 + Math.cos(a) * 85, 240 + Math.sin(a) * 85, 46, 8); } disc(430, 240, 44, 4); },
      bird: function () { ring(250, 160, 55, 10, 24); ring(330, 140, 70, 10, 24); ring(410, 165, 55, 10, 24); [[480, 330, 1.3], [300, 420, 0.8], [600, 220, 0.7]].forEach(function (b) { var s = 70 * b[2]; add(0, 10, [b[0] - s, b[1] - s * 0.5, b[0] - s * 0.5, b[1] - s * 0.75, b[0], b[1], b[0] + s * 0.5, b[1] - s * 0.75, b[0] + s, b[1] - s * 0.5]); }); },
      house: function () { rect(290, 300, 570, 500, 4); add(2, 26, [260, 310, 430, 160, 600, 310]); add(2, 30, [330, 280, 430, 200, 530, 280]); rect(400, 400, 460, 500, 9); rect(320, 340, 370, 390, 6); add(5, 20, [100, 520, 760, 520]); },
      eye: function () { var p = [], q = []; for (var x = 200; x <= 660; x += 23) { var k = Math.sin((x - 200) / 460 * Math.PI) * 120; p.push(x, 300 - k); q.push(x, 300 + k); } add(0, 14, p); add(0, 14, q); disc(430, 300, 80, 6); disc(430, 300, 34, 0); },
      clock: function () { ring(430, 300, 180, 0, 16); add(0, 14, [430, 300, 430, 180]); add(0, 14, [430, 300, 520, 330]); for (var i = 0; i < 12; i++) { var a = Math.PI * 2 * i / 12; add(2, 14, [430 + Math.cos(a) * 150, 300 + Math.sin(a) * 150]); } },
      note: function () { disc(340, 430, 50, 0); disc(560, 400, 50, 0); add(0, 16, [384, 430, 384, 170, 604, 140, 604, 400]); add(0, 26, [384, 185, 604, 155]); },
      crown: function () { add(4, 26, [230, 420, 200, 200, 320, 320, 430, 170, 540, 320, 660, 200, 630, 420, 230, 420]); rect(240, 330, 620, 430, 4); [[200, 200], [430, 170], [660, 200]].forEach(function (s) { add(2, 34, [s[0], s[1]]); }); add(3, 18, [240, 450, 620, 450]); },
      globe: function () { disc(430, 300, 170, 6); add(5, 40, [330, 220, 380, 200, 420, 250, 380, 300, 340, 280]); add(5, 40, [470, 330, 540, 300, 560, 370, 500, 410]); add(5, 30, [500, 190, 540, 200]); ring(430, 300, 172, 0, 8); },
      tree: function () { rect(400, 360, 460, 540, 9); disc(430, 240, 120, 5); disc(340, 300, 70, 5); disc(520, 300, 70, 5); add(5, 20, [120, 545, 740, 545]); },
      mountain: function () { add(10, 30, [100, 500, 300, 190, 420, 380, 540, 240, 740, 500, 100, 500]); add(10, 40, [220, 440, 300, 300, 380, 440]); add(10, 40, [480, 450, 545, 340, 620, 450]); add(1, 22, [270, 235, 300, 195, 330, 240]); add(1, 20, [515, 280, 540, 245, 565, 280]); disc(640, 130, 44, 4); },
      snow: function () { for (var i = 0; i < 6; i++) { var a = Math.PI * i / 3; add(6, 12, [430, 300, 430 + Math.cos(a) * 190, 300 + Math.sin(a) * 190]); var mx = 430 + Math.cos(a) * 120, my = 300 + Math.sin(a) * 120; add(6, 10, [mx + Math.cos(a + 2.2) * 50, my + Math.sin(a + 2.2) * 50, mx, my, mx + Math.cos(a - 2.2) * 50, my + Math.sin(a - 2.2) * 50]); } },
      phone: function () { add(0, 40, [250, 250, 330, 190, 530, 190, 610, 250]); rect(230, 230, 310, 300, 0); rect(550, 230, 630, 300, 0); rect(300, 320, 560, 470, 2); ring(430, 395, 44, 1, 12); [[120, 150, 170, 110], [140, 220, 90, 220], [740, 150, 690, 110], [720, 220, 770, 220]].forEach(function (z) { add(4, 10, z); }); },
      boom: function () { var p = []; for (var i = 0; i <= 24; i++) { var a = Math.PI * 2 * i / 24, r = i % 2 ? 110 : 220; p.push(430 + Math.cos(a) * r + wob(), 300 + Math.sin(a) * r * 0.85 + wob()); } add(2, 16, p); disc(430, 300, 95, 3); disc(430, 300, 50, 4); },
      cross: function () { add(2, 36, [250, 130, 610, 470]); add(2, 36, [610, 130, 250, 470]); },
      qmark: function () { ring(430, 220, 95, 7, 34, Math.PI * 1.05, Math.PI * 2.45); add(7, 34, [470, 305, 430, 350, 430, 400]); add(7, 44, [430, 490]); },
      person: function () { ring(430, 170, 60, 0, 14); add(0, 14, [430, 230, 430, 410]); add(0, 14, [320, 290, 430, 270, 540, 290]); add(0, 14, [350, 540, 430, 410, 510, 540]); add(2, 10, [405, 180, 430, 195, 455, 180]); }
    };
    // No word it knows: the title as blanks, one dash per letter, like a game of hangman (with the first letter filled in as a dot).
    var blanks = function (title) {
      var ws = String(title || '').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 6), y = 170, x = 70, cw = 46;
      ws.forEach(function (w, wi) {
        var len = Math.min(12, w.length); if (x + len * cw > 740) { x = 70; y += 120; }
        for (var k = 0; k < len; k++) { add(0, 10, [x + 4, y + 50, x + cw - 10, y + 50]); if (!k) add(wi % 2 ? 6 : 2, 26, [x + cw / 2 - 3, y + 14]); x += cw; }
        x += cw * 0.7;
      });
      add(0, 8, [60, y + 110, 740, y + 110]);
    };
    var words = ((song[3] || '') + ' ' + ((window.TITLE_EN && TITLE_EN[song[4]]) || '')).toLowerCase(), pic = null;
    for (var i = 0; i < BOT_WORDS.length && !pic; i++) if (BOT_WORDS[i][1].test(words)) pic = BOT_WORDS[i][0];
    if (pic) pics[pic](); else blanks(song[3]);   // (no flags: the picture is about the title)
    return L.length ? L : botScribble();
  }
  function botScribble() {
    var lines = [];
    for (var s = 0; s < 4; s++) {
      var x = 100 + Math.random() * 600, y = 100 + Math.random() * 400, p = [Math.round(x), Math.round(y)];
      for (var i = 0; i < 14; i++) { x = Math.max(20, Math.min(780, x + (Math.random() - 0.5) * 160)); y = Math.max(20, Math.min(580, y + (Math.random() - 0.5) * 160)); p.push(Math.round(x), Math.round(y)); }
      lines.push({ c: [0, 2, 4, 5, 6][Math.floor(Math.random() * 5)], w: Math.random() < 0.5 ? 6 : 14, p: p });
    }
    return lines;
  }
  function botAdd() {
    if (REMOTE || bots.length >= (window.BOT_MAX || 8) || G.phase !== 'lobby') return;
    var used = {}; list().forEach(function (p) { used[p.char] = 1; });
    // a bot is named after its avatar (a random free one)
    var open = CHARS.filter(function (c) { return !used[c.id]; }), free = open.length ? pick(open) : null, n = bots.length + 1;
    var pid = 'bot' + n + '-' + Math.random().toString(36).slice(2, 7);
    H.hi({ pid: pid, name: free ? (free.name.length > 16 ? free.name.split(' ')[0] : free.name) : 'Bot ' + n, char: free ? free.id : null });
    if (!players[pid]) return;
    players[pid].bot = true; bots.push({ pid: pid, key: '', at: 0, done: false });
    H.go({ pid: pid });
    botButtons();
  }
  function botClear() {
    bots.forEach(function (b) { delete players[b.pid]; if (G.go) delete G.go[b.pid]; });
    bots = []; botButtons(); push();
  }
  // "Remove all players": everyone is sent back to the join screen (a second click confirms).
  var clearArmed = null;
  $('clearplayers').addEventListener('click', function () {
    var b = $('clearplayers');
    if (G.phase !== 'lobby') return;
    if (!clearArmed) { b.textContent = 'Remove everyone? Click again'; clearArmed = setTimeout(function () { clearArmed = null; b.textContent = 'Remove all players'; }, 4000); return; }
    clearTimeout(clearArmed); clearArmed = null; b.textContent = 'Remove all players';
    net.send('kick', {});
    Object.keys(players).forEach(function (k) { delete players[k]; });
    bots = []; G.go = {}; botButtons(); push();
  });
  function botButtons() {
    $('botadd').classList.toggle('hidden', REMOTE);
    $('botadd').disabled = bots.length >= 8; $('botadd').textContent = bots.length ? 'Add another test bot (' + bots.length + ' of 8)' : 'Add a test bot';
    $('botclear').classList.toggle('hidden', !bots.length);
  }
  $('botadd').addEventListener('click', botAdd); $('botclear').addEventListener('click', botClear); botButtons();
  setInterval(function () {
    bots = bots.filter(function (b) { return players[b.pid]; });
    bots.forEach(function (b) {
      var p = players[b.pid], ph = G.phase, pid = b.pid;
      p.last = Date.now(); p.off = false;   // a bot never drops out
      if (ph === 'lobby') { b.key = ''; if (!(G.go && G.go[pid])) H.go({ pid: pid }); return; }
      // one action per step of the game, after a short random think
      var key = ph + ':' + G.round + ':' + (G.best ? G.best.id : '') + (G.draw ? G.draw.id : '');
      // (two-clip questions: wait until the second song has been on for a bit, about 15 seconds in)
      if (b.key !== key) { b.key = key; b.at = Date.now() + (ph === 'guess' && G.q && G.q.peel ? 40000 + Math.random() * 15000 : ph === 'guess' && isPair() ? 14000 + Math.random() * 3000 : ph === 'srec' ? 9000 + Math.random() * 2500 : 1200 + Math.random() * 3500); b.done = false; }   // (and about 10 seconds to "record")
      if (b.done || Date.now() < b.at) return;
      b.done = true;
      if (ph === 'guess' && G.q && G.q.options) {
        var can = []; G.q.options.forEach(function (o, i) { if (!(G.best && G.best.pids[i] === pid)) can.push(i); });
        // A question with a right answer: right 40% of the time, otherwise one of the wrong answers. (Votes are random.)
        var known = !G.best && G.q.correct >= 0, smart = known && Math.random() < (window.BOT_SMART == null ? 0.4 : window.BOT_SMART);
        var wrong = known ? can.filter(function (i) { return i !== G.q.correct; }) : can;
        if (can.length) H.guess({ pid: pid, choice: smart ? G.q.correct : pick(wrong.length ? wrong : can) });
      }
      else if (ph === 'dall' && G.gallery && G.gallery.items[pid]) { var bp = Math.floor(Math.random() * 4), bs = (G.gallery.items[pid].options || [])[bp]; H.draw({ pid: pid, pick: bp }); H.draw({ pid: pid, lines: bs ? botDraw(bs) : botScribble() }); H.draw({ pid: pid, done: 1 }); }
      else if (ph === 'qall') H.quip({ pid: pid, text: pick(G.quips && G.quips.bluff ? BOT_BLUFFS : BOT_LINES) });
      else if (ph === 'svote' && G.sing) H.poll({ pid: pid, choice: window.BOT_SAME ? 0 : Math.floor(Math.random() * G.sing.options.length) });
      else if (ph === 'srec' && G.sing) { try { if (G.sing.clips[pid]) URL.revokeObjectURL(G.sing.clips[pid]); G.sing.clips[pid] = botTune(); G.sing.in[pid] = 1; push(); allIn(); } catch (e) { H.clip({ pid: pid, skip: true }); } }   // a bot "sings" a random little tune
      else if (ph === 'sbest' && G.sing) { var others = []; G.sing.order.forEach(function (o, i) { if (o !== pid) others.push(i); }); if (others.length) H.poll({ pid: pid, choice: pick(others) }); }
    });
  }, 400);

  // ---------- buttons ----------
  // "Leave out" (Advanced settings): Israel, Russia or both can be kept out of a game. Their songs are
  // not played, and they do not turn up among the wrong answers either.
  function skipped(code) { return !!G.skip && G.skip.split(',').indexOf(code) >= 0; }   // G.skip: '', 'il', 'ru' or 'il,ru'
  function playSongs() { return G.skip ? songs.filter(function (s) { return !skipped(s[1]); }) : songs; }
  function playCountries() { if (!G.skip) return countries; var c = {}, k; for (k in countries) if (!skipped(k)) c[k] = countries[k]; return c; }
  $('s-skip').addEventListener('change', function () { G.skip = $('s-skip').value; try { localStorage.setItem('esc-skip', G.skip); } catch (e) {} ready(); });
  function buildPool() {
    G.pool = poolFor(playSongs(), G.eraNow || (G.era === 'spin' ? '1956-2100' : G.era), G.cat);   // eraNow: the years this round was dealt by the spin
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
  var lastType = 'mc';
  function singToggle() { var on = $('s-atype').value === 'sing' || $('s-atype').value === 'draw' || $('s-atype').value === 'quip'; $('s-subject').disabled = on; $('s-scoring').disabled = on;
    // Party has Sing! and Draw! rounds with their own points, so the Ladder cannot be used there.
    var party = $('s-atype').value === 'party', lo = $('s-scoring').querySelector('option[value="ladder"]');
    var robin = $('s-atype').value === 'robin';
    $('partybox').classList.toggle('hidden', !party); $('partypickbox').classList.toggle('hidden', !party); $('s-partypick').disabled = !party;   // the party settings only show for a Party game
    if (lo) lo.disabled = party;
    if (party && $('s-scoring').value === 'ladder') $('s-scoring').value = 'correct';
    // Party needs ten songs to fit both Sing! and Draw!: five is not on offer there.
    var five = $('s-rounds').querySelector('option'); if (five) five.disabled = party; if (party && $('s-rounds').value === '5') $('s-rounds').value = '10';
    var lad = !on && $('s-scoring').value === 'ladder';   // Ladder: no song count and no hidden scores
    var tour = party && $('s-partypick').value === 'order';   // Grand tour sets its own length: every minigame once
    $('s-rounds').disabled = lad || tour; $('s-show').disabled = lad;
    // Rounds and the spin for the years belong to a plain quiz
    // Round Robin: several rounds, each with its own era from the spin. Rounds only counts there, and
    // the Era setting has nothing to choose then.
    $('s-parts').disabled = party; $('s-era').disabled = robin;   // rounds: for Quiz and Through the Years, with any scoring
    if (robin && lastType !== 'robin') { $('s-parts').value = '4'; $('s-rounds').value = '5'; }   // picked just now: four rounds of five songs to start from
    if ((!robin && lastType === 'robin') || party) $('s-parts').value = '1';   // back from Through the Years, or Party: one round
    lastType = $('s-atype').value;
    scoreHelp(); }
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
    $('scorehelp').textContent = ($('s-atype').value === 'robin' ? 'Through the Years: a quiz in rounds. Before each round a spin picks the era for its songs, and an era that has been played is out. ' : '') + ($('s-atype').value === 'party' ? PARTY_HELP + ' ' + (HOST_SCORING_HELP[$('s-scoring').value] || '') : $('s-atype').value === 'draw' ? DRAW_HELP : $('s-atype').value === 'quip' ? QUIP_HELP : $('s-atype').value === 'sing' ? 'Jury Show: the votes decide. The singer with the most votes gets 12 points, the next 10, then 8, 7, 6 and so on.' : (HOST_SCORING_HELP[$('s-scoring').value] || '')) + show;
  }
  $('s-scoring').addEventListener('change', scoreHelp); $('s-show').addEventListener('change', scoreHelp); scoreHelp();
  // ---------- eras: several can be switched on (none or all of them: every year) ----------
  // The hidden Era field carries the choice as one value: '1956-2100' for everything, otherwise the chosen
  // stretches of years separated by commas.
  function eraSet(value) {
    var parts = String(value || '1956-2100').split(','), all = value === '1956-2100' || !value, sel = $('s-era'), names = [];
    [].forEach.call($('erabox').querySelectorAll('input:not([data-all])'), function (el) { el.checked = all || parts.indexOf(el.getAttribute('data-era')) >= 0; if (el.checked) names.push(el.parentNode.querySelector('b').textContent); });
    var boxes = $('erabox').querySelectorAll('input:not([data-all])'); if (names.length === boxes.length || !names.length) { all = true; value = '1956-2100'; }
    var opt = sel.querySelector('option[data-custom]');
    if (!all && !sel.querySelector('option[value="' + value + '"]')) { if (!opt) { opt = document.createElement('option'); opt.setAttribute('data-custom', '1'); sel.appendChild(opt); } opt.value = value; opt.textContent = names.join(', '); }
    sel.value = value;
    $('erasum').textContent = all ? 'All eras' : names.length === 1 ? names[0] : 'Custom';
    if ($('erabox')._allSync) $('erabox')._allSync();
    return value;
  }
  function eraRead() {
    var on = []; [].forEach.call($('erabox').querySelectorAll('input:not([data-all])'), function (el) { if (el.checked) on.push(el.getAttribute('data-era')); });
    var all = !on.length || on.length === $('erabox').querySelectorAll('input:not([data-all])').length;
    if (!on.length) { G.era = '1956-2100'; $('s-era').value = G.era; $('erasum').textContent = 'All eras'; }   // nothing switched on: every year (the switches stay off)
    else G.era = eraSet(all ? '1956-2100' : on.join(','));
    try { localStorage.setItem('esc-eras', G.era); } catch (e) {}
    ready();
  }
  $('erabox').addEventListener('change', eraRead);
  try { var er0 = localStorage.getItem('esc-eras'); if (er0 && /^[0-9,\-]+$/.test(er0)) G.era = eraSet(er0); } catch (e) {}
  // ---------- entries: winners, the other finalists and non-qualifiers can be combined the same way ----------
  // The hidden Entries field carries the choice: 'all', the old single values where they fit ('win', 'nq',
  // 'final' for every finalist), otherwise the switched-on kinds separated by commas.
  function catSet(value) {
    var v = String(value || 'all'), on = v === 'all' ? ['win', 'fin', 'nq'] : v === 'final' ? ['win', 'fin'] : v.split(','), sel = $('s-cat'), names = [];
    [].forEach.call($('catbox').querySelectorAll('input:not([data-all])'), function (el) { el.checked = on.indexOf(el.getAttribute('data-cat')) >= 0; if (el.checked) names.push(el.parentNode.querySelector('b').textContent); });
    if (!sel.querySelector('option[value="' + v + '"]')) { var opt = sel.querySelector('option[data-custom]'); if (!opt) { opt = document.createElement('option'); opt.setAttribute('data-custom', '1'); sel.appendChild(opt); } opt.value = v; opt.textContent = names.join(' and '); }
    sel.value = v;
    $('catsum').textContent = v === 'all' ? 'All entries' : names.length === 1 ? names[0] : v === 'final' ? 'All finalists' : 'Custom';
    if ($('catbox')._allSync) $('catbox')._allSync();
    return v;
  }
  function catRead() {
    var on = []; [].forEach.call($('catbox').querySelectorAll('input:not([data-all])'), function (el) { if (el.checked) on.push(el.getAttribute('data-cat')); });
    if (!on.length) { G.cat = 'all'; $('s-cat').value = 'all'; $('catsum').textContent = 'All entries'; }   // nothing switched on: every entry (the switches stay off)
    else G.cat = catSet(on.length === 3 ? 'all' : on.indexOf('win') >= 0 && on.indexOf('fin') >= 0 ? 'final' : on.join(','));
    try { localStorage.setItem('esc-cats', G.cat); } catch (e) {}
    winnersLock(); ready();
  }
  $('catbox').addEventListener('change', catRead);
  try { var ct0 = localStorage.getItem('esc-cats'); if (ct0 && /^[a-z,]+$/.test(ct0)) { G.cat = catSet(ct0); winnersLock(); } } catch (e) {}
  ['s-era', 's-cat'].forEach(function (id) { $(id).addEventListener('change', function () { G.era = $('s-era').value; G.cat = $('s-cat').value; ready(); }); });
  function toLobby() {
    setTimeout(fanCue, 1500);   // back in the lobby: line the fanfare up again
    payFlush(); paper(null); clearTimeout(quipTimer);
    G.ladderWon = false; G.gallery = null; G.best = null; G.quips = null; G.part = null; G.eraNow = ''; clearTimeout(partTimer); clearTimeout(funTimer); $('cover').classList.remove('funcard'); G.fun = null; G.pspin = null; clearTimeout(quipTimer); list().forEach(function (p) { p.rung = 0; p.moved = ''; });
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
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.robin = $('s-atype').value === 'robin'; G.atype = G.robin ? 'mc' : $('s-atype').value; G.subject = $('s-subject').value; G.scoring = $('s-scoring').value; G.showScore = $('s-show').value;
    if (!ytReadyOrRemote() || !buildPool()) return false;
    // Rounds: a quiz can be played in several rounds of so many songs each. With "Spin the years" each
    // round gets its own decade, picked by a spin; a decade that has been played is out of the draw.
    if (G.robin) { G.era = '1956-2100'; buildPool(); }
    G.per = +$('s-rounds').value; G.parts = G.atype === 'mc' ? +$('s-parts').value || 1 : 1;
    G.partLadder = G.atype === 'mc' && G.scoring === 'ladder' && G.parts > 1; G.partN = 0; G.partNext = true; G.partStart = 1;
    list().forEach(function (p) { p.bank = 0; });
    G.eraSpin = G.robin; G.eraNow = ''; G.eraUsed = []; G.part = null; G.partDone = {};
    G.total = G.per * G.parts; G.guessMs = (+$('s-time').value + AFTER) * 1000;
    if (ladderGame()) { G.total = ENDLESS; G.showScore = 'always'; }   // the ladder is the score, and it goes on until someone is at the top   // the clip, then 5 seconds more to answer
    G.round = 0; G.used = {}; fails = 0; note('');
    list().forEach(function (p) { p.score = 0; p.rung = 0; p.moved = ''; }); G.ladderWon = false; G.mode = 'mc'; G.gallery = null; G.quips = null; G.quipUsed = []; G.bluffSong = null; G.lastParty = ''; G.pspin = null; G.partyIdx = 0; G.afterParty = $('s-atype').value === 'party'; G.partyDone = [];   // a Party game opens with the Quiz card too
    G.partyPick = $('s-partypick').value; G.tourLast = false; G.tourFinal = false; G.tour = G.atype === 'party' && G.partyPick === 'order'; if (G.tour) G.total = ENDLESS;   // Grand tour: three questions and a minigame, until every minigame has been played
    G.quizRun = 0; G.quipSlot = 0; G.lastSpecial = '';
    G.brief = briefInfo(); introStart();
    return true;
  }
  $('start').addEventListener('click', function () { if (G.phase === 'intro') introEnd(); else beginGame(); });
  // Autoplay: with the box ticked the next song starts by itself, after 10, 20 or 30 seconds or when
  // the song that is playing has finished ("Until the end").
  var autoTick = null, autoEnd = 0;
  // Autoplay is on by default, 20 seconds after the answer. It can be set in the lobby (Advanced
  // settings) and on the bar during the game; the two always show the same.
  $('auto').checked = true; $('autolen').value = '20';
  try { $('auto').checked = localStorage.getItem('esc-auto2') !== '0'; var al = localStorage.getItem('esc-autolen2'); if (al && $('autolen').querySelector('option[value="' + al + '"]')) $('autolen').value = al; } catch (e) {}
  function autoMirror() { $('s-auto').value = $('auto').checked ? '1' : '0'; $('s-autolen').value = $('autolen').value; $('s-autolen').disabled = !$('auto').checked; }
  autoMirror();
  $('s-auto').addEventListener('change', function () { $('auto').checked = $('s-auto').value === '1'; $('auto').dispatchEvent(new Event('change')); });
  $('s-autolen').addEventListener('change', function () { $('autolen').value = $('s-autolen').value; $('autolen').dispatchEvent(new Event('change')); });
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
    // After a drawing the song only plays for ten seconds (there are as many drawings as players); everything else keeps the setting.
    if (G.draw && !lastSong()) { toEnd = false; }
    // Until the end: follow the player. If nothing is playing (or it cannot be read), fall back to a fixed wait.
    autoEnd = Date.now() + (toEnd ? REMOTE ? (G.remain > 0 ? Math.max(5, G.remain + 1 - (G.q && G.q.noclip ? 0 : Math.min(clipSecs(), (Date.now() - (G.guessAt || Date.now())) / 1000))) : 30) : 20 : G.draw && !lastSong() ? Math.min(10, +$('autolen').value || 10) : +$('autolen').value) * 1000;
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
    try { localStorage.setItem('esc-auto2', $('auto').checked ? '1' : '0'); } catch (e) {}
    autoMirror();
    autoStart();
    if (!recovering) net.send('state', snapshot());
  });
  $('autolen').addEventListener('change', function () {
    try { localStorage.setItem('esc-autolen2', $('autolen').value); } catch (e) {}
    autoMirror();
    autoStart();
    if (!recovering) net.send('state', snapshot());
  });
  $('skip').addEventListener('click', function () { if (G.sing) singSkip(); else reveal(); });
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (lastSong()) {
      // a Ladder game in rounds: the last round is added to what was banked before
      if (G.partLadder) list().forEach(function (p) { p.score = (p.bank || 0) + LADDER[Math.floor(p.rung || 0)]; });
      try { yt.stopVideo(); } catch (e) {} G.go = {}; G.phase = 'end'; push();
    } else startRound();   // nobody is 'ready' for the next game yet
  }
  $('again').addEventListener('click', toLobby);

  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    try { var sk = localStorage.getItem('esc-skip'); if (sk && $('s-skip').querySelector('option[value="' + sk + '"]')) { $('s-skip').value = sk; G.skip = sk; } } catch (e) {}
    ready();
  }).catch(function () { $('start').textContent = 'Could not load songs'; });
  fetch('chorus.json?v=43').then(function (r) { return r.json(); }).then(function (d) { chorus = d || {}; }).catch(function () {});
  keepSettings(['s-time', 's-scoring', 's-rounds']);   // shared with solo play (the eras have their own switches here)
  restore();
  render();
})();
