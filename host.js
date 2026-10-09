(function () {
  var $ = function (id) { return document.getElementById(id); };
  var AFTER = 5;            // seconds to answer after the clip has ended
  function clipSecs() { return Math.max(5, Math.round(G.guessMs / 1000) - AFTER); }   // clip length (the Video length setting)
  var room = '', net, songs = [], countries = {}, chorus = {};
  var REMOTE = new URLSearchParams(location.search).get('screen') === '0';   // a game without a shared screen
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 25000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true, era: '1956-2100', cat: 'all', atype: 'mc', subject: 'random', q: null, sing: null, barMs: 30000, scoring: 'correct', showScore: 'always', revealAt: 0, draw: null, drawTurn: 0, go: {} };
  // The whoosh sounds only in the Grand Final: in the rest of the game they were a bit much.
  (function () { var w = Music.woosh; Music.woosh = function () { if (G.phase === 'chase') w.apply(Music, arguments); }; })();
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
      if (SHOP_START_ALL && G.atype === 'party' && G.starterGiven) p.inv = SHOP_ITEMS.map(function (it) { return it.id; });   // joining a Party game later: the items too
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
    if (!p || G.phase !== 'guess' || p.got || p.done || !G.q || p.sitNow) return;
    var res, mc = G.q.type === 'mc';
    if (mc) {
      // Multiple choice: the answer is held and can still be changed. Nobody learns whether
      // it was right before the reveal, which comes once everyone has an answer in.
      if (G.best && G.best.ranked && Array.isArray(m.ranks)) {   // the 12-10-8 of the best drawings (not your own, no drawing twice)
        var rk = []; m.ranks.forEach(function (i) { if (typeof i === 'number' && G.q.options[i] && G.best.pids[i] !== m.pid && rk.indexOf(i) < 0 && rk.length < 3) rk.push(i); });
        if (!rk.length) return; p.ranks = rk; p.pick = rk[0]; p.pickMs = (G.barMs || G.guessMs) - (G.endsAt - Date.now()); push(); allIn(); return;
      }
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
      p.pts = pointsFor(G.scoring, G.guessMs - (G.endsAt - Date.now()), G.guessMs, before); if (p.halfNow) p.pts = Math.ceil(p.pts / 2); p.score += p.pts; p.got = true; cardPay(p);
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
    if (p.sitNow && G.phase === 'guess') return true;   // sitting out (Broken Mic)
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
    var s = { phase: G.phase, round: G.round, total: G.total, total_ms: G.guessMs, bar_ms: G.barMs, left: G.frozenLeft != null ? G.frozenLeft : Math.max(0, G.endsAt - Date.now()), frozen: G.frozenLeft != null,
      cfg: { era: G.era, cat: G.cat, showVideo: G.showVideo, atype: G.atype, subject: G.subject, scoring: G.scoring, showScore: G.showScore },
      players: list().map(function (p) { return { pid: p.pid, name: p.name, char: p.char, score: p.score, got: p.got, done: !!p.done, picked: p.pick != null, in: isIn(p), pick: G.phase === 'reveal' ? p.pick : null, pts: p.pts, inv: p.inv || [], uses: p.uses || {}, sit: p.sitNow || '', flag: !!p.flagNow }; }) };
    if (G.sing) s.sing = singSnapshot();
    if (G.phase === 'bomb' && G.bomb) s.bomb = bombSnap();
    if (G.clue) s.clue = clueSnap();
    if (G.note && G.phase === 'note') s.note = noteSnap();
    if (G.qj && G.phase === 'qj') s.qj = qjSnap();
    if (G.phase === 'shop' && G.shop && !G.shop.talk) { s.shop = { id: G.shop.id, sold: Object.keys(G.sold || {}).filter(soldOut), buy: !!G.shop.buy, free: G.shop.free || [], n: G.shop.n || SHOP_PICKS, who: G.shop.who, items: SHOP_ITEMS.map(function (it) { var c = {}; for (var k in it) c[k] = it[k]; c.price = shopPrice(it); return c; }), offer: G.shop.offer || null, done: {}, over: !!G.shop.over }; Object.keys(G.shop.picks).forEach(function (k) { s.shop.done[k] = G.shop.picks[k]; }); }
    if (G.atype === 'party') { s.shopq = (G.shopQ || []).length; s.mg = !!G.mgLive; }
    if (G.phase === 'chase' && G.chase) s.chase = chaseSnap();
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
    if (G.q && (G.phase === 'guess' || G.phase === 'reveal')) s.q = { subject: G.q.subject, type: G.q.type, text: G.q.text, hint: G.q.hint, options: G.q.options, noclip: !!G.q.noclip, smoke: G.phase === 'guess' && G.smoke && G.smoke.length ? G.smoke : null, fan: G.phase === 'guess' && G.fanQ && G.fanQ.key === qKeyNow() ? G.fanQ.map : null };
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
    if (G.best && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal')) s.best = { only: G.best.only || null, pick: !!G.best.pick, bluff: !!G.best.bluff, quip: !!G.best.quip, win_pts: G.best.quip ? QUIP_WIN : BEST_PTS * partyX(), id: G.best.id, pids: G.best.pids, tally: G.phase === 'reveal' ? G.best.tally : null, wins: G.phase === 'reveal' ? G.best.wins : null, pts: BEST_PTS, ranked: !!G.best.ranked };
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
    if (G.scoring === 'ladder') { $('s-qmode').value = 'ladder'; $('s-scoring').value = 'correct'; } else $('s-scoring').value = G.scoring;
    $('s-show').value = G.showScore;
    if (G.atype === 'open' || G.atype === 'mix') G.atype = 'mc';   // typed answers were removed; older saved games fall back to multiple choice
    if (G.subject === 'sing') { G.atype = 'sing'; G.subject = 'country'; }
    if (G.subject === 'points') G.subject = 'random';
    if (['country', 'artist', 'title', 'year', 'place'].indexOf(G.subject) >= 0) G.subject = 'facts';   // these are one category now   // the points question was removed
    if (G.phase === 'lobby' || G.phase === 'end') G.go = {};   // games saved before Sing! moved to Category
    eraSet(G.era); catSet(G.cat);
    $('s-atype').value = G.robin ? 'robin' : G.atype; $('s-subject').value = G.subject; $('s-subject').disabled = $('s-scoring').disabled = G.atype === 'sing' || G.atype === 'draw' || G.atype === 'quip'; scoreHelp();
    if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20].indexOf(G.total) >= 0) $('s-rounds').value = G.total;
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
  var viewNow = '';
  function show(id) { if (id !== viewNow) { viewNow = id; viewEnter(id); } ['v-lobby', 'v-brief', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want((id === 'v-lobby' && G.phase === 'lobby') || (id === 'v-game' && !REMOTE && (((G.phase === 'guess' || (G.phase === 'reveal' && G.q && G.q.subject === 'trivia')) && !!G.q && (!!G.q.noclip || !!G.q.peel)) || (roundMode() === 'draw' && (G.phase === 'dall' || G.phase === 'loading')) || G.phase === 'part' || G.phase === 'opening' || G.phase === 'qj' || (G.phase === 'fun' && !(G.fun && G.fun.kind === 'clue')) || G.phase === 'pspin')) && !G.clue || !!G.fsMusic); }   // menu music until the fanfare
  // "Show score: at the end of the round" keeps every total secret until the final scoreboard.
  function hideScores() {
    if (G.phase === 'end' || G.phase === 'lobby' || G.phase === 'brief' || G.phase === 'intro') return false;
    if (G.showScore === 'end') return true;
    if (G.tourFinal) return true;   // Grand tour: the last three questions are played blind
    return false;   // (the last song is no longer played blind: the round summary and the final game do the revealing)
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
var BAG_SVG = '<svg class="bagico" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="bagg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3fa4"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><path d="M8 8.5V6a4 4 0 0 1 8 0v2.5" fill="none" stroke="#ffd34d" stroke-width="2" stroke-linecap="round"/><path d="M3.5 8h17l-1.3 14H4.8z" fill="url(#bagg)"/><path d="M12 19.5c-3-1.9-4.6-3.5-4.6-5.3a2.3 2.3 0 0 1 4.6-.7 2.3 2.3 0 0 1 4.6.7c0 1.8-1.6 3.4-4.6 5.3z" fill="#fff"/></svg>';   // the items on the scoreboard: a Eurovision shopping bag with a heart
  function boardHtml(showGot) {
    var hide = hideScores();
    var ps = hide ? list().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }) : list();   // no order to read the ranking from
    return ps.map(function (p) {
      return '<li data-pid="' + esc(p.pid) + '" class="' + (showGot && p.got && !hide ? 'got ' : '') + (showGot && p.pts < 0 && !hide ? 'lost ' : '') + (p.off ? 'off' : '') + '"><span class="who">' + charSvg(p.char) + esc(p.name) + (p.rcrown && G.phase !== 'end' ? ' <span class="rcrown" title="Won the last round">👑</span>' : '') + (G.atype === 'party' && shielded(p) ? ' <span class="rshield" title="Protected by an umbrella: no items can be aimed at them">☂️</span>' : '') + '</span><span class="binv"' + (G.atype === 'party' && p.inv && p.inv.length ? ' title="Items in their bag">' + BAG_SVG + '<b>' + p.inv.length + '</b>' : '>') + '</span><span class="tot">' + (hide ? '?' : p.score) + '</span><span class="pts">' + (!hide && showGot && p.pts < 0 ? '−' + (-p.pts) : !hide && showGot && p.got && p.pts ? '+' + p.pts : '') + '</span></li>';   // the +points have their own column, so the totals never shift
    }).join('') || '<li class="mute">No players yet</li>';
  }
  var joinSeen = {}, joinQuiet = Date.now() + 2500;   // players restored when the page opens do not pop
  function render() {
    var ps = list();
    if (G.phase !== 'chase') $('chase').classList.add('hidden');
    if (G.phase !== 'shop' && $('shopov')) $('shopov').remove();
    if (G.phase !== 'bomb' && $('bombov')) $('bombov').remove();
    if (!(G.phase === 'fun' && G.fun && G.fun.kind === 'groom') && $('grov')) $('grov').remove();
    if (!(G.phase === 'fun' && G.fun && G.fun.kind === 'scene') && $('hsov')) $('hsov').remove();
    if (!((G.phase === 'fun' && G.fun && G.fun.kind === 'clue') || G.phase === 'clueacc' || G.phase === 'cluerev') && $('clueov')) $('clueov').remove();
    if (!G.clue && ((poeAudio && !poeAudio.paused) || (egghAudio && !egghAudio.paused))) clueSongStop();
    if (G.phase !== 'note' && $('noteov')) { $('noteov').remove(); noteAudio(false); }
    if (G.phase !== 'qj' && $('qjov')) $('qjov').remove();   // (the game is over, or was ended)
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
    $('boardtitle').textContent = hideScores() ? 'Scores at the end' : ladderGame() ? 'Ladder' : 'Scores' + (G.parts > 1 && G.partN && G.atype !== 'party' && G.phase !== 'lobby' && G.phase !== 'end' ? ' – Round ' + Math.min(G.partN, G.parts) : '');
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
        var champs0 = list().filter(function (p) { return p.champ; });
        $('final').classList.toggle('hidden', champs0.length > 0 || !!G.chaseLost);   // after the chase there is no scoreboard: the chase decided
        chaseOverview(champs0.length > 0 || !!G.chaseLost);
        if (G.chaseLost) { $('endlead').textContent = 'Everyone lost!'; $('winner').textContent = G.chaseLost + ' grabbed the trophy'; $('winchar').innerHTML = ''; }
        else if (champs0.length) {
          $('endlead').textContent = 'Winner of the Grand Final'; $('winner').textContent = champs0.map(function (w) { return w.name; }).join(' & ');
          $('winchar').innerHTML = '<div class="winballoon">Thank you Europe!</div><div class="winfaces">' + champs0.slice(0, 4).map(function (w) { return charSvg(w.char); }).join('') + '</div>';
          Music.douze();
        } else
        finalBoard($('final'), ps, null, function (wins) {
          $('endlead').textContent = wins.length ? 'And the winner is…' : 'Final scores';
          $('winner').textContent = wins.length ? wins.map(function (w) { return w.name; }).join(' & ') + ' · ' + ptsLabel(wins[0].score) : 'Nobody scored';
          // the winner's big avatar (with a tie: all of them), with a speech balloon above it
          $('winchar').innerHTML = wins.length ? '<div class="winballoon">Thank you Europe!</div><div class="winfaces">' + wins.slice(0, 4).map(function (w) { return charSvg(w.char); }).join('') + '</div>' : '';
        }, true, ladderGame());
        endLadder();   // counted up only when the totals were hidden during the game
      }
    } else if (G.phase === 'chase') {
      show('v-game'); chaseShow();
    } else if (G.phase === 'shop') {
      show('v-game'); shopShow();
    } else if (G.phase === 'bomb') {
      show('v-game'); bombShow();
    } else if (G.phase === 'clueacc' || G.phase === 'cluerev') {
      show('v-game'); clueShow();
    } else if (G.phase === 'note') {
      show('v-game'); noteShow();
    } else if (G.phase === 'qj') {
      show('v-game'); qjShow();
    } else {
      show('v-game');
      $('roundlabel').textContent = G.phase === 'opening' ? '' : 'Song ' + G.round + ofTotal(' / ');
      renderQuestion(); renderAnswered(); hostsEl();
      $('qopts').classList.toggle('smoked', G.phase === 'guess' && !!(G.smoke && G.smoke.length));   // Smoke Machine: the answers are hidden until the reveal
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
    if (G.phase === 'fun' && G.fun && G.fun.quiet) { $('qtext').textContent = ''; $('qopts').innerHTML = ''; }   // (an announcement by the presenters: the screen says it all)
    else if (G.phase === 'fun' && G.fun) { $('qtext').textContent = (G.fun.plain ? '' : 'Party round: ') + G.fun.title; $('qopts').innerHTML = '<p class="funsub">' + esc(G.fun.sub) + '</p>'; $('qopts').classList.remove('votelist'); $('qopts').classList.remove('eras'); G.plopped = null; return; }
    if (G.phase === 'part' && G.part) {
      var pt = G.part, head = G.atype === 'party' ? 'Next trivia' : pt.of > 1 ? 'Round ' + pt.n + ' of ' + pt.of : 'This game';
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
      return '<div class="optcol"><div class="opt' + (rev ? ((G.best && G.best.wins ? G.best.wins.indexOf(i) >= 0 : i === q.correct) ? ' right' : ' dim') : '') + '"><b>' + 'ABCDEFGHIJKLMNOP'[i] + '</b><span class="otx">' + esc(o) + '</span></div><div class="voters">' +
        who.map(function (p) {
          var cq = rev && G.clue && G.clue.st === 'ask' && i === q.correct, fast = cq && G.clue.fast === p.pid;   // Edgar: no points, clues; the fastest gets an extra one
          return '<span class="' + (p.pid === G.plopped ? 'plop' : '') + (fast ? ' fastest' : '') + '">' + charSvg(p.char) + esc(p.name) + (cq ? (fast ? ' <b>🔍 +extra clue</b>' : '') : rev && p.got && i === q.correct && !G.best ? ' <b>+' + p.pts + '</b>' : '') + '</span>';
        }).join('') + '</div></div>';
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
    bestRender(); pcSync();
    var stg = document.querySelector('#v-game .stage'); stg.classList.toggle('withdraw', dSide); stg.classList.toggle('novideo', (!!G.draw || !!(G.q && G.q.noclip)) && (G.phase !== 'reveal' || triviaQ()));   // no clip in this question: not a glimpse of the video before the answer
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
      else if (G.q.battle) worth = String(BATTLE_PTS);
      else if (G.clue) worth = '🔍';
      else if (G.q.peel) worth = String(peelPoints((G.barMs || PEEL_MS) - (G.endsAt - Date.now()), G.q.blur) * x2);
      else if (G.scoring === 'speed') worth = String((ESC_POINTS[list().filter(function (p) { return p.pick != null; }).length] || 1) * x2);   // Speedy: what the next one in can still get
      else worth = String((G.scoring === 'random' && G.qWorth ? G.qWorth : 12) * x2);
    }
    if (worth !== worthShown) { worthShown = worth; $('worth').classList.toggle('hidden', !worth); if (worth) { $('worth').textContent = worth; $('worth').classList.remove('tick'); void $('worth').offsetWidth; $('worth').classList.add('tick'); } }
    var timed = G.phase === 'guess' || G.phase === 'dall' || G.phase === 'qall' || (G.sing && (G.phase === 'svote' || G.phase === 'slisten' || G.phase === 'srec' || G.phase === 'sbest'));
    $('tbar').style.transform = 'scaleX(' + (timed ? Math.max(0, Math.min(1, (G.frozenLeft != null ? G.frozenLeft : G.endsAt - Date.now()) / (G.barMs || G.guessMs))) : 0) + ')';
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
      events: { onReady: function () { ytVolWrap(yt); ytReady = true; ready(); fanCue(); }, onError: function () {
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

  // Variety: a type of question that has just been played sits out the next two questions (as far as the
  // switched-on types allow: with only one or two on, there is nothing else to pick).
  function typesNow() {
    if (G.clue && G.clue.st === 'ask') { var cs = CLUE_TYPES.filter(function (x) { return !G.types || G.types.indexOf(x) >= 0; }); return cs.length ? cs : CLUE_TYPES; }   // Edgar: no videos, his tune keeps playing
    var base = G.types || Object.keys(TYPE_WEIGHT), seen = (G.typeLast || []).filter(function (x) { return x.round !== G.round; }).map(function (x) { return x.kind; });
    if (seen.indexOf('map') >= 0 || seen.indexOf('host') >= 0) seen = seen.concat(['map', 'host']);   // both show the outline of a country: they keep the same distance from each other
    var t = base.filter(function (x) { return seen.indexOf(x) < 0; });
    if (!t.length && seen.length) t = base.filter(function (x) { return x !== seen[seen.length - 1]; });   // then at least not the same one twice in a row
    return t.length ? t : base;
  }
  function typeNote(q) {
    if (!q) return q;
    var kind = ['country', 'artist', 'title', 'year', 'place', 'points'].indexOf(q.subject) >= 0 ? 'facts' : q.subject;
    if (!(G.typeLast || []).some(function (x) { return x.round === G.round; })) {
      G.typeWait = G.typeWait || {};
      (G.types || Object.keys(TYPE_WEIGHT)).forEach(function (x) { G.typeWait[x] = (G.typeWait[x] || 0) + 1; });
    }
    G.typeWait[kind] = 0;
    G.typeLast = (G.typeLast || []).filter(function (x) { return x.round !== G.round; });   // (a replacement for a broken video is the same question slot)
    G.typeLast.push({ round: G.round, kind: kind }); if (G.typeLast.length > 2) G.typeLast = G.typeLast.slice(-2);
    return q;
  }
  var lateLoad = false;
  function loadSong(fixed) {
    if (REMOTE) { remoteLoad(fixed); return; }
    stopTimers(); stuck = false;
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = fixed || free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    G.q = G.sing || G.quipLoad ? null : G.draw ? G.q : G.battleQ ? G.battleQ : typeNote(makeQuestion(G.song, G.subject, 'mc', playSongs(), playCountries(), { pair: true, peel: true, cat: G.cat, pool: G.pool, used: G.used, types: typesNow(), wait: G.typeWait }));
    if (G.q && G.q.swap) { G.song = G.q.swap; G.used[G.song[4]] = 1; }   // the question brought its own song
    stage = 'probe'; rate(1);
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
      // Behind the curtain and Out of focus last a minute and the song plays on at the answer: they start early in the
      // video (5 to 30 seconds in, sooner for a short one), so there is at least a minute and a half of song left.
      if (G.q && G.q.peel) cs = Math.max(0, Math.min(Math.floor(5 + frac * 25), Math.floor(d - 100)));
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
  function triviaQ() { return !!(G.q && (G.q.subject === 'trivia' || (G.clue && G.clue.st === 'ask'))); }   // no video at the answer either (Did you know?, and the questions in Edgar's game)
  function noClipQ() { return !!G.draw || !!(G.q && G.q.noclip); }
  function adNote(on) {
    if (on && (noClipQ() || (G.q && G.q.peel))) return;   // never uncover the video of a question that has no clip, or that hides it (curtain, blur)
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
    if (G.battleQ) { battleFix(); return; }   // Song Battle: the song that will not play is swapped for another
    if (G.draw) { fails = 0; stage = 'idle'; clipReady = true; return; }   // Draw! does not need the video: carry on, the drawing starts after the countdown
    loadSong();
  }
  function rate(r) { try { yt.setPlaybackRate(r); } catch (e) {} }
  function playClip() {
    clearInterval(poll);
    stage = 'clip'; quietAt = -1;
    var rolling = false; try { var t0 = yt.getCurrentTime() || 0; rolling = !!preAt && yt.getPlayerState() === 1 && Math.abs(t0 - clipStart) < 1.5; } catch (e) {}
    preAt = 0;
    if (!rolling) yt.seekTo(clipStart, true);   // (already running at the right spot after its head start: no jump, no symbol)
    yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipLen() * (G.q && G.q.fast && G.phase === 'guess' ? 0.5 : 1)) {   // (at half speed the clip takes just as long: half as much song)
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
    if (G.q.blur) { blurPlay(ms); return; }
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
  function peelStop() { clearInterval(peelTick); $('peel').classList.add('hidden'); $('peel').innerHTML = ''; blurSet(0); }
  // "Out of focus": the same round, but the picture starts as a blur and sharpens little by little.
  function blurSet(px) { var f = document.getElementById('yt'); if (!f) return; f.style.transition = px ? 'filter .5s linear' : 'none'; f.style.filter = px > 0.3 ? 'blur(' + px.toFixed(1) + 'px)' : ''; }
  function blurPlay(ms) {
    var w = stageEl().clientWidth || 800, start = Math.max(26, w * 0.065), t0 = Date.now();
    var f = document.getElementById('yt'); if (f) { f.style.transition = 'none'; f.style.filter = 'blur(' + start.toFixed(1) + 'px)'; }
    clearInterval(peelTick);
    peelTick = setInterval(function () {
      if (G.phase !== 'guess' || !G.q || !G.q.blur) { peelStop(); return; }
      var left = Math.max(0, 1 - (Date.now() - t0) / (ms * 0.97));
      blurSet(start * Math.pow(left, 1.5));   // stays vague for a good while, sharp just before the time is up
    }, 400);
  }
  // Standard scoring: while the song is being selected, a light runs up and down a column of the Eurovision
  // points (12, 10, 8, 7 … 1) and stops on what a right answer to this question will be worth.
  var WORTHS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1], worthTimer = null;
  function worthSpin() {
    var ok = !REMOTE && G.q && !G.q.battle && !G.clue && !G.draw && !G.sing && !G.quipLoad && !G.best && G.scoring === 'random' && !ladderGame();
    if (!ok) { G.qWorth = 0; worthHide(); return; }
    if (G.worthRound === G.round && $('ptspin').innerHTML) return;   // a replacement for a broken video keeps what was spun
    // Behind the curtain starts at twelve and falls from there: the light lands on 12.
    var open = !!G.q.peel;
    G.worthRound = G.round; G.qWorth = open ? 0 : pick(WORTHS);
    var el = $('ptspin'), x2 = G.tourFinal ? 2 : 1, target = open ? 0 : WORTHS.indexOf(G.qWorth);
    el.innerHTML = WORTHS.map(function (v) { return '<i>' + v * x2 + '</i>'; }).join(''); el.classList.remove('hidden');
    // The light climbs from 1 at the bottom, rung by rung, up to this question's number, and pops when it gets there.
    // (First it runs once all the way from the bottom to the top, quickly; the second time up it stops on the number.)
    var chips = el.querySelectorAll('i'), n = chips.length, at = n - 1, steps = n - 1 - target, gap = Math.max(100, Math.min(240, 1400 / Math.max(1, steps))), lap = 1;
    clearTimeout(worthTimer);
    var hop = function () {
      if (G.phase !== 'loading') { worthHide(); return; }
      [].forEach.call(chips, function (c, i) { c.className = i === at ? 'on' : ''; });   // only the rung it is on lights up
      Music.plop(n - 1 - at, 0.22);   // a soft tick, in the background
      if (lap === 1) { if (at <= 0) { lap = 2; at = n - 1; worthTimer = setTimeout(hop, 160); } else { at--; worthTimer = setTimeout(hop, 55); } return; }
      if (at <= target) { worthTimer = setTimeout(function () { if (G.phase !== 'loading') return; chips[at].className = 'on picked' + (at === 0 ? ' douze' : ''); if (at === 0) Music.douze(); else Music.ding(); }, 260); return; }   // twelve gets a fanfare of its own
      at--; worthTimer = setTimeout(hop, gap);
    };
    worthTimer = setTimeout(hop, 200);
  }
  function worthHide() { clearTimeout(worthTimer); $('ptspin').classList.add('hidden'); $('ptspin').innerHTML = ''; }
  function beginGuess() {
    setTimeout(hostQuestion, 600); setTimeout(questionEnter, 30);
    worthHide();
    if (G.quipLoad) { quipWrite(); return; }   // Quip!: the clip comes with a question to write an answer to
    $('err').textContent = '';
    var ms = G.draw ? drawGuessMs() : isPair() ? PAIR_MS : G.q && G.q.peel ? PEEL_MS : G.guessMs;
    G.phase = 'guess'; G.barMs = ms; G.endsAt = Date.now() + ms;
    if (isPair()) { pairStep = 0; stageEl().classList.remove('second'); pairTag('Song 1'); }
    if (G.q && G.q.noclip) { clearInterval(poll); stage = 'paused'; var art = noClipArt(G.q); cover(true, G.draw ? '✏️' : art[0], G.draw ? '' : art[1], false); if (!G.draw && G.q.flag) { $('covericon').innerHTML = flagHtml(G.q.flag); $('covertext').textContent = ''; } if (!G.draw && G.q.map) { $('covericon').innerHTML = mapHtml(G.q.map, G.q.dot); $('covertext').textContent = ''; } }   // odd one out and Draw!: no clip
    else if (G.q && G.q.peel) peelPlay(ms);
    else { rate(G.q && G.q.fast ? 0.5 : 1); playClip(); if (G.q && G.q.fast) cover(true, '🐌', 'Slow motion', false); }   // Slow motion: only the sound, at half speed
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
  // After the Grand Final: everyone's points per round and in the chase; the winner on top, the rest greyed out.
  function chaseOverview(on) {
    var box = $('chaseov');
    if (!box) { box = document.createElement('div'); box.id = 'chaseov'; box.className = 'chaseov'; $('v-end').insertBefore(box, $('v-end').querySelector('.endbtns')); }
    box.classList.toggle('hidden', !on || !G.chaseOv); if (!on || !G.chaseOv) { $('v-end').classList.remove('ovmany'); return; }
    var R = 0; G.chaseOv.forEach(function (o) { var p = players[o.pid]; if (p && p.rh) R = Math.max(R, p.rh.length); });
    var rows = G.chaseOv.filter(function (o) { return players[o.pid]; }).slice().sort(function (a, b) { return (b.win - a.win) || (b.fp - a.fp) || (players[b.pid].score - players[a.pid].score); });
    var R1 = R > 1 ? R : 0;   // (one round: its column would just repeat the points)
    var head = '<span></span>'; for (var k = 0; k < R1; k++) head += '<span>Round ' + (k + 1) + '</span>'; head += '<span class="pc">Points</span><span class="fc">Grand Final</span>';
    box.style.setProperty('--cols', 'minmax(0,1fr) ' + (R1 ? 'repeat(' + R1 + ',5.2em) ' : '') + '5.6em 6.4em');
    // the most points before the Grand Final: a silver crown (the trophy is for the Grand Final)
    var topPts = Math.max.apply(null, rows.map(function (o) { return players[o.pid].score; }));
    var rowHtml = function (o, i) {
      var p = players[o.pid], cells = ''; for (var k = 0; k < R1; k++) cells += '<span>' + ((p.rh || [])[k] || 0) + '</span>';
      var silver = topPts > 0 && p.score === topPts ? ' <span class="silvercrown" title="Most points">👑</span>' : '';
      return '<div class="ovrow' + (o.win ? ' win' : ' dead') + (silver ? ' silver' : '') + '" style="--i:' + i + '"><span class="who">' + charSvg(p.char) + esc(p.name) + silver + (o.win ? ' 🏆' : '') + '</span>' + cells + '<span class="pc">' + p.score + '</span><span class="fc">' + o.fp + '</span></div>';
    };
    // a big group is split over two columns, so everyone fits without scrolling
    var two = rows.length > 6, half = two ? Math.ceil(rows.length / 2) : rows.length, cols = two ? [rows.slice(0, half), rows.slice(half)] : [rows];
    box.classList.toggle('two', two);
    box.innerHTML = cols.map(function (cl, c) { return '<div class="ovcol"><div class="ovrow ovhead">' + head + '</div>' + cl.map(function (o, i) { return rowHtml(o, i + c * half); }).join('') + '</div>'; }).join('');
    // everyone has to fit on the screen, without scrolling: a big group gets a smaller header, and the table shrinks until it fits
    $('v-end').classList.toggle('ovmany', rows.length > 5);
    var fit = function () {
      if (!box.isConnected || box.classList.contains('hidden')) return;
      box.style.fontSize = '';
      var btns = $('v-end').querySelector('.endbtns'), bh = btns ? btns.offsetHeight + 34 : 90;   // (the buttons, the gap and the page's padding below the table)
      for (var f = 16; f > 8; f -= 0.5) { box.style.fontSize = f + 'px'; if (box.getBoundingClientRect().bottom + scrollY + bh <= innerHeight) break; }
    };
    fit(); setTimeout(fit, 300); setTimeout(fit, 1200);
    if (!window.__ovFit) { window.__ovFit = 1; addEventListener('resize', function () { var b = $('chaseov'); if (b && !b.classList.contains('hidden')) chaseOverview(true); }); }
  }
  function ladderGame() { return G.atype === 'mc' && G.scoring === 'ladder' && !(G.phase === 'end' && G.partLadder); }
  var ENDLESS = 9999;   // Ladder has no song limit: it runs until someone is at the top
  function ofTotal(sep) { return G.total >= ENDLESS ? '' : sep + G.total; }
  // Grand tour: the game is over when the last minigame is (with Postcard: when its last drawing and the vote are done).
  function tourOver() { return !!(G.tour && G.tourLast && !(G.gallery && (G.gallery.queue.length || G.gallery.vote))); }
  function lastSong() { return G.round >= G.total || !!(G.ladderWon && ladderGame() && (!G.partLadder || (G.partN || 0) >= G.parts)); }
  function reveal() {
    if (G.frozenLeft != null && G.phase === 'guess') { G.revealPending = true; return; }   // an item is landing: the answer waits
    if (G.phase === 'guess' && !REMOTE && G.q && G.q.type === 'mc' && list().some(function (p) { return p.pick != null; })) { showPicks(); return; }
    if (G.phase !== 'guess' && G.phase !== 'picks') return;
    clearTimeout(picksTimer);
    stopTimers(); G.phase = 'reveal'; stage = 'reveal'; G.revealAt = 0;
    // Multiple choice is scored now, from the answer each player was holding.
    // For "order" scoring the right answers are ranked by when they were put in.
    if (G.q && G.q.battle) battleCount();   // Song Battle: the vote decides which of the two was the "right" answer
    var right = G.q && G.q.type === 'mc' ? list().filter(function (p) { return p.pick === G.q.correct && !(G.draw && p.pid === G.draw.pid); })
      .sort(function (a, b) { return (a.pickMs || 0) - (b.pickMs || 0); }) : [];
    // Speed scoring on a two-clip question only starts counting when the second clip begins.
    if (G.best) {
      // Best drawing: the votes are counted, the drawing with the most gets the bonus (a tie: all of them).
      right = [];
      var tally = G.best.pids.map(function () { return 0; });
      if (G.best.ranked) list().forEach(function (p) { (p.ranks || (p.pick != null ? [p.pick] : [])).forEach(function (i, r) { if (tally[i] != null) tally[i] += RANK_PTS[r] || 0; }); });   // 12, 10, 8
      else list().forEach(function (p) { if (p.pick != null && tally[p.pick] != null) tally[p.pick]++; });
      var top = Math.max.apply(null, tally), tops = [];
      tally.forEach(function (n, i) { if (top > 0 && n === top) tops.push(i); });
      if (G.best.bpick) { battleBets(); return; }   // Song Battle: the bets are in, on to the first battle
      if (G.best.funny) { funnyPicked(tops); return; }
      if (G.best.eraPick) { eraPicked(tops); return; }
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
      if (G.best.ranked) {   // every drawing gets the points it was given; the most points wins
        G.best.pids.forEach(function (k, i) { var w = players[k]; if (!w || !tally[i]) return; w.pts = tally[i]; w.score += w.pts; w.got = tops.indexOf(i) >= 0; });
        G.q.reveal = G.q.options.map(function (o, i) { return o + '  —  ' + tally[i] + (tally[i] === 1 ? ' point' : ' points'); });
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
    if (G.clue && G.clue.st === 'ask' && G.q && !G.best && !G.draw && !G.q.battle) { clueGive(right); right = []; }   // Where the Hell Is Edgar?: no points, secret clues for a right answer
    right.forEach(function (p, rank) { p.pts = G.draw ? drawPts(p) : G.q && G.q.battle ? BATTLE_PTS : (G.q && G.q.peel ? peelPoints(p.pickMs, G.q.blur) : G.scoring === 'random' && G.qWorth ? G.qWorth : pointsFor(G.scoring === 'speed' ? 'order' : G.scoring, isPair() ? Math.max(0, p.pickMs - PAIR_CLIP * 1000) : p.pickMs, G.guessMs, rank)) * (G.tourFinal && !G.draw ? 2 : 1); if (p.halfNow) p.pts = Math.ceil(p.pts / 2); p.score += p.pts; p.got = true; cardPay(p); });   // (Limited View tickets: half points; a credit card: 2 to its owner)   // (the Grand tour's finale counts double)
    // Draw!: a point for everyone who guesses it, and a point for the artist for each of them.
    var artist = G.draw && players[G.draw.pid];
    // The artist: 12 points shared out over everyone who answered, for each of them who got it (all right: 12).
    var answered = G.draw ? list().filter(function (p) { return p.pick != null && p.pid !== G.draw.pid; }).length : 0;
    if (artist && right.length) { artist.pts = Math.max(1, Math.round(12 * right.length / Math.max(answered, right.length))); artist.score += artist.pts; artist.got = true; }
    if (G.q && G.q.battle) battlePay();
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
    else if (triviaQ()) { var ta = noClipArt(G.q); cover(true, ta[0], ta[1], false); if (G.q.flag) { $('covericon').innerHTML = flagHtml(G.q.flag); $('covertext').textContent = ''; } if (G.q.map) { $('covericon').innerHTML = mapHtml(G.q.map, G.q.dot); $('covertext').textContent = ''; } }   // Did you know?: no song at all, also not at the answer
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
      if (G.q && G.q.fast) { rate(1); quietAt = -1; yt.seekTo(clipStart, true); }   // Slow motion: the same bit once more, at its own speed
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
    if (!G.round && !G.opened && !REMOTE && !G.skipOpening) { G.opened = true; opening(startRound); return; }   // the very first thing: the show opens
    payFlush(); paper(null); peelStop();
    G.round++; G.phase = 'loading'; G.singSkips = 0; G.qWorth = 0; worthHide();
    list().forEach(function (p) { p.sitNow = ''; p.flagNow = false; p.halfNow = false; p.cardNow = ''; }); G.smoke = null; G.frozenLeft = null; G.revealPending = false; clearTimeout(freezeT);
    list().forEach(function (p) { p.got = false; p.done = false; p.pick = null; p.pts = 0; p.ranks = null; });
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
    if ((G.parts > 1 || G.eraSpin) && due && G.atype !== 'party' && !G.tourFinal) { partIntro(); return; }
    startRound2();
  }
  function startRound2() {
    G.phase = 'loading';
    // Drawings that are still waiting to be guessed come first.
    if (G.gallery && G.gallery.queue.length) { if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} } drawNext(); return; }
    if (G.gallery && G.gallery.vote && drawVote()) return;   // and to finish: which drawing was the best?
    G.gallery = null;
    if (G.battle && battleNext()) return;   // Song Battle: the next battle
    if (G.clue && clueNext()) return;   // Who Stole the Trophy?: the next clue question, or the accusation
    // Party: four quiz questions, then a Sing! or a Draw! round, then four quiz questions again, and so on
    // (Sing! only with a shared screen, and neither without at least two players).
    if (G.atype === 'party' && SHOP_START_ALL && !G.starterGiven) {   // right before the first question: every (human) player gets a bag with one of each item
      G.starterGiven = true;
      list().forEach(function (p) { if (!p.bot) p.inv = (p.inv || []).concat(SHOP_ITEMS.map(function (it) { return it.id; })); });
      FUN.starter = { icon: '🛍️', title: 'Your Eurofan bag!', sub: 'Everyone gets one of each item from the Eurofan Shop. Use them with the 🛍️ button on your phone, whenever you like.' };
      funIntro('starter', startRound2, 6500); return;
    }
    if (G.atype === 'party' && G.afterParty && G.mgBase) { mgPrize(); return; }
    if (G.atype === 'party' && G.mgTest) { G.afterParty = false; G.quizRun = Math.max(G.quizRun || 0, G.block || 3); }   // testing the party games: no trivia in between   // a party game is over: the winner goes shopping
    if (G.atype === 'party') {
      // Party: three quiz questions, then a party round, and so on. Which party round is decided by a spin
      // over the ones that are switched on (Advanced settings); the one just played sits a turn out.
      var pOn = G.partyOn || {}, two = list().filter(function (p) { return !p.off; }).length >= 2;
      var games = partyGames(pOn, two);
      G.mode = 'mc'; G.mgLive = false;
      if (G.tour && !games.length) { G.tour = false; G.total = G.round + 9; }   // no minigame can be played with this group: a plain quiz of ten
      // Grand tour: after the last minigame come three more questions, for double points and with the scores hidden.
      if (G.tour && G.tourLast && !G.tourFinal && !G.tourDone) { G.tourDone = true; G.total = G.round + (G.block || 3) - 1; G.quizRun = 0; G.mgTest = false; }   // the tour is over: one last block of trivia, then the end (the Grand Final)
      if (!G.tourFinal && (G.quizRun || 0) >= (G.block || 3) && shopOn() && !G.shopFirst && list().filter(function (p) { return !p.off; }).length >= 2) { G.shopFirst = true; G.quizRun = 0; shopIntro(); return; }   // the first break: everyone visits the boutique
      if (!G.tourFinal && !G.tourDone && (G.quizRun || 0) >= (G.block || 3) && games.length) { G.quizRun = 0; if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} } partyTime(games); return; }
      // Back from a minigame: a card says so, before the questions start again.
      if (G.afterParty) { G.afterParty = false; var nb = G.block || 3; FUN.quiz.sub = 'Trivia time: ' + (nb === 1 ? 'one question' : (['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][nb] || nb) + ' questions') + ' coming up.'; funIntro('quiz', startRound2, 4200); return; }
      if (G.eraSpin && !(G.quizRun || 0) && G.eraBlock !== G.round) { G.eraBlock = G.round; partIntro(); return; }   // Random or Voted rounds: each block of trivia gets its decade
      G.quizRun = (G.quizRun || 0) + 1;
    } else G.mode = G.atype;
    // Final "Double points": the last three questions count double and the scores are hidden until the end
    if (G.bigCard) { G.bigCard = false; G.mode = 'mc'; funIntro('bigfive', startRound2, 6000); return; }   // Big Five: five extra questions after the rounds
    var md = roundMode();
    if (!REMOTE && (md === 'sing' || md === 'draw')) { try { yt.pauseVideo(); } catch (e) {} }   // the previous song stops while the next one is chosen
    // A party round is announced first, so nobody is surprised by what is asked of them.
    var alone = { sing: singStart, draw: drawAll, quip: quipAll, bluff: bluffAll, battle: battleAll };   // (a game of only one of these)
    if (G.atype !== 'party' && alone[md] && !(md === 'sing' && REMOTE)) { funIntro(md, alone[md]); return; }
    if (G.atype === 'party' && !G.botRolled) { G.botRolled = true; botItems(); }   // bots with items may use one: 10% chance, 10% more each question they wait
    if (G.atype === 'party' && G.shopQ && G.shopQ.length) { shopDeliver(questionGo); return; }   // Eurofan Shop items used since the last question land first (then straight on to this question: it was already counted)
    questionGo();
  }
  function questionGo() {
    G.botRolled = false;
    if (G.atype === 'party' && !G.quipLoad) list().forEach(function (p) { if (p.sitout) { p.sitNow = p.sitout; p.sitout = ''; } if (p.flagged > 0) { p.flagNow = true; p.flagged--; } if (p.halfQ > 0) { p.halfNow = true; p.halfQ--; } if (p.cardQ > 0 && players[p.cardBy]) { p.cardNow = p.cardBy; p.cardQ--; } });   // (a Giant Flag: this question is blocked from view)   // a Broken Mic: this one sits out
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
    if (G.quipLoad) G.q = null; else if (!G.draw) G.q = typeNote(makeQuestion(G.song, G.subject, 'mc', playSongs(), playCountries(), { cat: G.cat, pool: G.pool, types: typesNow(), wait: G.typeWait }));
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
  // Postcard: a right guess is worth more the faster it comes (in a Party game 4 to 12 points), so it rarely ends in a tie.
  function drawPts(p) { var ms = G.barMs || drawGuessMs(), f = 1 - Math.max(0, Math.min(1, (p.pickMs || ms) / ms)); return Math.max(1, Math.round(partyX() * (1 + 2 * f))); }
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
    g.vote = true;   // at the end: 12, 10 and 8 points for the best drawings
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
  var PARTY_KINDS = ['sing', 'draw', 'quip', 'bluff', 'clue', 'bomb', 'note', 'queue'];   // (Song Battle and Beat the Favourite were taken out)
  var FUN = {
    bigfive: { icon: '🖐️', title: 'Big Five', sub: 'Five final questions, and every point counts double! The scores stay hidden until the end.' },
    bomb: { icon: '💌', title: 'The Envelope, Please', sub: 'Golden envelopes on stage: most hide a flag, one hides a bomb. Take turns to open one. Blow up and you are out; the last one standing wins!' },
    partytime: { icon: '🎉', title: 'Party round!', sub: '' },
    shop: { icon: '🛍️', title: 'Woodruff’s Boutique', sub: 'Everyone gets one free item! Use it whenever you like. From now on, win a party game to go shopping again.' },
    shopwin: { icon: '🛍️', title: 'Woodruff’s Boutique', sub: '' },
    clue: { icon: '🔍', title: 'Where the Hell Is Edgar?', sub: 'Edgar, our mascot, has been abducted! Answer trivia right for secret clues on your phone, then accuse: who took him, where is he hidden, and what is he hidden inside?' },
    queue: { icon: '🌹', title: 'Lost in Verona', sub: 'Juliet calls out the way through a hidden maze: one step, then two, then three… Tap the whole route from memory on your phone. One wrong step and you are lost. Last one left wins!' },
    note: { icon: '🎤', title: 'Hold That Note', sub: 'Technical problems! How long will the diva hold her high note this time? Guess between 10 seconds and one minute on your phone. Once she sings past your time you are out: the closest guess that is still in wins.' },
    battle: { icon: '⚔️', title: 'Song Battle', sub: 'Four songs, two semi-finals and a final. First bet on the winner, then vote for your favourite in every battle.' },
    quip: { icon: '💬', title: 'Green Room', sub: 'A song plays with a question about it. Everyone writes a funny answer on their phone. Then you all vote for the funniest one.' },
    draw: { icon: '🎨', title: 'Postcard', sub: 'Everyone picks a song and draws it on their phone. Then guess what the others drew.' },
    bluff: { icon: '🤥', title: 'Lost in Translation', sub: 'A song title in another language. Make up a translation that fools the others, then find the real one.' },
    final: { icon: '✨', title: 'Grand Final', sub: 'The last three questions: every point counts double! The scores stay hidden until the final reveal.' },
    quiz: { icon: '🎧', title: 'Trivia', sub: 'Trivia time: three questions coming up.' },
    sing: { icon: '🎤', title: 'Jury Show', sub: 'Vote for a song, listen, then record yourself singing it on your phone.' }
  };
  var funTimer = null;
  // Which party round is next. How that is decided is a setting: a spin (random), each in turn, a vote
  // by everyone, or one player (a different one each time) picks.
  function partyGo(kind, ms) {
    var starts = { sing: singStart, draw: drawAll, quip: quipAll, bluff: bluffAll, battle: battleAll, clue: clueAll, shop: shopAll, bomb: bombAll, note: noteAll, queue: qjAll };
    G.mode = G.lastParty = kind; G.best = null; G.q = null; G.afterParty = true;
    G.mgBase = kind !== 'shop' && shopOn() ? mgScores() : null; G.mgLive = kind !== 'shop';   // (items wait: no items during a party game)   // (the winner goes shopping instead of keeping the points)
    if (kind === 'quip' && !REMOTE) { greenRoom(quipAll); return; }
    if (kind === 'clue') { if (G.phase !== 'pspin') { autoStop(); stopTimers(); G.phase = 'loading'; push(); } setTimeout(function () { if (G.mode === 'clue' && !G.clue) clueAll(); }, 1000); return; }   // (a second of quiet first, so the 'Who the hell…' sting is heard clearly; then the presenters explain it in the scene)
    if (kind === 'note') { noteAll(); return; }
    if (kind === 'queue') {   // Stella needs some air first, and takes everyone outside, to Verona
      if (REMOTE) { qjAll(); return; }
      autoStop(); stopTimers(); try { yt.pauseVideo(); } catch (e) {} G.phase = 'loading'; cover(true, '', '', false); masks(true); $('cover').classList.add('funcard'); push();
      hostHold = true; clearTimeout(hostT.away);
      var l1 = 'Phew… I need a smoke. 🚬', l2 = '…I mean, some fresh air, of course! 😇 If you can all follow me outside, that would be lovely!';
      setTimeout(function () { hostSay('her', l1, 2600); }, 400);
      setTimeout(function () { hostSay('her', l2, 4800); }, 400 + Array.from(l1).length * TALK_MS + 1500);
      setTimeout(function () {
        hostHold = false; var v = $('v-game'); v.classList.remove('enter'); v.classList.add('leaving'); whooshes([0, 300, 550]);
        setTimeout(function () { v.classList.remove('leaving'); $('cover').classList.remove('funcard'); if (G.mode === 'queue') qjAll(); }, 1300);
      }, 400 + (Array.from(l1).length + Array.from(l2).length) * TALK_MS + 4600);
      return;
    }
    if (SCENES[kind] && !REMOTE) { hostScene(kind, starts[kind]); return; }   // the presenters set the scene and explain the game   // the Green Room: the presenters take us there first
    funIntro(kind, starts[kind], 8000);   // long enough to read what the minigame asks of you
  }
  // A presenter hops on screen to announce it, then the party round is chosen.
  // The party games that can be played now: switched on, and possible with this group (most need two players or more).
  function partyGames(pOn, two) {
    pOn = pOn || G.partyOn || {}; if (two == null) two = list().filter(function (p) { return !p.off; }).length >= 2;
    return PARTY_KINDS.filter(function (x) { return pOn[x] !== false && !((x === 'sing' || x === 'battle' || x === 'clue' || x === 'note' || x === 'queue') && REMOTE) && (two || (x !== 'sing' && x !== 'draw' && x !== 'battle' && x !== 'clue' && x !== 'note' && x !== 'queue' && x !== 'shop' && x !== 'bomb')); });
  }
  function partyTime(games) {
    if (REMOTE) { partyChoose(games); return; }
    studioIntro('🎉', 'Party round!', '', vary('party'), function () { partyChoose(games); }, 'partytime');
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
    G.pspin = { games: PARTY_KINDS.map(function (k) { return { kind: k, icon: FUN[k].icon, title: FUN[k].title, out: games.indexOf(k) < 0 }; }), roll: -1, done: false };
    var idx = function (k) { return PARTY_KINDS.indexOf(k); };
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, '🎉', 'Party round!', false); masks(true); $('cover').classList.add('funcard'); }
    var hops = games.length < 2 ? 0 : 16 + Math.floor(Math.random() * games.length), start = (games.indexOf(chosen) - (hops % games.length) + games.length * 8) % games.length, k = 0;   // only one left: no running light, straight to yellow and then green
    var hop = function () {
      if (G.phase !== 'pspin') return;
      G.pspin.roll = idx(games[(start + k) % games.length]); if (!REMOTE) Music.plop(k); render();
      if (k >= hops) { funTimer = setTimeout(function () { if (G.phase !== 'pspin') return; G.pspin.done = true; if (!REMOTE) Music.ding(); if (chosen === 'clue') { clueSting(); G.clueSting = true; } push(); funTimer = setTimeout(function () { if (G.phase !== 'pspin') return; G.pspin = null; then(); }, 1300); }, LAND); return; }   // the light lands on the winner first, then that tile turns green
      k++; funTimer = setTimeout(hop, 70 + Math.pow(k / hops, 2.4) * 520);
    };
    push(); clearTimeout(funTimer); funTimer = setTimeout(hop, 2200);   // a moment to take in the cards before the light starts running
  }
  function funIntro(kind, then, ms) {
    var f = FUN[kind];
    G.fun = { kind: kind, icon: f.icon, title: f.title, sub: f.sub, plain: kind === 'quiz' || kind === 'final' || kind === 'bigfive' || kind === 'starter' || kind === 'shopgo' || kind === 'partytime' };
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
  // The eras of the Era setting (all four when nothing is narrowed): Random and Voted rounds pick from these.
  var ERA_GROUPS = [['1956-1979', '1956 – 1979'], ['1980-1999', '1980 – 1999'], ['2000-2012', '2000 – 2012'], ['2013-2100', '2013 – now']];
  function eraList() { var sel = G.era && G.era !== '1956-2100' && G.era !== 'spin' ? String(G.era).split(',') : ERA_GROUPS.map(function (g) { return g[0]; }); var l = ERA_GROUPS.filter(function (g) { return sel.indexOf(g[0]) >= 0; }); return l.length ? l : ERA_GROUPS; }
  var ERAS = ERA_GROUPS;
  var partTimer = null;
  function partIntro() {
    G.partDone = G.partDone || {}; G.partDone[G.round] = 1;
    // every round starts from 0 on the scoreboard; what was scored before is kept aside and added up after the last round
    if ((G.partN || 0) >= 1 && !G.partLadder && !ladderGame()) {
      var best = Math.max.apply(null, list().map(function (p) { return p.score; }));   // the winner of the round just played wears a crown in the next one
      list().forEach(function (p) { p.rcrown = best > 0 && p.score === best; p.qbank = (p.qbank || 0) + p.score; p.score = 0; });
    }
    list().forEach(function (p) { p.rs = p.score; });   // the round summary shows what was scored from here
    G.partNext = false; G.partN = (G.partN || 0) + 1; G.partStart = G.round;
    var n = G.partN;
    G.part = { n: n, of: G.parts, eras: null, roll: -1, done: false, label: '' };
    G.phase = 'part'; G.barMs = 0;
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} cover(true, String(n), G.parts > 1 ? 'Round ' + n + ' of ' + G.parts : 'Spinning the era', false); masks(true); }
    var go = function () { if (G.phase !== 'part') return; startRound2(); };
    if (!G.eraSpin) { push(); clearTimeout(partTimer); partTimer = setTimeout(go, 3200); return; }
    // Which decades are still in the draw: inside the Era setting, not played yet in this game, and with enough songs.
    var inSel = function (e) { return poolFor(poolFor(playSongs(), G.era === 'spin' ? '1956-2100' : G.era, G.cat), e[0], 'all').length; };
    var ok = function (e) { return inSel(e) >= Math.max(4, Math.min(G.per, 8)); };
    ERAS = eraList();   // (a played era stays greyed out until every era has had its turn)
    var open = []; ERAS.forEach(function (e, i) { if (G.eraUsed.indexOf(i) < 0 && ok(e)) open.push(i); });
    if (!open.length) { G.eraUsed = []; ERAS.forEach(function (e, i) { if (ok(e)) open.push(i); }); }   // all played: everything is back in
    if (!open.length) { G.eraNow = ''; buildPool(); push(); partTimer = setTimeout(go, 2000); return; }   // a selection too thin to split up
    G.part.eras = ERAS.map(function (e, i) { return { label: e[1], out: open.indexOf(i) < 0 }; });
    if (G.eraVote && open.length > 1) { eraVote(open, n); return; }   // Voted rounds: the phones choose
    push(); clearTimeout(partTimer); partTimer = setTimeout(function () { eraSpinAmong(open, pick(open), n); }, 1400);
  }
  // The spin over the decades that are in the draw; it lands on the chosen one.
  function eraSpinAmong(open, chosen, n) {
    var go = function () { if (G.phase !== 'part') return; startRound2(); };
    G.phase = 'part'; G.part.roll = -1; G.part.done = false;
    var hops = open.length < 2 ? 0 : 18 + Math.floor(Math.random() * open.length), start = (open.indexOf(chosen) - (hops % open.length) + open.length * 8) % open.length, k = 0;
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
    push(); clearTimeout(partTimer); hop();
  }
  // Voted rounds: everyone votes on their phone for the decade of the next round; a tie is settled by the spin.
  function eraVote(open, n) {
    stopTimers(); G.draw = null; G.song = null; G.clip = null;
    G.best = { pick: true, eraPick: true, open: open, n: n, pids: open.map(function () { return null; }), id: 'era' + G.round, tally: null, wins: null };
    G.q = { subject: 'pick', type: 'mc', text: 'Vote: which era for round ' + n + (G.parts > 1 ? ' of ' + G.parts : '') + '?', hint: '', options: open.map(function (i) { return ERAS[i][1]; }), correct: -1, answer: '', noclip: true };
    if (!REMOTE) { cover(true, '🗳️', 'Vote for the era', false); masks(true); $('cover').classList.add('funcard'); stageEl().classList.add('novideo'); }
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = PICK_MS; G.endsAt = Date.now() + PICK_MS; push();
    endTimer = setTimeout(reveal, PICK_MS);
  }
  function eraPicked(tops) {
    var b = G.best, cands = tops.length ? tops.map(function (i) { return b.open[i]; }) : b.open;
    clearTimeout(picksTimer); stopTimers();
    list().forEach(function (p) { p.pick = null; });
    G.best = null; G.q = null; if (!REMOTE) $('cover').classList.remove('funcard');
    eraSpinAmong(cands, pick(cands), b.n);
  }

  // ---------- Song Battle ----------
  // Four songs in a knockout: two semi-finals and a final. First everyone bets on the song that will win; then
  // each battle plays its two songs one after the other (like a two-clip question) and everyone votes for their
  // favourite. Voting with the room scores a few points, and a right bet scores twelve at the end.
  var BATTLE_PTS = 4, BATTLE_BET = 12, BET_MS = 20000;
  function battleLab(s) { return s[3] + ' – ' + s[2]; }
  function battleFresh(n, not) {
    var ok = function (s) { return !BAD_VIDEOS[s[4]] && not.indexOf(s) < 0; };
    var c = shuffle(G.pool.filter(function (s) { return ok(s) && !G.used[s[4]]; }));
    if (c.length < n) c = shuffle(G.pool.filter(ok));
    return c.slice(0, n);
  }
  function battleAll() {
    var four = battleFresh(4, []);
    if (four.length < 4 || REMOTE) { G.battle = null; quipAll(); return; }   // too few songs in this selection: a Green Room instead
    four.forEach(function (s) { G.used[s[4]] = 1; });
    G.battle = { songs: four, step: 0, wins: [], bets: {} }; G.battleQ = null;
    if (G.atype === 'party' && G.total < ENDLESS) G.total += 2;   // three battles in the place of one song
    stopTimers(); G.draw = null; G.song = null; G.clip = null; G.quipLoad = false; G.quips = null;
    G.best = { pick: true, bpick: true, pids: four.map(function () { return null; }), id: 'bet' + G.round, tally: null, wins: null };
    G.q = { subject: 'battle', type: 'mc', text: 'Place your bets: which of these four will win the Song Battle?', hint: '', options: four.map(function (s) { return battleLab(s) + ' · ' + s[0]; }), correct: -1, answer: '', noclip: true };
    cover(true, '⚔️', 'Song Battle', false); masks(true); $('cover').classList.add('funcard'); stageEl().classList.add('novideo');
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = BET_MS; G.endsAt = Date.now() + BET_MS; push();
    endTimer = setTimeout(reveal, BET_MS);
  }
  // The bets are in (called from the answer): remember them and start the first semi-final.
  function battleBets() {
    clearTimeout(picksTimer); stopTimers();
    list().forEach(function (p) { if (p.pick != null) G.battle.bets[p.pid] = p.pick; p.pick = null; });
    G.best = null; G.q = null; $('cover').classList.remove('funcard');
    battleLoad();
  }
  function battlePair() { var b = G.battle; return b.step === 0 ? [0, 1] : b.step === 1 ? [2, 3] : [b.wins[0], b.wins[1]]; }
  function battleLoad() {
    var b = G.battle, ix = battlePair(), pr = [b.songs[ix[0]], b.songs[ix[1]]], name = b.step === 2 ? 'The final' : 'Semi-final ' + (b.step + 1);
    G.battleQ = { subject: 'battle', battle: true, type: 'mc', hint: '', pair: pr, ix: ix, correct: 0, answer: '',
      text: name + ': which song gets your vote?', options: pr.map(battleLab) };
    G.best = null; G.draw = null; G.quipLoad = false; G.phase = 'loading'; push();
    loadSong(pr[0]);
  }
  // A song of this battle will not play: another one takes its place (in the final: the same two again).
  function battleFix() {
    var b = G.battle, ix = battlePair(), done = false;
    if (b.step < 2) ix.forEach(function (i) { if (BAD_VIDEOS[b.songs[i][4]]) { var f = battleFresh(1, b.songs)[0]; if (f) { b.songs[i] = f; G.used[f[4]] = 1; done = true; } } });
    if (!done && b.step < 2) { var f2 = battleFresh(1, b.songs)[0]; if (f2) { b.songs[ix[0]] = f2; G.used[f2[4]] = 1; } }
    battleLoad();
  }
  // The votes of a battle are counted (just before the answer): the song with the most goes through. A tie is tossed.
  function battleCount() {
    var q = G.q, b = G.battle, n = [0, 0];
    list().forEach(function (p) { if (p.pick === 0 || p.pick === 1) n[p.pick]++; });
    var tie = n[0] === n[1], w = tie ? (Math.random() < 0.5 ? 0 : 1) : n[0] > n[1] ? 0 : 1, win = q.pair[w];
    q.correct = w; q.answer = q.options[w]; G.song = win; b.wins[b.step] = q.ix[w]; q.votes = n;
    q.reveal = q.pair.map(function (s, i) { return battleLab(s) + ' · ' + s[0] + ' · ' + n[i] + (n[i] === 1 ? ' vote' : ' votes'); });
    q.explain = (b.step === 2 ? '🏆 The winner of the Song Battle: ' : 'Through to the final: ') + battleLab(win) + (tie ? ' (a tie, decided by the toss of a coin).' : '.');
  }
  // After the final: twelve points for everyone who bet on the winner.
  function battlePay() {
    var b = G.battle; if (!b || b.step !== 2) return;
    var champ = b.wins[2], lucky = [];
    list().forEach(function (p) { if (b.bets[p.pid] === champ) { p.pts = (p.pts || 0) + BATTLE_BET; p.score += BATTLE_BET; p.got = true; lucky.push(p.name); } });
    G.q.explain += lucky.length ? ' ' + BATTLE_BET + ' points for the right bet: ' + lucky.join(', ') + '.' : ' Nobody bet on it.';
  }
  // Called when the next song would start: the next battle, or (after the final) back to the game.
  function battleNext() {
    var b = G.battle; G.battleQ = null;
    if (!b || b.step >= 2) { G.battle = null; return false; }
    b.step++; battleLoad(); return true;
  }

  // ---------- The Grand Final ----------
  // The end of the game, like a horror-movie chase: every player has a lane, the Diva comes from the left and the
  // trophy waits on the right, twenty spaces on. The player with the fewest points starts on space 1, the others
  // further ahead by their score. Each question has three songs, any number of which fit; you move one space for
  // each song you judge right. After everyone has moved, the Diva moves (faster as it goes on), and whoever she
  // reaches is caught. The first to reach the trophy wins the game.
  var CHASE_END = 20, CHASE_GOAL = 21, CHASE_ASK = 8000,   // twenty spaces of runway; the stage is one step beyond the last
  chaseTimer = null, chaseBuilt = '';
  // The monster of the chase, and her song, which loops in the background (from YouTube, like every other song in
  // the game). More monsters can be added here; one is picked at random for each chase.
  var CHASE_MONSTERS = [{ id: 'diva', name: 'The Diva', her: 'her', song: 'Vul5zgC5Yvg' }, { id: 'goblin', name: 'The Neon Goblin', her: 'him', song: 'rNrgQm5z07U' }, { id: 'phoenix', name: 'The Phoenix Queen', her: 'her', song: 'QRUIava4WRM', cry: 'Rise like a phoenix!' }], chaseLoop = null;
  function mName() { return G.chase && G.chase.monster ? G.chase.monster.name : 'The Diva'; }
  function chaseMusic(on) {
    clearInterval(chaseLoop); chaseLoop = null;
    if (!on) { try { yt.stopVideo(); } catch (e) {} return; }
    var id = G.chase && G.chase.monster && G.chase.monster.song; if (!id) return;
    try { stage = 'chase'; yt.unMute(); yt.setVolume(55); yt.loadVideoById({ videoId: id, startSeconds: 0 }); } catch (e) {}
    chaseLoop = setInterval(function () {
      if (G.phase !== 'chase') { chaseMusic(false); return; }
      try { var st = yt.getPlayerState(); if (st === 0) { yt.seekTo(0, true); yt.playVideo(); } else if (st === 2 || st === 5) yt.playVideo(); } catch (e) {}
    }, 1000);
  }
  // Sound files for the chase (the rest of its sounds are made on the spot). Loaded once, played from the start each time.
  var CHASE_SFX = { brk: 'sounds/stage_break.mp3?v=1' }, chaseSfxEl = {};
  function chaseSfx(k, vol, fallback) {
    try {
      var a = chaseSfxEl[k] || (chaseSfxEl[k] = new Audio(CHASE_SFX[k])); a.volume = Math.max(0, Math.min(1, (vol == null ? 1 : vol) * (Music.vol ? Music.vol.fx : 1)));
      a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () { if (fallback) fallback(); });
    } catch (e) { if (fallback) fallback(); }
  }
  function chaseSpot(src) {   // a fresh copy each time, so the clunks can overlap
    try { var a = new Audio(src || 'sounds/spotlight.mp3?v=1'); a.volume = Math.max(0, Math.min(1, 0.8 * (Music.vol ? Music.vol.fx : 1))); var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  // The way in: the lights go out on the quiz, a line in the dark, then the chase opens up from a growing circle.
  var CHASE_ENTER = 5400, CHASE_BUILD = 9200;
  // The audience: fans on both sides of the runway, jumping, dancing and waving, made up afresh for every chase.
  var FAN_COLS = ['#ff2fa8', '#ffd23f', '#2fd3ff', '#9b5cff', '#3dff9a', '#ff7a2f', '#ff4d6d', '#ffffff'];
  function fanSvg(front) {
    var r = function (a, b) { return a + Math.random() * (b - a); }, col = FAN_COLS[Math.floor(Math.random() * FAN_COLS.length)], body = front ? '#2e1a4d' : '#3b2363';
    var pose = Math.floor(Math.random() * 4), held = Math.random() < 0.35 ? FAN_COLS[Math.floor(Math.random() * FAN_COLS.length)] : '';
    // arms: both up in a V, one up, waving overhead, or clapping
    var arms = pose === 0 ? '<path class="arm l" d="M15 30 L6 10"/><path class="arm r" d="M25 30 L34 10"/>' : pose === 1 ? '<path class="arm l" d="M15 30 L9 44"/><path class="arm r" d="M25 30 L33 8"/>' : pose === 2 ? '<path class="arm l" d="M15 30 L10 8"/><path class="arm r" d="M25 30 L30 8"/>' : '<path class="arm l" d="M15 30 L17 20"/><path class="arm r" d="M25 30 L23 20"/>';
    var flag = held ? (pose === 1 ? '<rect class="flag" x="33" y="2" width="11" height="7" rx="1" fill="' + held + '"/>' : pose === 0 ? '<circle class="stick" cx="34" cy="9" r="2.6" fill="' + held + '"/><circle class="stick" cx="6" cy="9" r="2.6" fill="' + held + '"/>' : '') : '';
    return '<svg class="fan p' + pose + '" viewBox="0 0 40 80" style="--d:' + r(0.45, 0.8).toFixed(2) + 's;--dl:-' + r(0, 1).toFixed(2) + 's;--s:' + r(0.85, 1.15).toFixed(2) + ';--h:' + r(4, 12).toFixed(0) + 'px">' +
      '<g stroke="' + body + '" stroke-width="5" stroke-linecap="round" fill="none">' + arms + '</g>' + flag +
      '<circle cx="20" cy="14" r="7.5" fill="' + body + '"/><path d="M12 26 Q20 21 28 26 L30 80 L10 80 Z" fill="' + body + '"/>' +
      '<path d="M12 26 Q20 21 28 26 L28.6 40 L11.4 40 Z" fill="' + col + '" opacity="' + (front ? '.85' : '.7') + '"/></svg>';
  }
  function chaseCrowd() {
    var v = $('chview'); [].forEach.call(v.querySelectorAll('.chcrowd'), function (e) { e.remove(); });
    var back = document.createElement('div'); back.className = 'chcrowd back';
    var front = document.createElement('div'); front.className = 'chcrowd front';
    // a few rows deep, packed together; the far rows smaller and darker
    var rows = function (el, spec, front) { el.innerHTML = spec.map(function (n, r) { var h = ''; for (var i = 0; i < n; i++) h += fanSvg(front); return '<div class="crow r' + r + '">' + h + '</div>'; }).join(''); };
    rows(back, [34, 30, 26], false); rows(front, [17, 14], true);
    v.insertBefore(back, v.firstChild); v.appendChild(front);
  }
  function chaseEnter() {
    var bk = $('chblack');
    if (!bk) { bk = document.createElement('div'); bk.id = 'chblack'; bk.className = 'chblack'; document.body.appendChild(bk); }
    bk.innerHTML = '<div><b>But wait…</b><span>the trophy has not been won yet.</span></div>';
    bk.classList.remove('gone'); bk.classList.add('on');
    Music.dread(true);
    // then the scene is built up: first the background, then the stage moves in, then the runway slides in, then the fans come in (in the dark), then the lights
    chaseCrowd();
    var ch = $('chase'); ch.classList.add('nostage', 'norunway', 'nolights', 'nocrowd', 'nofire');
    setTimeout(function () { bk.classList.add('gone'); bk.classList.remove('on'); }, CHASE_ENTER - 400);
    setTimeout(function () { ch.classList.remove('nostage'); Music.woosh(); }, CHASE_ENTER + 700);
    setTimeout(function () { ch.classList.remove('norunway'); Music.woosh(); }, CHASE_ENTER + 1700);
    [].forEach.call(ch.querySelectorAll('.lit'), function (e) { e.classList.remove('lit'); });
    // the lights pop on one by one, each with a spotlight clunk: the four beams, then the stage and the trophy
    var beams = [].slice.call(ch.querySelectorAll('.chbeams')), lights = [3, 2, 1, 0].map(function (k) { return beams.map(function (b) { return b.children[k]; }); });   // each beam, with its glow over the stage
    lights.push([].slice.call(ch.querySelectorAll('.chstg-floor,.chstg-ring,.chtro')));
    lights.forEach(function (els, i) { setTimeout(function () { els.forEach(function (e) { e.classList.add('lit'); }); chaseSpot(); }, CHASE_ENTER + 4000 + i * 420); });
    setTimeout(function () { ch.classList.remove('nolights'); }, CHASE_ENTER + 4000 + (lights.length - 1) * 420 + 150);   // the crowd brightens with the last light
    setTimeout(function () { ch.classList.remove('nofire'); [].forEach.call(ch.querySelectorAll('.chpyro'), function (e) { e.classList.remove('ign'); void e.offsetWidth; e.classList.add('ign'); }); }, CHASE_ENTER + 4000 + (lights.length - 1) * 420 + 2000);
    setTimeout(function () { chaseSpot('sounds/fire.mp3?v=1'); }, CHASE_ENTER + 4000 + (lights.length - 1) * 420 + 1700);   // the whoosh starts a little early, so the burst lands on it   // two seconds after the last light, the flames burst up
    setTimeout(function () { ch.classList.remove('nocrowd'); Music.woosh(); }, CHASE_ENTER + 2800);   // the fans come in, still in the dark
  }
  function chaseWanted() { return !REMOTE && G.finalMode === 'chase' && !(G.chase && G.chase.done) && list().length > 0; }
  function chaseStart(test, face) {
    autoStop(); stopTimers(); clearTimeout(chaseTimer); try { yt.pauseVideo(); } catch (e) {} yt2.pause(); cover(true, '', '', false);
    var ps = list().filter(function (p) { return !p.off; }); if (!ps.length) ps = list();
    // Starting spaces: the lowest score on space 1, the highest four spaces ahead (two with fewer than four players),
  // everyone else in between by their score.
    // (A test chase makes up scores, in steps of the usual 12 points.)
    var sc = ps.map(function (p) { return face ? 60 : test ? 12 * Math.floor(Math.random() * 15) : p.score; }), lo = Math.min.apply(null, sc), hi = Math.max.apply(null, sc);
    var lanes = {}, scores = {}; ps.forEach(function (p, i) { scores[p.pid] = sc[i]; lanes[p.pid] = { pos: 1 + (hi > lo ? Math.round((ps.length < 4 ? 2 : 4) * (sc[i] - lo) / (hi - lo)) : 0), out: false, res: null, mask: 0, lock: false, touched: false, at: 0 }; });
    // Ice Skates in the bag: they glide 2 spaces ahead (every pair counts), and the skates are used up
    var perks = [];   // (announced once everyone is ready: first the broken heels, then the ice skates)
    (G.heels || []).forEach(function (h) { if (lanes[h.to] && players[h.by]) perks.push({ kind: 'heel', by: h.by, to: h.to }); }); G.heels = [];
    ps.forEach(function (p) { var n = (p.inv || []).filter(function (id) { return id === 'skates'; }).length; if (n) perks.push({ kind: 'skates', pid: p.pid, n: 2 * n }); });
    list().forEach(function (p) { p.inv = []; p.uses = {}; });   // in the Grand Final nobody has any items left
    // they are put on the runway one by one, half a second apart, the lowest score first
    var placeOrder = ps.map(function (p) { return p.pid; }).sort(function (a, b) { return scores[a] - scores[b]; });
    G.chase = { monster: pick(CHASE_MONSTERS), key: Math.random().toString(36).slice(2, 7), st: 'intro', n: 0, lanes: lanes, order: ps.map(function (p) { return p.pid; }), mon: 0, q: null, qkey: '', endsAt: 0, used: {}, test: !!test, win: null, done: false, scores: scores, placeOrder: placeOrder, placed: 0, perks: perks };
    G.phase = 'chase'; G.barMs = 0; chaseBuilt = '';
    G.chase.enterAt = Date.now() + CHASE_ENTER - 600; G.chase.builtAt = Date.now() + CHASE_ENTER + CHASE_BUILD; chaseEnter();
    // the monster starts hidden (no fade-out from the last chase), dressed as this chase's monster
    var mon = $('chmon'); mon.classList.remove('rise', 'defeat', 'hungry', 'sleep'); mon.classList.add('lurk'); mon.setAttribute('data-mon', G.chase.monster.id);
    Object.keys(CHASE_SFX).forEach(function (k) { if (!chaseSfxEl[k]) { chaseSfxEl[k] = new Audio(CHASE_SFX[k]); chaseSfxEl[k].preload = 'auto'; } });
    Music.want(false); Music.dread(true);
    push();
    // first a message in the middle, then it moves up and the jury votes are counted
    chaseTimer = setTimeout(function () { var c2 = G.chase; if (!c2 || c2.st !== 'intro') return; c2.introTop = true; push(); chaseTimer = setTimeout(chaseIntroNext, 1100); }, 6200 + CHASE_ENTER + CHASE_BUILD);
  }
  // The start: one by one, lowest score first, each player is shown big in the middle while their jury votes count up
  // to their score; then they take their place on the runway. When all are on it, the Diva rises from the smoke.
  var chaseCount = null;
  function chaseIntroNext() {
    var c = G.chase; if (!c || G.phase !== 'chase' || c.st !== 'intro') return;
    clearInterval(chaseCount);
    if (c.placed >= c.placeOrder.length) {
      // a wheel with the monsters, an arrow spins in the middle and picks the one that chases (the pick was made at the start)
      c.showing = null;
      var toPre = function () { c.st = 'pre'; push(); chaseTimer = setTimeout(function () { if (G.chase === c && c.st === 'pre') chaseSpin(c); }, 3000); };
      if (c.perks && c.perks.length && !c.perked) { c.perked = true; chasePerks(c, toPre); return; }   // first the secrets: broken heels, ice skates
      toPre();
      return;
    }
    function chaseSpin(c) {
      c.st = 'wheel'; c.wheelAt = Date.now(); push();
      var turns = 0, gaps = [];
      for (var g = 60; turns < 4200; g *= 1.09) { gaps.push(g); turns += g; }
      var tk = 1500; /* the wheel shows for 1.5 seconds before the arrow starts */ gaps.forEach(function (g) { tk += g; setTimeout(function () { if (G.chase === c && c.st === 'wheel') Music.plop(3, 0.5); }, tk); });
      chaseTimer = setTimeout(function () {
        if (G.chase !== c || c.st !== 'wheel') return;
        Music.ding(); c.landed = true; push();   // the chosen slice lights up for two seconds
        chaseTimer = setTimeout(function () {
          if (G.chase !== c) return;
          chaseSfx('brk', 0.9, Music.crumble); chaseReady(c);   /* the monster rises */   // the monster rises; the same screen asks everyone to press Ready
        }, 2200);
      }, 6000);
    }
    var k = c.placeOrder[c.placed], total = c.scores[k] || 0, steps = Math.max(1, Math.min(40, total)), i = 0;
    c.showing = k; c.count = 0; c.counted = false; push();
    var card = function () { var el = $('chcount'); if (el) el.textContent = c.count; };
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { if (G.chase !== c || c.st !== 'intro') return; chaseCount = setInterval(countStep, Math.max(25, Math.min(60, 1300 / steps))); }, 1000);   // a second on 0 first
    var countStep = function () {
      if (!G.chase || G.chase !== c) { clearInterval(chaseCount); return; }
      i++; c.count = Math.round(total * i / steps); card();
      if (i % 2 === 0 || i === steps) Music.ping(i, steps);
      if (i >= steps) {
        clearInterval(chaseCount); c.counted = true; Music.ding(); push();
        chaseTimer = setTimeout(function () {
          if (G.chase !== c || c.st !== 'intro') return;
          c.placed++; c.showing = null; Music.plop(c.placed); push();
          chaseTimer = setTimeout(chaseIntroNext, 650);
        }, 1100);
      }
    };
  }
  // The Diva sleeps through the first two questions, then comes: one space a turn for three questions, then two a turn.
  function divaStep(n) { return n <= 2 ? 0 : n <= 5 ? 1 : 2; }
  function chaseNear() { var c = G.chase; return chaseAlive().filter(function (k) { return c.lanes[k].pos >= CHASE_GOAL - 3; }); }
  // who answers now: everyone still running, or (in a sudden death on the stage) the finalists still standing
  function chaseActive() { var c = G.chase; return c.sd ? c.finals.filter(function (k) { return c.lanes[k] && !c.lanes[k].fell; }) : chaseAlive(); }
  // The chase asks about all the selected eras (and entries), whatever era the last round had
  function chasePool() { var p = poolFor(playSongs(), $('s-era').value || '1956-2100', $('s-cat').value || 'all'); return p.length >= 60 ? p : playSongs(); }
  function chaseAlive() { var c = G.chase; return c.order.filter(function (k) { return c.lanes[k] && !c.lanes[k].out; }); }
  function chaseAsk() {
    var c = G.chase; if (!c || G.phase !== 'chase') return;
    c.n++; var cp = chasePool(); c.q = makeChase(cp, playCountries(), c.used) || makeChase(cp, playCountries(), {});
    c.q.items.forEach(function (it) { c.used[it.id] = 1; });
    c.qkey = c.key + '-' + c.n; c.st = 'ask'; c.endsAt = Date.now() + CHASE_ASK;
    chaseActive().forEach(function (k) { var l = c.lanes[k]; l.res = null; l.mask = 0; l.lock = false; l.touched = false; });
    // test bots: a random answer after a few seconds, each song judged right a bit more often than not
    chaseActive().forEach(function (k) { if (!players[k] || !players[k].bot) return; var qk = c.qkey;
      setTimeout(function () { if (!G.chase || G.chase.qkey !== qk || G.chase.st !== 'ask') return; var m = 0; c.q.items.forEach(function (it, i) { var right = Math.random() < (c.face ? (c.sd ? 0.55 : 1) : (window.CHASE_SMART || 0.62));   /* face-off test: perfect until the stage, then a coin toss */ if (it.ok === right) m |= 1 << i; }); H.chase({ pid: k, key: qk, mask: m, lock: true }); }, 1500 + Math.random() * 5000); });
    push();
    clearTimeout(chaseTimer); chaseTimer = setTimeout(chaseScore, CHASE_ASK + 300);
  }
  // Before the first question: everyone presses Ready on their phone (test bots after three seconds).
  function chaseReady(c) {
    if (G.chase !== c) return;
    c.st = 'ready'; c.ready = {}; c.msgAt = Date.now() + 2000; c.readyEnds = Date.now() + 62000; push();   // two seconds of the monster alone, then the message
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { if (G.chase === c && c.st === 'ready') chaseGo(c); }, 62000);   // a minute at most, ready or not
    chaseAlive().forEach(function (k) { if (players[k] && players[k].bot) setTimeout(function () { chaseMsg({ pid: k, key: c.key + '-r', ready: 1 }); }, 5000); });
  }
  function chaseGo(c) {
    c.st = 'go'; chaseMusic(true); push(); clearTimeout(chaseTimer); chaseTimer = setTimeout(chaseAsk, 2500);
  }
  // Before the first question: the secrets come out. Who got a broken heel from whom (unless an umbrella blocks it),
  // then who has ice skates (they glide forward right then).
  var PERK_MS = 5200;
  var iceEl = null;
  function iceSnd() { if (REMOTE) return; try { if (!iceEl) iceEl = new Audio('sounds/ice.mp3'); iceEl.currentTime = 0; iceEl.volume = Math.max(0, Math.min(1, 0.9 * (Music.vol ? Music.vol.fx : 1))); var pr = iceEl.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  var boneEl = null;
  function boneCrack() { if (REMOTE) return; try { if (!boneEl) boneEl = new Audio('sounds/bone_crack.mp3'); boneEl.currentTime = 0; boneEl.volume = Math.max(0, Math.min(1, 0.9 * (Music.vol ? Music.vol.fx : 1))); var pr = boneEl.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  function chasePerks(c, done) {
    var list0 = c.perks.filter(function (x) { return x.kind === 'heel'; }).concat(c.perks.filter(function (x) { return x.kind === 'skates'; }));
    var step = function (i) {
      if (G.chase !== c) return;
      if (i >= list0.length) { c.perk = null; done(); return; }
      var x = list0[i], l;
      if (x.kind === 'heel') {
        var t = players[x.to];
        x.blocked = false; if ((l = c.lanes[x.to])) l.heel = x.by;   // (an umbrella does not help against a broken heel)
        boneCrack();
      } else if ((l = c.lanes[x.pid])) { l.pos = Math.min(CHASE_END, l.pos + x.n); l.skates = (l.skates || 0) + x.n; iceSnd(); }
      c.st = 'perk'; c.perk = x; push();
      clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { step(i + 1); }, PERK_MS);
    };
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { step(0); }, 1000);   // (a moment after everyone is on the runway)
  }
  function chaseMsg(m) {
    var c = G.chase; if (!c || G.phase !== 'chase') return;
    if (m.ready) {
      if (c.st !== 'ready' || m.key !== c.key + '-r' || !c.lanes[m.pid] || c.ready[m.pid]) return;
      c.ready[m.pid] = 1; Music.plop(Object.keys(c.ready).length); push();
      if (chaseAlive().every(function (k) { return c.ready[k]; })) chaseGo(c);   // everyone is ready: the monster's song starts
      return;
    }
    if (c.st !== 'ask' || m.key !== c.qkey) return;
    var l = c.lanes[m.pid]; if (!l || l.out || l.lock || chaseActive().indexOf(m.pid) < 0) return;
    l.mask = (m.mask | 0) & 7; l.touched = true;   // (no locking in: whatever is ticked when the time is up counts)
    push();
  }
  net.on('chase', chaseMsg);
  function chaseScore() {
    var c = G.chase; if (!c || c.st !== 'ask') return;
    c.st = 'show';
    chaseActive().forEach(function (k) { var l = c.lanes[k]; l.res = !l.touched ? 0 : c.q.items.reduce(function (n, it, i) { return n + ((((l.mask >> i) & 1) === 1) === it.ok ? 1 : 0); }, 0); l.fp = (l.fp || 0) + l.res; });   // (a point per right answer, for the overview at the end)
    Music.soft(); push();
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { if (G.chase !== c || c.st !== 'show') return; c.st = 'pause'; push(); chaseTimer = setTimeout(chaseMove, 1000); }, 3000);   // the answers go, a second's pause, then everyone moves
  }
  function chaseMove() {
    var c = G.chase; if (!c) return;
    if (c.sd) { chaseSdMove(); return; }
    c.st = 'move';
    // Only a perfect answer (all three right) takes the trophy: anything less stops at the last space.
    chaseAlive().forEach(function (k) { var l = c.lanes[k], to = l.pos + (l.res || 0); l.blocked = 0;
      if (l.heel && !l.heelAt) { l.heelAt = c.n; to = l.pos; }   // a broken heel: no step this time, whatever they answered
      if (to >= CHASE_GOAL && l.res < 3) { to = CHASE_END; l.blocked = c.n; /* not perfect: they bump into the stage and fall back onto the last space */ } l.pos = Math.max(l.pos, to); });
    if (chaseAlive().some(function (k) { return c.lanes[k].res > 0; })) Music.woosh();
    if (chaseAlive().some(function (k) { return c.lanes[k].blocked === c.n; })) setTimeout(function () { if (G.phase === 'chase') Music.buzz(); }, 650);   // in front of the stage, but not perfect
    push();
    var home = chaseAlive().filter(function (k) { return c.lanes[k].pos >= CHASE_GOAL; });
    if (home.length) { clearTimeout(chaseTimer); chaseTimer = setTimeout(function () { if (home.length > 1) chaseFinal(home); else chaseWin(home); }, 1400); return; }
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () {
      // the Diva moves: one space at first, two from the fifth question, three from the tenth
      var before = chaseAlive();
      var stepN = divaStep(c.n); c.mon += stepN; c.st = 'diva'; c.coming = c.n === 2;
      var caught = before.filter(function (k) { return c.lanes[k].pos <= c.mon; });
      caught.forEach(function (k) { c.lanes[k].out = true; c.lanes[k].at = c.n; });
      push();
      if (stepN) chaseSfx('brk', 0.9, Music.crumble);
      if (caught.length) setTimeout(function () { if (G.phase === 'chase') { Music.chomp(); Music.scream(); } }, 900);
      chaseTimer = setTimeout(function () {
        if (!chaseAlive().length) { chaseMonsterWins(c); return; }   // everyone caught: the monster takes the trophy
        if (chaseAlive().length && caught.length) Music.dread(true, true);   // getting tight: the heart beats faster
        // someone has come within reach of the stage: a big message for five seconds, then the next question
        var fresh = c.nearShown ? [] : chaseNear();   // (only the first time anyone gets close)
        if (fresh.length) { c.nearShown = true; c.nearNew = fresh; c.st = 'near'; Music.ding(); push(); chaseTimer = setTimeout(chaseAsk, 5000); return; }
        chaseAsk();
      }, caught.length || c.coming ? 2800 : stepN ? 1600 : 400);
    }, 1500);
  }
  // Two or more reach the stage at once: the monster goes down, they all walk up to the trophy, and a sudden death
  // decides: the same kind of questions, and whoever gets fewer right than the best falls off the stage.
  function chaseFinal(home) {
    var c = G.chase; if (!c) return;
    c.sd = true; c.finals = home.slice(); c.st = 'fdie'; c.wreckWarn = true; Music.buzz(); push();   // the runway is marked, then smashed
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () {
      if (G.chase !== c) return;
      chaseWreck(c);
      chaseTimer = setTimeout(sdDie, 1900);
    }, 2000);
    var sdDie = function () {
      if (G.chase !== c) return;
      chaseDie(c);   // then the monster goes down
      chaseTimer = setTimeout(function () {
        if (G.chase !== c) return;
        c.st = 'fmsg'; Music.douze(); push();
        chaseTimer = setTimeout(chaseAsk, 5500);
      }, 2300);
    };
  }
  function chaseSdMove() {
    var c = G.chase, act = chaseActive(), best = Math.max.apply(null, act.map(function (k) { return c.lanes[k].res || 0; }));
    var losers = act.filter(function (k) { return (c.lanes[k].res || 0) < best; }), stay = act.filter(function (k) { return losers.indexOf(k) < 0; });
    c.sdLost = losers; c.st = 'sdres'; push();
    // whoever is still standing walks over and pushes the loser(s) off the stage, one by one
    var STEP = 1700;
    losers.forEach(function (k, i) {
      var by = stay[i % stay.length];
      setTimeout(function () { if (G.chase !== c) return; c.shove = { by: by, who: k }; push(); Music.step(); }, 300 + i * STEP);   // over to them…
      setTimeout(function () { if (G.chase !== c) return; c.lanes[k].fell = c.n; c.lanes[k].shoved = 1; push(); Music.thud ? Music.thud() : Music.blip(); Music.woosh(); setTimeout(function () { if (G.phase === 'chase') Music.scream(); }, 250); }, 300 + i * STEP + 900);   // …a shove
      setTimeout(function () { if (G.chase !== c) return; if (c.shove && c.shove.who === k) { c.shove = null; push(); } }, 300 + i * STEP + 1500);   // and back to their place
    });
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () {
      if (G.chase !== c) return;
      c.shove = null;
      var left = chaseActive();
      if (left.length === 1) { chaseWin(left); return; }
      chaseAsk();
    }, losers.length ? 1800 + losers.length * STEP : 2600);
  }
  function chaseDie(c) { c.monsterDead = true; chaseMusic(false); Music.dread(false); Music.short(); setTimeout(function () { Music.defeat(); }, 350); push(); }
  function chaseWreck(c) { c.wrecked = true; c.mon = CHASE_END; chaseSfx('brk', 1, Music.crumble); push(); }   // the whole runway breaks away
  // Nobody left: the monster smashes the rest of the runway, rushes onto the stage and grabs the trophy. Everyone lost.
  function chaseMonsterWins(c) {
    c.wreckWarn = true; c.st = 'mrush'; Music.buzz(); push();
    clearTimeout(chaseTimer); chaseTimer = setTimeout(function () {
      if (G.chase !== c) return;
      chaseWreck(c);
      chaseTimer = setTimeout(function () {
        if (G.chase !== c) return;
        c.grab = true; c.st = 'mwin'; c.win = []; chaseMusic(false); Music.dread(false); Music.chomp(); setTimeout(function () { Music.douze(); }, 500); push();
        chaseTimer = setTimeout(chaseDone, 8000);
      }, 1800);
    }, 2000);
  }
  function chaseWin(pids) {
    var c = G.chase; if (!c) return;
    var onStage = chaseAlive().filter(function (k) { return c.lanes[k].pos >= CHASE_GOAL; });
    if (!c.sd && onStage.length > 1) { chaseFinal(onStage); return; }   // more than one on the stage: always a sudden death
    var top = Math.max.apply(null, pids.map(function (k) { return c.lanes[k].pos; }));
    pids = pids.filter(function (k) { return c.lanes[k].pos === top; });
    if (pids.length > 1) pids = [pick(pids)];   // more than one on the stage at once: for now a random one wins
    var reached = c.lanes[pids[0]] && c.lanes[pids[0]].pos >= CHASE_GOAL;
    if (reached && !c.monsterDead) {
      // the monster goes down first, then the whole runway breaks away, then the winner walks to the trophy
      // the whole runway is marked first, then the monster storms down it and smashes all of it, then she goes down
      c.st = 'wdie'; c.wpend = pids; c.wreckWarn = true; Music.buzz(); push();
      clearTimeout(chaseTimer); chaseTimer = setTimeout(function () {
        if (G.chase !== c) return;
        chaseWreck(c);
        chaseTimer = setTimeout(function () {
          if (G.chase !== c) return;
          chaseDie(c);
          chaseTimer = setTimeout(function () { if (G.chase === c) chaseWin(c.wpend); }, 2300);
        }, 1900);
      }, 2000);
      return;
    }
    c.st = 'win'; c.win = pids; Music.dread(false); Music.ding(); push();
    clearTimeout(chaseTimer); chaseTimer = setTimeout(chaseDone, 9000);
  }
  function chaseDone() {
    var c = G.chase; clearTimeout(chaseTimer); clearInterval(chaseCount); Music.dread(false); chaseMusic(false);
    $('chase').classList.add('hidden');
    if (!c) return;
    c.done = true;
    G.chaseLost = c.grab ? mName() : '';
    (c.win || []).forEach(function (k) { if (players[k]) players[k].champ = true; });
    // for the overview at the end: everyone's points in the chase (one per right answer), and who won
    G.chaseOv = c.order.map(function (k) { return { pid: k, fp: (c.lanes[k] && c.lanes[k].fp) || 0, win: (c.win || []).indexOf(k) >= 0 }; });
    try { yt.stopVideo(); } catch (e) {} G.go = {}; G.phase = 'end'; push();
  }
  $('chstop').addEventListener('click', function () { var c = G.chase; if (!c) return; if (c.st !== 'win') { var al = chaseAlive(), best = al.length ? Math.max.apply(null, al.map(function (k) { return c.lanes[k].pos; })) : 0; c.win = al.filter(function (k) { return c.lanes[k].pos === best; }); } chaseDone(); });
  // Test the party games: a Party game that goes straight from one party game to the next (the ones switched on), no trivia in between.
  $('mgtest').addEventListener('click', function () {
    if (REMOTE || G.phase !== 'lobby') return;
    var nb = list().filter(function (p) { return !p.off; }).length; while (nb < 3 && bots.length < (window.BOT_MAX || 12)) { botAdd(); nb++; }
    $('s-atype').value = 'party'; $('s-atype').dispatchEvent(new Event('change'));
    if (beginGame() === false) return;
    G.mgTest = true; G.quizRun = 99; G.skipOpening = true; G.shopFirst = true; G.partyOn = G.partyOn || {}; G.partyOn.shop = true; testBribes();   // the test starts straight with a party game (no opening, no first boutique visit); after each one, the winner goes shopping
    if (G.phase === 'intro') introEnd();
  });
  // Test the boutique: straight into the shop (everyone picks one), then a winner's trip (two items), then the party games.
  $('shoptest').addEventListener('click', function () {
    if (REMOTE || G.phase !== 'lobby') return;
    var nb = list().filter(function (p) { return !p.off; }).length; while (nb < 3 && bots.length < (window.BOT_MAX || 12)) { botAdd(); nb++; }
    $('s-atype').value = 'party'; $('s-atype').dispatchEvent(new Event('change'));
    G.partyOn = G.partyOn || {}; G.partyOn.shop = true;
    if (beginGame() === false) return;
    G.mgTest = true; G.skipOpening = true; testBribes();
    if (G.phase === 'intro') introEnd();
    G.shopFirst = true; G.quizRun = 99; clearTimeout(funTimer); stopTimers();
    var first = list().filter(function (p) { return !p.off; }), lucky = [pick(first).pid];
    G.mode = G.lastParty = 'shop'; G.afterParty = true; G.mgBase = null;
    shopGo(null, 1, function () {   // then a pretend win, so the winner's trip can be seen too
      var nm = players[lucky[0]] ? players[lucky[0]].name : '';
      FUN.shopwin = { icon: '🛍️', title: 'Woodruff’s Boutique', sub: nm + ' wins this party game, and may buy an item in the boutique!' };
      shopVisit(lucky, 1, function () { backFromShop(1, startRound); }, true, '', true);
    });
  });
  // Testing: every human player gets an envelope for the EBU in their bag (to try it out)
  function testBribes() { list().forEach(function (p) { if (p.bot) return; p.inv = p.inv || []; if (p.inv.indexOf('bribe') < 0) p.inv.push('bribe'); }); push(); }
  // Testing the Grand Final with human players: they have already sent their envelope, so first the presenters show
  // the scores and the courier comes in, then the chase.
  function testStandings(then) {
    var hum = list().filter(function (p) { return !p.bot && !p.off; });
    if (!hum.length) { then(); return; }
    list().forEach(function (p) { p.score = 12 * (2 + Math.floor(Math.random() * 12)); });
    G.bribes = hum.map(function (p) { return p.pid; }); G.phase = 'loading'; push();
    partyStandings(then);
  }
  function testPerks() {   // testing the Grand Final: one bot has ice skates, another one got a broken heel from a third
    var bs = list().filter(function (p) { return p.bot && !p.off; }); if (bs.length < 2) return;
    bs[0].inv = (bs[0].inv || []).concat('skates'); G.heels = [{ by: (bs[2] || bs[0]).pid, to: bs[1].pid }];
  }
  $('chasetest').addEventListener('click', function () {
    if (REMOTE || G.phase !== 'lobby') return;
    if (!list().length) { botAdd(); botAdd(); botAdd(); }
    if (list().filter(function (p) { return p.bot; }).length < 3) botAdd();
    testPerks();
    testStandings(function () { chaseStart(true); });
  });
  $('chasetest2').addEventListener('click', function () {
    if (REMOTE || G.phase !== 'lobby') return;
    var nb = list().filter(function (p) { return p.bot; }).length; while (nb < 3 && bots.length < 8) { botAdd(); nb++; }
    testPerks();
    testStandings(function () { chaseStart(true, true); if (G.chase) G.chase.face = true; });   // the bots answer everything right until they are on the stage together
  });
  // The monster wheel: one slice per monster, its picture in the slice; the arrow in the middle spins and stops on the chosen one.
  function chaseWheel(c) {
    var w = $('chwheel'), on = c.st === 'wheel';
    w.classList.toggle('hidden', !on);
    if (!on) { w.removeAttribute('data-k'); return; }
    if (w.getAttribute('data-k') === c.key) {
      if (c.landed && !w.classList.contains('landed')) {
        w.classList.add('landed'); var ix = CHASE_MONSTERS.indexOf(c.monster), nn = CHASE_MONSTERS.length;
        var hl = w.querySelector('.whwin'); if (hl) hl.style.background = 'conic-gradient(transparent 0deg ' + (ix * 360 / nn) + 'deg, rgba(255,255,255,.4) ' + (ix * 360 / nn) + 'deg ' + ((ix + 1) * 360 / nn) + 'deg, transparent ' + ((ix + 1) * 360 / nn) + 'deg)';
        var s = w.querySelectorAll('.whs')[ix]; if (s) s.classList.add('won');
      }
      return;
    }
    w.classList.remove('landed');
    w.setAttribute('data-k', c.key);
    var n = CHASE_MONSTERS.length, cols = { diva: '#7a1140', goblin: '#1f6b12', phoenix: '#a8540a' }, stops = [];
    CHASE_MONSTERS.forEach(function (m, i) { stops.push((cols[m.id] || '#333') + ' ' + (i * 360 / n) + 'deg ' + ((i + 1) * 360 / n) + 'deg'); });
    var art = function (id) { var s = $('chmon').querySelector('svg.' + id); return s ? s.outerHTML.replace(/id="([a-z]+)"/g, 'id="w$1"').replace(/url\(#([a-z]+)\)/g, 'url(#w$1)') : ''; };
    w.innerHTML = '<div class="whl" style="background:conic-gradient(' + stops.join(',') + ')">' + CHASE_MONSTERS.map(function (m, i) {
      var a = (i + 0.5) * 360 / n;
      return '<div class="whs" style="transform:rotate(' + a + 'deg) translateY(-52%) rotate(' + (-a) + 'deg)">' + art(m.id) + '<b>' + esc(m.name) + '</b></div>';
    }).join('') + '<div class="whwin"></div><div class="wharrow" id="wharrow"></div><div class="whhub"></div></div>';
    var target = (CHASE_MONSTERS.indexOf(c.monster) + 0.5) * 360 / n + (Math.random() - 0.5) * (300 / n) / 2, arr = $('wharrow');
    arr.style.transform = 'rotate(0deg)'; arr.getBoundingClientRect();
    setTimeout(function () { arr.style.transition = 'transform 4.3s cubic-bezier(.12,.75,.15,1)'; arr.style.transform = 'rotate(' + (360 * 5 + target) + 'deg)'; }, 1500);   // a moment to take in the wheel first
  }
  function chaseSnap() {
    var c = G.chase, s = { rleft: c.st === 'ready' ? Math.max(0, (c.readyEnds || 0) - Date.now()) : 0, sd: !!c.sd, act: c.sd ? chaseActive() : null, key: c.qkey, rkey: c.key + '-r', ready: c.ready || {}, st: c.st, n: c.n, mon: c.mon, mname: c.monster && c.landed ? c.monster.name : '', /* only once the wheel has picked */ end: CHASE_END, goal: CHASE_GOAL, wake: Math.max(0, 2 - c.n), near: chaseNear().length > 0, left: Math.max(0, c.endsAt - Date.now()), lanes: {}, win: c.win };
    if (c.q && c.st !== 'intro') { s.text = c.q.text; s.items = c.q.items.map(function (it) { return it.label; }); if (c.st !== 'ask') s.truth = c.q.items.map(function (it) { return it.ok; }); }
    var nx = c.monsterDead ? 0 : (c.st === 'ask' || c.st === 'show' || c.st === 'pause' || c.st === 'move') ? divaStep(c.n) : divaStep(c.n + 1);
    c.order.forEach(function (k) { var l = c.lanes[k]; s.lanes[k] = { danger: !l.out && !!nx && l.pos <= c.mon + nx && l.pos < CHASE_GOAL, fell: !!l.fell, pos: Math.min(CHASE_GOAL, l.pos), out: l.out, res: l.res, lock: l.lock }; });
    return s;
  }
  // The big screen: lanes, tokens, the Diva and the trophy; the question in a smaller box in the middle.
  // The runway, seen from the side and a little from above: every player has a lane running from left to right,
  // the Diva comes from the left and the stage with the trophy is on the right. The spaces she has smashed stay dark;
  // the ones she will smash next turn flash, and a player standing on one of those flashes red: move, or be caught.
  function chaseX(pos) { return Math.max(0, Math.min(CHASE_END, pos)) / CHASE_END * 100; }
  function chaseShow() {
    var c = G.chase; if (!c) return;
    $('chase').classList.toggle('hidden', !!c.enterAt && Date.now() < c.enterAt);
    if (c.enterAt && Date.now() < c.enterAt) { setTimeout(function () { if (G.phase === 'chase') render(); }, c.enterAt - Date.now() + 20); }
    var n = c.order.length;
    if (chaseBuilt !== c.key) {
      chaseBuilt = c.key; $('chview').classList.remove('zoom');
      $('chtiles').style.gridTemplateColumns = 'repeat(' + CHASE_END + ',1fr)'; $('chtiles').style.gridTemplateRows = 'repeat(' + n + ',1fr)';
      var tiles = ''; for (var ln = 0; ln < n; ln++) for (var r = 1; r <= CHASE_END; r++) tiles += '<i data-r="' + r + '" data-l="' + ln + '" class="' + ((r + ln) % 2 ? '' : 'even') + '"></i>';
      $('chtiles').innerHTML = tiles;
      $('chlanes').innerHTML = c.order.map(function (k, i) { var p = players[k] || { name: '?' }; return '<div class="chtok" data-pid="' + esc(k) + '" data-sk="' + (c.lanes[k].skates || '') + '" style="top:' + ((i + 0.62) / n * 100) + '%;left:' + chaseX(c.lanes[k].pos - 0.5) + '%"><div class="ch-face">' + charSvg(p.char) + '</div><span class="ch-name">' + esc(p.name) + '</span><span class="ch-res"></span>' + (c.lanes[k].skates ? '<span class="ch-sk">⛸️ +' + c.lanes[k].skates + '</span>' : '') + '</div>'; }).join('');
      var rh = $('chrun').clientHeight || 480, rw = $('chrun').clientWidth || 1000;
      $('chase').classList.toggle('many', n >= 9);
      $('chtrack').style.setProperty('--tok', Math.max(30, Math.min(78, Math.round(Math.min(rh / n * 0.62, rw / CHASE_END * 1.25)))) + 'px');
    }
    var next = c.wreckWarn && !c.wrecked ? CHASE_END : c.monsterDead ? 0 : c.st === 'diva' || c.st === 'intro' || c.st === 'rise' || c.st === 'near' || c.st === 'wheel' || c.st === 'pre' || c.st === 'ready' || c.st === 'perk' || c.st === 'go' ? divaStep(c.n + 1) : divaStep(c.n), occ = {}, doomed = {}, deny = {};
    c.order.forEach(function (k, i) {
      var l = c.lanes[k], el = $('chlanes').querySelector('.chtok[data-pid="' + k.replace(/"/g, '') + '"]'); if (!el) return;
      var at = Math.min(CHASE_END, l.pos), won = !!(c.win && c.win.indexOf(k) >= 0);
      if (l.pos >= CHASE_GOAL) {   // on the stage: the winner walks to the trophy; in a sudden death all finalists stand around it
        var fi = c.sd ? c.finals.indexOf(k) : -1, fn = c.sd ? c.finals.length : 1, ftop = fn > 1 ? 24 + fi * (56 / (fn - 1)) : 56;
        if (won) { el.style.left = '110%'; el.style.top = '56%'; }
        else if (c.st === 'wdie' && c.wpend && c.wpend.indexOf(k) >= 0) { el.style.left = '103%'; el.style.top = ((i + 0.62) / n * 100) + '%'; }
        else if (fi >= 0) {
          var sh = c.shove && c.shove.by === k ? c.shove : null, ti = sh ? c.finals.indexOf(sh.who) : -1, ttop = ti >= 0 ? (fn > 1 ? 24 + ti * (56 / (fn - 1)) : 56) : ftop;
          el.style.left = (sh ? 101.5 : c.st === 'fdie' ? 103 : 106) + '%'; el.style.top = (l.fell ? ftop + 60 : sh ? ttop : ftop) + '%';   // (the pusher: right next to the one being pushed)
          el.classList.toggle('shove', !!sh);
        }
        else { el.style.left = '103%'; el.style.top = ((i + 0.62) / n * 100) + '%'; }
        el.classList.toggle('fall', !!l.fell); el.classList.toggle('shoved', !!l.shoved);
        el.classList.add('jump');
      } else if (l.blocked === c.n && c.st === 'move' && el.getAttribute('data-bump') !== c.qkey) {
        // the bump: run up to the edge of the stage, hit it, and slide back to the space they came from
        el.setAttribute('data-bump', c.qkey); el.style.top = ((i + 0.62) / n * 100) + '%';
        el.style.left = '99%'; el.classList.remove('bonk');
        setTimeout(function () { el.classList.add('bonk'); }, 650);
        setTimeout(function () { el.style.left = chaseX(at - 0.5) + '%'; }, 900);
        setTimeout(function () { el.classList.remove('bonk'); }, 1700);
      } else if (el.getAttribute('data-bump') !== c.qkey || c.st !== 'move') { el.style.left = chaseX(at - 0.5) + '%'; el.style.top = ((i + 0.62) / n * 100) + '%'; }
      if (!l.out && l.blocked === c.n && c.st === 'move') deny[i + ':' + at] = 1;   // not perfect, so not onto the stage: the space flashes red
      if (!l.out) { occ[i + ':' + at] = 1; if (next && l.pos < CHASE_GOAL && at <= c.mon + next && c.st !== 'win' && c.st !== 'move' && c.st !== 'pause') doomed[k] = 1; }
      el.classList.toggle('out', l.out); el.classList.toggle('vanish', (l.out && !(c.st === 'diva' && l.at === c.n)) || (!!c.wrecked && l.pos < CHASE_GOAL));   // caught: shown with a skull for a moment, then gone
      el.classList.toggle('locked', c.st === 'ask' && l.lock); el.classList.toggle('won', !!(c.win && c.win.indexOf(k) >= 0));
      el.classList.toggle('near', !l.out && l.pos >= CHASE_GOAL - 3 && !c.win); el.classList.toggle('doomed', !!doomed[k]);
      var waiting = c.st === 'intro' && c.placeOrder.indexOf(k) >= c.placed; el.classList.toggle('unplaced', waiting);   // not on the runway yet
      if (waiting) delete occ[i + ':' + at];
      el.querySelector('.ch-name').textContent = (players[k] ? players[k].name : '?');
      var r = el.querySelector('.ch-res'), showR = (c.st === 'show' || c.st === 'pause') && l.res != null && !l.out;
      r.classList.toggle('on', showR); r.classList.toggle('zero', !l.res); r.classList.toggle('gold', l.res === 3); r.textContent = showR ? (l.res === 3 ? '★ +3' : '+' + l.res) : '';
      var heeled = (!!l.heel && !l.heelAt && c.st !== 'move') || (l.heelAt === c.n && c.st === 'move');   // a broken heel: this time they stay where they are
      el.classList.toggle('heeled', heeled); el.classList.toggle('skated', !!l.skates && c.n === 0); var sk = el.querySelector('.ch-sk'); if (l.skates) { if (!sk) { sk = document.createElement('span'); sk.className = 'ch-sk'; el.appendChild(sk); } sk.textContent = '⛸️ +' + l.skates; } if (heeled && showR) { r.textContent = '👠 stuck!'; r.classList.add('zero'); r.classList.remove('gold'); }
    });
    // smashed, threatened and occupied spaces (an occupied space that is threatened: deadly)
    [].forEach.call($('chtiles').children, function (t) {
      var r = +t.getAttribute('data-r'), on = !!occ[t.getAttribute('data-l') + ':' + r], warn = r > c.mon && r <= c.mon + next && c.st !== 'win';
      if (r <= c.mon && !t.getAttribute('data-x')) {   // smashed: it cracks, shakes and falls away, then it is gone
        t.setAttribute('data-x', '1'); t.classList.remove('warn', 'doom', 'occ'); t.classList.add('crumble');
        setTimeout(function () { t.classList.remove('crumble'); t.classList.add('gone'); }, 1350 + Math.random() * 200);
      }
      if (r <= c.mon) return;
      if (warn && !t.classList.contains('warn')) t.style.animationDelay = -(performance.now() % 1400) + 'ms'; /* all marked tiles blink in step */ t.classList.toggle('warn', warn); t.classList.remove('doom'); t.classList.toggle('occ', on && !warn);   // a player in danger: only their avatar shows it
      t.classList.toggle('deny', !!deny[t.getAttribute('data-l') + ':' + r]);
    });
    $('chvoid').style.width = chaseX(c.mon) + '%';
    // the winner on the stage: the Diva goes down in agony and is gone, then the camera zooms in on the winner and the trophy
    var view = $('chview');
    $('chmon').classList.toggle('defeat', !!c.monsterDead || (c.st === 'win' && !!c.win && c.win.some(function (k) { return c.lanes[k] && c.lanes[k].pos >= CHASE_GOAL; })));
    if (c.st === 'win' && c.win && c.win.length && !view.classList.contains('zoom') && !view._zt) {
      var onStage = c.lanes[c.win[0]] && c.lanes[c.win[0]].pos >= CHASE_GOAL;
      view._zt = setTimeout(function () {
        view._zt = null; if (!G.chase || G.chase.st !== 'win') return;
        var w = $('chlanes').querySelector('.chtok[data-pid="' + G.chase.win[0].replace(/"/g, '') + '"]'); if (!w) return;
        var vr = view.getBoundingClientRect(), wr = w.getBoundingClientRect(), tr = onStage ? $('chtro').getBoundingClientRect() : wr;
        var L = Math.min(wr.left, tr.left), R = Math.max(wr.right, tr.right), T = Math.min(wr.top, tr.top), B = Math.max(wr.bottom, tr.bottom);
        var z = Math.max(1.4, Math.min(5, 0.9 * vr.width / (R - L), 0.9 * vr.height / (B - T)));   // close in: only the winner and the trophy
        view.style.setProperty('--z', z.toFixed(2));
        view.style.transformOrigin = ((L + R) / 2 - vr.left) + 'px ' + ((T + B) / 2 - vr.top) + 'px';
        view.classList.add('zoom'); Music.douze();
      }, onStage ? 1700 : 1300);
    }
    if (c.st !== 'win') { view.classList.remove('zoom'); clearTimeout(view._zt); view._zt = null; }
    [].forEach.call(document.querySelectorAll('#chase .chpyro'), function (p) { p.classList.toggle('boom', c.st === 'win' || chaseNear().length > 0); });
    $('chmon').style.left = (c.grab ? 112 : chaseX(c.mon)) + '%';
    $('chtro').classList.toggle('taken', !!c.grab);
    $('chmon').classList.toggle('grab', !!c.grab);
    if (c.monster) { $('chmon').querySelector('.chmonname').textContent = c.monster.name; $('chmon').setAttribute('data-mon', c.monster.id); }
    $('chmon').classList.toggle('hungry', c.st === 'diva' && divaStep(c.n) > 0); $('chmon').classList.toggle('sleep', c.n < 2 || (c.n === 2 && c.st !== 'diva'));
    $('chn').textContent = c.n ? 'Question ' + c.n + ' · first to the trophy wins' : 'First to the trophy wins';
    var note = $('chnote'), near = chaseNear();
    note.classList.add('hidden'); void near; void doomed;   /* no line about the monster's next move any more */
    var big = $('chbig'); big.classList.toggle('winbox', c.st === 'win'); big.classList.toggle('introbox', (c.st === 'intro' && !!c.introTop) || c.st === 'wheel');
    $('chmon').classList.toggle('lurk', c.st === 'intro' || c.st === 'perk' || c.st === 'wheel' || c.st === 'pre');   // (hidden until the wheel has chosen)
    chaseWheel(c); $('chmon').classList.toggle('rise', c.st === 'rise' || c.st === 'ready' || c.st === 'go');
    var cc = $('chcard'), sp = c.st === 'intro' && c.showing ? players[c.showing] : null;
    cc.classList.toggle('hidden', !sp);
    if (sp && cc.getAttribute('data-k') !== c.showing) { cc.setAttribute('data-k', c.showing); cc.innerHTML = '<div class="chcard-face">' + charSvg(sp.char) + '</div><b>' + esc(sp.name) + '</b><span>Jury votes</span><strong id="chcount">' + (c.count || 0) + '</strong>'; }
    cc.classList.toggle('final', !!(sp && c.counted));
    if (c.st === 'mwin') { big.innerHTML = esc(mName()) + ' grabbed the trophy!<small>Everyone lost.</small>'; big.classList.remove('hidden'); big.classList.add('winbox'); }
    var nm = function (ks) { return esc(ks.map(function (k) { return players[k] ? players[k].name : '?'; }).join(' & ')); };
    if (c.st === 'mwin') {}
    else if (c.st === 'fmsg') { big.innerHTML = 'Sudden death!<small>' + nm(c.finals) + ' reached the stage together. Keep answering: whoever gets fewer right than the others falls off the stage. The last one standing wins!</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'sdres') { big.innerHTML = (c.sdLost && c.sdLost.length ? (function () { var st = chaseActive().filter(function (k) { return c.sdLost.indexOf(k) < 0; }); return st.length === 1 ? nm(st) + ' pushes ' + nm(c.sdLost) + ' off the stage!' : nm(c.sdLost) + ' ' + (c.sdLost.length > 1 ? 'are' : 'is') + ' pushed off the stage!'; })() : 'Still level! Next question…'); big.classList.remove('hidden'); }
    else if (c.st === 'ready' && c.msgAt && Date.now() < c.msgAt) { big.classList.add('hidden'); setTimeout(function () { if (G.phase === 'chase') render(); }, c.msgAt - Date.now() + 20); }   // the monster shows itself first
    else if (c.st === 'ready' || c.st === 'go') { big.innerHTML = (c.monster.cry ? '<div class="chcry">' + esc(c.monster.cry) + '</div>' : '') + esc(mName()) + ' is coming for the trophy!<small>Answer correctly to beat ' + c.monster.her + ' to it, or risk falling off the stage.</small><div class="chreadyq">' + (c.st === 'go' ? 'Here we go!' : 'Ready?') + '</div>' + (c.st === 'ready' ? '<div class="chrbar"><i id="chrbar"></i></div>' : '') + '<div class="chready">' + chaseAlive().map(function (k) { var p = players[k] || {}; return '<span class="' + (c.ready[k] ? 'on' : '') + '"><i>' + charSvg(p.char) + '</i>' + esc(p.name || '?') + '</span>'; }).join('') + '</div>'; big.classList.remove('hidden'); }
    else if (c.st === 'perk' && c.perk) {
      var pk = c.perk, pn = function (k) { return esc(players[k] ? players[k].name : '?'); };
      big.innerHTML = pk.kind === 'heel' ? (pk.blocked ? '☂️ Blocked!<small>' + pn(pk.by) + ' tried to break ' + pn(pk.to) + '’s heel, but ' + pn(pk.to) + '’s umbrella blocked it!</small>' : '👠 Broken heel!<small>' + pn(pk.to) + ' received a broken heel from ' + pn(pk.by) + ': ' + pn(pk.to) + ' can’t move on the first question.</small>')
        : '⛸️ Ice skates!<small>' + pn(pk.pid) + ' has ice skates and glides ' + pk.n + ' spaces forward!</small>';
      big.classList.remove('hidden');
    }
    else if (c.st === 'pre') { big.innerHTML = '👑 A Eurovision icon is coming for the trophy…<small>Who will it be?</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'wheel') { big.innerHTML = 'Who will chase you?'; big.classList.remove('hidden'); }
    else if (c.st === 'intro' && c.builtAt && Date.now() < c.builtAt) { big.classList.add('hidden'); setTimeout(function () { if (G.phase === 'chase') render(); }, c.builtAt - Date.now() + 20); }   // (the scene is still being built)
    else if (c.st === 'intro') { big.innerHTML = 'You have reached the Grand Final!<small>First, let’s see how many jury votes you received: the more points, the further ahead you start.</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'rise') { big.innerHTML = (c.monster.cry ? '<div class="chcry">' + esc(c.monster.cry) + '</div>' : '') + esc(mName()) + ' is coming for the trophy!<small>Answer correctly to beat ' + c.monster.her + ' to it, or risk being destroyed. Tick every song that fits: one space for each one you get right.</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'win') { big.innerHTML = '🏆 ' + esc((c.win || []).map(function (k) { return players[k] ? players[k].name : '?'; }).join(' & ')) + '<small>' + (c.win && c.win.length && c.lanes[c.win[0]].out ? 'caught last, so the winner!' : (c.sd ? 'last one standing on the stage: the trophy is theirs!' : 'jumped onto the stage: the trophy is theirs!')) + '</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'diva' && c.order.some(function (k) { return c.lanes[k].at === c.n; })) { big.innerHTML = '💀 Caught!<small>' + esc(c.order.filter(function (k) { return c.lanes[k].at === c.n; }).map(function (k) { return players[k] ? players[k].name : '?'; }).join(', ')) + '</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'near') { big.innerHTML = '🏆 ' + esc((c.nearNew || []).map(function (k) { return players[k] ? players[k].name : '?'; }).join(' & ')) + ' within reach of the stage!<small>Only a perfect answer (all three right) gets you onto the stage. Anything less and you bounce back.</small>'; big.classList.remove('hidden'); }
    else if (c.st === 'diva' && c.coming) { big.innerHTML = '👹 ' + esc(mName()) + ' starts moving!'; big.classList.remove('hidden'); }
    else big.classList.add('hidden');
    var rb = $('chrbar'); if (rb && c.st === 'ready' && !rb.getAttribute('data-on')) { rb.setAttribute('data-on', '1'); var leftR = Math.max(0, c.readyEnds - Date.now()); rb.style.width = (leftR / 600) + '%'; rb.getBoundingClientRect(); rb.style.transition = 'width ' + leftR + 'ms linear'; rb.style.width = '0%'; }
    var q = $('chq'), on = !!c.q && (c.st === 'ask' || c.st === 'show');
    q.classList.toggle('hidden', !on);
    if (on) {
      var truth = c.st === 'show';
      $('chqt').textContent = c.q.text;
      $('chqs').textContent = truth ? 'The answer:' : c.sd ? 'Sudden death: whoever gets fewer right falls off the stage!' : 'Tick every one that fits on your phone (none, some or all)';
      $('chqi').innerHTML = c.q.items.map(function (it, i) { return '<div class="' + (truth ? (it.ok ? 'yes' : 'no') : '') + '"><b>' + 'ABC'[i] + '</b>' + esc(it.label) + (truth ? '<i>' + (it.ok ? '✓' : '✗') + '</i>' : '') + '</div>'; }).join('');
      var bar = $('chbar');
      if (c.st === 'ask' && bar.getAttribute('data-k') !== c.qkey) {
        bar.setAttribute('data-k', c.qkey); bar.style.transition = 'none'; bar.style.width = (Math.max(0, c.endsAt - Date.now()) / CHASE_ASK * 100) + '%';
        bar.getBoundingClientRect(); bar.style.transition = 'width ' + Math.max(0, c.endsAt - Date.now()) + 'ms linear'; bar.style.width = '0%';
      }
    }
  }

  // ---------- The Envelope, Please ----------
  // Golden envelopes on stage, one per player still in: all hide a flag but one, which hides a bomb.
  // The players take turns (on their phone) to open one; whoever finds the bomb is out, and a new set
  // of envelopes comes out. The last one standing wins.
  // The two presenters of "The Envelope, Please" (original characters): a man in a sharp suit and a woman in a gown.
  var HOST_HIM = '<svg class="ehost him" viewBox="0 0 200 420" aria-hidden="true"><defs>' +
    '<linearGradient id="ehsuit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#28306e"/><stop offset="1" stop-color="#121640"/></linearGradient>' +
    '<radialGradient id="ehskin" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#f3c9a4"/><stop offset="1" stop-color="#d89b72"/></radialGradient></defs>' +
    '<ellipse cx="100" cy="410" rx="62" ry="9" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M74 300 L70 405 L94 405 L100 320 L106 405 L130 405 L126 300 Z" fill="#0d1033"/>' +
    '<path d="M68 404 h28 v8 h-30 z M104 404 h28 v8 h-30 z" fill="#050510"/>' +
    '<path d="M52 150 Q100 128 148 150 L140 310 Q100 322 60 310 Z" fill="url(#ehsuit)"/>' +
    '<path d="M86 140 L100 210 L114 140 Z" fill="#fff"/>' +
    '<path d="M86 140 L78 150 L96 215 L100 210 Z M114 140 L122 150 L104 215 L100 210 Z" fill="#1a1f55"/>' +
    '<path d="M91 146 L100 152 L109 146 L109 158 L100 153 L91 158 Z" fill="#e0234a"/>' +
    '<circle cx="100" cy="232" r="3" fill="#c9a34a"/><circle cx="100" cy="258" r="3" fill="#c9a34a"/>' +
    '<path d="M126 168 l6 0 l-2 14 l-8 0 z" fill="#ffd23f"/>' +
    '<path d="M52 152 Q38 200 44 262 L60 262 Q58 210 66 170 Z" fill="url(#ehsuit)"/>' +
    '<path d="M148 152 Q166 186 160 232 L146 236 Q148 200 136 172 Z" fill="url(#ehsuit)"/>' +
    '<circle cx="52" cy="266" r="9" fill="url(#ehskin)"/>' +
    '<g class="ecard"><rect x="140" y="206" width="38" height="26" rx="3" fill="#ffd23f" transform="rotate(-12 159 219)"/><circle cx="154" cy="236" r="9" fill="url(#ehskin)"/></g>' +
    '<rect x="92" y="118" width="16" height="22" fill="#d89b72"/>' +
    '<ellipse cx="100" cy="92" rx="30" ry="36" fill="url(#ehskin)"/>' +
    '<path d="M70 86 Q68 50 100 50 Q134 50 131 84 Q124 66 104 66 Q88 70 76 66 Z" fill="#2b1d14"/>' +
    '<ellipse cx="89" cy="94" rx="3.2" ry="4" fill="#2a1a10"/><ellipse cx="111" cy="94" rx="3.2" ry="4" fill="#2a1a10"/>' +
    '<path d="M83 84 q6 -4 12 0 M105 84 q6 -4 12 0" stroke="#2b1d14" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M88 110 Q100 122 112 110" stroke="#7a3b2a" stroke-width="3.5" fill="#fff" stroke-linecap="round"/>' +
    '</svg>';
  var HOST_HER = '<svg class="ehost her" viewBox="0 0 200 420" aria-hidden="true"><defs>' +
    '<linearGradient id="ehgown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff3fa4"/><stop offset=".55" stop-color="#b0208a"/><stop offset="1" stop-color="#5a1170"/></linearGradient>' +
    '<radialGradient id="ehskin2" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#e8b48c"/><stop offset="1" stop-color="#b9805a"/></radialGradient>' +
    '<pattern id="ehsparkle" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.3" fill="#fff" opacity=".85"/><circle cx="12" cy="11" r="1" fill="#ffd23f" opacity=".9"/></pattern></defs>' +
    '<ellipse cx="100" cy="410" rx="74" ry="10" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M74 150 Q100 140 126 150 L132 232 Q168 330 176 408 Q100 420 24 408 Q34 330 68 232 Z" fill="url(#ehgown)"/>' +
    '<path d="M74 150 Q100 140 126 150 L132 232 Q168 330 176 408 Q100 420 24 408 Q34 330 68 232 Z" fill="url(#ehsparkle)" class="esparkle"/>' +
    '<path d="M70 232 Q100 244 130 232" stroke="#ffd23f" stroke-width="4" fill="none"/>' +
    '<path d="M74 152 Q60 196 64 236 L76 236 Q76 200 84 160 Z" fill="url(#ehskin2)"/>' +
    '<path d="M126 152 Q146 180 144 214 L132 218 Q134 192 118 164 Z" fill="url(#ehskin2)"/>' +
    '<circle cx="70" cy="240" r="8" fill="url(#ehskin2)"/>' +
    '<g class="emic"><rect x="134" y="196" width="7" height="30" rx="3" fill="#222" transform="rotate(18 137 211)"/><circle cx="133" cy="194" r="8" fill="#9aa0b4"/><circle cx="140" cy="220" r="8" fill="url(#ehskin2)"/></g>' +
    '<rect x="93" y="118" width="14" height="26" fill="#b9805a"/>' +
    '<path d="M64 96 Q58 40 100 38 Q144 40 138 98 Q146 150 128 176 Q132 128 122 106 L78 106 Q68 128 72 176 Q54 150 64 96 Z" fill="#6b2a12"/>' +
    '<ellipse cx="100" cy="90" rx="27" ry="33" fill="url(#ehskin2)"/>' +
    '<path d="M73 84 Q76 54 104 56 Q128 58 128 82 Q114 66 94 70 Q80 74 73 84 Z" fill="#6b2a12"/>' +
    '<ellipse cx="90" cy="92" rx="3" ry="3.8" fill="#2a1a10"/><ellipse cx="110" cy="92" rx="3" ry="3.8" fill="#2a1a10"/>' +
    '<path d="M85 86 l-3 -3 M115 86 l3 -3" stroke="#2a1a10" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M90 107 Q100 116 110 107" stroke="#c0204a" stroke-width="4" fill="#fff" stroke-linecap="round"/>' +
    '<circle cx="74" cy="100" r="3" fill="#ffd23f"/><circle cx="126" cy="100" r="3" fill="#ffd23f"/>' +
    '</svg>';

  var BOMB_PICK_MS = 20000, bombTimer = null;
  // ---------- things slide in, with a whoosh ----------
  function whooshes(times) { if (REMOTE) return; times.forEach(function (t) { setTimeout(function () { Music.woosh(); }, t); }); }
  function viewEnter(id) {
    var v = $(id); if (!v || REMOTE) return;
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    clearTimeout(v._enterT); v._enterT = setTimeout(function () { v.classList.remove('enter'); }, 2400);
    if (id === 'v-game') whooshes([0, 350, 700, 1000]); else if (id === 'v-end') whooshes([0, 400]);
  }
  var qInKey = '';
  function questionEnter() {   // a new question: the question and its answers slide up, one after another
    if (REMOTE || !G.q) return;
    var k = G.round + '|' + G.q.text; if (k === qInKey) return; qInKey = k;
    ['qtext', 'qopts'].forEach(function (id) { var e = $(id); if (!e) return; e.classList.remove('qin'); void e.offsetWidth; e.classList.add('qin'); clearTimeout(e._qinT); e._qinT = setTimeout(function () { e.classList.remove('qin'); }, 1100); });   // (only once: the answers are redrawn on every update, which would start it again)
    whooshes([0]);
  }
  // ---------- the presenters on the big screen ----------
  // The two presenters stand in front of the video screen for the whole game and talk in speech balloons.
  var HOST_LINES = {
    lost: ['Language barrier! What does this title mean?', 'Lost in translation, anyone?'], peel: ['Behind the curtain… who is hiding there?'], flag: ['Whose flag is this?', 'Name that flag!'],
    host: ['Where was the party that year?'], odd: ['Spot the odd one out!'], mistake: ['One of these is a lie…', 'Find the mistake, darlings!'], higher: ['Two songs: which one did better?'], newer: ['Two songs: which one is newer?'],
    any: ['Listen closely…', 'Here comes the next song!', 'Do you know this one?', 'Ears open, Europe!', 'Phones ready?', 'This one’s a classic!']
  };
  var HOST_REACT = ['Did you get it right?', 'Douze points if you knew that one!', 'Ooh, that was a tricky one!', 'Nul points for the rest of you!', 'The jury has spoken!', 'What a performance!'];
  var hostTurn = 0, hostT = { him: null, her: null }, hostType = {}, hostHold = false;   // (hold: they stay on stage for the whole announcement)
  function hostsEl() {
    var st = stageEl(); if (!st || REMOTE) return null;
    var h = st.querySelector('.shosts');
    if (!h) { h = document.createElement('div'); h.className = 'shosts away together'; h.innerHTML = HOST_HIM + HOST_HER + '<div class="hbub him"></div><div class="hbub her"></div>'; st.appendChild(h); }   // (off stage until they have something to say)
    return h;
  }
  // A line that comes out letter by letter, with a little blip now and then, so it looks (and sounds) like someone talking.
  // The rest of the line is already there, invisible, so the balloon has its full size from the start.
  // The same line again (a redraw) changes nothing. Returns how long the typing takes.
  var TALK_MS = 26;
  function typeSay(el, text, voice) {
    text = String(text); if (el._said === text) return 0; el._said = text;
    var chars = Array.from(text), n = 0;
    clearInterval(el._typeT);
    var draw = function () { el.innerHTML = '<span>' + esc(chars.slice(0, n).join('')) + '</span><span class="unsaid">' + esc(chars.slice(n).join('')) + '</span>'; };
    draw();
    el._typeT = setInterval(function () {
      if (!el.isConnected) { clearInterval(el._typeT); return; }
      n++; draw();
      var c = chars[n - 1];
      if (!REMOTE && c && /[A-Za-zÀ-ÿ0-9]/.test(c) && n % 3 === 1) Music.talk(voice);
      if (n >= chars.length) clearInterval(el._typeT);
    }, TALK_MS);
    return chars.length * TALK_MS;
  }
  // The presenters don't say the same thing every time: a random line from a set, never the one they used last.
  var VARY_LAST = {};
  var LINES = {
    back: ['Welcome back, Europe!', 'And we’re back, Europe! 📺', 'Hello again, Europe! Did you miss us?', 'Welcome back to EuroQuizion!', 'We’re back, and the glitter hasn’t settled yet! ✨', 'Good to see you again, Europe! 💖'],
    party: ['It’s time for a party game! Let’s see what it’s going to be…', 'Party time! 🎉 Which game will it be this time?', 'Enough thinking for a moment: it’s time to play! 🎡', 'Grab your phones and your sequins: party game time! 🎉', 'The jury needs a coffee break, so… party game! ☕🎉', 'Let’s shake things up with a party game! 💃', 'Wind machines on, it’s party game time! 💨'],
    trivia: ['It’s time again for trivia! 🧠', 'Brains on, Europe: trivia time! 🧠', 'Back to the questions! 🎧', 'Let’s see what you really know about Eurovision! 🧠', 'Phones ready: here come the questions! 📱', 'Trivia time! Douze points for the know-it-alls! 🧠', 'Time to sort the fans from the superfans! 🤓', 'Ears open, Europe: the music is back! 🎶'],
    first: ['It’s time to test your knowledge: it’s trivia time! 🧠', 'Let’s find out who the real Eurovision expert is: trivia time! 🧠', 'First up: trivia! Show us what you know! 🧠', 'We start with some trivia. Ears open, Europe! 🎧'],
    souvenir: ['I hope you got a nice souvenir!', 'Ooh, shopping bags! I hope you spent wisely! 🛍️', 'Lynda will be counting her coins tonight! 💰', 'Back from the boutique, and looking fabulous! ✨', 'Did anyone buy something dangerous? I hope not! 😬', 'I spotted something shiny in that bag… 👀'],
    onward: ['Let’s get on with the show!', 'On with the show!', 'The show must go on!', 'Back to business!', 'Where were we? Ah, yes!'],
    lynda: ['Let’s go and see our beloved Lynda!', 'To the boutique! Lynda is waiting… 🛍️', 'Shopping time! Don’t keep Lynda waiting! 🛍️', 'Lynda has opened her doors… let’s pay her a visit! 👠', 'Wallets out, Europe: off to Lynda! 💸']
  };
  function vary(key) { var l = LINES[key] || [''], c = l.filter(function (x) { return x !== VARY_LAST[key]; }), t = pick(c.length ? c : l); VARY_LAST[key] = t; return t; }
  function hostSay(who, text, ms) {
    if (who === 'next') { who = hostTurn++ % 2 ? 'her' : 'him'; }
    var pc = !REMOTE && $('pcov');
    if (pc) {   // the Postcard studio: they are on stage already, and talk there
      [].forEach.call(pc.querySelectorAll('.grbub'), function (x) { if (!x.classList.contains(who)) x.classList.remove('on'); });
      var pb = pc.querySelector('.grbub.' + who); pb.classList.add('on'); pb._said = ''; var tp = typeSay(pb, text, who);
      clearTimeout(hostT[who]); hostT[who] = setTimeout(function () { pb.classList.remove('on'); }, Math.max(ms || 3500, tp + 1600));
      return;
    }
    var h = hostsEl(); if (!h) return;
    if (h.classList.contains('away')) { h.classList.remove('away'); if (!REMOTE) Music.woosh(); }   // they walk on to say it…
    var b = h.querySelector('.hbub.' + who); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    // The words come out letter by letter, with a little blip now and then, so it looks (and sounds) like they are talking.
    // The rest of the line is already there, invisible, so the balloon has its full size from the start.
    b._said = ''; var typing = typeSay(b, text, who);
    ms = Math.max(ms || 3500, typing + 1600);
    clearTimeout(hostT[who]); hostT[who] = setTimeout(function () { b.classList.remove('on'); }, ms);
    clearTimeout(hostT.away); hostT.away = setTimeout(hostsAway, ms + 600);   // …and leave the screen to the game again
  }
  function hostsAway() {
    var h = hostsEl(); if (!h || h.classList.contains('away') || G.phase === 'opening' || hostHold || h.querySelector('.hbub.on')) return;
    h.classList.add('away'); if (!REMOTE) Music.woosh();
    setTimeout(function () { if (h.classList.contains('away')) h.classList.add('together'); }, 700);   // (next time they come on side by side)
  }
  function hostQuestion() {   // a line for the question that starts now (not used: the presenters keep out of the way during the questions)
    return;
    if (!G.q || G.best || G.draw || G.sing || G.quipLoad || G.round <= 1) return;   // (the first song: the welcome is still being said)
    var sub = G.q.blur ? 'peel' : G.q.subject, l = HOST_LINES[sub] || HOST_LINES.any;
    hostSay('next', pick(l), 3800);
  }
  // The opening of the show: the studio slides in, then the presenters walk onto the stage and introduce
  // themselves, and only then does the game begin.
  function opening(then) {
    stopTimers(); G.phase = 'opening'; G.q = null; G.song = null; G.barMs = 0;
    try { yt.pauseVideo(); } catch (e) {}
    cover(true, '', '', false); masks(true); $('cover').classList.add('funcard');
    var v = $('v-game'); v.classList.add('opening'); push();
    var h = hostsEl(); if (h) { h.classList.remove('arrive'); h.classList.remove('away'); }
    var at = 0, step = function (ms, f) { at += ms; setTimeout(function () { if (G.phase === 'opening') f(); }, at); };
    step(1900, function () { var hh = hostsEl(); if (hh) { hh.classList.add('arrive'); } whooshes([0, 120]); });
    // what they say: who they are, what we play tonight and how it works, then off we go
    var lines = [['him', 'Good evening, Europe! I’m Felix…'], ['her', '…and I’m Stella! Welcome to EuroQuizion!']].concat(showPlan());
    lines.push([lines[lines.length - 1][0] === 'him' ? 'her' : 'him', 'Grab your phones. Let’s get this show started!']);
    lines.push([lines[lines.length - 1][0] === 'him' ? 'her' : 'him', vary('first')]);
    lines.forEach(function (l, i) { step(i ? 3300 : 1300, function () { hostSay(l[0], l[1], 3600); if (!i) Music.ding(); }); });
    step(3300, function () { v.classList.remove('opening'); var hh = hostsEl(); if (hh) hh.classList.remove('arrive'); if (!G.mgTest) hostsAway(); then(); });   // (testing the party games: they stay on, the boutique is announced straight away)
  }
  // The plan for tonight, in the presenters' words (alternating him / her, after "…and I'm Stella!").
  function showPlan() {
    var L = [], who = 'him', say = function (t) { L.push([who, t]); who = who === 'him' ? 'her' : 'him'; };
    var party = G.atype === 'party', lad = !party && (ladderGame() || G.partLadder), multi = !party && G.parts > 1;
    var fin = G.finalMode === 'chase' ? 'And our final game tonight: the Grand Final! You’ll race each other for the Eurovision trophy… 🏆'
      : G.finalMode === 'double' ? 'And our final game tonight: the Big Five! Five extra questions at the end, all for double points. ⭐'
      : 'No final game tonight: whoever has the most points after the last question wins!';
    // 1. What we play tonight
    if (party) {
      say({ order: 'Tonight it’s Party mode: the Grand Tour! 🎉', random: 'Tonight it’s Party mode, and the wheel decides! 🎡', vote: 'Tonight it’s Party mode, and you vote! 🗳️', one: 'Tonight it’s Party mode, and you take turns to choose!' }[G.partyPick] || 'Tonight it’s Party mode! 🎉');
      say({ order: 'First ' + (['', 'One trivia question', 'Two trivia questions', 'Three trivia questions', 'Four trivia questions', 'Five trivia questions', 'Six trivia questions'][G.block || 3] || (G.block + ' trivia questions')).toLowerCase() + ', then a party game, and so on, until every party game has had its turn.', random: (['', 'One trivia question', 'Two trivia questions', 'Three trivia questions', 'Four trivia questions', 'Five trivia questions', 'Six trivia questions'][G.block || 3] || (G.block + ' trivia questions')) + ', then the wheel picks a party game, and so on.', vote: (['', 'One trivia question', 'Two trivia questions', 'Three trivia questions', 'Four trivia questions', 'Five trivia questions', 'Six trivia questions'][G.block || 3] || (G.block + ' trivia questions')) + ', then you vote for the next party game, and so on.', one: (['', 'One trivia question', 'Two trivia questions', 'Three trivia questions', 'Four trivia questions', 'Five trivia questions', 'Six trivia questions'][G.block || 3] || (G.block + ' trivia questions')) + ', then one of you picks the next party game, and so on.' }[G.partyPick] || (['', 'One trivia question', 'Two trivia questions', 'Three trivia questions', 'Four trivia questions', 'Five trivia questions', 'Six trivia questions'][G.block || 3] || (G.block + ' trivia questions')) + ', then a party game, and so on.');
    } else if (lad) say(G.parts > 1 ? 'Tonight we play the Ladder, in ' + G.parts + ' rounds! 🪜' : 'Tonight we play the Ladder! 🪜');
    else say(multi ? 'Tonight it’s a quiz in ' + G.parts + ' rounds, of ' + G.per + ' questions each! 🎤' : 'Tonight it’s a quiz: ' + G.per + ' questions about Eurovision songs! 🎤');
    // 2. Which songs: the era, and which entries
    var eraTxt = $('erasum') ? $('erasum').textContent : '', block = party ? 'every block of trivia' : 'every round';
    if (G.robin) say('Every round, a different era of Eurovision.');
    else if (G.eraSpin && G.eraVote) say('Before ' + block + ', you vote for the era we play.');
    else if (G.eraSpin) say('Before ' + block + ', the wheel picks the era. 🎡');
    else if (eraTxt && eraTxt !== 'All eras' && eraTxt !== 'Custom') say('Every song tonight comes from ' + eraTxt + '.');
    else if (eraTxt === 'Custom') say('Tonight’s songs come from the eras you picked.');
    else say('Songs from every era of Eurovision, from 1956 until now!');
    if (G.cat === 'win') say('And only winners tonight! 🏆');
    else if (G.cat === 'nq') say('And only songs that never made it out of the semi-final… 😬');
    else if (G.cat === 'final') say('And only songs that made it to the final.');
    // 3. How the points work
    if (lad) say('Every right answer takes you a rung higher, a wrong one half a rung down. First to the top wins!');
    else if (G.scoring === 'speed') say('Be quick: the first right answer gets 12 points, the next 10, then 8, and so on.');
    else if (G.scoring === 'random') say('Every question is worth a surprise number of points: keep an eye on the screen!');
    else say('A right answer is worth 12 points, douze points!');
    if (party && shopOn()) say('Win a party game and you get to go shopping in Woodruff’s Boutique! 🛍️');
    if (multi && !lad) { say('Every round starts from zero, and the winner of a round wears a crown in the next one. 👑'); say('After the last round, all your rounds add up!'); }
    // 4. The final game
    say(fin);
    return L;
  }
  function hostWelcome() {
    if (G.mgTest) return;   // (a test of the party games or the boutique: straight to it)
    hostSay('him', 'Good evening, Europe!', 3200);
    setTimeout(function () { hostSay('her', 'Welcome to EuroQuizion! Grab your phones: here comes the first song!', 4200); }, 2600);
  }

  function bombAll() {
    var act = list().filter(function (p) { return !p.off; });
    if (act.length < 2) { quipAll(); return; }
    stopTimers(); G.q = null; G.song = null; G.clip = null; G.draw = null; G.best = null;
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} }
    var order = shuffle(act.map(function (p) { return p.pid; }));
    G.bomb = { id: 'bomb' + G.round + '-' + Math.random().toString(36).slice(2, 6), alive: order.slice(), out: [], turn: 0, round: 0, env: [], st: 'deal', pick: -1, at: Date.now() };
    G.phase = 'bomb'; G.barMs = 0; push();
    bombDeal();
  }
  function bombDeal() {   // a fresh set: one envelope per player still in, one of them with the bomb
    var g = G.bomb; if (!g) return;
    g.round++;
    var codes = shuffle(Object.keys(countries || {})).filter(function (c) { return c.length === 2 && ['yu', 'cs'].indexOf(c) < 0; }), n = g.alive.length, bomb = Math.floor(Math.random() * n);
    g.env = []; for (var i = 0; i < n; i++) g.env.push({ bomb: i === bomb, code: codes[i % (codes.length || 1)] || 'se', open: false, by: '' });
    g.st = 'deal'; g.pick = -1; push(); Music.woosh();
    clearTimeout(bombTimer); bombTimer = setTimeout(bombTurn, 2200);
  }
  function bombWho() { var g = G.bomb; return g.alive[g.turn % g.alive.length]; }
  function bombTurn() {   // the next player walks on stage and picks
    var g = G.bomb; if (!g || G.phase !== 'bomb') return;
    g.st = 'pick'; g.pick = -1; g.at = Date.now(); g.ends = Date.now() + BOMB_PICK_MS; push(); Music.blip();
    var who = bombWho(), id = g.id + '-' + g.round + '-' + g.turn;
    g.key = id;
    if (players[who] && players[who].bot) setTimeout(function () { bombMsg({ pid: who, key: id, pick: bombRandom() }); }, 1800 + Math.random() * 1800);
    clearTimeout(bombTimer); bombTimer = setTimeout(function () { if (G.bomb === g && g.st === 'pick' && g.key === id) bombOpen(bombRandom()); }, BOMB_PICK_MS);   // too slow: one is picked for you
  }
  function bombRandom() { var g = G.bomb, left = []; g.env.forEach(function (e, i) { if (!e.open) left.push(i); }); return pick(left); }
  function bombMsg(m) {
    var g = G.bomb; if (!g || G.phase !== 'bomb' || g.st !== 'pick' || !m || m.key !== g.key || m.pid !== bombWho()) return;
    if (typeof m.pick !== 'number' || !g.env[m.pick] || g.env[m.pick].open) return;
    bombOpen(m.pick);
  }
  function bombOpen(i) {   // the envelope is picked: a moment of suspense, then it opens
    var g = G.bomb; if (!g) return;
    clearTimeout(bombTimer); g.st = 'open'; g.pick = i; g.env[i].by = bombWho(); push();
    Music.dread(true);
    bombTimer = setTimeout(function () {
      Music.dread(false);
      var e = g.env[i], who = bombWho(); e.open = true;
      if (!e.bomb) { g.st = 'safe'; Music.ding(); push(); g.turn++; bombTimer = setTimeout(bombTurn, 2600); return; }
      g.st = 'boom'; chaseSfx('brk', 1, Music.crumble); setTimeout(function () { Music.scream(); }, 300); push();
      bombTimer = setTimeout(function () {
        g.alive.splice(g.alive.indexOf(who), 1); g.out.push(who); g.turn = g.turn % Math.max(1, g.alive.length);
        if (g.alive.length <= 1) { bombWin(); return; }
        bombDeal();
      }, 3200);
    }, 2400);
  }
  function bombWin() {
    var g = G.bomb, w = players[g.alive[0]], second = players[g.out[g.out.length - 1]];
    var big = 6 * partyX(), small = 3 * partyX();
    if (w) { w.score += big; w.pts = big; } if (second) { second.score += small; second.pts = small; }
    g.st = 'win'; g.prize = [big, small]; push(); Music.douze();
    clearTimeout(bombTimer); bombTimer = setTimeout(function () { if (G.phase === 'bomb') { G.bomb = null; startRound(); } }, 6500);
  }
  function bombSnap() {
    var g = G.bomb;
    return { id: g.id, st: g.st, round: g.round, turn: bombWho(), key: g.key, pick: g.pick, alive: g.alive, out: g.out, left: g.st === 'pick' ? Math.max(0, g.ends - Date.now()) : 0, prize: g.prize || null,
      env: g.env.map(function (e) { return e.open ? { open: 1, bomb: e.bomb ? 1 : 0, code: e.code, by: e.by } : { open: 0 }; }) };   // (what is inside stays on the host until it opens)
  }
  // The big screen: the stage, the two presenters, the player whose turn it is, and the envelopes.
  function bombShow() {
    var g = G.bomb; if (!g) return;
    var ov = $('bombov'); if (!ov) { ov = document.createElement('div'); ov.id = 'bombov'; ov.className = 'bombov enter'; whooshes([0, 350, 700]); (function (o) { setTimeout(function () { o.classList.remove('enter'); }, 2600); })(ov); ov.innerHTML = '<div class="bbeams"><i></i><i></i><i></i><i></i></div><div class="bfloor"></div><div class="bhosts">' + HOST_HIM + HOST_HER + '</div><div class="bhead"></div><div class="bplayer"></div><div class="benvs"></div><div class="bstrip"></div><div class="bmsg"></div>'; document.body.appendChild(ov); }
    var who = players[bombWho()], cur = g.st === 'win' ? players[g.alive[0]] : who;
    ov.setAttribute('data-st', g.st);
    ov.querySelector('.bhead').innerHTML = '💌 The Envelope, Please <small>' + (g.alive.length) + ' still in · round ' + g.round + '</small>';
    var bp = ov.querySelector('.bplayer');   // the player on stage walks in once per turn (not on every update)
    if (cur && bp.getAttribute('data-k') !== cur.pid + '|' + g.round + '|' + g.turn) { bp.setAttribute('data-k', cur.pid + '|' + g.round + '|' + g.turn); bp.innerHTML = '<div class="bme">' + charSvg(cur.char) + '<b>' + esc(cur.name) + '</b></div>'; }
    if (!cur) { bp.innerHTML = ''; bp.removeAttribute('data-k'); }
    var bme = bp.querySelector('.bme'); if (bme) { bme.classList.toggle('boom', g.st === 'boom'); bme.classList.toggle('win', g.st === 'win'); }
    ov.querySelector('.benvs').style.setProperty('--n', g.env.length);   // (all envelopes in one row, however many)
    ov.querySelector('.benvs').innerHTML = g.env.map(function (e, i) {
      var cls = 'benv' + (e.open ? ' open' + (e.bomb ? ' bomb' : ' flag') : '') + (g.pick === i && !e.open ? ' picked' : '');
      return '<div class="' + cls + '" style="--i:' + i + '"><span class="bno">' + (i + 1) + '</span>' + (e.open ? (e.bomb ? '<span class="bin">💣</span>' : '<span class="bin"><img class="bflag" src="https://flagcdn.com/w160/' + e.code + '.png" alt=""></span><small>' + esc(countries[e.code] || '') + '</small>') : '') + '</div>';
    }).join('');
    ov.querySelector('.bstrip').innerHTML = g.alive.concat(g.out).map(function (k) { var p = players[k]; if (!p) return ''; var o = g.out.indexOf(k) >= 0; return '<span class="bps' + (o ? ' out' : '') + (k === bombWho() && g.st !== 'win' ? ' now' : '') + '">' + charSvg(p.char) + '<i>' + esc(p.name) + (o ? ' 💥' : '') + '</i></span>'; }).join('');
    var e = g.pick >= 0 ? g.env[g.pick] : null, nm = cur ? cur.name : '';
    ov.querySelector('.bmsg').innerHTML = g.st === 'deal' ? (g.round > 1 ? 'New envelopes! One of them hides a bomb…' : 'One of these envelopes hides a bomb…')
      : g.st === 'pick' ? esc(nm) + ', pick an envelope on your phone!'
      : g.st === 'open' ? 'Envelope ' + (g.pick + 1) + '… the envelope, please!'
      : g.st === 'safe' ? 'Phew! ' + esc(countries[e.code] || '') + ': ' + esc(nm) + ' is safe!'
      : g.st === 'boom' ? '💥 BOOM! ' + esc(nm) + ' is out!'
      : g.st === 'win' ? '🏆 ' + esc(nm) + ' is the last one standing!' + (shopOn() ? '' : ' +' + g.prize[0] + (g.out.length && players[g.out[g.out.length - 1]] ? ' · ' + esc(players[g.out[g.out.length - 1]].name) + ' +' + g.prize[1] : '')) : '';
  }
  net.on('bomb', bombMsg);
  net.on('clue', clueMsg);
  net.on('note', noteMsg);
  net.on('qj', qjMsg);

  // ---------- Eurofan Shop ----------
  // Everyone picks free items on their phone. They keep them, and use one whenever they like (on their phone);
  // what was used lands just before the next question: points blown away or stolen, or a mic that breaks.
  var SHOP_MS = 30000, shopTimer = null;
  function shopOn() { return G.atype === 'party'; }   // Woodruff's Boutique is part of every Party game (no switch)
  function mgScores() { var o = {}; list().forEach(function (p) { o[p.pid] = p.score; }); return o; }
  // A party game is over: what it scored is taken back, and whoever scored the most in it (a tie: all of them) wins a visit to the boutique.
  function mgPrize() {
    var base = G.mgBase; G.mgBase = null; G.mgLive = false;
    var gain = {}; list().forEach(function (p) { gain[p.pid] = p.score - (base[p.pid] || 0); p.score = base[p.pid] != null ? base[p.pid] : p.score; p.pts = 0; });
    var best = Math.max.apply(null, Object.keys(gain).map(function (k) { return gain[k]; }));
    var wins = best > 0 ? Object.keys(gain).filter(function (k) { return gain[k] === best && players[k] && !players[k].off; }) : [];
    var back = function () { startRound2(); };   // (then on as usual: the trivia card, or the Grand Final)
    if (!wins.length && G.mgTest) { var any = list().filter(function (p) { return !p.off; }); if (any.length) wins = [pick(any).pid]; }   // (testing: always a trip to the boutique, even without a winner)
    if (!wins.length) { back(); return; }
    // Lost in Translation ends in a tie: everyone votes for the funniest fake translation of those tied, and that one wins the trip
    if (wins.length > 1 && G.lastParty === 'bluff' && G.bluffFakes && wins.every(function (k) { return G.bluffFakes[k]; })) {
      var bf = G.bluffFakes; G.bluffFakes = null;
      funnyVote(wins, bf, function (w) { mgGo([w], back); }, function () { underdog(wins, back); }); return;
    }
    if (wins.length > 1) { underdog(wins, back); return; }
    mgGo(wins, back);
  }
  // A tie: Lynda has a soft spot for the underdog, so the one of them with the lowest score goes shopping.
  function underdogOf(wins) {
    var ps = wins.map(function (k) { return players[k]; }).filter(function (p) { return p && !p.off; });
    var low = Math.min.apply(null, ps.map(function (p) { return p.score; }));
    var lp = pick(ps.filter(function (p) { return p.score === low; }));
    return lp ? lp.pid : wins[0];
  }
  function underdogLine(nm) { return nm + ', darling, come in! It was a tie, but I have a soft spot for the underdog! 💖'; }
  function underdog(wins, back) {
    var w = underdogOf(wins), nm = players[w] ? players[w].name : '';
    if (REMOTE) { mgGo([w], back, underdogLine(nm)); return; }
    stopTimers(); G.phase = 'loading'; G.q = null; G.best = null; push();
    hostSay('him', 'It’s a tie! But only one can go shopping…', 3400);
    setTimeout(function () { hostSay('her', 'Lynda sent us a message: she has a soft spot for the underdog, so ' + nm + ', the lowest scorer of the tied players, goes to the boutique! 💌', 5600); }, 3600);
    setTimeout(function () { mgGo([w], back, underdogLine(nm)); }, 3600 + 5800);
  }
  function mgGo(wins, back, line) {
    var names = wins.map(function (k) { return players[k].name; });
    FUN.shopwin = { icon: '🛍️', title: 'Woodruff’s Boutique', sub: (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' win' : names[0] + ' wins') + ' this party game, and may buy an item in the boutique!' };
    Music.douze(); shopVisit(wins, 1, function () { backFromShop(wins.length, back); }, true, line, true);   // only the winner shops: one item from each shelf, to buy with points   // straight to the boutique: the winner chooses one
  }
  // The tie-break vote: which fake translation was the funniest?
  var funnyDone = null, FUNNY_MS = 15000;
  var funnyTie = null;
  function funnyVote(wins, fakes, done, tie) {
    stopTimers(); G.draw = null; G.song = null; G.clip = null; funnyDone = done; funnyTie = tie || null;
    G.best = { pick: true, funny: true, pids: wins.slice(), id: 'funny' + G.round, tally: null, wins: null };
    G.q = { subject: 'pick', type: 'mc', text: 'It’s a tie! Vote for the funniest fake translation:', hint: '', options: wins.map(function (k) { return '“' + fakes[k] + '” (' + players[k].name + ')'; }), correct: -1, answer: '', noclip: true };
    list().forEach(function (p) { p.pick = null; });
    if (!REMOTE) { cover(true, '😂', 'Tie-break!', false); masks(true); $('cover').classList.add('funcard'); stageEl().classList.add('novideo'); hostSay('him', 'It’s a tie! Which fake translation was the funniest? Vote on your phone! 😂', 4600); }
    G.guessAt = Date.now(); G.phase = 'guess'; G.barMs = FUNNY_MS; G.endsAt = Date.now() + FUNNY_MS; push();
    endTimer = setTimeout(reveal, FUNNY_MS);
  }
  function funnyPicked(tops) {
    clearTimeout(picksTimer); stopTimers();
    var tie = funnyTie; funnyTie = null;
    if (tie && tops.length !== 1) {   // the vote is a tie too (or nobody voted): Lynda picks the underdog
      list().forEach(function (p) { p.pick = null; }); G.best = null; G.q = null; funnyDone = null; tie(); return;
    }
    var w = tops.length ? G.best.pids[pick(tops)] : pick(G.best.pids), nm = players[w] ? players[w].name : '';
    list().forEach(function (p) { p.pick = null; });
    G.best = null; G.q = null; G.phase = 'loading'; push();
    if (!REMOTE) hostSay('her', nm + '’s translation was the funniest! Off to Lynda’s boutique! 🛍️', 3600);
    var d = funnyDone; funnyDone = null;
    setTimeout(function () { if (d) d(w); }, 3800);
  }
  function shopAll() { shopGo(null, 1, function () { startRound(); }); }
  // The first visit: the presenters welcome Europe back, the boutique appears on the screen between them,
  // they announce it, and the whole studio moves over to the shop.
  // The presenters welcome Europe back, a card appears on the screen between them, they announce what comes, then it starts.
  function studioIntro(icon, title, sub, line, then, kind) {
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.fun = { kind: kind, icon: '', title: '', sub: '', plain: true, quiet: true }; G.phase = 'fun'; G.barMs = 0;
    cover(true, '', '', false); masks(true); $('cover').classList.add('funcard'); $('cover').classList.add('introcard'); push();
    var at = function (ms, f) { setTimeout(function () { if (G.phase === 'fun' && G.fun && G.fun.kind === kind) f(); }, ms); };
    var hh = hostsEl(), on = hh && !hh.classList.contains('away'), d = on ? -2000 : 0; hostHold = true; clearTimeout(hostT.away);   // already on stage (right after the opening): no "welcome back"
    if (!on) at(200, function () { hostSay('him', vary('back'), 4000); });
    if (hh) hh.classList.add('together');
    at(2400 + d, function () { var h2 = hostsEl(); if (h2) h2.classList.remove('together');   // the card comes between them
      G.fun.icon = icon; G.fun.title = title; G.fun.sub = sub; cover(true, icon, title, false); $('cover').classList.add('funcard'); $('cover').classList.add('introcard'); Music.ding(); whooshes([0]); push(); });
    at(3700 + d, function () { hostSay('her', line, 3400); });
    at(7200 + d, function () { hostHold = false; then(); });
    setTimeout(function () { hostHold = false; }, 7600 + d);
  }
  // Back in the studio after the boutique: the presenters hope you found something nice, and it's trivia time again.
  function backFromShop(n, then) {
    if (REMOTE) { then(); return; }
    G.phase = 'loading'; cover(true, '', '', false); masks(true); $('cover').classList.add('funcard'); push();
    hostHold = true; clearTimeout(hostT.away);
    hostSay('him', vary('souvenir') + ' ' + vary('onward'), 3600);
    setTimeout(function () { hostSay('her', G.mgTest ? 'On to the next party game! 🎉' : vary('trivia'), 3000); }, 3300);   // (testing the party games: there is no trivia in between)
    setTimeout(function () { hostHold = false; then(); }, 6400);
  }
  function shopIntro() {
    if (REMOTE) { partyGo('shop'); return; }
    G.mode = G.lastParty = 'shop'; G.best = null; G.q = null; G.afterParty = true; G.mgBase = null;
    studioIntro('🛍️', 'Woodruff’s Boutique', FUN.shop.sub, 'It’s time to visit Woodruff’s Boutique!', function () {
      var v = $('v-game'); v.classList.remove('enter'); v.classList.add('leaving'); whooshes([0, 300, 550, 800]);
      setTimeout(function () { shopVisit(null, 1, function () { backFromShop(2, startRound); }); }, 1400);
    }, 'shop');
  }
  // To the boutique: a presenter sends us there, the studio slides away (presenters first), and the shop slides in.
  function shopGo(who, n, then) {
    if (REMOTE || $('v-game').classList.contains('hidden')) { shopVisit(who, n, then); return; }
    stopTimers(); hostsEl();
    hostSay('him', vary('lynda'), 2600); Music.ding();
    setTimeout(function () {
      var v = $('v-game'); v.classList.remove('enter'); v.classList.add('leaving'); whooshes([0, 300, 550, 800]);
      setTimeout(function () { shopVisit(who, n, then); }, 1400);
    }, 2200);
  }   // the first visit: everyone, one item each
  // A visit to the boutique: who (null: everyone), how many items each, and what comes after.
  function shopVisit(who, n, then, win, line, buy) {
    var act = list().filter(function (p) { return !p.off && (!who || who.indexOf(p.pid) >= 0); });
    if (!act.length) { then(); return; }
    stopTimers(); G.q = null; G.song = null; G.clip = null; G.draw = null; G.best = null;
    if (!REMOTE) { try { yt.pauseVideo(); } catch (e) {} }
    var old = $('shopov'); if (old) old.remove();   // (a fresh boutique, sliding in)
    // everyone gets their own selection of two, and Lynda spreads her stock: as many different items as possible go round
    var stock = !win && !buy ? shopAvail().filter(function (it) { return it.tier === 1; }) : shopAvail();   // (the free welcome item comes from the bargain shelf)
    var offer = {}, deck = [], deal = function (mine) { if (!deck.length) deck = shuffle(stock.map(function (it) { return it.id; })); var i = 0; while (i < deck.length && mine.indexOf(deck[i]) >= 0) i++; if (i === deck.length) { deck = deck.concat(shuffle(stock.map(function (it) { return it.id; }))); while (mine.indexOf(deck[i]) >= 0) i++; } return deck.splice(i, 1)[0]; };
    var mayHave = function (p, it) { return it.id !== 'bribe' || !(p.bribed || (p.inv || []).indexOf('bribe') >= 0); };   // one envelope for the EBU per player, ever
    if (buy) act.forEach(function (p) { offer[p.pid] = [3, 2, 1].map(function (t) { var row = stock.filter(function (it) { return it.tier === t && mayHave(p, it); }); return row.length ? pick(row).id : null; }).filter(Boolean); });   // the winner's trip: one from each shelf
    else act.forEach(function (p) { var mine = []; while (mine.length < Math.min(SHOP_OFFER, stock.length)) mine.push(deal(mine)); offer[p.pid] = mine; });
    G.shop = { id: 'shop' + G.round + '-' + Math.random().toString(36).slice(2, 6), picks: {}, over: false, n: n, who: act.map(function (p) { return p.pid; }), then: then, offer: offer, win: !!win, line: line || '', buy: !!buy, free: Array.isArray(buy) ? buy.slice() : [], paid: {} };
    // the very first visit: Lynda first tells what her boutique is, then offers everyone a free item, and only then the choice
    var talk = !win && !line && !G.shopTalked && !REMOTE, TALK1 = 7600, TALK2 = 6000;
    if (talk) { G.shopTalked = true; G.shop.talk = 1; G.phase = 'shop'; G.barMs = 0; push(); Music.ding(); var g0 = G.shop; setTimeout(function () { if (G.shop === g0) { g0.talk = 2; push(); render(); } }, TALK1); setTimeout(function () { if (G.shop === g0) { g0.talk = 0; shopOpen(); } }, TALK1 + TALK2); return; }
    shopOpen();
  }
  function shopOpen() {
    var n = G.shop.n, offer = G.shop.offer;
    G.phase = 'shop'; G.barMs = SHOP_MS; G.endsAt = Date.now() + SHOP_MS; push(); Music.ding();
    var id = G.shop.id;
    var buy = G.shop.buy;
    bots.forEach(function (b) { if (G.shop.who.indexOf(b.pid) >= 0) setTimeout(function () {
      if (!buy) { shopMsg({ pid: b.pid, id: id, items: shopRandom(n, offer[b.pid]) }); return; }
      if (G.shop && G.shop.free.indexOf(b.pid) >= 0) { shopMsg({ pid: b.pid, id: id, items: shopRandom(1, offer[b.pid]) }); return; }
      var p = players[b.pid], can = (offer[b.pid] || []).filter(function (x) { return p && shopPrice(shopItem(x)) <= p.score; });
      shopMsg(can.length && Math.random() < 0.75 ? { pid: b.pid, id: id, items: [pick(can)] } : { pid: b.pid, id: id, items: [], skip: 1 });
    }, 16000 + Math.random() * 8000); });   // (about 20 seconds to make up their mind)
    clearTimeout(shopTimer); shopTimer = setTimeout(shopDone, SHOP_MS);
  }
  function cardPay(p) { var o = p.cardNow && players[p.cardNow]; if (!o || o === p) return; var c = Math.min(2, Math.max(0, p.score)); if (!c) return; p.score -= c; p.pts = (p.pts || 0) - c; o.score += c; o.pts = (o.pts || 0) + c; o.got = true; }   // (the Eurovision Credit Card: a right answer pays its owner 2 points)
  function shielded(p) { return !!(p && p.inv && p.inv.indexOf('umbrella') >= 0); }   // the Eurovision Umbrella: nobody can aim an item at you (a Broken Heel still can)
  function usesLeft(p, id) { return (p && p.uses && p.uses[id]) || 0; }
  function useOne(p, id) { p.uses = p.uses || {}; p.uses[id] = Math.max(0, (p.uses[id] || 1) - 1); useSync(p, id); }   // (the last use: the item is gone)
  function umbBlock(p) { if (!shielded(p)) return false; useOne(p, 'umbrella'); return true; }
  function shopLater(it) { return it.kind === 'bribe' || it.kind === 'heel' || it.kind === 'smoke'; }   // (the heel and the envelope: secrets)   // secret and delivery items: any time, even during a party game
  function qKeyNow() { return G.round + '|' + (G.q ? G.q.text : ''); }
  // Someone gets an item (bought, free or picked by Lynda): a cash-register "ka-ching"
  var itemGetEl = null;
  function itemGetSnd() { if (REMOTE) return; try { if (!itemGetEl) itemGetEl = new Audio('sounds/item_get.mp3'); itemGetEl.currentTime = 0; itemGetEl.volume = Math.max(0, Math.min(1, 0.8 * (Music.vol ? Music.vol.fx : 1))); var pr = itemGetEl.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  function shopGive(p, ids) { ids.forEach(function (id) { var it = shopItem(id); if (it && it.uses) { p.uses = p.uses || {}; p.uses[id] = (p.uses[id] || 0) + it.uses; } }); return ids; }   // (the Eurovision Fan: one item in the bag, with 3 uses)
  function useSync(p, id) { var it = shopItem(id), per = (it && it.uses) || 1, want = Math.ceil(usesLeft(p, id) / per), inv = p.inv || []; while (inv.filter(function (x) { return x === id; }).length > want) inv.splice(inv.lastIndexOf(id), 1); }   // (an item with 3 uses: three in the bag)
  function shopPrice(it) { return shopPriceOf(it, G.block || 3); }   // (more questions per block of trivia: dearer)
  function shopAvail() { return SHOP_ITEMS.filter(function (it) { return (!it.final || G.finalMode === 'chase') && !soldOut(it.id); }); }
  // Some items are one of a kind (stock: 1): once someone has it, it is gone from the boutique for the rest of the game.
  function soldOut(id) { var it = shopItem(id); return !!(it && it.stock && ((G.sold || {})[id] || 0) >= it.stock); }
  function shopTake(ids) { G.sold = G.sold || {}; ids.forEach(function (id) { var it = shopItem(id); if (it && it.stock) G.sold[id] = (G.sold[id] || 0) + 1; }); }
  function shopRandom(n, from) { var ids = from || shopAvail().map(function (it) { return it.id; }), out = []; for (var i = 0; i < (n || SHOP_PICKS); i++) out.push(pick(ids)); return out; }
  // Bots and their items: every trivia question a bot with items has a chance to use one,
  // 10% at first and 10% more for every question it waits. The Broken Mic waits for the question to open.
  var SHOP_OPEN_ONLY = ['sit', 'blow', 'lose', 'steal', 'thief', 'flag', 'half', 'card'];   // instant items: only while a question is open
  function botItems() {
    var alive = list().filter(function (x) { return !x.off; }), done = false;
    shuffle(list().slice()).forEach(function (b) {   // (at most one bot per question, so they never all go at once)
      if (done || !b.bot || b.off || !b.inv || !b.inv.length) return;
      var ch = b.useP || 0.1;
      if (Math.random() >= ch) { b.useP = Math.min(1, ch + 0.1); return; }
      var ids = b.inv.filter(function (id) { var it = shopItem(id); return it && it.kind !== 'shield' && it.kind !== 'skates' && it.kind !== 'fan'; });
      if (!ids.length) return;
      b.useP = 0.1; done = true;
      var id = pick(ids), it = shopItem(id), others = alive.filter(function (x) { return x !== b && (it.kind === 'heel' || !shielded(x)); });
      var self = it.kind === 'smoke' || it.kind === 'bribe' || it.kind === 'thief';
      if (!self && !others.length) return;
      var t = self ? b : pick(others), key = 'bot' + Date.now() + Math.random();
      if (SHOP_OPEN_ONLY.indexOf(it.kind) >= 0) {   // the Broken Mic and the other instant items: a few seconds into the question
        var tries = 0; (function tryMic() { if (++tries > 8 || !players[b.pid]) return; if (G.phase === 'guess' && G.q) { setTimeout(function () { if (G.phase === 'guess' && G.q && !(it.kind === 'sit' && t.sitNow)) shopMsg({ pid: b.pid, use: id, target: t.pid, key: key }); }, 1500 + Math.random() * 3500); return; } setTimeout(tryMic, 1500); })();
        return;
      }
      shopMsg({ pid: b.pid, use: id, target: t.pid, key: key });
    });
  }
  function shopMsg(m) {
    var p = m && players[m.pid]; if (!p) return;
    if (m.items) {   // shopping
      var g = G.shop; if (G.phase !== 'shop' || !g || g.over || m.id !== g.id || g.picks[p.pid] || g.who.indexOf(p.pid) < 0) return;
      var own = (g.offer || {})[p.pid], items = (m.items || []).filter(function (x) { return !!shopItem(x) && (!own || own.indexOf(x) >= 0); }).slice(0, g.n || SHOP_PICKS);
      items = items.filter(function (x) { return !soldOut(x); });   // (someone else was just quicker)
      if (!items.length && !m.skip) return;
      if (g.buy) {   // after a party game: one item each, free for the winner, paid for with points by the rest (or nothing)
        if (m.skip) items = [];
        else { items = items.slice(0, 1); var pr = items.length && g.free.indexOf(p.pid) < 0 ? shopPrice(shopItem(items[0])) : 0; if (!items.length || pr > p.score) return; p.score -= pr; g.paid[p.pid] = pr; }
      } else if (!items.length) return;
      g.picks[p.pid] = items; shopTake(items); p.inv = (p.inv || []).concat(shopGive(p, items));
      if (items.length) itemGetSnd(); else Music.plop(Object.keys(g.picks).length); push();
      if (g.who.filter(function (k) { return players[k] && !players[k].off; }).every(function (k) { return g.picks[k]; })) { clearTimeout(shopTimer); shopTimer = setTimeout(shopDone, 1500); }
      return;
    }
    if (m.use) {   // using an item: it lands before the next question
      if (G.atype !== 'party' || ['lobby', 'end', 'brief', 'intro', 'chase'].indexOf(G.phase) >= 0) return;
      if (m.key && p.useKey === m.key) return; p.useKey = m.key;   // (the phone sends twice, to be sure)
      var inv = p.inv || [], k = inv.indexOf(m.use), t = players[m.target];
      var it0 = shopItem(m.use); if (it0 && (it0.kind === 'smoke' || it0.kind === 'bribe' || it0.kind === 'thief' || it0.kind === 'fan')) t = p;   // (no target: it is the user's own smoke)
      if (k < 0 || !t || (t === p && !(it0 && (it0.kind === 'smoke' || it0.kind === 'bribe' || it0.kind === 'thief' || it0.kind === 'fan')))) return;
      var it = shopItem(m.use); if (!it || it.kind === 'shield' || it.kind === 'skates') return;   // (the umbrella works by itself)
      if (t !== p && it.kind !== 'heel' && shielded(t)) return;   // under an umbrella: out of reach
      if (G.mgLive && !shopLater(it)) return;   // not during a party game: items are for the trivia (only what works at the Grand Final can go any time)
      var open = G.phase === 'guess' && !!G.q && G.q.subject !== 'pick' && G.q.subject !== 'best' && !G.draw && !G.sing && !G.q.battle;
      if (it.kind === 'sit' && (!open || t.sitNow)) return;   // the Broken Mic only works on an open question
      if (SHOP_OPEN_ONLY.indexOf(it.kind) >= 0 && !open) return;   // these too: only while a question is open, and then they land straight away
      if (it.kind === 'fan') {   // the Eurovision Fan: on your own phone, half of the wrong answers of this question blow away (quietly: no siren)
        var q = G.q; if (!open || !q || q.type !== 'mc' || !(q.correct >= 0) || !q.options || q.options.length !== 4) return;   // (only on a question with four answers)
        var key = qKeyNow(); if (!G.fanQ || G.fanQ.key !== key) G.fanQ = { key: key, map: {} }; if (G.fanQ.map[p.pid]) return;   // (once per question)
        var wrong = shuffle(q.options.map(function (o, i) { return i; }).filter(function (i) { return i !== q.correct; }));
        G.fanQ.map[p.pid] = wrong.slice(0, Math.min(wrong.length - 1, Math.round(wrong.length / 2)));   // (half, rounded: three wrong answers lose two; one always stays)
        useOne(p, 'fan'); Music.blip(); push();
        shopFlash('🪭 ' + p.name + ' waves the Eurovision Fan!'); return;
      }
      if (it.kind === 'heel') { inv.splice(k, 1); (G.heels = G.heels || []).push({ by: p.pid, to: t.pid }); push(); return; }   // secret: revealed when the Grand Final starts
      if (it.kind === 'bribe') { inv.splice(k, 1); p.bribed = 1; (G.bribes = G.bribes || []).push(p.pid); push(); return; }   // secret: it pays out right before the final
      if (it.kind === 'smoke') { inv.splice(k, 1); (G.shopQ = G.shopQ || []).push({ by: p.pid, item: it.id, target: p.pid }); Music.blip(); push(); return; }   // the Smoke Machine waits for the next question
      if (open && it.kind !== 'heel') {   // during a question: it lands right away (the Broken Heel is always a delivery, before the next question); the video and the timer stop while it does
        inv.splice(k, 1);
        shopFreeze(7800 + ALARM_MS, function () { itemAlarm(function () { var txt = shopApply({ by: p.pid, item: it.id, target: t.pid }); if (txt) shopHit(txt, 7600); push(); }); });
        return;
      }
      inv.splice(k, 1); (G.shopQ = G.shopQ || []).push({ by: p.pid, item: m.use, target: t.pid });
      Music.blip(); push();
    }
  }
  function shopDone() {
    var g = G.shop; if (G.phase !== 'shop' || !g || g.over) return;
    clearTimeout(shopTimer); g.over = true;
    g.who.forEach(function (k) { var p = players[k]; if (!p || p.off || g.picks[k]) return; if (g.buy && g.free.indexOf(k) < 0) { g.picks[k] = []; return; }   // (buying: too late is no sale; the winner's free item comes anyway)
      var it = shopRandom(g.n, ((g.offer || {})[k] || []).filter(function (x) { return !soldOut(x); })); if (!it.length || it.some(function (x) { return !x; })) it = shopRandom(g.n, shopAvail().filter(function (x) { return x.tier === 1; }).map(function (x) { return x.id; })); g.picks[k] = it; shopTake(it); p.inv = (p.inv || []).concat(shopGive(p, it)); itemGetSnd(); });   // too late: a surprise bag
    Music.ding(); push();
    shopTimer = setTimeout(function () {   // the boutique slides away, then the show goes on
      if (G.phase !== 'shop') return;
      var ov = $('shopov'); if (ov) { ov.classList.remove('enter'); ov.classList.add('leaving'); } whooshes([0, 250, 500]);
      shopTimer = setTimeout(function () {
        if (G.phase !== 'shop') return;
        var then = g.then || startRound, v = $('v-game'); G.shop = null;
        $('cover').classList.remove('introcard');
        if (v.classList.contains('leaving')) { v.classList.remove('leaving'); G.phase = 'loading'; cover(true, '', '', false); push(); viewEnter('v-game'); setTimeout(then, 2100); }   // the studio slides back in first
        else then();
      }, 1300);
    }, 3800);
  }
  // The used items land: one card on the big screen with everything that happens, then the next question.
  function shopDeliver(then) {
    var q = G.shopQ || []; G.shopQ = [];
    var step = function (i) {   // one at a time, each with its own big announcement
      if (i >= q.length) { then(); return; }
      itemAlarm(function () {
        var txt = shopApply(q[i]); if (!txt) { step(i + 1); return; }
        FUN.shopgo = { icon: shopLast.icon, title: 'Special delivery!', sub: txt };
        funIntro('shopgo', function () { step(i + 1); }, 7800);
        shopHit(txt, 7600);
      });
    };
    step(0);
  }
  // The envelopes for the EBU: right before the final, a tenth of the leader's score is shared among everyone who sent one
  // (two envelopes from one player: two shares).
  function ebuCalc() {   // who sent an envelope, and what each gets (not paid yet); null when nobody did
    var bs = (G.bribes || []).filter(function (k) { return players[k]; }); G.bribes = [];
    if (!bs.length) return null;
    var top = Math.max.apply(null, list().map(function (p) { return p.score; })), got = {}, pot = 0;
    bs.forEach(function (k) { var v = Math.max(1, Math.round(top * (0.1 + Math.random() * 0.1))); got[k] = (got[k] || 0) + v; pot += v; });   // every envelope: a random 10 to 20% of the leader's score
    var names = Object.keys(got).map(function (k) { return players[k].name; });
    return { got: got, pot: pot, names: names, txt: '✉️ ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' bribed' : names[0] + ' bribed') + ' the EBU! ' + (names.length > 1 ? 'Extra points for all of them.' : pot + ' points for them.') };
  }
  // Party: before the Grand Final, the presenters show the scores in their studio. If anyone sent an envelope to the
  // EBU, a courier rushes in with a brown envelope, the presenters open it in front of everyone, and the bribes pay out.
  var COURIER = '<svg class="courier" viewBox="0 0 220 440" aria-hidden="true"><ellipse cx="110" cy="432" rx="70" ry="8" fill="rgba(0,0,0,.35)"/><g class="cleg l"><rect x="80" y="290" width="26" height="120" rx="10" fill="#5a3a1c"/><path d="M72 404 h40 v18 h-46 q-4-10 6-18z" fill="#222"/></g><g class="cleg r"><rect x="114" y="290" width="26" height="120" rx="10" fill="#6b4522"/><path d="M110 404 h40 q10 8 6 18 h-46z" fill="#222"/></g><path d="M66 170 Q110 150 154 170 L162 300 Q110 312 58 300 Z" fill="#8a5a2b"/><path d="M66 170 Q110 150 154 170 L150 196 Q110 182 70 196 Z" fill="#a26c36"/><rect x="58" y="282" width="104" height="16" rx="4" fill="#4a2e14"/><rect x="102" y="282" width="16" height="16" rx="3" fill="#ffd166"/><rect x="74" y="210" width="32" height="20" rx="4" fill="#ffd166"/><text x="90" y="225" font-size="13" font-weight="900" text-anchor="middle" fill="#5a3a1c">EXP</text><path d="M66 176 Q40 220 50 270" stroke="#8a5a2b" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="51" cy="274" r="12" fill="#e8b58f"/><path class="carm" d="M154 176 Q190 200 196 236" stroke="#8a5a2b" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="196" cy="242" r="12" fill="#e8b58f"/><rect x="98" y="132" width="24" height="26" rx="8" fill="#e8b58f"/><ellipse cx="110" cy="100" rx="40" ry="44" fill="#e8b58f"/><ellipse cx="96" cy="100" rx="5" ry="6" fill="#222"/><ellipse cx="124" cy="100" rx="5" ry="6" fill="#222"/><path d="M96 122 Q110 134 124 122" stroke="#7a2a1a" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="84" cy="114" rx="7" ry="4" fill="#ff8f8f" opacity=".5"/><ellipse cx="136" cy="114" rx="7" ry="4" fill="#ff8f8f" opacity=".5"/><path d="M68 84 Q70 48 110 46 Q150 48 152 84 Z" fill="#6b4522"/><path d="M62 84 h104 q6 0 4 8 q-56 6 -112 0 q-2-8 4-8z" fill="#4a2e14"/><rect x="100" y="56" width="20" height="14" rx="3" fill="#ffd166"/></svg>';   // (an original character: a courier in a brown uniform)
  function partyStandings(then) {
    var gf = chaseWanted(), e = ebuCalc();
    try { yt.pauseVideo(); } catch (e2) {} G.fsMusic = true; Music.want(true);   // the song stops: the studio music plays under the scores
    var then0 = then; then = function () { G.fsMusic = false; Music.want(false); then0(); };
    var old = $('fsov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'fsov'; ov.className = 'grov hsov hs-scores fsov enter';
    var ps = list().slice().sort(function (a, b) { return b.score - a.score; }), n = ps.length;
    ov.style.setProperty('--rh', Math.min(7.5, 66 / Math.max(1, n)).toFixed(2) + 'vh');
    ov.innerHTML = '<div class="grwall"></div><div class="grfloor"></div><div class="hsspot"></div><div class="fssiren"></div><div class="grsign hssign">🏆 The Final Scores</div>' +
      '<div class="fsboard"><ol>' + ps.map(function (p, i) { return '<li data-pid="' + esc(p.pid) + '"><b class="rk">' + (i + 1) + '</b><span class="who">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></span><span class="gain"></span><span class="tot">' + p.score + '</span></li>'; }).join('') + '</ol></div>' +
      '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>' +
      '<div class="fscour">' + COURIER + '<div class="fscbub"></div></div><div class="fsenv"><div class="fsback"></div><div class="fsletter"><b>EBU</b><i>Official notice</i><span></span></div><div class="fsfront"></div><div class="fsflap"></div><div class="fsseal">EBU</div></div>';
    document.body.appendChild(ov); whooshes([0, 350, 700]); Music.ding(); hostHold = true;
    setTimeout(function () { ov.classList.remove('enter'); }, 2600);
    var say = function (who, txt) { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); return typeSay(b, txt, who); };
    var t = 0, at = function (ms, f) { t += ms; setTimeout(function () { if (ov.isConnected) f(); }, t); };
    var lineMs = function (txt) { return Math.max(3400, Array.from(txt).length * TALK_MS + 2200); };
    var lead = function () { var top = Math.max.apply(null, list().map(function (p) { return p.score; })), ls = ps.filter(function (p) { return p.score === top; }).map(function (p) { return p.name; }); return ls.length > 1 ? ls.slice(0, -1).join(', ') + ' and ' + ls[ls.length - 1] + ' share the lead with ' + top + ' points! 👑' : ls[0] + ' is in the lead with ' + top + ' points! 👑'; };
    var reorder = function () {
      var ol = ov.querySelector('ol'), lis = [].slice.call(ol.children), was = {}; lis.forEach(function (li) { was[li.getAttribute('data-pid')] = li.getBoundingClientRect().top; });
      lis.sort(function (a, b) { return (players[b.getAttribute('data-pid')] || {}).score - (players[a.getAttribute('data-pid')] || {}).score; }).forEach(function (li, i) { ol.appendChild(li); li.querySelector('.rk').textContent = i + 1; });
      lis.forEach(function (li) { var dy = was[li.getAttribute('data-pid')] - li.getBoundingClientRect().top; if (Math.abs(dy) < 2) return; li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)'; li.getBoundingClientRect(); li.style.transition = 'transform .9s cubic-bezier(.22,.8,.3,1)'; li.style.transform = ''; });
      ps = list().slice().sort(function (a, b) { return b.score - a.score; }); push();
    };
    var l1 = gf ? 'Europe, before the Grand Final… let’s look at the scores! 📊' : 'Europe, it’s time for the final scores! 📊';
    at(1600, function () { say('him', l1); });
    at(lineMs(l1) - 1200, function () { [].slice.call(ov.querySelectorAll('li')).reverse().forEach(function (li, i) { setTimeout(function () { li.classList.add('on'); Music.plop(i % 8); }, i * 380); }); });   // last place first
    at(n * 380 + 900, function () { ov.querySelector('li').classList.add('top'); say('her', lead()); });
    var l2 = lead(); t += lineMs(l2);
    if (e) {
      var nm = e.names.length > 1 ? e.names.slice(0, -1).join(', ') + ' and ' + e.names[e.names.length - 1] : e.names[0], paid = Object.keys(e.got).reduce(function (a, k) { return a + e.got[k]; }, 0);
      at(0, function () { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); Music.thump && Music.thump(); [0, 260, 520].forEach(function (d) { setTimeout(function () { Music.step(); }, d); }); });   // knock, knock, knock
      var k1 = 'Wait… is somebody knocking? 🚪'; at(900, function () { say('him', k1); });
      at(lineMs(k1) - 800, function () { ov.classList.add('cin'); var steps = setInterval(function () { if (!ov.isConnected || !ov.classList.contains('cin') || ov.classList.contains('cstop')) { clearInterval(steps); return; } Music.step(); }, 330); });   // the courier runs in
      at(2600, function () { ov.classList.add('cstop'); var cb = ov.querySelector('.fscbub'); cb.classList.add('on'); typeSay(cb, 'Special delivery from the EBU! 📦 Sign here, please!', 'him'); });
      at(3600, function () { say('him', 'A brown envelope… from the EBU?! 😱'); ov.classList.add('shock'); Music.dread(true); });
      at(3400, function () { ov.querySelector('.fscbub').classList.remove('on'); ov.classList.add('cgive'); Music.blip(); });   // the envelope changes hands
      at(1100, function () { ov.classList.add('cout'); whooshes([0]); });   // and off he goes
      at(1400, function () { ov.classList.add('envbig'); whooshes([0]); var h = 'Let’s open it… 🥁'; say('her', h); });
      at(2600, function () { ov.classList.add('envopen'); Music.ping(); ov.querySelector('.fsletter span').textContent = 'With thanks for the… very generous gifts. 💸 ' + Object.keys(e.got).map(function (k) { return (players[k] ? players[k].name : '') + ' +' + e.got[k]; }).join(' · '); });
      var sc = 'Scandalous! ' + nm + ' bribed the EBU! 🤑 ' + (e.names.length > 1 ? 'Extra points for all of them!' : paid + ' points for ' + nm + '!');
      at(1800, function () { ov.classList.add('siren'); say('her', sc); Music.buzz && Music.buzz(); });
      var rr = 'Well… the EBU has spoken. Rules are rules! 🤷'; t += lineMs(sc) - 1200;
      at(0, function () { say('him', rr); ov.classList.remove('siren'); });
      at(lineMs(rr) - 1400, function () {   // the envelope goes, and the points count in on the board
        ov.classList.remove('envbig'); ov.classList.remove('envopen'); ov.classList.add('envgone'); ov.classList.remove('shock'); Music.dread(false);
        Object.keys(e.got).forEach(function (k, i) {
          var p = players[k], li = ov.querySelector('li[data-pid="' + k.replace(/"/g, '') + '"]'); if (!p || !li) return;
          setTimeout(function () {
            var ge = li.querySelector('.gain'), el = li.querySelector('.tot'), from = p.score; p.score += e.got[k]; ge.textContent = '✉️ +' + e.got[k]; ge.classList.add('on'); li.classList.add('bribed'); Music.plop(i);
            setTimeout(function () { var t0 = Date.now(); (function f() { var q = Math.min(1, (Date.now() - t0) / 700); el.textContent = Math.round(from + e.got[k] * q); if (q < 1) requestAnimationFrame(f); })(); }, 700);
          }, 600 + i * 500);
        });
      });
      at(1900 + Object.keys(e.got).length * 500, function () { [].forEach.call(ov.querySelectorAll('li.top'), function (x) { x.classList.remove('top'); }); reorder(); setTimeout(function () { var f = ov.querySelector('li'); if (f) f.classList.add('top'); }, 900); });
      var l3 = ''; at(1400, function () { l3 = lead(); say('her', l3); });
      t += 3800;
    }
    var bye = gf ? 'And now… it’s time for the Grand Final! 🏆' : 'What a game, Europe! 🎉';
    at(0, function () { say('him', bye); });
    at(lineMs(bye), function () { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); ov.classList.add('leaving'); whooshes([0, 300]); });
    at(1000, function () { hostHold = false; ov.remove(); then(); });
  }
  function ebuPay(then) {
    var e = ebuCalc(); if (!e) { then(); return; }
    var got = e.got, pot = e.pot, names = e.names;
    Object.keys(got).forEach(function (k) { players[k].score += got[k]; });
    shopLast = { icon: '✉️', sound: 'steal', deltas: Object.keys(got).map(function (k) { return { pid: k, n: got[k] }; }) };
    var txt = '✉️ ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' bribed' : names[0] + ' bribed') + ' the EBU! ' + (names.length > 1 ? 'Extra points for all of them' : pot + ' points') + ' before the Grand Final.';
    FUN.shopgo = { icon: '✉️', title: 'A brown envelope…', sub: txt };
    funIntro('shopgo', then, 9000); shopHit(txt, 8800);
  }
  // What an item does; returns the line for the big screen.
  var shopLast = null, SHOP_OFFER = 2;   // what the last item did: { icon, deltas: [{ pid, n }] }, for the big announcement
  function shopApply(u) {
    var by = players[u.by], t = players[u.target], it = shopItem(u.item); if (!by || !t || !it) return '';
    shopLast = { icon: it.icon, deltas: [], sound: it.kind };
    var ui = (it.kind === 'lose' || it.kind === 'blow' || it.kind === 'steal' || it.kind === 'sit' || it.kind === 'flag' || it.kind === 'half' || it.kind === 'card' || it.kind === 'heel') && t.inv ? t.inv.indexOf('umbrella') : -1;
    ui = -1;   // (the umbrella keeps aimed items away before they are used: nothing to block here)
    if (ui >= 0) { useOne(t, 'umbrella'); var ul = usesLeft(t, 'umbrella'); shopLast = { icon: '☂️', deltas: [{ pid: by.pid, tag: it.icon }, { pid: t.pid, tag: '☂️ blocked' }], sound: 'block' }; return '☂️ ' + by.name + ' tried the ' + it.name + ' on ' + t.name + ', but ' + t.name + '’s Eurovision Umbrella blocked it! (' + (ul ? ul + ' use' + (ul > 1 ? 's' : '') + ' left' : 'now it’s worn out') + ')'; }   // the umbrella takes it (one of its 3 uses)
    if (it.kind === 'smoke') { (G.smoke = G.smoke || []).push(by.pid); shopLast.deltas = [{ pid: by.pid, tag: it.icon }]; var safe = [];   /* (the smoke gets everyone, umbrella or not) */ safe.forEach(function (x) { G.smoke.push(x.pid); shopLast.deltas.push({ pid: x.pid, tag: '☂️ blocked' }); }); return it.icon + ' ' + by.name + ' fired up the Smoke Machine: the next answers are hidden in smoke!' + (safe.length ? ' ' + safe.map(function (x) { return x.name; }).join(' and ') + (safe.length > 1 ? ' stay' : ' stays') + ' dry under an umbrella.' : ''); }
    if (it.kind === 'thief') {   // a random item from a random player's bag (which one stays a secret)
      var loose = function (x) { return (x.inv || []).map(function (id, i) { return id === 'bribe' ? -1 : i; }).filter(function (i) { return i >= 0; }); };   // (an envelope for the EBU cannot be stolen)
      var bags = list().filter(function (x) { return x !== by && !x.off && loose(x).length; });
      if (!bags.length) { shopLast.sound = 'empty'; shopLast.deltas = [{ pid: by.pid, tag: it.icon }]; return it.icon + ' ' + by.name + ' used their wristband to get into the Euroclub, but every bag was empty!'; }
      var v = pick(bags);
      if (false) { shopLast.sound = 'block'; shopLast.icon = '☂️'; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: v.pid, tag: '☂️ blocked' }]; return '☂️ ' + by.name + ' sneaked into the Euroclub after ' + v.name + '’s bag, but ' + v.name + '’s umbrella kept it shut!'; }
      var gi = pick(loose(v)), loot = v.inv.splice(gi, 1)[0], lit = shopItem(loot);
      if (lit && lit.uses) {   // an item with uses goes with the uses it has left
        var nf = v.inv.filter(function (x) { return x === loot; }).length, mv = Math.max(1, usesLeft(v, loot) - nf * lit.uses);
        v.uses[loot] = Math.max(0, usesLeft(v, loot) - mv); by.uses = by.uses || {}; by.uses[loot] = (by.uses[loot] || 0) + mv;
      }
      by.inv = (by.inv || []).concat(loot);
      shopLast.deltas = [{ pid: by.pid, tag: '+1 item' }, { pid: v.pid, tag: '−1 item' }];
      return it.icon + ' ' + by.name + ' used their wristband to get into the Euroclub and left with an item from ' + v.name + '!';
    }
    if (it.kind === 'heel') { t.heel = 1; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: t.pid, tag: '👠 stuck in the Grand Final' }]; return it.icon + ' ' + by.name + ' broke ' + t.name + '’s heel! ' + t.name + ' can’t move on the first question of the Grand Final!'; }
    if (it.kind === 'card') { var cn = it.amount || 5; t.cardBy = by.pid; if (G.phase === 'guess') { t.cardNow = by.pid; t.cardQ = cn - 1; } else t.cardQ = cn; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: t.pid, tag: '💳 pays ' + by.name }]; return it.icon + ' ' + by.name + ' slipped the Eurovision Credit Card to ' + t.name + '! For ' + cn + ' questions, every right answer of ' + t.name + ' pays ' + by.name + ' 2 points! 💸'; }
    if (it.kind === 'half') { var hn = it.amount || 3; if (G.phase === 'guess') { t.halfNow = true; t.halfQ = (t.halfQ || 0) + hn - 1; } else t.halfQ = (t.halfQ || 0) + hn; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: t.pid, tag: '½ points · ' + hn + ' questions' }]; return it.icon + ' ' + by.name + ' gave ' + t.name + ' Limited View Liveshow Tickets: a pillar in the way! ' + t.name + ' gets half points ' + (G.phase === 'guess' ? 'for this question and the next ' + (hn - 1) : 'for the next ' + hn + ' questions') + '!'; }
    if (it.kind === 'flag') { if (G.phase === 'guess') { t.flagNow = true; t.flagged = (t.flagged || 0) + (it.amount || 3) - 1; } else t.flagged = (t.flagged || 0) + (it.amount || 3);   // (straight away: this question counts as the first of three)
 shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: t.pid, tag: '🙈 ' + (it.amount || 3) + ' questions' }]; return it.icon + ' ' + by.name + ' waves a giant flag in front of ' + t.name + ': ' + t.name + ' can’t see ' + (G.phase === 'guess' ? 'this question or the next ' + ((it.amount || 3) - 1) : 'the next ' + (it.amount || 3) + ' questions') + '!'; }
    if (it.kind === 'lose') { var n = Math.min(it.amount, Math.max(0, t.score)); t.score -= n; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, { pid: t.pid, n: -n }]; return it.icon + ' ' + by.name + (it.id === 'power' ? ' threw Marc’s Powerbank at ' + t.name : ' used the ' + it.name + ' on ' + t.name) + ': −' + n; }
    if (it.kind === 'blow') {   // blown over to whoever has the fewest points (not the one it was blown from; a tie: one of them)
      var rest = list().filter(function (x) { return !x.off && x !== t; }); if (!rest.length) return '';
      var low = Math.min.apply(null, rest.map(function (x) { return x.score; })), to = pick(rest.filter(function (x) { return x.score === low; }));
      var nb = Math.min(it.amount, Math.max(0, t.score)); t.score -= nb; to.score += nb; shopLast.deltas = (to === by ? [] : [{ pid: by.pid, tag: it.icon }]).concat([{ pid: t.pid, n: -nb }, { pid: to.pid, n: nb }]);
      return it.icon + ' ' + by.name + ' used the ' + it.name + ' on ' + t.name + ': ' + nb + ' points blown over to ' + (to === by ? by.name + ' (that’s them!)' : to.name);
    }
    if (it.kind === 'steal') { var n2 = Math.min(it.amount, Math.max(0, t.score)); t.score -= n2; by.score += n2; shopLast.deltas = [{ pid: t.pid, n: -n2 }, { pid: by.pid, n: n2 }]; return it.icon + ' ' + by.name + ' hacked ' + t.name + '’s televote: ' + n2 + ' points stolen'; }
    if (it.kind === 'sit') { t.sitNow = by.name; t.pick = null; shopLast.deltas = [{ pid: by.pid, tag: it.icon }, t.got && t.pts ? { pid: t.pid, n: -t.pts } : { pid: t.pid, tag: '🔇 muted' }]; if (t.got) { t.score -= t.pts || 0; t.got = false; t.pts = 0; } return it.icon + ' ' + by.name + ' broke ' + t.name + '’s mic: no points for this question!'; }
    return '';
  }
  // An item used during a question: everything stops for a moment (video, timer), the item lands, then it goes on.
  var freezeT = null;
  // After an item: make sure the video really runs again (the player can miss a single play command after a long pause).
  var frozeWasPlaying = false;
  function ytNudge() {
    if (REMOTE || !frozeWasPlaying) return;
    [700, 1600, 3000].forEach(function (ms) { setTimeout(function () {
      if (G.frozenLeft != null || isPair() || (G.q && G.q.noclip) || ['guess', 'picks'].indexOf(G.phase) < 0) return;
      try { var st = yt.getPlayerState(); if (st === 2 || st === 5 || st === -1) yt.playVideo(); } catch (e) {}
    }, ms); });
  }
  function shopFreeze(ms, apply) {
    if (G.phase !== 'guess') { apply(); push(); return; }
    if (G.frozenLeft == null) {
      G.frozenLeft = Math.max(0, G.endsAt - Date.now()); clearTimeout(endTimer);
      frozeWasPlaying = false; try { var ps = yt.getPlayerState(); frozeWasPlaying = ps === 1 || ps === 3; } catch (e) {}   // (was the video running? then it must run again afterwards)
      if (!REMOTE && !isPair()) { try { yt.pauseVideo(); } catch (e) {} }
    }
    apply(); push();
    clearTimeout(freezeT); freezeT = setTimeout(function () {
      if (G.frozenLeft == null) return;
      var left = G.frozenLeft; G.frozenLeft = null;
      if (G.phase !== 'guess') return;
      G.endsAt = Date.now() + left;
      if (!REMOTE && !isPair() && !(G.q && G.q.noclip)) { try { yt.playVideo(); } catch (e) {} ytNudge(); }
      push();
      if (G.revealPending) { G.revealPending = false; reveal(); return; }
      endTimer = setTimeout(reveal, left); allIn();
    }, ms);
  }
  // The big screen during the shopping: the items, and who has picked already.
  // The shopkeeper of Woodruff’s Boutique (an original character): big red curls, cat-eye glasses, an emerald sequinned jumpsuit.
  var SHOPKEEPER = '<svg class="keeper" viewBox="0 0 220 420" aria-hidden="true"><defs>' +
    '<linearGradient id="kpsuit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#19c48a"/><stop offset="1" stop-color="#0a6b52"/></linearGradient>' +
    '<radialGradient id="kpskin" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#f6d2b8"/><stop offset="1" stop-color="#d9a585"/></radialGradient>' +
    '<pattern id="kpsq" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="#d6fff0" opacity=".8"/><circle cx="9" cy="9" r="1.1" fill="#ffd23f" opacity=".8"/></pattern></defs>' +
    '<ellipse cx="110" cy="410" rx="64" ry="9" fill="rgba(0,0,0,.45)"/>' +
    '<path d="M80 250 L74 404 L102 404 L110 290 L118 404 L146 404 L140 250 Z" fill="url(#kpsuit)"/><path d="M80 250 L74 404 L102 404 L110 290 L118 404 L146 404 L140 250 Z" fill="url(#kpsq)"/>' +
    '<path d="M70 402 h34 l-2 10 h-34 z M116 402 h34 l2 10 h-34 z" fill="#ffd23f"/>' +
    '<path d="M70 146 Q110 132 150 146 L144 256 Q110 266 76 256 Z" fill="url(#kpsuit)"/><path d="M70 146 Q110 132 150 146 L144 256 Q110 266 76 256 Z" fill="url(#kpsq)"/>' +
    '<path d="M60 140 Q70 128 92 136 L84 160 Q66 160 60 140 Z M160 140 Q150 128 128 136 L136 160 Q154 160 160 140 Z" fill="#ffd23f"/>' +
    '<path d="M76 248 Q110 258 144 248 L144 256 Q110 266 76 256 Z" fill="#ffd23f"/>' +
    '<path d="M64 150 Q48 196 56 236 L70 236 Q66 200 78 166 Z" fill="url(#kpsuit)"/><circle cx="62" cy="242" r="9" fill="url(#kpskin)"/>' +
    '<g class="kbag"><path d="M150 152 Q172 190 168 214 L156 216 Q158 190 140 166 Z" fill="url(#kpsuit)"/><circle cx="163" cy="222" r="9" fill="url(#kpskin)"/>' +
    '<path d="M150 226 h34 l6 46 h-46 z" fill="#ff2fa8"/><path d="M158 228 q9 -16 18 0" stroke="#ffd23f" stroke-width="3" fill="none"/><text x="167" y="256" font-size="16" text-anchor="middle" fill="#fff">✦</text></g>' +
    '<rect x="102" y="116" width="16" height="24" fill="#d9a585"/>' +
    '<g fill="#c0392b"><circle cx="78" cy="78" r="20"/><circle cx="142" cy="78" r="20"/><circle cx="90" cy="52" r="20"/><circle cx="130" cy="52" r="20"/><circle cx="110" cy="42" r="20"/><circle cx="72" cy="104" r="16"/><circle cx="148" cy="104" r="16"/><circle cx="76" cy="126" r="13"/><circle cx="144" cy="126" r="13"/></g>' +
    '<ellipse cx="110" cy="90" rx="27" ry="32" fill="url(#kpskin)"/>' +
    '<path d="M86 74 Q98 60 122 66 Q132 70 134 80 Q120 70 100 72 Z" fill="#c0392b"/>' +
    '<path d="M84 88 h22 v10 h-22 z M114 88 h22 v10 h-22 z" fill="none" stroke="#111" stroke-width="3" stroke-linejoin="round"/><path d="M84 88 l-6 -6 M136 88 l6 -6 M106 92 h8" stroke="#111" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="95" cy="93" r="2.6" fill="#1a1a1a"/><circle cx="125" cy="93" r="2.6" fill="#1a1a1a"/>' +
    '<path d="M98 107 Q110 118 122 107" stroke="#c0204a" stroke-width="4" fill="#fff" stroke-linecap="round"/>' +
    '<circle cx="84" cy="104" r="3.5" fill="#ffd23f"/><circle cx="136" cy="104" r="3.5" fill="#ffd23f"/>' +
    '</svg>';
  function shopShow() {
    var g = G.shop; if (!g) return;
    var ov = $('shopov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'shopov'; ov.className = 'shopov boutique enter'; whooshes([0, 300, 650, 950]); setTimeout(function () { ov.classList.remove('enter'); }, 2600);
      var codes = shuffle(Object.keys(countries || {}).filter(function (c) { return c.length === 2; })).slice(0, 22);
      // bunting with real flag pictures (flag emoji show up as letters on some computers)
      ov.innerHTML = '<div class="bqwall"></div><div class="bqsign">✨ Woodruff’s Boutique ✨</div><div class="bqbunting">' + codes.map(function (c, i) { return '<span class="bqpen" style="--i:' + i + ';background:hsl(' + (i * 47 % 360) + ',80%,60%)"><img src="https://flagcdn.com/w80/' + c + '.png" alt="" onerror="this.remove()"></span>'; }).join('') + '</div>' +
        '<div class="bqdisco">🪩</div><div class="bqsale">SALE<br><b>100% OFF</b></div>' +
        '<div class="bqfans"><span>🪭</span><span>🪭</span><span>🪭</span><span>🪭</span><span>🪭</span></div>' +
        '<div class="bqhats"><span>🎩</span><span>👑</span><span>🧢</span><span>👒</span><span>🎓</span></div>' +
        '<div class="bqrack"><i class="rail"></i><span>👕</span><span>🧣</span><span>👗</span><span>🧥</span><span>🧣</span><span>👕</span></div>' +
        '<div class="bqfloor"><span>🛍️</span><span>🎁</span><span>🛍️</span><span>🎈</span><span>🎁</span></div>' +
        (function () {   // the merchandise on the shelves at the back, with its name (what you can get is on your phone)
          var shelf = function (items) { return items.map(function (it) { return '<span class="bqi" data-id="' + esc(it.id) + '"><span class="si">' + it.icon + '</span><b>' + esc(it.name) + '</b><i class="bqp">' + shopPrice(it) + ' pts</i><i class="bqstock' + (it.stock ? ' one' : '') + '">' + (it.stock ? 'Only ' + it.stock + ' in stock' : '∞ in stock') + '</i></span>'; }).join(''); }, av = shopAvail();
          return '<div class="bqcase">' + [3, 2, 1].map(function (t) { var tr = SHOP_TIERS[t]; return '<div class="bqshelf t' + t + '"><span class="bqtier">' + tr.icon + ' ' + tr.name + ' <em>' + shopPrice({ tier: t }) + ' pts</em></span>' + shelf(av.filter(function (it) { return (it.tier || 2) === t; })) + '</div>'; }).join('') + '<div class="bqcasenote">⚡ Instant items: during a question · 📦 Deliveries: any time, they land before the next question</div></div>';
        })() +
        '<div class="bqkeeper">' + SHOPKEEPER + '</div><div class="bqbubble"></div><div class="shoppers"></div><div class="bqtimer"></div>';
      document.body.appendChild(ov);
      var tick = setInterval(function () {   // the 30 seconds to choose, counting down
        if (!ov.isConnected) { clearInterval(tick); return; }
        var sg = G.shop, tm = ov.querySelector('.bqtimer'), on = !!sg && !sg.over && !sg.talk && G.phase === 'shop', left = on ? Math.max(0, Math.ceil((G.endsAt - Date.now()) / 1000)) : 0;
        tm.classList.toggle('on', on); tm.classList.toggle('hurry', on && left <= 10); if (on) tm.textContent = '⏱ ' + left;
      }, 250);
    }
    var act = list().filter(function (p) { return !p.off && (!g.who || g.who.indexOf(p.pid) >= 0); }), first = g.who && g.who.length === list().filter(function (p) { return !p.off; }).length && g.n === 1;
    var one = act.length === 1, wn = act.map(function (p) { return p.name; }), wnames = wn.length > 1 ? wn.slice(0, -1).join(', ') + ' and ' + wn[wn.length - 1] : wn[0];
    var bq = ov.querySelector('.bqbubble');
    if (g.talk === 1) typeSay(bq, 'Welcome to Woodruff’s Boutique, darling' + (one ? '' : 's') + '! 💋 This is where you get items to use in the trivia rounds. Not during the party games, mind you!', 'lynda');
    else if (g.talk === 2) typeSay(bq, 'And as a token of goodwill, I’m giving everyone one item for free! 🎁 From the bargain shelf, of course, darling. 😉', 'lynda');
    else if (g.line && !g.over && !g.buy) typeSay(bq, g.line, 'lynda');   // (a line of her own: Edgar's game, a tie)
    else if (g.buy) { var fw = (g.free || []).map(function (k) { return players[k] ? players[k].name : ''; }).filter(Boolean), fn = fw.length > 1 ? fw.slice(0, -1).join(', ') + ' and ' + fw[fw.length - 1] : fw[0], bought = act.some(function (p) { return (g.picks[p.pid] || []).length; }); typeSay(bq, g.over ? (bought ? 'Pleasure doing business, darling' + (one ? '' : 's') + '! 😘' : 'Next time then, darling' + (one ? '' : 's') + '! 😘') : (g.line ? g.line + ' ' : 'Congratulations, ' + wnames + '! 🛍️ ') + 'I have a little selection for ' + (one ? 'you' : 'you two') + ': I handpicked one item from each shelf. Fancy one? It will cost you, darling! 💸', 'lynda'); }
    else if (g.win) typeSay(bq, g.over ? (one ? 'Fabulous choice, darling! Use it wisely. 😘' : 'Fabulous choices, darlings! Use them wisely. 😘') : 'Congratulations, ' + wnames + '! 🛍️ I picked two items just for ' + (one ? 'you' : 'each of you') + '. Choose one on your phone!', 'lynda');
    else typeSay(bq, g.over ? 'Fabulous choice' + (one ? ', darling' : 's, darlings') + '! Enjoy the show. 😘' : 'I picked two items for ' + (one ? 'you' : 'each of you') + '. Choose ' + (g.n > 1 ? g.n : 'one') + ' on your phone! 🛍️', 'lynda');
    var on = {}; Object.keys(g.offer || {}).forEach(function (k) { (g.offer[k] || []).forEach(function (id) { on[id] = 1; }); });
    [].forEach.call(ov.querySelectorAll('.bqi'), function (x) { var id = x.getAttribute('data-id'); x.classList.toggle('offer', !!on[id]); if (soldOut(id) && !x.classList.contains('sold')) { x.classList.add('sold'); } });
    ov.querySelector('.shoppers').innerHTML = act.map(function (p) { var pk = g.picks[p.pid], free = g.buy && (g.free || []).indexOf(p.pid) >= 0, tag = free ? '<em class="free">🎁 free</em>' : g.buy && pk ? (pk.length ? '<em class="paid">🛍️</em>' : '<em class="nobuy">no thanks</em>') : ''; return '<span class="shopper' + (pk ? ' done' : '') + (g.buy && pk && !pk.length ? ' skip' : '') + '">' + charSvg(p.char) + '<i>' + esc(p.name) + '</i>' + tag + '</span>'; }).join('');
    // a purchase: a shower of coins from the buyer to Lynda's till (with the ka-ching)
    ov._coined = ov._coined || {};
    act.forEach(function (p, i) {
      if (!g.paid || !g.paid[p.pid] || ov._coined[g.id + p.pid]) return; ov._coined[g.id + p.pid] = 1;
      var chip = ov.querySelectorAll('.shoppers .shopper')[i], kp = ov.querySelector('.bqkeeper'); if (!chip || !kp) return;
      var a = chip.getBoundingClientRect(), b = kp.getBoundingClientRect(), tx = b.left + b.width * 0.7, ty = b.top + b.height * 0.55;
      for (var c = 0; c < 12; c++) (function (c) {
        var e = document.createElement('i'); e.className = 'bqcoin'; e.textContent = '🪙';
        var x0 = a.left + 20 + Math.random() * Math.max(10, a.width - 40), y0 = a.top + a.height / 2;
        e.style.left = x0 + 'px'; e.style.top = y0 + 'px'; e.style.setProperty('--dx', (tx - x0) + 'px'); e.style.setProperty('--dy', (ty - y0) + 'px'); e.style.setProperty('--h', (-80 - Math.random() * 120) + 'px'); e.style.animationDelay = (c * 0.06) + 's';
        ov.appendChild(e); setTimeout(function () { e.remove(); }, 1800 + c * 60);
      })(c);
    });
    ov.classList.toggle('buying', !!g.buy); var sale = ov.querySelector('.bqsale'); if (sale) sale.innerHTML = g.buy ? 'PRICES<br><b>IN POINTS</b>' : 'SALE<br><b>100% OFF</b>';
  }
  // Someone used an item: everything stops, a police siren wails and the screen flashes red and blue for three seconds,
  // and only then does the item's card come up.
  var ALARM_MS = 3000, sirenEl = null;
  function itemAlarm(then) {
    if (REMOTE) { then(); return; }
    if (!(G.phase === 'guess' && isPair())) { try { yt.pauseVideo(); } catch (e) {} }   // (a question with two songs runs on: its clips have their own timing, and nothing would start it again)
    try { if (!sirenEl) sirenEl = new Audio('sounds/siren.mp3'); sirenEl.currentTime = 0; sirenEl.volume = Math.max(0, Math.min(1, 0.8 * (Music.vol ? Music.vol.fx : 1))); var pr = sirenEl.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    var ov = $('alarmov'); if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'alarmov'; ov.className = 'alarmov';
    ov.innerHTML = '<div class="alred"></div><div class="alblue"></div><div class="albar t"></div><div class="albar b"></div><div class="alsign"><span class="allight">🚨</span><b>ITEM ALERT!</b><span class="allight">🚨</span></div>';
    document.body.appendChild(ov);
    setTimeout(function () { ov.classList.add('out'); }, ALARM_MS - 300);
    setTimeout(function () { ov.remove(); try { if (sirenEl) { sirenEl.pause(); } } catch (e) {} then(); }, ALARM_MS);
  }
  // The big announcement of an item: across the whole screen, with the points flying and a sound.
  var shopHitT = null;
  function shopHit(txt, ms) {
    var snd = (shopLast && shopLast.sound) || '';
    if (snd === 'lose') { Music.woosh(); setTimeout(function () { Music.crumble(); }, 250); }
    else if (snd === 'blow') { Music.woosh(); setTimeout(function () { Music.woosh(); }, 400); }
    else if (snd === 'steal') { Music.ping(); setTimeout(function () { Music.ding(); }, 300); }
    else if (snd === 'sit') Music.buzz();
    else if (snd === 'thief') itemGetSnd();   // (left the Euroclub with an item)
    else if (snd === 'heel') { Music.blip(); setTimeout(function () { Music.crumble(); }, 200); }
    else if (snd === 'block') { Music.blip(); setTimeout(function () { Music.ding(); }, 250); }
    else Music.woosh();
    if (REMOTE) return;
    var ov = $('shophit'); if (!ov) { ov = document.createElement('div'); ov.id = 'shophit'; ov.className = 'shophit'; document.body.appendChild(ov); }
    var ds = (shopLast && shopLast.deltas || []).filter(function (d) { return players[d.pid]; });   // everyone it involves: who used it and who it hit
    ov.innerHTML = '<div class="shcard"><div class="shicon">' + ((shopLast && shopLast.icon) || '🛍️') + '</div><div class="shtxt">' + esc(txt.replace(/^\S+\s/, '')) + '</div>' +
      (ds.length ? '<div class="shdel">' + ds.map(function (d, i) { var p = players[d.pid]; var num = typeof d.n === 'number'; return '<span class="shd ' + (num ? (d.n < 0 ? 'neg' : 'pos') : 'neu') + '" style="--i:' + i + '">' + charSvg(p.char) + '<b>' + esc(p.name) + '</b><em>' + (num ? (d.n < 0 ? '−' + (-d.n) : '+' + d.n) : esc(d.tag || '')) + '</em></span>'; }).join('') + '</div>' : '') + '</div>';
    // right in front of the video screen (when it is showing), else over the whole page
    var st = stageEl(), r = st && st.offsetParent ? st.getBoundingClientRect() : null;
    if (r && r.width > 200) { ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px'; ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px'; ov.classList.add('onstage'); }
    else { ov.style.left = ov.style.top = ov.style.width = ov.style.height = ''; ov.classList.remove('onstage'); }
    ov.classList.remove('on'); void ov.offsetWidth; ov.classList.add('on');
    clearTimeout(shopHitT); shopHitT = setTimeout(function () { ov.classList.remove('on'); }, ms || 4500);
  }
  var shopFlashT = null;
  function shopFlash(t) {   // a banner across the top of the big screen
    if (REMOTE) return;
    var e = $('shopflash'); if (!e) { e = document.createElement('div'); e.id = 'shopflash'; e.className = 'shopflash'; document.body.appendChild(e); }
    e.textContent = t; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
    clearTimeout(shopFlashT); shopFlashT = setTimeout(function () { e.classList.remove('on'); }, 3500);
  }
  net.on('shop', shopMsg);

  // ---------- Where the Hell Is Edgar? ----------
  // A Cluedo-style party game. Edgar, the show's mascot, has been abducted: by one suspect, hidden in one place,
  // hidden inside one thing. The presenters set
  // the scene, then come four trivia questions; a right answer gets three secret clues on your phone (the fastest right
  // answer gets four), each one a card that is NOT the answer, from the row where the player still has the most options. Then everyone accuses on their phone, and the answer comes out,
  // part by part. 4 points for each right part, 6 more for all three.
  var clueTimer = null, clueTick = null;
  // Edgar's own tune loops from the start of his game through the four clue questions. Those questions are only ones
  // without a video, so nothing else plays over it.
  var poeAudio = null;
  function clueSong() {
    if (REMOTE) return;
    try {
      if (!poeAudio) poeAudio = new Audio('sounds/poe.mp3');
      clearInterval(poeFade); poeAudio.loop = true; if (poeWatch && poeAudio.paused) { poeAudio.removeEventListener('timeupdate', poeWatch); poeWatch = null; }
      poeAudio.volume = Math.max(0, Math.min(1, 0.6 * (Music.vol ? Music.vol.music : 1)));
      if (poeAudio.paused) { poeAudio.currentTime = 0; var pr = poeAudio.play(); if (pr && pr.catch) pr.catch(function () {}); }
    } catch (e) {}
  }
  // The last clue question: no more loops, the tune plays its current round to the end (it ends near the answer);
  // if anything is still playing when the accusation starts, it fades out instead of stopping dead.
  var poeFade = null, poeWatch = null;
  // If the round that is playing would end soon (within 15 seconds: too early, in the middle of the question),
  // it goes round once more and only that next round is the last.
  // When the tune's current round is over, then(): it stops looping, and the reveal waits for its last note
  // (with a safety net in case the sound never ends, e.g. blocked by the browser).
  function poeThen(then) {
    var a = poeAudio, done = false, go = function () { if (done) return; done = true; a && a.removeEventListener('ended', go); then(); };
    if (REMOTE || !a || a.paused || a.ended) { then(); return; }
    a.loop = false; a.addEventListener('ended', go);
    setTimeout(go, Math.max(1, ((a.duration || 26) - (a.currentTime || 0))) * 1000 + 1500);
  }
  function clueSongLast() {
    var a = poeAudio; if (!a || a.paused) return;
    var left = (a.duration || 26) - (a.currentTime || 0);
    if (left >= 15) { a.loop = false; return; }
    var last = a.currentTime;
    if (poeWatch) a.removeEventListener('timeupdate', poeWatch);
    var watch = poeWatch = function () { if (a.currentTime < last) { a.loop = false; a.removeEventListener('timeupdate', watch); } else last = a.currentTime; };   // (it just wrapped round: this round is the last)
    a.addEventListener('timeupdate', watch);
  }
  function clueSongFade() {
    if (!poeAudio || poeAudio.paused) return;
    var a = poeAudio, v0 = a.volume, n = 0; clearInterval(poeFade);
    poeFade = setInterval(function () { n++; a.volume = Math.max(0, v0 * (1 - n / 15)); if (n >= 15) { clearInterval(poeFade); try { a.pause(); } catch (e) {} a.volume = v0; } }, 100);
  }
  // "Who the hell…?!": when the spin lands on this game (or as it starts, when it was not spun)
  function clueSting() { if (REMOTE) return; try { var w = new Audio('sounds/who_the_hell.mp3'); w.volume = Math.max(0, Math.min(1, Music.vol ? Music.vol.fx : 1)); var pr = w.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  function clueSongStop() { if (poeAudio) try { poeAudio.pause(); } catch (e) {} if (egghAudio) try { egghAudio.pause(); } catch (e) {} }
  var egghAudio = null;
  clueReveal.music = function () {   // the reveal's own track (once, not looped)
    if (REMOTE) return;
    try { if (!egghAudio) egghAudio = new Audio('sounds/egghh.mp3'); egghAudio.volume = Math.max(0, Math.min(1, 0.7 * (Music.vol ? Music.vol.music : 1))); egghAudio.currentTime = 0; var pr = egghAudio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
  };
  var CLUE_TYPES = ['trivia', 'flag', 'host', 'odd', 'lost'];   // question types without a video
  // Edgar, the show's mascot: a big-headed cartoon inspired by Edgar Allan Poe, with his little raven on his shoulder.
  var EDGAR = '<svg class="edgar" viewBox="0 0 200 300" aria-hidden="true"><defs><radialGradient id="edskin" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fff4e8"/><stop offset="1" stop-color="#e9d2bd"/></radialGradient><linearGradient id="edcoat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3466"/><stop offset="1" stop-color="#1d1a3c"/></linearGradient></defs><ellipse cx="100" cy="292" rx="58" ry="7" fill="rgba(0,0,0,.35)"/><rect x="70" y="250" width="22" height="34" rx="8" fill="#1d1a3c"/><rect x="108" y="250" width="22" height="34" rx="8" fill="#1d1a3c"/><ellipse cx="78" cy="286" rx="18" ry="8" fill="#111"/><ellipse cx="122" cy="286" rx="18" ry="8" fill="#111"/><path d="M44 190 Q46 150 100 148 Q154 150 156 190 L162 258 Q100 274 38 258 Z" fill="url(#edcoat)"/><path d="M100 150 L84 150 L100 210 L116 150 Z" fill="#fff"/><path d="M100 166 L82 156 L82 176 Z M100 166 L118 156 L118 176 Z" fill="#111"/><circle cx="100" cy="166" r="5" fill="#222"/><circle cx="100" cy="222" r="4" fill="#d9b44a"/><circle cx="100" cy="240" r="4" fill="#d9b44a"/><path d="M46 178 Q22 196 24 226" stroke="url(#edcoat)" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="24" cy="230" r="12" fill="#fff"/><path d="M154 178 Q182 160 182 132" stroke="url(#edcoat)" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="182" cy="126" r="12" fill="#fff"/><ellipse cx="100" cy="92" rx="66" ry="70" fill="url(#edskin)"/><ellipse cx="38" cy="98" rx="10" ry="16" fill="#e9d2bd"/><ellipse cx="162" cy="98" rx="10" ry="16" fill="#e9d2bd"/><path d="M34 92 Q26 40 70 24 Q104 10 140 26 Q176 44 168 96 Q160 70 148 62 Q150 44 126 40 Q130 52 116 50 Q96 44 84 52 Q62 58 54 74 Q42 80 34 92 Z" fill="#1a1420"/><path d="M34 92 Q30 112 40 128 Q38 108 46 96 Z M168 96 Q172 116 160 130 Q162 110 154 98 Z" fill="#1a1420"/><path d="M64 80 Q76 72 88 80" stroke="#1a1420" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M112 80 Q124 72 136 80" stroke="#1a1420" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="78" cy="96" rx="11" ry="13" fill="#fff"/><ellipse cx="122" cy="96" rx="11" ry="13" fill="#fff"/><circle cx="80" cy="98" r="7" fill="#2a1c3a"/><circle cx="124" cy="98" r="7" fill="#2a1c3a"/><circle cx="82" cy="95" r="2.5" fill="#fff"/><circle cx="126" cy="95" r="2.5" fill="#fff"/><ellipse cx="66" cy="116" rx="9" ry="5" fill="#f2a7a7" opacity=".55"/><ellipse cx="134" cy="116" rx="9" ry="5" fill="#f2a7a7" opacity=".55"/><path d="M100 104 Q96 116 102 118" stroke="#cfa98a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M100 124 Q86 118 72 128 Q84 130 100 128 Q116 130 128 128 Q114 118 100 124 Z" fill="#1a1420"/><path d="M88 136 Q100 144 112 136" stroke="#7a3b3b" stroke-width="3" fill="none" stroke-linecap="round"/><g class="edraven"><path d="M136 160 Q140 140 158 138 Q172 138 176 150 Q182 158 176 168 Q160 176 140 170 Z" fill="#15121c"/><path d="M146 166 L132 178 L150 172 Z" fill="#15121c"/><circle cx="164" cy="148" r="3.2" fill="#fff"/><circle cx="165" cy="148" r="1.6" fill="#111"/><path d="M174 150 L188 154 L174 157 Z" fill="#f2b134"/></g></svg>';
  function clueAll() {
    var act = list().filter(function (p) { return !p.off; });
    if (act.length < 2 || REMOTE) { G.clue = null; quipAll(); return; }
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.clue = { id: 'clue' + G.round + '-' + Math.random().toString(36).slice(2, 6), st: 'intro', n: 0, known: {}, fresh: {}, acc: {}, step: 0, res: null,
      sol: { who: pick(CLUE_WHO).id, where: pick(CLUE_WHERE).id, what: pick(CLUE_WHAT).id } };
    if (G.atype === 'party' && G.total < ENDLESS) G.total += CLUE_N - 1;
    G.fun = { kind: 'clue', icon: FUN.clue.icon, title: FUN.clue.title, sub: FUN.clue.sub, plain: true, quiet: true }; G.phase = 'fun'; G.barMs = 0;
    cover(true, '', '', false); masks(true); hostsAway(); push();
    clueShow(); clueSong();   // Edgar's tune: from the start of the game to the end of the clue questions
    if (!G.clueSting) clueSting(); G.clueSting = false;   // (no spin landed on it: the sting plays now)
    var ov = $('clueov'); if (ov) { ov.classList.add('story'); ov.classList.add('intro'); ov.classList.add('nohosts'); ov.classList.add('noframe'); }
    setTimeout(function () { var o = $('clueov'); if (o) { o.classList.remove('noframe'); Music.blip(); } }, 2600);   // the framed photo, a little later
    setTimeout(function () { var o = $('clueov'); if (o) { o.classList.remove('nohosts'); whooshes([0, 200]); } }, 4800);   // then the presenters walk on   // first only the news: the poster big, the presenters close together; the cards come later
    var at = function (ms, f) { clueTimer = setTimeout(function () { if (G.clue && G.clue.st === 'intro' && $('clueov')) f(); }, ms); };
    // The story, taken slowly: each line stays long enough to type out and read (and the rows light up as they are explained).
    var lines = [
      ['him', 'Breaking news, Europe… Edgar, our beloved mascot, has been abducted! 😱'],
      ['her', 'Someone took him, and hid him inside something, somewhere in the building.'],
      ['him', 'Look at the cards. The top row: where he could be hidden.', 'where'],
      ['her', 'The middle row: what he is hidden inside.', 'what'],
      ['him', 'And the bottom row: who took him.', 'who'],
      ['her', 'In each row, one card is the truth. We need detectives to find out which!'],
      ['him', 'Here’s how it works: four trivia questions are coming. Answer right, and your phone gets secret clues.'],
      ['her', 'A clue is a card that is NOT the answer. A right answer gets you three clues…'],
      ['him', '…and be quick: the fastest right answer gets an extra clue! ⚡'],
      ['her', 'After every question, your phone shows which cards are still possible.'],
      ['him', 'After the last question, you make your accusation: where, inside what, and who. Let’s bring Edgar home! 🔍']
    ];
    var t = 6600;   // (the poster first, the photo, the presenters walking on: then the story)
    lines.forEach(function (l) {
      (function (l, at0) { at(at0, function () {
        clueSay(l[0], l[1]);
        var ov2 = $('clueov'); if (ov2) {
          if (l[2]) { if (ov2.classList.contains('story')) whooshes([0, 250]); ov2.classList.remove('story'); }   // on to the clues: the presenters step apart, the rows come in one by one
          [].forEach.call(ov2.querySelectorAll('.clrow'), function (r) { var me = !!l[2] && r.getAttribute('data-k') === l[2]; r.classList.toggle('lit', me); if (me) r.classList.add('on'); });
        }
      }); })(l, t);
      t += Math.max(4200, Array.from(l[1]).length * TALK_MS + 2800);
    });
    at(t, function () { var ov2 = $('clueov'); if (ov2) [].forEach.call(ov2.querySelectorAll('.clrow'), function (r) { r.classList.remove('lit'); r.classList.add('on'); }); clueLeave(function () { G.clue.st = 'ask'; clueNext(); }); });
  }
  function clueSay(who, txt) {
    var ov = $('clueov'); if (!ov) return;
    [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); });
    var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); typeSay(b, txt, who);
  }
  function clueLeave(then) {   // the scene zooms away
    Music.dread(false);
    var ov = $('clueov'); if (!ov) { then(); return; }
    [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); });
    ov.classList.add('leaving'); whooshes([0, 300]);
    clueTimer = setTimeout(function () { if (ov.parentNode) ov.remove(); then(); }, 1000);
  }
  // The next clue question; after the last one, the accusation. False: this game is over.
  function clueNext() {
    var g = G.clue; if (!g) return false;
    if (g.st === 'ask' && g.n < CLUE_N) {
      G.mode = 'mc'; G.phase = 'loading'; clueSong(); push(); loadSong();   // (Edgar's tune: on through the questions and the accusation)
      if (G.q) G.q.text = '🔍 Clue ' + (g.n + 1) + ' of ' + CLUE_N + ' · ' + G.q.text;
      return true;
    }
    if (g.st === 'ask') { clueAccuse(); return true; }
    return false;
  }
  function cluePool(pid) {   // the cards this player could still be told about: not the answer, not known yet
    var g = G.clue, known = g.known[pid] || [], out = [];
    ['who', 'where', 'what'].forEach(function (k) { CLUE_SETS[k].forEach(function (c) { var key = k + ':' + c.id; if (c.id !== g.sol[k] && known.indexOf(key) < 0) out.push(key); }); });
    return out;
  }
  function clueGive(right) {   // the answer is out: a clue for everyone who got it right (in answer order: the first gets two)
    var g = G.clue; g.n++; g.fresh = {}; g.fast = right.length ? right[0].pid : '';
    right.forEach(function (p, i) {
      for (var k = 0; k < (i === 0 ? CLUE_FAST : CLUE_GIVE); k++) {
        // a smart clue: from the row where this player still has the most options left, so the clues add up to an answer
        var pool = cluePool(p.pid); if (!pool.length) break;
        var left = {}; pool.forEach(function (c) { var r = c.split(':')[0]; left[r] = (left[r] || 0) + 1; });
        var most = Math.max.apply(null, Object.keys(left).map(function (r) { return left[r]; }));
        var rows = Object.keys(left).filter(function (r) { return left[r] === most; }), row = pick(rows);
        var c = pick(pool.filter(function (x) { return x.split(':')[0] === row; })); (g.known[p.pid] = g.known[p.pid] || []).push(c); (g.fresh[p.pid] = g.fresh[p.pid] || []).push(c);
      }
      p.got = true; p.pts = 0;
    });
    g.freshKey = g.id + ':' + g.n;
    var names = right.map(function (p) { return p.name; });
    if (G.q) G.q.explain = (G.q.explain ? G.q.explain + ' ' : '') + (right.length ? '🔍 Secret clues for ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + (right.length > 1 ? ' (' + names[0] + ' was fastest: four clues, the rest three)' : ' (four clues for being fastest)') + '. Check your phone!' : '🔍 Nobody got it right: no clues this time.');
  }
  function clueAccuse() {
    var g = G.clue; stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    g.st = 'acc'; g.acc = {}; g.fresh = {}; G.phase = 'clueacc'; G.q = null; G.song = null; G.clip = null; G.barMs = 0; g.ends = Date.now() + CLUE_ACC_MS;
    cover(true, '', '', false); masks(true); hostsAway(); push(); clueSong();   // (the tune plays on)
    clueTimer = setTimeout(function () { clueSay('him', 'Time to accuse! Who took Edgar, where is he hidden, and what is he hidden inside?'); }, 1400);
    setTimeout(function () { if (G.clue && G.clue.st === 'acc') clueSay('her', 'Make your choice on your phone. Use your clues, detectives!'); }, 5200);
    // bots: a guess among what their clues leave open
    bots.forEach(function (b) { if (!players[b.pid] || players[b.pid].off) return; setTimeout(function () {
      if (!G.clue || G.clue.st !== 'acc') return;
      var kn = g.known[b.pid] || [], m = { pid: b.pid, id: g.id };
      ['who', 'where', 'what'].forEach(function (k) { var open = CLUE_SETS[k].filter(function (c) { return kn.indexOf(k + ':' + c.id) < 0; }); m[k] = pick(open).id; });
      clueMsg(m);
    }, 4000 + Math.random() * 9000); });
    endTimer = setTimeout(function () { poeThen(clueReveal); }, CLUE_ACC_MS);
    clearInterval(clueTick); clueTick = setInterval(function () {
      if (!G.clue || G.clue.st !== 'acc') { clearInterval(clueTick); return; }
      clueShow();
      // the tune: the round that ends closest to the end of the timer is the last one
      var a = poeAudio; if (a && a.loop && !a.paused && a.duration) { var accLeft = (g.ends - Date.now()) / 1000, loopLeft = a.duration - a.currentTime; if (accLeft <= loopLeft + 0.5) a.loop = false; }
    }, 1000);   // (the countdown on the screen)
  }
  function clueMsg(m) {
    var g = G.clue; if (!g || G.phase !== 'clueacc' || g.st !== 'acc' || !m || m.id !== g.id || !players[m.pid] || g.acc[m.pid]) return;
    var ok = ['who', 'where', 'what'].every(function (k) { return CLUE_SETS[k].some(function (c) { return c.id === m[k]; }); }); if (!ok) return;
    g.acc[m.pid] = { who: m.who, where: m.where, what: m.what }; Music.plop(Object.keys(g.acc).length); push();
    if (list().filter(function (p) { return !p.off; }).every(function (p) { return g.acc[p.pid]; })) { clearTimeout(endTimer); g.allIn = true; clueShow(); poeThen(clueReveal); }   // everyone locked in: this round of the tune is the last; the reveal comes when it ends
  }
  function clueReveal() {
    var g = G.clue; if (!g || g.st !== 'acc') return;
    clearTimeout(endTimer); g.st = 'reveal'; g.step = 0; G.phase = 'cluerev'; push();
    var who = clueCard('who:' + g.sol.who).c, where = clueCard('where:' + g.sol.where).c, what = clueCard('what:' + g.sol.what).c;
    var step = function (n) { if (!G.clue || G.clue.st !== 'reveal') return; g.step = n; Music.ding(); push(); };
    var at = function (ms, f) { setTimeout(function () { if (G.clue && G.clue.st === 'reveal') f(); }, ms); };
    // The reveal, row by row (top row first, the culprit last): a question, then the wrong cards drop out one by one
    // until only the right one is left, which lights up. Its own music plays underneath.
    clueSongFade(); clueReveal.music();
    g.dimmed = {};
    var lines = {
      where: ['Where was Edgar hidden?', where.icon + ' ' + where.in.charAt(0).toUpperCase() + where.in.slice(1) + '!'],
      what: ['And what was he hidden inside?', 'Inside the ' + what.name + '! ' + what.icon],
      who: ['And who abducted Edgar? It was…', who.id === 'felix' ? 'Felix?! You took our own mascot?! 😱' : who.id === 'stella' ? '…me?! I only wanted a cuddle! 🙈' : who.id === 'lynda' ? 'Lynda! Darling, Edgar is not for sale! 👠' : who.name + '! 😱']
    };
    var t = 800;
    ['where', 'what', 'who'].forEach(function (k, n) {
      at(t, function () { clueSay('him', lines[k][0]); });
      var wrong = shuffle(CLUE_SETS[k].filter(function (c) { return c.id !== g.sol[k]; }));
      wrong.forEach(function (c, m) { at(t + 1800 + m * 1000, function () { g.dimmed[k + ':' + c.id] = 1; Music.plop(m * 2, 0.8); clueShow(); }); });
      at(t + 1800 + wrong.length * 1000 + 400, function () { step(n + 1); clueSay('her', lines[k][1]); });
      t += 1800 + wrong.length * 1000 + 2600;
    });
    if (who.id === 'felix') at(t - 600, function () { clueSay('him', 'I just wanted a selfie with him! 🤳'); });
    var T0 = t + (who.id === 'felix' ? 1600 : 0);
    at(T0, function () {   // the result. With the boutique on, the prize is a trip there (no points); without it: 4 points a right part, 6 more for all three
      var solved = [], shop = shopOn(), base = G.mgBase;
      g.res = {};
      list().forEach(function (p) {
        var a = g.acc[p.pid]; if (!a) { g.res[p.pid] = { n: 0, pts: 0, none: true }; return; }
        var n = (a.who === g.sol.who) + (a.where === g.sol.where) + (a.what === g.sol.what), pts = shop ? 0 : n * CLUE_PART + (n === 3 ? CLUE_BONUS : 0);
        g.res[p.pid] = { n: n, pts: pts, a: a }; if (pts) { p.score += pts; p.pts = pts; p.got = true; } if (n === 3) solved.push(p);
      });
      G.mgLive = false;
      if (shop) { G.mgBase = null; if (base) list().forEach(function (p) { if (base[p.pid] != null) p.score = base[p.pid]; }); }   // (this game hands out its own prize: no general winner's trip)
      step(4); Music.douze();
      var names = function (ps) { var n = ps.map(function (p) { return p.name; }); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]; };
      if (solved.length) {
        var sw = solved.map(function (p) { return p.pid; });
        if (shop && sw.length > 1) {   // a tie: Lynda has a soft spot for the underdog
          var ud = underdogOf(sw);
          g.prize = { who: [ud], solved: true, under: true };
          clueSay('him', names(solved) + ' were true detectives and found all the clues! 🎉');
          at(4000, function () { clueSay('her', 'But only one can go shopping… Lynda has a soft spot for the underdog, so ' + (players[ud] ? players[ud].name : '') + ', with the lowest score, is off to Woodruff’s Boutique! 💌'); });
        } else {
          g.prize = { who: sw, solved: true };
          clueSay('him', names(solved) + (solved.length > 1 ? ' were true detectives and found' : ' was a true detective and found') + ' all the clues' + (shop ? ', and ' + (solved.length > 1 ? 'are' : 'is') + ' rewarded with a visit to Woodruff’s Boutique! 🛍️' : '! Welcome back, Edgar! 🎉'));
        }
      } else {
        clueSay('him', 'Unfortunately, nobody discovered the truth… 😢');
        if (shop) {
          var act = list().filter(function (p) { return !p.off; }), low = Math.min.apply(null, act.map(function (p) { return p.score; }));
          var lp = pick(act.filter(function (p) { return p.score === low; }));
          if (lp) { g.prize = { who: [lp.pid], solved: false }; at(4000, function () { clueSay('her', 'But Lynda sent us a message: she’d like to offer the lowest scoring player, ' + lp.name + ', something anyway! 💌'); }); }
        }
      }
    });
    var lynda = function () {   // what Lynda says in the boutique: about Edgar (and a confession, if she took him)
      var pr = g.prize, ws = pr.who.map(function (k) { return players[k] ? players[k].name : ''; }).filter(Boolean), nm = ws.length > 1 ? ws.slice(0, -1).join(', ') + ' and ' + ws[ws.length - 1] : ws[0], took = g.sol.who === 'lynda';
      if (pr.solved && took) return 'Alright, alright, ' + nm + ', you caught me! 👠 Edgar just looked SO good in sequins… To say sorry, pick one item from my selection. Don’t tell the police, darling!';
      if (pr.solved && pr.under) return 'Darling ' + nm + ', I have a soft spot for the underdog! 💖 Edgar popped in to say thank you, and his raven won’t stop squawking at my hats! 🐦 Pick one item from my selection, on the house!';
      if (pr.solved) return 'Darling ' + nm + ', what a detective! Edgar popped in to say thank you, and his raven won’t stop squawking at my hats! 🐦 Pick one item from my selection, on the house!';
      if (took) return 'Shh, ' + nm + ', between us… Edgar was in my changing room all along! 👠 Here’s something to keep you quiet, darling: pick one item from my selection!';
      return nm + ', darling, nobody found the truth, but Edgar whispered to me that you could use a little help! 🐦 Pick one item from my selection.';
    };
    var done = function () { clueSongStop(); G.clue = null; G.phase = 'loading'; push(); startRound2(); };
    at(T0 + 8500, function () {
      var pr = g.prize;
      if (!pr || !shopOn() || !pr.who.some(function (k) { return players[k] && !players[k].off; })) { clueLeave(done); return; }
      var line = lynda();
      clueLeave(function () { clueSongStop(); G.clue = null; shopVisit(pr.who, 1, function () { backFromShop(pr.who.length, function () { startRound2(); }); }, true, line); });
    });
  }
  function clueSnap() {
    var g = G.clue, acc = {};
    Object.keys(g.acc).forEach(function (k) { acc[k] = 1; });
    return { id: g.id, st: g.st, n: g.n, of: CLUE_N, known: g.known, fresh: g.fresh, freshKey: g.freshKey || '', acc: acc, left: g.st === 'acc' ? Math.max(0, g.ends - Date.now()) : 0, step: g.step,
      sol: g.st === 'reveal' ? { where: g.step >= 1 ? g.sol.where : '', what: g.step >= 2 ? g.sol.what : '', who: g.step >= 3 ? g.sol.who : '' } : null, res: g.step >= 4 ? g.res : null, gift: g.step >= 5 ? g.gift : null };
  }
  // The scene on the big screen: an empty pedestal, the three rows of cards, the presenters, and the players.
  function clueShow() {
    var g = G.clue; if (!g) return;
    var ov = $('clueov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'clueov'; ov.className = 'grov clueov enter';
      var row = function (k, label) { return '<div class="clrow" data-k="' + k + '"><span class="cllab">' + label + '</span>' + CLUE_SETS[k].map(function (c) { return '<div class="clcard" data-id="' + c.id + '"><span>' + c.icon + '</span><b>' + esc(c.name) + '</b></div>'; }).join('') + '</div>'; };
      ov.innerHTML = '<div class="grwall"></div><div class="grfloor"></div><div class="clspot"></div>' +
        '<div class="grsign clsign">🔍 Where the Hell Is Edgar?</div>' +
        '<div class="clposter"><b>MISSING</b>' + EDGAR + '<small>Have you seen Edgar?</small></div><div class="clframe"><img src="' + commons(EXTRA_PHOTOS[0].file) + '" alt=""><small>With love to Teya &amp; Salena · Austria 2023</small></div><div class="cledgar">' + EDGAR + '</div>' +
        '<div class="clrows">' + row('where', 'Hidden where?') + row('what', 'Hidden inside?') + row('who', 'Who took him?') + '</div>' +
        '<div class="clmsg"></div><div class="clplayers"></div>' +
        '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
      document.body.appendChild(ov); whooshes([0, 350, 700]);
      setTimeout(function () { ov.classList.remove('enter'); }, 2800);
    }
    ov.setAttribute('data-st', g.st);
    ['where', 'what', 'who'].forEach(function (k, i) {   // (top row first, the culprit last)
      var shown = g.st === 'reveal' && g.step >= i + 1;
      [].forEach.call(ov.querySelectorAll('.clrow[data-k="' + k + '"] .clcard'), function (el) { var hit = shown && el.getAttribute('data-id') === g.sol[k]; el.classList.toggle('hit', hit); el.classList.toggle('dim', (shown && !hit) || !!(g.dimmed && g.dimmed[k + ':' + el.getAttribute('data-id')])); });
    });
    ov.classList.toggle('found', g.st === 'reveal' && g.step >= 4);
    var msg = g.st === 'intro' ? 'Edgar, the EuroQuizion mascot, is missing!' : g.st === 'acc' ? (g.allIn ? 'Everyone has made their accusation… 🎶' : Date.now() > g.ends ? 'Time’s up! 🎶' : 'Accuse on your phone: who, where, and with what? ⏱️ ' + Math.ceil(Math.max(0, g.ends - Date.now()) / 1000) + 's') : g.st === 'reveal' && g.step >= 4 ? (g.res && Object.keys(g.res).some(function (k) { return g.res[k].n === 3; }) ? 'Edgar is back! 🎉' : 'Edgar found his own way back… 😅') : g.st === 'reveal' ? 'Who took Edgar…?' : '';
    var me = ov.querySelector('.clmsg'); if (me.textContent !== msg) me.textContent = msg;
    var act = list().filter(function (p) { return !p.off; });
    var html = act.map(function (p) {
      var r = g.res && g.res[p.pid], a = r && r.a;
      var marks = r ? (r.none ? '<i>no accusation</i>' : ['where', 'what', 'who'].map(function (k) { return '<em class="' + (a[k] === g.sol[k] ? 'ok' : 'no') + '">' + clueCard(k + ':' + a[k]).c.icon + '</em>'; }).join('') + '<strong>' + (shopOn() ? (r.n === 3 ? '🏆' : r.n + '/3') : (r.pts ? '+' + r.pts : '0')) + '</strong>') : g.st === 'acc' ? (g.acc[p.pid] ? '<em class="ok">✔</em>' : '<em class="wait">…</em>') : '<em>' + ((g.known[p.pid] || []).length) + ((g.known[p.pid] || []).length === 1 ? ' clue' : ' clues') + '</em>';
      return '<div class="clp' + (r && r.n === 3 ? ' solved' : '') + '">' + charSvg(p.char) + '<b>' + esc(p.name) + '</b>' + marks + '</div>';
    }).join('');
    var pl = ov.querySelector('.clplayers'); if (pl.getAttribute('data-h') !== html) { pl.setAttribute('data-h', html); pl.innerHTML = html; }
  }



  // ---------- The presenters introduce every party game ----------
  // One shared scene: a themed stage with its own sign and centrepiece, Felix and Stella on either side,
  // and their story in speech balloons (letter by letter). Then the game itself starts.
  var SCENES = {
    draw: { sign: '🎨 Postcard', theme: 'postcard',
      art: '<div class="hspost"><div class="hspcard"><div class="hspl"><b>Greetings from</b><i>Eurovision!</i><span class="hsdoodle">🎤✨🎶</span></div><div class="hspr"><span class="hsstamp">12</span><span class="hsline"></span><span class="hsline"></span><span class="hsline"></span></div></div><span class="hspencil">✏️</span></div>',
      lines: [['him', 'Time to get creative, Europe! Your phones are about to become sketchbooks! ✏️'],
        ['her', 'Everyone gets four songs. Pick one, and draw it on your phone, all within one minute.'],
        ['him', 'Then we show every drawing, and the others guess which song it is.'],
        ['her', 'A right guess scores points, more the faster you are… and the artist scores too, for everyone who guessed it!'],
        ['him', 'At the end you give your 12, 10 and 8 points to the best drawings. Pencils ready? 🎨']] },
    sing: { sign: '🎤 Jury Show', theme: 'jury',
      art: '<div class="hsjury"><div class="hsmic">🎙️</div><div class="hsdesk"><span>12</span><span>10</span><span>8</span><span>7</span></div><div class="hsdesklabel">THE JURY</div></div>',
      lines: [['him', 'Welcome to the Jury Show! Tonight YOU are the singers… 🎤'],
        ['her', '…and everyone else is the jury! First, vote for the song you all want to sing.'],
        ['him', 'Listen closely, then record yourself singing it on your phone. Up to ten seconds!'],
        ['her', 'Then we play every performance, and the jury votes for the best one.'],
        ['him', 'The most votes gets 12 points, then 10, then 8… Warm up those voices! 🎶']] },
    bluff: { sign: '🌍 Lost in Translation', theme: 'bluff',
      art: '<div class="hsbluff"><div class="hsbook">📖</div><span class="hsw" style="--x:-34vh;--y:-6vh">Magyar?</span><span class="hsw" style="--x:30vh;--y:-10vh">Suomi?</span><span class="hsw" style="--x:-28vh;--y:12vh">Shqip?</span><span class="hsw" style="--x:34vh;--y:10vh">Ελληνικά?</span><span class="hsw" style="--x:0vh;--y:-20vh">Polski?</span></div>',
      lines: [['him', 'Lost in Translation! A song title in a language you probably don’t speak… 🌍'],
        ['her', 'Make up an English translation that sounds real enough to fool everyone.'],
        ['him', 'Then all the translations appear, with the real one hidden among them.'],
        ['her', 'Find the real one for 12 points…'],
        ['him', '…and get 2 points for every player who falls for your fake! Good luck, liars! 🤥']] },
    bomb: { sign: '💌 The Envelope, Please', theme: 'bomb',
      art: '<div class="hsbomb"><span class="hsenv" style="--r:-12deg;--x:-20vh">✉️</span><span class="hsenv" style="--r:6deg;--x:-6vh">✉️</span><span class="hsenv hsboom" style="--r:-4deg;--x:8vh">✉️</span><span class="hsenv" style="--r:14deg;--x:22vh">✉️</span><span class="hsfuse">💣</span></div>',
      lines: [['him', 'The envelope, please! 💌 Golden envelopes are coming on stage.'],
        ['her', 'Most of them hide a flag… but one of them hides a bomb! 💣'],
        ['him', 'Take turns to open one on your phone. Find the bomb, and you’re out.'],
        ['her', 'Then there’s a fresh set, until only one of you is left. The last one standing wins!']] }
  };
  function hostScene(kind, then) {
    var sc = SCENES[kind], f = FUN[kind]; if (!sc || REMOTE) { funIntro(kind, then, 8000); return; }
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.fun = { kind: 'scene', icon: f.icon, title: f.title, sub: f.sub, plain: true, quiet: true }; G.phase = 'fun'; G.barMs = 0;
    cover(true, '', '', false); masks(true); hostsAway(); push();
    var old = $('hsov'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'hsov'; ov.className = 'grov hsov hs-' + sc.theme + ' enter';
    ov.innerHTML = '<div class="grwall"></div><div class="grfloor"></div><div class="hsspot"></div><div class="grsign hssign">' + sc.sign + '</div>' +
      '<div class="hsart">' + sc.art + '</div><div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
    document.body.appendChild(ov); whooshes([0, 350, 700]); Music.ding();
    setTimeout(function () { ov.classList.remove('enter'); }, 2600);
    var say = function (who, txt) { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); typeSay(b, txt, who); };
    var at = function (ms, fn) { setTimeout(function () { if (ov.isConnected && G.phase === 'fun' && G.fun && G.fun.kind === 'scene') fn(); }, ms); };
    var t = 1600;
    sc.lines.forEach(function (l) { (function (l, t0) { at(t0, function () { say(l[0], l[1]); }); })(l, t); t += Math.max(3800, Array.from(l[1]).length * TALK_MS + 2500); });
    if (kind === 'draw') {   // Postcard: the game itself is played in this same studio, so no goodbye
      at(t, function () { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); ov.querySelector('.hsart').classList.add('pcgo'); whooshes([0]); });
      at(t + 700, function () { then(); pcSync(); setTimeout(function () { ov.remove(); }, 60); });
      return;
    }
    at(t, function () { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); ov.classList.add('leaving'); whooshes([0, 300]); });
    at(t + 1000, function () { ov.remove(); then(); });
  }
  // ---------- Postcard: the whole game in the presenters' studio ----------
  // From the drawing to the vote for the best one, Felix and Stella stay on stage. Every drawing arrives as a real
  // postcard (the drawing on the front, a stamp, who sent it), the answers sit underneath, and at the answer
  // the song title is stamped on the card.
  var pcSt = '', pcCard = '', pcBest = '', pcRev = '';
  var PC_IN = ['A postcard from {n}! 💌 Which song did they draw?', 'Look what came in the mail from {n}! 📬 What is it?', 'Next postcard, from {n}! ✏️ Any idea?', 'Fresh from {n}’s pencil! 🎨 Which song is this?'];
  function pcOn() { return !REMOTE && roundMode() === 'draw' && !!G.gallery && ['dall', 'loading', 'guess', 'picks', 'reveal'].indexOf(G.phase) >= 0 && !G.clue && !G.shop && (!G.best || !!G.best.ranked); }
  function pcSync() {
    var ov = $('pcov');
    if (!pcOn()) { if (ov) ov.remove(); pcSt = pcCard = pcBest = pcRev = ''; return; }
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'pcov'; ov.className = 'grov hsov hs-postcard pcov';
      ov.innerHTML = '<div class="grwall"></div><div class="grfloor"></div><div class="hsspot"></div><div class="grsign hssign">🎨 Postcard</div>' +
        '<div class="pcmid"><div class="pcstage">' +
          '<div class="pcblank"><div class="hspcard"><div class="hspl"><b>Greetings from</b><i>Eurovision!</i><span class="hsdoodle">🎤✨🎶</span></div><div class="hspr"><span class="hsstamp">12</span><span class="hsline"></span><span class="hsline"></span><span class="hsline"></span></div></div><span class="hspencil">✏️</span><b class="pcbusy">Everyone is drawing…</b></div>' +
          '<div class="pcslot">📬<b class="pcslotb">Next postcard…</b></div>' +
          '<div class="pccard"><div class="pcfront"><canvas width="' + DRAW_W + '" height="' + DRAW_H + '"></canvas></div><span class="pcstamp">12</span><span class="pcpost">EUROVISION</span><span class="pcfrom"></span><span class="pcmark"></span></div>' +
          '<div class="pcbest"></div>' +
        '</div><div class="pcq"><div class="bar"><i></i></div><h2></h2></div><div class="pcopts opts"></div><div class="pcans answered"></div></div>' +
        '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
      document.body.appendChild(ov);
    }
    var st = G.best ? 'best' : G.phase === 'dall' ? 'dall' : G.draw && (G.phase === 'guess' || G.phase === 'picks' || G.phase === 'reveal') ? 'card' : 'wait';
    ov.setAttribute('data-st', st); ov.classList.toggle('rev', G.phase === 'reveal');
    var firstCard = !pcCard; ov.querySelector('.pcslotb').textContent = firstCard ? 'The first postcard…' : 'Next postcard…';
    // what is underneath: the question, the time, the answers, who is still drawing (copied from the usual screen)
    ov.querySelector('.pcq h2').textContent = st === 'wait' ? '' : $('qtext').textContent;
    ov.querySelector('.pcq i').style.transform = $('tbar').style.transform;
    var po = ov.querySelector('.pcopts'), qo = st === 'wait' || st === 'dall' ? '' : $('qopts').innerHTML; if (po._h !== qo) { po._h = qo; po.innerHTML = qo; }
    var pa = ov.querySelector('.pcans'), an = st === 'dall' ? $('answered').innerHTML : ''; if (pa._h !== an) { pa._h = an; pa.innerHTML = an; }
    if (st !== pcSt) {
      pcSt = st;
      if (st === 'dall') hostSay('him', 'Pencils out! Everyone is drawing now… ✏️', 3600);
      if (st === 'best') hostSay('her', 'All postcards are in! Now give your 12, 10 and 8 points to the best ones! 🏆', 5000);
    }
    if (st === 'card') {
      var d = G.draw, dp = players[d.pid];
      if (pcCard !== d.id) {
        pcCard = d.id; pcRev = '';
        var cv = ov.querySelector('.pcfront canvas'), cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage($('drawview'), 0, 0, cv.width, cv.height);
        ov.querySelector('.pcfrom').textContent = 'From: ' + (dp ? dp.name : '?');
        var c = ov.querySelector('.pccard'); c.style.setProperty('--r', (Math.random() * 6 - 3).toFixed(1) + 'deg'); c.classList.remove('in'); void c.offsetWidth; c.classList.add('in'); whooshes([0]);
        if (dp) hostSay('next', (firstCard ? 'Here’s the first postcard, from {n}! 💌 Which song did they draw?' : pick(PC_IN)).replace('{n}', dp.name), 4200);
      }
      if (G.phase === 'reveal' && pcRev !== d.id) {
        pcRev = d.id;
        var mk = ov.querySelector('.pcmark'), song = d.options[d.chosen];
        mk.textContent = song ? song[3] : ''; setTimeout(function () { if (mk.isConnected) { mk.classList.add('on'); Music.ding(); } }, 600);
        setTimeout(function () {
          if (!G.draw || G.draw.id !== d.id || G.phase !== 'reveal') return;
          var ok = list().filter(function (p) { return p.pid !== d.pid && !p.off && (p.pts || 0) > 0; }).length, art = players[d.pid];
          hostSay('her', 'It was “' + (song ? song[3] : '?') + '”! 🎶 ' + (ok ? ok + (ok > 1 ? ' of you' : ' player') + ' recognised it' + (art && art.pts ? ', and ' + art.name + ' scores ' + art.pts + ' as the artist!' : '!') : 'Nobody recognised it this time… 🙈'), 5200);
        }, 1400);
      }
      if (G.phase !== 'reveal') ov.querySelector('.pcmark').classList.remove('on');
    }
    if (st === 'best') {
      var bv = $('bestview'), bb = ov.querySelector('.pcbest');
      if (pcBest !== G.best.id) {
        pcBest = G.best.id;
        var src = bv.querySelectorAll('.tile');
        bb.className = 'pcbest n' + Math.min(8, src.length);
        bb.innerHTML = [].map.call(src, function (t, i) { return '<div class="pctile" style="--r:' + ((i % 2 ? 1 : -1) * (1 + (i * 7) % 3)) + 'deg;--d:' + (i * 0.12).toFixed(2) + 's"><canvas width="' + DRAW_W + '" height="' + DRAW_H + '"></canvas><span>' + t.querySelector('span').innerHTML + '</span></div>'; }).join('');
        [].forEach.call(bb.querySelectorAll('canvas'), function (cv, i) { var s0 = src[i].querySelector('canvas'), cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(s0, 0, 0, cv.width, cv.height); });
      }
      var tl = bv.querySelectorAll('.tile');
      [].forEach.call(bb.querySelectorAll('.pctile'), function (t, i) { if (!tl[i]) return; t.classList.toggle('win', tl[i].classList.contains('win')); t.classList.toggle('lose', tl[i].classList.contains('lose')); });
      if (G.phase === 'reveal' && pcRev !== 'best' + G.best.id) {
        pcRev = 'best' + G.best.id;
        setTimeout(function () {
          var w = [].map.call(ov.querySelectorAll('.pctile.win span'), function (x) { return x.textContent.replace(/^[A-Z] /, ''); });
          if (w.length) hostSay('him', (w.length > 1 ? 'The best postcards come from ' + w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1] : 'The best postcard comes from ' + w[0]) + '! 🏆🎨', 4600);
        }, 1200);
      }
    }
  }
  // ---------- Hold That Note ----------
  // Technical problems: one of the stars keeps getting cut off in the middle of her high note. A diva rises on stage
  // in an enormous gown; everyone guesses on their phone how long she will hold it this time (10 to 20 seconds);
  // she sings, a timer runs, and the note is cut at a random moment. The closest guess wins.
  var DIVA = '<svg class="diva" viewBox="0 0 600 720" aria-hidden="true"><defs><linearGradient id="ntgown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7fb"/><stop offset=".5" stop-color="#bfc2d3"/><stop offset="1" stop-color="#6e7290"/></linearGradient><linearGradient id="nttier" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffb3e1"/></linearGradient><radialGradient id="ntskin" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f7d2b6"/><stop offset="1" stop-color="#d9a17f"/></radialGradient></defs><path d="M262 250 Q300 238 338 250 L360 330 L240 330 Z" fill="url(#ntgown)"/><path d="M240 320 Q300 300 360 320 Q420 430 470 470 Q300 500 130 470 Q180 430 240 320 Z" fill="url(#ntgown)"/><path d="M130 462 Q300 492 470 462 Q520 540 560 590 Q300 640 40 590 Q80 540 130 462 Z" fill="url(#ntgown)"/><path d="M40 582 Q300 632 560 582 Q590 650 600 720 L0 720 Q10 650 40 582 Z" fill="url(#ntgown)"/><path d="M130 466 Q300 496 470 466" stroke="url(#nttier)" stroke-width="9" fill="none"/><path d="M40 586 Q300 636 560 586" stroke="url(#nttier)" stroke-width="11" fill="none"/><path d="M240 322 Q300 302 360 322" stroke="url(#nttier)" stroke-width="7" fill="none"/><g class="dvfringe" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" opacity=".9"><line x1="245" y1="322" x2="247" y2="344"/><line x1="259" y1="317" x2="261" y2="339"/><line x1="272" y1="313" x2="274" y2="335"/><line x1="286" y1="311" x2="288" y2="333"/><line x1="300" y1="310" x2="302" y2="332"/><line x1="314" y1="311" x2="316" y2="333"/><line x1="328" y1="313" x2="330" y2="335"/><line x1="341" y1="317" x2="343" y2="339"/><line x1="355" y1="322" x2="357" y2="344"/><line x1="135" y1="466" x2="137" y2="496"/><line x1="151" y1="469" x2="153" y2="499"/><line x1="166" y1="471" x2="168" y2="501"/><line x1="182" y1="473" x2="184" y2="503"/><line x1="198" y1="475" x2="200" y2="505"/><line x1="214" y1="477" x2="216" y2="507"/><line x1="229" y1="478" x2="231" y2="508"/><line x1="245" y1="479" x2="247" y2="509"/><line x1="261" y1="480" x2="263" y2="510"/><line x1="276" y1="481" x2="278" y2="511"/><line x1="292" y1="481" x2="294" y2="511"/><line x1="308" y1="481" x2="310" y2="511"/><line x1="324" y1="481" x2="326" y2="511"/><line x1="339" y1="480" x2="341" y2="510"/><line x1="355" y1="479" x2="357" y2="509"/><line x1="371" y1="478" x2="373" y2="508"/><line x1="386" y1="477" x2="388" y2="507"/><line x1="402" y1="475" x2="404" y2="505"/><line x1="418" y1="473" x2="420" y2="503"/><line x1="434" y1="471" x2="436" y2="501"/><line x1="449" y1="469" x2="451" y2="499"/><line x1="465" y1="466" x2="467" y2="496"/><line x1="45" y1="586" x2="47" y2="622"/><line x1="63" y1="589" x2="65" y2="625"/><line x1="80" y1="592" x2="82" y2="628"/><line x1="98" y1="595" x2="100" y2="631"/><line x1="115" y1="598" x2="117" y2="634"/><line x1="133" y1="600" x2="135" y2="636"/><line x1="151" y1="602" x2="153" y2="638"/><line x1="168" y1="604" x2="170" y2="640"/><line x1="186" y1="606" x2="188" y2="642"/><line x1="203" y1="607" x2="205" y2="643"/><line x1="221" y1="609" x2="223" y2="645"/><line x1="238" y1="610" x2="240" y2="646"/><line x1="256" y1="610" x2="258" y2="646"/><line x1="274" y1="611" x2="276" y2="647"/><line x1="291" y1="611" x2="293" y2="647"/><line x1="309" y1="611" x2="311" y2="647"/><line x1="326" y1="611" x2="328" y2="647"/><line x1="344" y1="610" x2="346" y2="646"/><line x1="362" y1="610" x2="364" y2="646"/><line x1="379" y1="609" x2="381" y2="645"/><line x1="397" y1="607" x2="399" y2="643"/><line x1="414" y1="606" x2="416" y2="642"/><line x1="432" y1="604" x2="434" y2="640"/><line x1="449" y1="602" x2="451" y2="638"/><line x1="467" y1="600" x2="469" y2="636"/><line x1="485" y1="598" x2="487" y2="634"/><line x1="502" y1="595" x2="504" y2="631"/><line x1="520" y1="592" x2="522" y2="628"/><line x1="537" y1="589" x2="539" y2="625"/><line x1="555" y1="586" x2="557" y2="622"/></g><g fill="#fff" opacity=".95"><circle cx="200" cy="420" r="3"/><circle cx="380" cy="400" r="3"/><circle cx="300" cy="440" r="2.5"/><circle cx="150" cy="540" r="3"/><circle cx="450" cy="530" r="3"/><circle cx="300" cy="560" r="3.5"/><circle cx="90" cy="650" r="3"/><circle cx="520" cy="660" r="3"/><circle cx="240" cy="670" r="3"/><circle cx="380" cy="690" r="3"/><circle cx="330" cy="360" r="2"/><circle cx="270" cy="380" r="2"/></g><path d="M268 200 Q300 190 332 200 L340 258 Q300 270 260 258 Z" fill="url(#ntgown)"/><g fill="#ffd6f0"><circle cx="285" cy="215" r="2.5"/><circle cx="310" cy="222" r="2.5"/><circle cx="296" cy="238" r="2.5"/><circle cx="320" cy="245" r="2"/><circle cx="278" cy="244" r="2"/></g><g fill="#e9c060"><circle cx="252" cy="80" r="34"/><circle cx="300" cy="52" r="38"/><circle cx="348" cy="80" r="34"/><circle cx="250" cy="126" r="22"/><circle cx="350" cy="126" r="22"/><circle cx="260" cy="160" r="16"/><circle cx="340" cy="160" r="16"/></g><g fill="#f7dc8c"><circle cx="262" cy="70" r="14"/><circle cx="300" cy="40" r="16"/><circle cx="338" cy="70" r="14"/><circle cx="244" cy="118" r="8"/><circle cx="356" cy="118" r="8"/></g><path d="M266 206 Q230 170 214 120" stroke="url(#ntskin)" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M334 206 Q372 180 388 132" stroke="url(#ntskin)" stroke-width="18" fill="none" stroke-linecap="round"/><circle cx="213" cy="114" r="11" fill="url(#ntskin)"/><circle cx="389" cy="126" r="11" fill="url(#ntskin)"/><g class="dvmic"><rect x="200" y="96" width="10" height="34" rx="4" fill="#333" transform="rotate(-25 205 113)"/><circle cx="198" cy="94" r="9" fill="#777"/></g><rect x="290" y="168" width="20" height="30" rx="8" fill="url(#ntskin)"/><ellipse cx="300" cy="118" rx="44" ry="52" fill="url(#ntskin)"/><path d="M254 100 Q258 56 300 54 Q342 56 346 100 Q332 76 312 74 Q300 92 270 84 Q262 90 254 100 Z" fill="#e9c060"/><g class="dveyesc"><path d="M276 112 Q284 118 292 112" stroke="#2a1410" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M308 112 Q316 118 324 112" stroke="#2a1410" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M276 112 L272 108 M292 112 L295 107 M308 112 L305 107 M324 112 L328 108" stroke="#2a1410" stroke-width="2"/></g><g class="dveyeso"><ellipse cx="284" cy="111" rx="9" ry="7" fill="#fff"/><ellipse cx="316" cy="111" rx="9" ry="7" fill="#fff"/><circle cx="285" cy="111" r="4.5" fill="#3a6ea8"/><circle cx="317" cy="111" r="4.5" fill="#3a6ea8"/><circle cx="285" cy="111" r="2" fill="#111"/><circle cx="317" cy="111" r="2" fill="#111"/><circle cx="286.5" cy="109.5" r="1.2" fill="#fff"/><circle cx="318.5" cy="109.5" r="1.2" fill="#fff"/><path d="M274 106 Q284 100 294 106 M306 106 Q316 100 326 106" stroke="#2a1410" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M275 106 L271 102 M293 106 L296 101 M307 106 L304 101 M325 106 L329 102" stroke="#2a1410" stroke-width="2"/></g><path d="M273 100 Q284 94 293 100" stroke="#a07a2a" stroke-width="3" fill="none"/><path d="M307 100 Q316 94 327 100" stroke="#a07a2a" stroke-width="3" fill="none"/><ellipse cx="270" cy="132" rx="8" ry="5" fill="#ff8fa3" opacity=".5"/><ellipse cx="330" cy="132" rx="8" ry="5" fill="#ff8fa3" opacity=".5"/><ellipse class="dvmouth" cx="300" cy="146" rx="10" ry="13" fill="#7a1430"/><ellipse class="dvtongue" cx="300" cy="152" rx="6" ry="4" fill="#e05570"/><circle cx="256" cy="130" r="5" fill="#ffd23f"/><circle cx="344" cy="130" r="5" fill="#ffd23f"/></svg>';   // (an original character: big blonde curls, a towering silver fringe gown)
  var NOTE_GUESS_MS = 20000, NOTE_MIN = 10, NOTE_MAX = 60, NOTE_LEAD = 6, noteTimer = null, noteTick = null;   // (NOTE_LEAD: seconds of the recording before the note itself)
  function noteElapsed(g) {   // seconds of the note so far (negative during the lead-in); the recording's own clock when it plays
    var a = ntAudio; if (a && !a.paused && a.currentTime > 0.05) return a.currentTime - NOTE_LEAD;
    return (Date.now() - g.t0) / 1000;
  }
  function noteTime(s, tenths) { var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + (tenths ? r.toFixed(1) : Math.floor(r)); }   // 1:05 (or 1:05.3)
  function noteAll() {
    var act = list().filter(function (p) { return !p.off; });
    if (act.length < 2 || REMOTE) { quipAll(); return; }
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.note = { id: 'note' + G.round + '-' + Math.random().toString(36).slice(2, 6), st: 'intro', guess: {}, out: {}, len: Math.round((NOTE_MIN + Math.random() * (NOTE_MAX - NOTE_MIN)) * 10) / 10, t0: 0, ends: 0, win: [] };
    G.phase = 'note'; G.q = null; G.song = null; G.clip = null; G.barMs = 0;
    cover(true, '', '', false); masks(true); hostsAway(); push(); noteShow();
    if (!REMOTE && !ntAudio) { try { ntAudio = new Audio('sounds/long_note.mp3'); ntAudio.preload = 'auto'; ntAudio.load(); } catch (e) {} }   // (loaded in advance: the note starts on time)
    var g = G.note, at = function (ms, f) { clearTimeout(f._t); setTimeout(function () { if (G.note === g && $('noteov')) f(); }, ms); };
    var lines = [
      ['him', 'Oh no, Europe… we have technical problems! 😱'],
      ['her', 'One of our stars keeps getting cut off in the middle of her big high note!'],
      ['him', 'Our engineers need your help: they want to find the exact moment the sound system breaks down! 🔧'],
      ['her', 'So: how long will she hold her note before it all goes wrong?'],
      ['him', 'Guess on your phone: anywhere between 10 seconds and one minute.'],
      ['her', 'But careful: once she sings past your time, you’re out! The closest guess that’s still in at the end wins. 🎯'],
      ['him', 'Ladies and gentlemen… our diva! 💃']
    ];
    var t = 1800;
    lines.forEach(function (l, i) { (function (l, t0) { at(t0, function () { noteSay(l[0], l[1]); if (i === lines.length - 1) { $('noteov').classList.add('diva-on'); Music.douze(); whooshes([0, 300]); } }); })(l, t); t += Math.max(3800, Array.from(l[1]).length * TALK_MS + 2400); });
    at(t + 800, function () { noteGuess(); });
  }
  // The diva's note: a recording of over two minutes, played from the start and stopped dead when the mic drops.
  var ntAudio = null;
  function noteAudio(on) {
    if (REMOTE) return;
    try {
      if (!on) { if (ntAudio) ntAudio.pause(); return; }
      if (!ntAudio) { ntAudio = new Audio('sounds/long_note.mp3'); ntAudio.preload = 'auto'; }
      ntAudio.volume = Math.max(0, Math.min(1, Music.vol ? Music.vol.fx : 1)); ntAudio.currentTime = 0;
      var pr = ntAudio.play(); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }
  function noteSay(who, txt) {
    var ov = $('noteov'); if (!ov) return;
    [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); });
    if (!who) return;
    var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); typeSay(b, txt, who);
  }
  function noteGuess() {
    var g = G.note; if (!g) return;
    g.st = 'guess'; g.ends = Date.now() + NOTE_GUESS_MS; noteSay(''); push(); noteShow(); Music.ding();
    bots.forEach(function (b) { if (!players[b.pid] || players[b.pid].off) return; setTimeout(function () { noteMsg({ pid: b.pid, id: g.id, guess: Math.round(NOTE_MIN + Math.random() * (NOTE_MAX - NOTE_MIN)) }); }, 3000 + Math.random() * 9000); });
    clearTimeout(noteTimer); noteTimer = setTimeout(noteSing, NOTE_GUESS_MS);
    clearInterval(noteTick); noteTick = setInterval(function () { if (!G.note || G.note.st !== 'guess') { clearInterval(noteTick); return; } noteShow(); }, 1000);
  }
  function noteMsg(m) {
    var g = G.note; if (!g || G.phase !== 'note' || g.st !== 'guess' || !m || m.id !== g.id || !players[m.pid] || g.guess[m.pid] != null) return;
    var v = Math.round(Number(m.guess)); if (!(v >= NOTE_MIN && v <= NOTE_MAX)) return;
    g.guess[m.pid] = v; Music.plop(Object.keys(g.guess).length); push(); noteShow();
    if (list().filter(function (p) { return !p.off; }).every(function (p) { return g.guess[p.pid] != null; })) { clearTimeout(noteTimer); noteTimer = setTimeout(noteSing, 1500); }
  }
  function noteSing() {
    var g = G.note; if (!g || g.st !== 'guess') return;
    clearInterval(noteTick); g.st = 'sing'; g.t0 = Date.now() + NOTE_LEAD * 1000; push(); noteShow();   // (the recording has a lead-in: the timer starts when the note does)
    noteAudio(true);
    var tick = function () {
      if (G.note !== g || g.st !== 'sing') return;
      var el = noteElapsed(g);
      if (el >= g.len) { noteCut(); return; }
      var gone = Object.keys(g.guess).filter(function (k) { return !g.out[k] && g.guess[k] < el; });   // she sang past these guesses: out
      if (gone.length) { gone.forEach(function (k) { g.out[k] = 1; }); Music.buzz(); push(); }
      noteShow(); noteTick = requestAnimationFrame(tick);
    };
    noteTick = requestAnimationFrame(tick);
  }
  function noteCut() {
    var g = G.note; if (!g) return;
    g.st = 'cut'; noteAudio(false);   // oops: an electric shock, and she drops her microphone
    if (!REMOTE) try { var zz = new Audio('sounds/shock.mp3'); zz.volume = Math.max(0, Math.min(1, Music.vol ? Music.vol.fx : 1)); var zp = zz.play(); if (zp && zp.catch) zp.catch(function () {}); } catch (e) {}
    setTimeout(function () { Music.micdrop(); }, 500);   // (the thud as it lands)
    var act = list().filter(function (p) { return !p.off; }), best = Infinity;
    act.forEach(function (p) { var v = g.guess[p.pid]; if (v != null && v >= g.len) best = Math.min(best, v - g.len); });   // the closest of those still in (not passed)
    g.win = act.filter(function (p) { var v = g.guess[p.pid]; return v != null && v >= g.len && v - g.len === best; }).map(function (p) { return p.pid; });
    g.win.forEach(function (k) { var p = players[k]; p.score += 12; p.pts = 12; p.got = true; });
    push(); noteShow();
    var at = function (ms, f) { setTimeout(function () { if (G.note === g) f(); }, ms); };
    at(1400, function () { noteSay('him', 'Oops… she dropped her microphone! 🎤💥 She held the note for ' + noteTime(g.len, true) + '!'); });
    at(4600, function () {
      var w = g.win.map(function (k) { return players[k] ? players[k].name + ' (' + noteTime(g.guess[k]) + ')' : ''; }).filter(Boolean);
      noteSay('her', w.length ? (w.length > 1 ? w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1] + ' were' : w[0] + ' was') + ' closest, and still in! 🏆' : Object.keys(g.guess).length ? 'She sang past every guess… nobody is left! 😅' : 'Nobody made a guess… what a shame!');
      g.st = 'done'; push(); noteShow(); Music.douze();
    });
    at(9600, function () {
      var ov = $('noteov'); if (ov) { ov.classList.add('leaving'); whooshes([0, 300]); }
      setTimeout(function () { if (G.note !== g) return; G.note = null; G.phase = 'loading'; push(); startRound2(); }, 1000);
    });
  }
  function noteSnap() {
    var g = G.note, locked = {};
    Object.keys(g.guess).forEach(function (k) { locked[k] = 1; });
    return { id: g.id, st: g.st, left: g.st === 'guess' ? Math.max(0, g.ends - Date.now()) : 0, locked: locked,
      guess: g.st === 'cut' || g.st === 'done' ? g.guess : null, out: g.out, len: g.st === 'cut' || g.st === 'done' ? g.len : null, win: g.st === 'done' ? g.win : null, min: NOTE_MIN, max: NOTE_MAX };
  }
  // The big screen: the stage, the diva (once she is announced), a timer, and a line from 0 to 20 seconds
  // with everyone's guess on it (shown when she starts) and a needle running along it while she sings.
  function noteShow() {
    var g = G.note; if (!g) return;
    var ov = $('noteov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'noteov'; ov.className = 'grov noteov enter';
      ov.innerHTML = '<div class="grwall"></div><div class="grfloor"></div><div class="ntspot"></div><div class="grsign ntsign">🎤 Hold That Note</div>' +
        '<div class="ntstage"><div class="ntstop"></div><div class="ntsfront"></div></div>' +
        '<div class="ntdiva">' + DIVA + '<div class="ntnotes"><i>♪</i><i>♫</i><i>♪</i><i>♬</i></div><div class="ntsparks"></div><div class="ntshock"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="16" fill="#e9f8ff" opacity=".9"/><g fill="none" stroke="#dff6ff" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><polyline points="50,50 40,36 47,30 34,12"/><polyline points="50,50 64,40 60,30 78,18"/><polyline points="50,50 66,58 74,52 94,60"/><polyline points="50,50 58,68 50,74 60,94"/><polyline points="50,50 36,62 30,56 10,70"/><polyline points="50,50 32,46 28,52 6,40"/></g></svg></div></div>' +
        '<div class="nttimer">0:00.0</div><div class="ntline"><div class="ntscale"></div><div class="ntpins"></div><div class="ntneedle"></div></div>' +
        '<div class="ntmsg"></div><div class="ntplayers"></div>' +
        '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
      document.body.appendChild(ov); whooshes([0, 350, 700]);
      var sc = ''; for (var s = 0; s <= NOTE_MAX; s += 10) sc += '<span style="left:' + (s / NOTE_MAX * 100) + '%">' + noteTime(s) + '</span>';
      ov.querySelector('.ntscale').innerHTML = sc;
      setTimeout(function () { ov.classList.remove('enter'); }, 2800);
    }
    ov.setAttribute('data-st', g.st);
    ov.classList.toggle('lead', g.st === 'sing' && noteElapsed(g) < 0);   // the lead-in of the recording: her mouth goes quickly open and shut
    var el = g.st === 'sing' ? Math.max(0, noteElapsed(g)) : g.st === 'cut' || g.st === 'done' ? g.len : 0;
    ov.querySelector('.nttimer').textContent = noteTime(el, true);
    ov.querySelector('.ntneedle').style.left = Math.min(100, el / NOTE_MAX * 100) + '%';
    var act = list().filter(function (p) { return !p.off; });
    var pinKey = (g.st === 'intro' || g.st === 'guess' ? 'none' : 'pins') + '|' + Object.keys(g.guess).length;
    var pins = ov.querySelector('.ntpins');
    if (pins.getAttribute('data-k') !== pinKey) {   // the guesses go up on the line when she starts to sing
      pins.setAttribute('data-k', pinKey);
      var sorted = act.filter(function (p) { return g.guess[p.pid] != null; }).sort(function (a, b) { return g.guess[a.pid] - g.guess[b.pid]; });
      pins.innerHTML = g.st === 'intro' || g.st === 'guess' ? '' : sorted.map(function (p, i) {
        return '<div class="ntpin" data-pid="' + esc(p.pid) + '" style="left:' + (g.guess[p.pid] / NOTE_MAX * 100) + '%;--i:' + (i % 2) + '">' + charSvg(p.char) + '<b>' + esc(p.name) + ' ' + noteTime(g.guess[p.pid]) + '</b></div>';
      }).join('');
    }
    [].forEach.call(pins.querySelectorAll('.ntpin'), function (el) { var k = el.getAttribute('data-pid'); el.classList.toggle('out', !!g.out[k]); el.classList.toggle('win', g.st === 'done' && g.win.indexOf(k) >= 0); });
    var msg = g.st === 'intro' ? '' : g.st === 'guess' ? 'How long will she hold it? Guess on your phone! ⏱️ ' + Math.ceil(Math.max(0, g.ends - Date.now()) / 1000) + 's' : g.st === 'sing' ? (noteElapsed(g) < 0 ? 'She takes a deep breath… 🌬️' : 'Hold it… hold it…') : g.st === 'cut' ? '💥 Oops!' : '';
    var me = ov.querySelector('.ntmsg'); if (me.textContent !== msg) me.textContent = msg;
    var ph = act.map(function (p) { return '<div class="clp">' + charSvg(p.char) + '<b>' + esc(p.name) + '</b><em class="' + (g.guess[p.pid] != null ? 'ok' : 'wait') + '">' + (g.guess[p.pid] != null ? '✔' : '…') + '</em></div>'; }).join('');
    var pl = ov.querySelector('.ntplayers'); if (g.st !== 'guess') ph = ''; if (pl.getAttribute('data-h') !== ph) { pl.setAttribute('data-h', ph); pl.innerHTML = ph; }
  }
  // ---------- Lost in Verona (Juliet's maze) ----------
  // Juliet, on her balcony, knows the way through a hidden maze. Like Simon says she calls out the route: one step,
  // then two, then three… Everyone taps the whole route from memory on their phone; every right step takes your token one
  // tile further and lights up the maze. One wrong step and you're lost (out). The last one left wins; if everyone left
  // goes wrong in the same round, whoever got furthest that round wins.
  var JM_COLS = 7, JM_ROWS = 6, JM_MAX = 14, JM_PTS = [12, 8, 4], JM_DIRS = [[-1, 0], [0, -1], [1, 0], [0, 1]], JM_ARROW = ['⬅️', '⬆️', '➡️', '⬇️'], qjTimer = null, qjTick = null;
  var JULIET = '<svg class="juliet" viewBox="0 0 200 300" aria-hidden="true"><path d="M58 58 Q60 14 100 12 Q140 14 142 58 L150 150 Q100 162 50 150 Z" fill="#3a1a14"/><rect x="88" y="94" width="24" height="22" rx="8" fill="#f2c9a8"/><ellipse cx="100" cy="68" rx="32" ry="36" fill="#f2c9a8"/><path d="M68 56 Q72 26 100 26 Q128 26 132 56 Q118 40 100 42 Q82 40 68 56 Z" fill="#3a1a14"/><circle cx="88" cy="70" r="4" fill="#2a1410"/><circle cx="112" cy="70" r="4" fill="#2a1410"/><path d="M84 62 q4 -3 8 0 M108 62 q4 -3 8 0" stroke="#2a1410" stroke-width="2" fill="none"/><path d="M90 86 Q100 94 110 86" stroke="#b0303a" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="80" cy="80" rx="6" ry="3.5" fill="#ff8f9f" opacity=".5"/><ellipse cx="120" cy="80" rx="6" ry="3.5" fill="#ff8f9f" opacity=".5"/><circle cx="100" cy="30" r="5" fill="#ffd23f"/><circle cx="90" cy="33" r="3" fill="#fff"/><circle cx="110" cy="33" r="3" fill="#fff"/><path d="M66 118 Q100 104 134 118 L150 240 Q100 252 50 240 Z" fill="#c2185b"/><path d="M80 116 Q100 126 120 116 L118 132 Q100 140 82 132 Z" fill="#ffd6e6"/><path d="M66 122 Q40 150 46 176" stroke="#c2185b" stroke-width="16" fill="none" stroke-linecap="round"/><circle cx="46" cy="180" r="8" fill="#f2c9a8"/><path class="jarm" d="M134 122 Q166 104 172 70" stroke="#c2185b" stroke-width="16" fill="none" stroke-linecap="round"/><circle class="jhand" cx="172" cy="64" r="8" fill="#f2c9a8"/><circle cx="168" cy="52" r="7" fill="#e0245e"/><path d="M168 59 l0 14" stroke="#2f7a3a" stroke-width="3"/></svg>';   // (an original character: Juliet with a rose)
  function jmRoute() {   // the way to the balcony: never straight back the way you came, mostly northwards
    var r = [], prev = -1;
    for (var i = 0; i < JM_MAX; i++) { var w = []; [0, 1, 2, 3].forEach(function (d) { if (prev >= 0 && d === (prev + 2) % 4) return; for (var k = 0; k < (d === 1 ? 3 : d === 3 ? 1 : 2); k++) w.push(d); }); prev = pick(w); r.push(prev); }
    return r;
  }
  function jmCell(g, n) { var x = Math.floor(JM_COLS / 2), y = JM_ROWS - 1; for (var i = 0; i < n; i++) { x += JM_DIRS[g.route[i]][0]; y += JM_DIRS[g.route[i]][1]; } return [x, y]; }
  function qjAll() {
    var act = list().filter(function (p) { return !p.off; });
    if (act.length < 2 || REMOTE) { quipAll(); return; }
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.qj = { id: 'jm' + G.round + '-' + Math.random().toString(36).slice(2, 6), st: 'intro', round: 0, route: jmRoute(), wrong: {}, falls: {}, pos: 0, order: act.map(function (p) { return p.pid; }), alive: act.map(function (p) { return p.pid; }), prog: {}, fail: {}, outAt: {}, best: {}, lit: 0, show: -1, ends: 0, win: [], rank: null };
    G.phase = 'qj'; G.q = null; G.song = null; G.clip = null; G.barMs = 0;
    cover(true, '', '', false); masks(true); hostsAway(); push(); qjShow();
    var g = G.qj, at = function (ms, f) { setTimeout(function () { if (G.qj === g && $('qjov')) f(); }, ms); };
    var lines = [
      ['him', 'Europe, we’re lost… lost in Verona! 🌹 The streets here are a real maze.'],
      ['her', 'But look up there: Juliet, on her balcony! She knows the way. 💃'],
      ['him', 'She calls out the route: first one step, then two, then three… one more every time!'],
      ['her', 'Remember them all, and tap the whole route on your phone. One step at a time! ✨'],
      ['him', 'One wrong step and you’re lost in Verona! 😵 The last one left wins.'],
      ['him', 'Good luck, everyone! 🍀'],
      ['her', 'See you back at the studio! 👋']
    ];
    var t = 2200;
    lines.forEach(function (l) { (function (l, t0) { at(t0, function () { qjSay(l[0], l[1]); }); })(l, t); t += Math.max(3800, Array.from(l[1]).length * TALK_MS + 2400); });
    at(t - 600, function () { qjSay(''); var o = $('qjov'); if (o) o.classList.add('hostsgone'); whooshes([0, 250]); });   // and off they run, north, into the clouds
    at(t + 2400, function () { qjRound(); });
  }
  function qjSay(who, txt) {
    var ov = $('qjov'); if (!ov) return;
    [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); });
    var nw = ov.querySelector('.jmnews');
    if (ov.classList.contains('hostsgone')) {   // the presenters have gone: their lines come up as a caption
      if (!nw) return; if (!who) { nw.classList.remove('on'); return; }
      nw.classList.add('on'); nw._said = ''; typeSay(nw, txt, who); return;
    }
    if (!who) return;
    var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); typeSay(b, txt, who);
  }
  // Juliet calls out the route so far, one arrow at a time; then everyone taps it.
  function qjRound() {
    var g = G.qj; if (!g) return;
    g.round++; g.st = 'show'; g.prog = {}; g.fail = {}; g.wrong = {}; g.show = -1; g.pos = 0; g.falls = {}; var ovh = $('qjov'); if (ovh) ovh._holes = {}; push(); qjShow();
    var STEP = Math.max(560, 900 - g.round * 25), at = function (ms, f) { setTimeout(function () { if (G.qj === g && g.st === 'show') f(); }, ms); };
    for (var i = 0; i < g.round; i++) (function (i) {
      at(1200 + i * STEP, function () { g.show = i; push(); qjShow(); Music.plop([2, 6, 9, 4][g.route[i]]); });
      at(1200 + i * STEP + STEP * 0.7, function () { g.show = -2; qjShow(); });
    })(i);
    at(1200 + g.round * STEP + 300, function () {
      g.show = -1; g.st = 'input'; var ms = 4500 + g.round * 1300; g.ends = Date.now() + ms; push(); qjShow(); Music.ding();
      bots.forEach(function (b) { if (g.alive.indexOf(b.pid) < 0) return; var n = 0, step = function () {
        if (G.qj !== g || g.st !== 'input' || g.fail[b.pid] || (g.prog[b.pid] || 0) >= g.round) return;
        var ok = G.mgTest || Math.random() < 0.985 - 0.03 * g.round, d = ok ? g.route[g.prog[b.pid] || 0] : (g.route[g.prog[b.pid] || 0] + 1 + Math.floor(Math.random() * 3)) % 4;
        qjMsg({ pid: b.pid, id: g.id, round: g.round, i: g.prog[b.pid] || 0, dir: d }); n++; setTimeout(step, 380 + Math.random() * 520);
      }; setTimeout(step, 900 + Math.random() * 900); });
      clearTimeout(qjTimer); qjTimer = setTimeout(qjResolve, ms);
      clearInterval(qjTick); qjTick = setInterval(function () { if (!G.qj || G.qj.st !== 'input') { clearInterval(qjTick); return; } qjShow(); }, 500);
    });
  }
  function qjMsg(m) {
    var g = G.qj; if (!g || G.phase !== 'qj' || g.st !== 'input' || !m || m.id !== g.id || m.round !== g.round || g.alive.indexOf(m.pid) < 0 || g.fail[m.pid]) return;
    var p = g.prog[m.pid] || 0; if (m.i !== p || p >= g.round) return;
    var d = Math.floor(Number(m.dir)); if (!(d >= 0 && d < 4)) return;
    if (d === g.route[p]) { g.prog[m.pid] = p + 1; Music.plop([2, 6, 9, 4][d]); }
    else { g.fail[m.pid] = 1; g.wrong[m.pid] = d; Music.blip(); }
    push(); qjShow();
    if (g.alive.every(function (k) { return g.fail[k] || (g.prog[k] || 0) >= g.round || !players[k] || players[k].off; })) { clearTimeout(qjTimer); qjTimer = setTimeout(qjResolve, 700); }
  }
  function qjResolve() {
    var g = G.qj; if (!g || g.st !== 'input') return;
    clearInterval(qjTick);
    g.alive.forEach(function (k) { if (!g.fail[k] && (g.prog[k] || 0) < g.round) { g.fail[k] = 1; var c = g.route[g.prog[k] || 0], o = [0, 1, 2, 3].filter(function (d) { return d !== c; }); g.wrong[k] = pick(o); } });   // (too slow: lost at the step they were on)
    g.st = 'run'; g.pos = 0; g.falls = {}; push(); qjShow();
    var t = 900, at = function (ms, f) { setTimeout(function () { if (G.qj === g) f(); }, ms); }, left = g.alive.slice();
    for (var i = 0; i < g.round; i++) (function (i) {
      var fall = left.filter(function (k) { return g.fail[k] && (g.prog[k] || 0) === i; });
      if (fall.length) {   // who went wrong here runs off that way, out of the picture: one direction at a time
        [0, 1, 2, 3].forEach(function (d) {
          var grp = fall.filter(function (k) { return g.wrong[k] === d; }); if (!grp.length) return;
          at(t, function () { grp.forEach(function (k) { g.falls[k] = { i: i, d: d }; }); push(); qjShow(); Music.step(); setTimeout(function () { if (G.qj === g) Music.buzz(); }, 300); }); t += 1500;
        });
        left = left.filter(function (k) { return fall.indexOf(k) < 0; });
      }
      if (!left.length) return;
      at(t, function () { g.pos = i + 1; push(); qjShow(); Music.step(); setTimeout(function () { Music.step(); }, 180); }); t += 650;
    })(i);
    at(t + 500, qjJudge);
  }
  function qjJudge() {
    var g = G.qj; if (!g || g.st !== 'run') return;
    var ok = g.alive.filter(function (k) { return !g.fail[k] && (g.prog[k] || 0) >= g.round; }), lost = g.alive.filter(function (k) { return ok.indexOf(k) < 0; });
    lost.forEach(function (k) { g.outAt[k] = g.round; g.best[k] = g.prog[k] || 0; });
    var nm = function (k) { return players[k] ? players[k].name : '?'; };
    g.st = 'res'; push(); qjShow();
    var end = false, line;   // (who fell, and who is still in)
    if (!ok.length) {   // everyone left went wrong: whoever got furthest this round wins
      var top = Math.max.apply(null, lost.map(function (k) { return g.prog[k] || 0; }));
      g.win = lost.filter(function (k) { return (g.prog[k] || 0) === top; }); end = true;
      line = 'Everyone got lost! 😵 But ' + g.win.map(nm).join(' and ') + ' got furthest: ' + top + ' step' + (top === 1 ? '' : 's') + '!';
    } else if (ok.length === 1 && g.alive.length > 1) { g.win = ok; end = true; line = nm(ok[0]) + ' is the last one standing! 🌹'; }
    else if (g.round >= JM_MAX) { g.win = ok; end = true; line = 'The whole route, and still not lost! ' + ok.map(nm).join(' and ') + ' made it to the balcony! 🌹'; }
    else line = lost.length ? '😵 ' + lost.map(nm).join(', ') + (lost.length > 1 ? ' are' : ' is') + ' lost in Verona!' : 'Everyone found the way! 👏 One more step…';
    g.alive = ok.length ? ok : g.alive;
    if (lost.length) Music.buzz(); else Music.ding();
    qjSay(g.round % 2 ? 'him' : 'her', line);
    setTimeout(function () { if (G.qj !== g) return; qjSay(''); if (end) qjEnd(); else qjRound(); }, 4200);
  }
  function qjEnd() {
    var g = G.qj; if (!g) return;
    var act = g.order.filter(function (k) { return players[k] && !players[k].off; });
    var score = function (k) { return g.win.indexOf(k) >= 0 ? 1e6 : (g.outAt[k] || 0) * 100 + (g.best[k] || 0); };
    act.sort(function (a, b) { return score(b) - score(a); });
    var rank = {}, r = 0; act.forEach(function (k, i) { if (i > 0 && score(k) !== score(act[i - 1])) r = i; rank[k] = r; });
    act.forEach(function (k) { var pts = rank[k] < Math.max(1, act.length - 1) ? JM_PTS[rank[k]] || 0 : 0; if (pts) { var p = players[k]; p.score += pts; p.pts = pts; p.got = true; } });
    g.rank = rank; g.st = 'done'; push(); qjShow(); Music.douze();
    var nm = function (k) { return players[k] ? players[k].name : '?'; };
    var at = function (ms, f) { setTimeout(function () { if (G.qj === g) f(); }, ms); };
    at(800, function () { qjSay('her', g.win.map(nm).join(' and ') + (g.win.length > 1 ? ' find' : ' finds') + ' the way to Juliet! 🌹 Bravissimo!'); });
    at(5200, function () { qjSay('him', 'And the rest of you… still lost in Verona! 🗺️😂'); });
    at(9800, function () {
      var ov = $('qjov'); if (ov) { ov.classList.add('leaving'); whooshes([0, 300]); }
      setTimeout(function () { if (G.qj !== g) return; G.qj = null; G.phase = 'loading'; push(); startRound2(); }, 1000);
    });
  }
  // Juliet's house, far away above the clouds: a tall romantic Italian house with an arched window, ivy, and a stone
  // balcony full of flowers (the balustrade is drawn in front of her).
  var JM_TOWER = '<svg viewBox="0 0 100 160" aria-hidden="true"><defs><linearGradient id="jmtw" x1="0" x2="1"><stop offset="0" stop-color="#cdb38e"/><stop offset=".45" stop-color="#f1dfbd"/><stop offset="1" stop-color="#b99d76"/></linearGradient><radialGradient id="jmwin" cx=".5" cy=".6" r=".7"><stop offset="0" stop-color="#fff2c4"/><stop offset=".6" stop-color="#ffbf62"/><stop offset="1" stop-color="#d9782e"/></radialGradient></defs>' +
    '<path d="M14 26 L50 4 L86 26 Z" fill="#b4532f"/><path d="M14 26 L50 4 L86 26" stroke="#7a3418" stroke-width="2" fill="none"/><rect x="18" y="25" width="64" height="4" fill="#efe2c8"/>' +
    '<rect x="20" y="29" width="60" height="131" fill="url(#jmtw)"/><g stroke="rgba(90,60,30,.18)" stroke-width=".8">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(function (i) { return '<path d="M20 ' + (34 + i * 7.6) + ' h60"/>'; }).join('') + '</g>' +
    '<path d="M36 74 V48 Q50 30 64 48 V74 Z" fill="#5a3a26"/><path d="M38.5 74 V49 Q50 34 61.5 49 V74 Z" fill="url(#jmwin)"/><path d="M50 36 V74 M38.5 58 H61.5" stroke="#6a4428" stroke-width="1.4"/>' +
    '<rect x="27" y="49" width="7" height="25" fill="#2f6a42"/><rect x="66" y="49" width="7" height="25" fill="#2f6a42"/>' +
    '<path d="M28 98 h10 v14 h-10 z M62 98 h10 v14 h-10 z" fill="#ffcf7a" stroke="#5a3a26" stroke-width="1.5"/><path d="M29 120 h9 v12 h-9 z M62 120 h9 v12 h-9 z" fill="#3a3550" stroke="#5a3a26" stroke-width="1.5"/>' +
    '<g fill="#3f7a3a">' + [[22, 30], [24, 38], [21, 46], [25, 55], [22, 64], [26, 72], [23, 82], [78, 34], [76, 44], [79, 53], [77, 62], [75, 90], [78, 98]].map(function (q) { return '<ellipse cx="' + q[0] + '" cy="' + q[1] + '" rx="3.6" ry="2.6"/>'; }).join('') + '</g>' +
    '<path d="M22 30 Q26 52 22 84 M78 34 Q74 62 78 100" stroke="#2d5a2a" stroke-width="1.2" fill="none"/>' +
    '<path d="M24 78 h52 v4 h-52 z" fill="#efe2c8"/><path d="M28 82 h44 l-6 6 h-32 z" fill="#d8c8a8"/></svg>';
  var JM_TFRONT = '<svg viewBox="0 0 100 160" aria-hidden="true"><path d="M23 64 h54 v3 h-54 z" fill="#f4ead4"/>' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return '<path d="M' + (26.5 + i * 5.9) + ' 67 q-1.6 2.5 0 5 q1.6 2.5 0 5.5 h2.4 q1.6 -3 0 -5.5 q-1.6 -2.5 0 -5 z" fill="#ece0c6"/>'; }).join('') +
    '<path d="M23 77.5 h54 v1.5 h-54 z" fill="#d8c8a8"/>' +
    '<rect x="21" y="59.5" width="11" height="5" rx="1" fill="#a24f2a"/><rect x="68" y="59.5" width="11" height="5" rx="1" fill="#a24f2a"/>' +
    [[22.5, 58], [25.5, 56.6], [28.5, 58.2], [31, 57], [69, 57], [72, 58.4], [75, 56.6], [78, 58]].map(function (q, i) { return '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="1.9" fill="' + ['#ff4d7a', '#ffd23f', '#ff7aa8', '#e0245e'][i % 4] + '"/><circle cx="' + (q[0] + .9) + '" cy="' + (q[1] + 1.8) + '" r="1.5" fill="#3f7a3a"/>'; }).join('') +
    [[30, 79, 7], [44, 79, 10], [58, 79, 6], [70, 79, 9]].map(function (q) { return '<path d="M' + q[0] + ' ' + q[1] + ' q-2 ' + (q[2] / 2) + ' 0 ' + q[2] + '" stroke="#3f7a3a" stroke-width="1.1" fill="none"/><circle cx="' + q[0] + '" cy="' + (q[1] + q[2]) + '" r="1.2" fill="#ff7aa8"/>'; }).join('') + '</svg>';
  function qjSnap() {
    var g = G.qj;
    return { id: g.id, st: g.st, round: g.round, alive: g.alive, prog: g.prog, fail: g.fail, left: g.st === 'input' ? Math.max(0, g.ends - Date.now()) : 0, win: g.win, outAt: g.outAt };
  }
  // The big screen: a crossroads in Verona seen from above, the group in the middle, Juliet's balcony at the top in the
  // mist. When the group walks, the city slides the other way; who goes wrong runs into a side street and falls in a hole.
  // The city in 3D (like the Grand Final): city blocks with lit windows and tiled roofs around every crossroads.
  // The group stays in the middle; the whole city slides the other way when they walk.
  // ---------- Lost in Verona: the city in real 3D (three.js) ----------
  // Blocks of Italian houses with lit windows and pyramid roofs around every crossroads, cobbled streets, a cold moon
  // and warm street lamps. The group stays at the crossroads in the middle of the screen; the whole city moves the other
  // way when they walk. Blocks are added around the group as it goes (and the far ones are dropped).
  var V3 = null, V3_C = 10, V3_B = 6.5;
  function v3Load(done) {
    if (window.THREE) { done(); return; }
    var sc = document.createElement('script'); sc.src = 'vendor/three.min.js?v=1'; sc.onload = function () { done(); }; sc.onerror = function () { done(); }; document.head.appendChild(sc);
  }
  function v3Tex(draw, w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; return t; }
  function v3Facade(col, seed) {   // a facade: plaster, rows of windows (most lit, warm), green shutters, a lit shop front at street level
    return v3Tex(function (x, w, h) {
      var r = function (k) { var v = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453; return v - Math.floor(v); };
      x.fillStyle = col; x.fillRect(0, 0, w, h);
      for (var n = 0; n < 900; n++) { x.fillStyle = 'rgba(' + (r(n) < .5 ? '255,255,255' : '80,50,30') + ',' + (.03 + r(n + 3) * .05) + ')'; x.fillRect(r(n + 1) * w, r(n + 2) * h, 3, 3); }
      x.fillStyle = 'rgba(60,35,20,.35)'; x.fillRect(0, h * .78, w, 4);
      var cols = 4, rows = 3;
      for (var cx = 0; cx < cols; cx++) for (var ry = 0; ry < rows; ry++) {
        var X = (cx + .28) * w / cols, Y = (ry + .2) * h * .78 / rows, W = w / cols * .44, H = h * .78 / rows * .58, lit = r(cx * 7 + ry * 3) < .62;
        x.fillStyle = '#3a2a22'; x.fillRect(X - 3, Y - 3, W + 6, H + 6);
        var g = x.createLinearGradient(0, Y, 0, Y + H); g.addColorStop(0, lit ? '#ffe2a0' : '#2a3048'); g.addColorStop(1, lit ? '#f2a64a' : '#1a1e30'); x.fillStyle = g; x.fillRect(X, Y, W, H);
        x.fillStyle = 'rgba(40,20,10,.6)'; x.fillRect(X + W / 2 - 1, Y, 2, H); x.fillRect(X, Y + H * .45, W, 2);
        x.fillStyle = '#2f6a42'; x.fillRect(X - W * .42, Y, W * .36, H); x.fillRect(X + W * 1.06, Y, W * .36, H);
        x.fillStyle = 'rgba(0,0,0,.25)'; for (var s = 0; s < 6; s++) { x.fillRect(X - W * .42, Y + s * H / 6, W * .36, 1.5); x.fillRect(X + W * 1.06, Y + s * H / 6, W * .36, 1.5); }
        x.fillStyle = '#e9e0cc'; x.fillRect(X - 5, Y + H + 3, W + 10, 5);
      }
      for (var d = 0; d < 3; d++) { var DX = (d + .2) * w / 3, DW = w / 3 * .6; var g2 = x.createLinearGradient(0, h * .82, 0, h); g2.addColorStop(0, '#fff0c0'); g2.addColorStop(1, '#e8962f'); x.fillStyle = '#3a2418'; x.fillRect(DX - 4, h * .81, DW + 8, h * .19); x.fillStyle = g2; x.fillRect(DX, h * .83, DW, h * .17); x.fillStyle = ['#a8283a', '#2a6a4a', '#2a4a8a'][(d + seed) % 3]; x.fillRect(DX - 6, h * .8, DW + 12, h * .035); }
    }, 256, 256);
  }
  function v3Init(host, over) {
    if (!window.THREE) return null;
    var T = THREE, w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    var rn = new T.WebGLRenderer({ antialias: true, alpha: false }); rn.setPixelRatio(Math.min(1.5, devicePixelRatio || 1)); rn.setSize(w, h); rn.shadowMap.enabled = true; rn.shadowMap.type = T.PCFSoftShadowMap;
    rn.outputEncoding = T.sRGBEncoding; rn.toneMapping = T.ACESFilmicToneMapping; rn.toneMappingExposure = .95;
    host.appendChild(rn.domElement);
    var sc = new T.Scene(); sc.background = new T.Color('#1b1236'); sc.fog = new T.Fog('#3a2a52', 30, 95);
    var cam = new T.PerspectiveCamera(52, w / h, 0.5, 200); cam.position.set(0, 16, 9); cam.lookAt(0, 0, -3.2);
    var hemi = new T.HemisphereLight('#8a7ac8', '#4a2a20', 0.55); hemi.layers.enable(1); sc.add(hemi);
    var moon = new T.DirectionalLight('#b8c4ff', 0.75); moon.position.set(-14, 26, -18); moon.layers.enable(1); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
    var sh = moon.shadow.camera; sh.left = -30; sh.right = 30; sh.top = 30; sh.bottom = -30; sh.near = 1; sh.far = 90; moon.shadow.bias = -0.0008; sc.add(moon);
    var lamp = new T.PointLight('#ffb866', 2.4, 26, 1.6); lamp.position.set(0, 6.5, 0); lamp.layers.enable(1); sc.add(lamp);   // the crossroads lamp, always over the group
    var rn2 = null, cam2 = null;
    if (over) { rn2 = new T.WebGLRenderer({ antialias: true, alpha: true }); rn2.setPixelRatio(rn.getPixelRatio()); rn2.setSize(w, h); rn2.setClearColor(0x000000, 0); rn2.shadowMap.enabled = true; rn2.shadowMap.type = T.PCFSoftShadowMap; rn2.outputEncoding = T.sRGBEncoding; rn2.toneMapping = T.ACESFilmicToneMapping; rn2.toneMappingExposure = rn.toneMappingExposure; over.appendChild(rn2.domElement); cam2 = cam.clone(); cam2.layers.set(1); }
    var city = new T.Group(); sc.add(city);
    var towerTex = v3Facade('#efe0c4', 7); towerTex.repeat.set(2, 7);
    var tower = new T.Group(), tw = new T.MeshStandardMaterial({ map: towerTex, roughness: .9 });
    var tb = new T.Mesh(new T.BoxGeometry(9, 46, 9), [tw, tw, capMat0(), capMat0(), tw, tw]); tb.position.y = 23; tower.add(tb);
    var bal = new T.Mesh(new T.BoxGeometry(6.5, .5, 3), new T.MeshStandardMaterial({ color: '#f4ead4', roughness: .7 })); bal.position.set(0, 38, 5.5); tower.add(bal);
    var rail = new T.Mesh(new T.BoxGeometry(6.5, 1.4, .3), new T.MeshStandardMaterial({ color: '#efe2c8', roughness: .7 })); rail.position.set(0, 38.9, 6.9); tower.add(rail);
    var tr = new T.Mesh(new T.ConeGeometry(7, 6, 4), new T.MeshStandardMaterial({ color: '#b4532f', roughness: .8, flatShading: true })); tr.rotation.y = Math.PI / 4; tr.position.y = 49; tower.add(tr);
    var glow = new T.PointLight('#ffb0d0', 1.6, 30, 1.5); glow.position.set(0, 41, 9); tower.add(glow);
    tower.position.set(0, 0, -70);   /* (not shown: the tower is the backdrop above the mist) */
    function capMat0() { return new T.MeshStandardMaterial({ color: '#7a3a22', roughness: .9 }); }
    var cob = v3Tex(function (x, W, H) { x.fillStyle = '#6a5c54'; x.fillRect(0, 0, W, H); for (var yy = 0; yy < 16; yy++) for (var xx = 0; xx < 16; xx++) { var v = 80 + ((xx * 37 + yy * 61) % 40); x.fillStyle = 'rgb(' + (v + 18) + ',' + (v + 6) + ',' + v + ')'; x.beginPath(); x.ellipse(xx * 16 + 8 + (yy % 2) * 8, yy * 16 + 8, 7, 6.5, 0, 0, Math.PI * 2); x.fill(); } }, 256, 256);
    cob.repeat.set(150, 150);
    var ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ map: cob, roughness: .95 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; city.add(ground);
    var facCols = ['#e8cc9a', '#e7b39a', '#efdcb4', '#d9a888', '#e3c08a', '#f0d2c0'], facs = facCols.map(function (c, i) { return new T.MeshStandardMaterial({ map: v3Facade(c, i), roughness: .9 }); });
    var roofTex = v3Tex(function (x, W, H) { x.fillStyle = '#b4532f'; x.fillRect(0, 0, W, H); for (var yy = 0; yy < 16; yy++) { x.fillStyle = yy % 2 ? '#9c4426' : '#c2633a'; x.fillRect(0, yy * 16, W, 9); for (var xx = 0; xx < 12; xx++) { x.fillStyle = 'rgba(60,20,10,.35)'; x.fillRect(xx * 22 + (yy % 2) * 11, yy * 16, 2, 16); } } }, 256, 256);
    var roofMat = new T.MeshStandardMaterial({ map: roofTex, roughness: .8, flatShading: true }), capMat = new T.MeshStandardMaterial({ color: '#7a3a22', roughness: .9 });
    var blocks = {};
    function rnd(a, b, k) { var v = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); }
    function addBlock(i, j) {   // the block whose corner is crossroads (i, j) and (i+1, j+1)
      var key = i + ',' + j; if (blocks[key]) return;
      var g = new T.Group(), hgt = 4.2 + rnd(i, j, 1) * 2.6, m = facs[Math.floor(rnd(i, j, 2) * facs.length)];
      var tx = m.map.clone(); tx.encoding = THREE.sRGBEncoding; tx.needsUpdate = true; tx.repeat.set(Math.round(V3_B / 3.4), Math.max(1, Math.round(hgt / 4.6)));
      var mat = new T.MeshStandardMaterial({ map: tx, roughness: .9 });
      var body = new T.Mesh(new T.BoxGeometry(V3_B, hgt, V3_B), [mat, mat, capMat, capMat, mat, mat]); body.position.y = hgt / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      var cor = new T.Mesh(new T.BoxGeometry(V3_B + .35, .35, V3_B + .35), new T.MeshStandardMaterial({ color: '#efe2c8', roughness: .8 })); cor.position.y = hgt + .1; cor.castShadow = true; g.add(cor);
      var roof = new T.Mesh(new T.ConeGeometry(V3_B * .74, 2.1 + rnd(i, j, 3) * 1.2, 4, 1), roofMat); roof.rotation.y = Math.PI / 4; roof.position.y = hgt + .25 + (2.1 + rnd(i, j, 3) * 1.2) / 2; roof.castShadow = true; g.add(roof);
      if (rnd(i, j, 4) < .7) { var ch = new T.Mesh(new T.BoxGeometry(.6, 1.3, .6), capMat); ch.position.set((rnd(i, j, 5) - .5) * 3, hgt + 1.4, (rnd(i, j, 6) - .5) * 3); ch.castShadow = true; g.add(ch); }
      g.position.set((i + .5) * V3_C, 0, (j + .5) * V3_C); city.add(g); blocks[key] = g;
    }
    function around(cx, cy) {   // the blocks around crossroads (cx, cy); far ones go
      for (var i = cx - 4; i < cx + 4; i++) for (var j = cy - 6; j < cy + 3; j++) addBlock(i, j);
      Object.keys(blocks).forEach(function (k) { var p = k.split(',').map(Number); if (Math.abs(p[0] - cx) > 6 || Math.abs(p[1] - cy) > 8) { city.remove(blocks[k]); delete blocks[k]; } });
    }
    around(0, 0);
    var holes = [], holeMat = new T.MeshBasicMaterial({ color: '#000' }), rimMat = new T.MeshStandardMaterial({ color: '#2a1a12', roughness: 1 });
    var st = { x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t0: 0, dur: 600, alive: true };
    function frame() {
      if (!st.alive) return;
      if (!host.isConnected) { st.alive = false; rn.dispose(); if (rn2) rn2.dispose(); return; }
      var k = st.t0 ? Math.min(1, (performance.now() - st.t0) / st.dur) : 1, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      st.x = st.fx + (st.tx - st.fx) * e; st.y = st.fy + (st.ty - st.fy) * e;
      city.position.set(-st.x * V3_C, 0, -st.y * V3_C);
      lamp.intensity = 2.3 + Math.sin(performance.now() / 300) * .08;
      var w2 = host.clientWidth, h2 = host.clientHeight; if (w2 && h2 && (w2 !== rn.domElement.width / rn.getPixelRatio() || h2 !== rn.domElement.height / rn.getPixelRatio())) { rn.setSize(w2, h2); cam.aspect = w2 / h2; cam.updateProjectionMatrix(); }
      rn.render(sc, cam);
      if (rn2) {   // the blocks in front of the crossroads (towards the camera), once more, over the players
        Object.keys(blocks).forEach(function (k) { var b = blocks[k], fz = b.position.z + city.position.z > 1; if (b.userData.front !== fz) { b.userData.front = fz; b.traverse(function (o) { if (fz) o.layers.enable(1); else o.layers.disable(1); }); } });
        if (w2 && h2 && (w2 !== rn2.domElement.width / rn2.getPixelRatio() || h2 !== rn2.domElement.height / rn2.getPixelRatio())) rn2.setSize(w2, h2);
        cam2.position.copy(cam.position); cam2.quaternion.copy(cam.quaternion); cam2.aspect = cam.aspect; cam2.updateProjectionMatrix();
        var bg = sc.background; sc.background = null; rn2.render(sc, cam2); sc.background = bg;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    var api = {
      go: function (x, y, jump) { st.fx = jump ? x : st.x; st.fy = jump ? y : st.y; st.tx = x; st.ty = y; st.t0 = jump ? 0 : performance.now(); if (jump) { st.x = x; st.y = y; } around(Math.round(x), Math.round(y)); },
      hole: function (x, y, d) {   // a hole in the side street from crossroads (x, y), direction d
        var g = new T.Group(), r = new T.Mesh(new T.CircleGeometry(1.35, 28), rimMat), b = new T.Mesh(new T.CircleGeometry(1.15, 28), holeMat);
        r.rotation.x = b.rotation.x = -Math.PI / 2; r.position.y = .02; b.position.y = .03; g.add(r); g.add(b);
        g.position.set((x + JM_DIRS[d][0] * .55) * V3_C, 0, (y + JM_DIRS[d][1] * .55) * V3_C); g.scale.set(.01, .01, .01); city.add(g); holes.push(g);
        var t0 = performance.now(); (function grow() { var k = Math.min(1, (performance.now() - t0) / 400); var s = .01 + .99 * (1 - Math.pow(1 - k, 3)); g.scale.set(s, s, s); if (k < 1) requestAnimationFrame(grow); })();
      },
      clearHoles: function () { holes.forEach(function (g) { city.remove(g); }); holes = []; },
      balcony: function () { cam.updateMatrixWorld(); var v = new T.Vector3(0, 39, -64.5); v.project(cam); return [(v.x + 1) / 2 * host.clientWidth, (1 - v.y) / 2 * host.clientHeight]; },
      screen3: function (wx, wy, wz) { cam.updateMatrixWorld(); var v = new T.Vector3(wx * V3_C, wy, wz * V3_C); v.project(cam); return [(v.x + 1) / 2 * host.clientWidth, (1 - v.y) / 2 * host.clientHeight]; },
      screen: function (wx, wz) {   // where a point on the ground (relative to the group) shows on screen, in px
        cam.updateMatrixWorld(); var v = new T.Vector3(wx * V3_C, 0, wz * V3_C); v.project(cam); return [(v.x + 1) / 2 * host.clientWidth, (1 - v.y) / 2 * host.clientHeight];
      }
    };
    return api;
  }
  function jmBlocks(cx, cy) {   // the blocks around where the group is (their look depends on where they are, so they stay the same)
    var h = '';
    for (var i = -2; i <= 2; i++) for (var j = -3; j <= 1; j++) { var ax = cx + i, ay = cy + j, t = ((ax * 7 + ay * 3) % 4 + 4) % 4; h += '<div class="jmb3 t' + t + '" style="--i:' + i + ';--j:' + j + '"><i class="n jmfac"></i><i class="w jmfac"></i><i class="e jmfac"></i><i class="s jmfac"></i><i class="roof"></i></div>'; }
    return h;
  }
  function jmCity() {
    return '<div class="jm3d"><div class="jmcam"><div class="jmplane jmgp"><div class="jmground"></div></div></div><div class="jmcam"><div class="jmplane"><div class="jmblocks">' + jmBlocks(0, 0) + '</div></div></div></div>';   /* (the ground in a layer of its own, underneath) */
  }
  function qjShow() {
    var g = G.qj; if (!g) return;
    var ov = $('qjov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'qjov'; ov.className = 'grov qjov jmov enter';
      ov.innerHTML = '<div class="jm3h"></div><div class="jmsky"><i class="cb"></i></div><div class="jmtower">' + JM_TOWER + '</div><div class="jmsky front"><i class="c1"></i><i class="c2"></i><i class="c3"></i></div><div class="jmholes"></div><div class="jmgroup"></div><div class="jm3o"></div><div class="jmmist"></div>' +
        '<div class="jmbalc"><div class="jmjul">' + JULIET + '</div><div class="jmrail"></div><div class="jmsay"></div></div><div class="jmtfront">' + JM_TFRONT + '</div>' +
        '<div class="grsign qjsign vrsign">🌹 Lost in Verona</div><div class="sfhall vrno"></div><div class="qjmsg jmmsg"></div><div class="jmnews"></div>' +
        '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
      document.body.appendChild(ov); whooshes([0, 350, 700]); Music.ding();
      setTimeout(function () { ov.classList.remove('enter'); }, 2800);
      V3 = null; v3Load(function () { var hh = ov.querySelector('.jm3h'); if (!hh || !hh.isConnected) return; V3 = v3Init(hh, ov.querySelector('.jm3o')); if (V3) { ov.classList.add('v3'); var hm = V3.screen(-.075, -.4), hf = V3.screen(.075, -.4), ht = V3.screen3(0, 3.6, -.4); ov.style.setProperty('--ps', (Math.max(60, hm[1] - ht[1]) / (innerHeight * .15)).toFixed(3)); ov.style.setProperty('--h1x', hm[0] + 'px'); ov.style.setProperty('--h2x', hf[0] + 'px'); ov.style.setProperty('--hy', hm[1] + 'px'); ov.style.setProperty('--hh', Math.max(120, hm[1] - ht[1]) + 'px'); var c0 = V3.screen(0, 0), bq = [innerWidth / 2, innerHeight * .2]; ov.style.setProperty('--jx', c0[0] + 'px'); ov.style.setProperty('--jy', c0[1] + 'px'); ov.style.setProperty('--bx', bq[0] + 'px'); ov.style.setProperty('--by', bq[1] + 'px'); } qjShow(); });
    }
    ov.setAttribute('data-st', g.st);
    ov.querySelector('.vrno').textContent = g.round ? 'Route: ' + g.round + ' step' + (g.round === 1 ? '' : 's') : '';
    // Juliet calls out an arrow
    var say = ov.querySelector('.jmsay'), sv = g.st === 'show' && g.show >= 0 ? JM_ARROW[g.route[g.show]] : '';
    if (say.getAttribute('data-v') !== (sv ? g.show + sv : '')) { say.setAttribute('data-v', sv ? g.show + sv : ''); say.innerHTML = sv ? '<b>' + sv + '</b><small>' + (g.show + 1) + '</small>' : ''; say.classList.toggle('on', !!sv); }
    ov.querySelector('.jmjul').classList.toggle('talk', g.st === 'show');
    // the city: where the group is on the route (it slides the other way)
    var x = 0, y = 0; for (var i = 0; i < (g.pos || 0); i++) { x += JM_DIRS[g.route[i]][0]; y += JM_DIRS[g.route[i]][1]; }
    ov.style.setProperty('--near', String(Math.max(0, Math.min(10, -y))));   // (north: the tower comes a little closer)
    var ck = x + ',' + y, was = (ov.getAttribute('data-p') || '0,0').split(',').map(Number);
    if (V3 && ov.getAttribute('data-p') !== ck) {
      ov.setAttribute('data-p', ck);
      var far = Math.abs(x - was[0]) + Math.abs(y - was[1]) !== 1;
      if (far) V3.clearHoles();
      V3.go(x, y, far);   // (a new round: back to the start in one go)
      ov.querySelector('.jmholes').innerHTML = '';
    }
    // the group: everyone still in, together in the middle; whoever goes wrong runs into a side street and falls
    var grp = ov.querySelector('.jmgroup'), act = g.order.filter(function (k) { return players[k]; }), inGroup = act.filter(function (k) { return g.alive.indexOf(k) >= 0 || (g.st === 'done' && g.win.indexOf(k) >= 0); });
    act.forEach(function (k) {
      var p = players[k], el = grp.querySelector('.jmt[data-pid="' + k.replace(/"/g, '') + '"]');
      if (!el) { el = document.createElement('div'); el.className = 'jmt'; el.setAttribute('data-pid', k); el.innerHTML = '<div class="jmlegs"><i></i><i></i></div><div class="jmbody"><i></i><i></i></div>' + charSvg(p.char) + '<b>' + esc(p.name) + '</b>'; grp.appendChild(el); }
      var j = inGroup.indexOf(k), n = inGroup.length, ang = n > 1 ? j / n * Math.PI * 2 : 0, rad = n > 1 ? Math.min(9.5, 3.2 + n * 0.9) : 0;
      el.style.setProperty('--gx', (Math.cos(ang) * rad).toFixed(2) + 'vh'); el.style.setProperty('--gy', (Math.sin(ang) * rad * 0.8).toFixed(2) + 'vh'); el.style.zIndex = String(100 + Math.round(Math.sin(ang) * rad * 8));   // (lower on screen = closer: in front)
      var f = g.falls && g.falls[k];
      if (f && !el.classList.contains('falling')) {
        var c0 = V3 ? V3.screen(0, 0) : [0, 0], c1 = V3 ? V3.screen(JM_DIRS[f.d][0] * 1.6, JM_DIRS[f.d][1] * (f.d === 1 ? 1.3 : 1.6)) : [JM_DIRS[f.d][0] * 900, JM_DIRS[f.d][1] * 600];   // (far down that street: out of the picture)
        el.style.setProperty('--fx', (c1[0] - c0[0]) + 'px'); el.style.setProperty('--fy', (c1[1] - c0[1]) + 'px');
        el.classList.add('falling');
        if (!ov._holes) ov._holes = {}; var hk = f.i + ':' + f.d;
        ov._holes[hk] = 1;
      }
      if (!f && el.classList.contains('falling')) el.classList.remove('falling');
      el.classList.toggle('out', j < 0 && !f);
      el.classList.toggle('run', g.st === 'run' && !f && j >= 0);
      el.classList.toggle('done', g.st === 'input' && j >= 0 && ((g.prog[k] || 0) >= g.round || !!g.fail[k]));
      el.classList.toggle('won', g.st === 'done' && g.win.indexOf(k) >= 0);
    });
    var tapped = inGroup.filter(function (k) { return (g.prog[k] || 0) >= g.round || g.fail[k]; }).length;
    var msg = g.st === 'show' ? '🤫 Listen to Juliet…' : g.st === 'input' ? 'Tap the route on your phone! ⏱️ ' + Math.ceil(Math.max(0, g.ends - Date.now()) / 1000) + 's · ' + tapped + '/' + inGroup.length : g.st === 'run' ? 'Andiamo! 🏃' : g.st === 'done' ? '🌹 To the balcony!' : '';
    var me = ov.querySelector('.qjmsg'); if (me.textContent !== msg) me.textContent = msg;
  }
  // ---------- Quip! ----------
  // A song plays, and with it comes a question about that song. Everyone writes their funniest answer
  // on their phone while the clip runs on; then all answers are shown without names and everyone
  // votes for the best one (not their own).
  var quipTimer = null;
  // The Green Room: the presenters take everyone to the green room, where the stars sit waiting on their sofas
  // (the players on the front sofa). They explain the game, then the performance starts and the question comes.
  var GR_SOFAS = ['#8e1b3a', '#1d6b6b', '#5b2a86', '#a8641a', '#25507f'];
  function greenRoom(then) {
    stopTimers(); try { yt.pauseVideo(); } catch (e) {}
    G.fun = { kind: 'groom', icon: FUN.quip.icon, title: FUN.quip.title, sub: FUN.quip.sub, plain: true, quiet: true }; G.phase = 'fun'; G.barMs = 0;
    cover(true, '', '', false); masks(true); push();
    hostsAway();
    var old = $('grov'); if (old) old.remove();
    var act = list().filter(function (p) { return !p.off; });
    var taken = {}; act.forEach(function (p) { taken[p.char] = 1; });
    var stars = shuffle(CHARS.filter(function (c) { return !taken[c.id]; })).slice(0, 12);
    var codes = shuffle(Object.keys(countries || {}).filter(function (c) { return c.length === 2 && ['yu', 'cs'].indexOf(c) < 0; }));
    var person = function (charId, name, i, flag) {   // someone on a sofa: body, head, and now and then a flag to wave
      var col = ['#e8457c', '#f2b134', '#3fb6c9', '#9b6bf2', '#55c27a', '#f07a3a'][i % 6];
      return '<div class="grp' + (Math.random() < 0.45 ? ' hop' : '') + '" style="--d:' + (-Math.random() * 3).toFixed(2) + 's">' +
        (flag ? '<span class="grflag"><img src="https://flagcdn.com/w80/' + flag + '.png" alt=""></span>' : '') +
        '<span class="grbody" style="background:' + col + '"></span>' + charSvg(charId) + '</div>';
    };
    var sofa = function (people, k, names) { return '<div class="grsofa" style="--c:' + GR_SOFAS[k % GR_SOFAS.length] + '"><div class="grseat">' + people.join('') + '</div><span class="grfront"></span>' + (names ? '<div class="grnames">' + names.map(function (n) { return '<b>' + esc(n) + '</b>'; }).join('') + '</div>' : '') + '</div>'; };
    var row = function (ppl, per, cls, k0, names) { var h = ''; for (var i = 0; i < ppl.length; i += per) h += sofa(ppl.slice(i, i + per), k0 + i / per, names ? names.slice(i, i + per) : null); return '<div class="grrow ' + cls + '">' + h + '</div>'; };
    var back = stars.slice(0, 6).map(function (c, i) { return person(c.id, '', i, i % 2 ? codes[i] : ''); });
    var mid = stars.slice(6, 12).map(function (c, i) { return person(c.id, '', i + 3, i % 2 ? '' : codes[i + 6]); });
    var front = act.map(function (p, i) { return person(p.char, p.name, i + 1, ''); });
    var ov = document.createElement('div'); ov.id = 'grov'; ov.className = 'grov enter';
    ov.innerHTML = '<div class="grwall"></div><div class="grflags">' + codes.slice(12, 30).map(function (c) { return '<i><img src="https://flagcdn.com/w80/' + c + '.png" alt=""></i>'; }).join('') + '</div>' +
      '<div class="grsign">🛋️ Green Room</div><div class="grfloor"></div>' +
      row(back, 3, 'back', 0) + row(mid, 3, 'mid', 2) + row(front, front.length > 6 ? Math.ceil(front.length / 2) : 6, 'front', 1, act.map(function (p) { return p.name; })) +
      '<div class="grhosts">' + HOST_HIM + HOST_HER + '</div><div class="grbub him"></div><div class="grbub her"></div>';
    document.body.appendChild(ov);
    whooshes([0, 350, 700]); setTimeout(function () { ov.classList.remove('enter'); }, 2800);
    var at = function (ms, f) { setTimeout(function () { if (ov.isConnected && G.phase === 'fun' && G.fun && G.fun.kind === 'groom') f(); }, ms); };
    var say = function (who, txt) { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); var b = ov.querySelector('.grbub.' + who); b._said = ''; b.classList.add('on'); typeSay(b, txt, who); };
    at(1500, function () { Music.ding(); say('him', 'Welcome to the Green Room, where all the stars are waiting for their results! 🛋️'); });
    at(5300, function () { say('her', 'We’re going to watch a performance together, and then we have a question for you.'); });
    at(9100, function () { say('him', 'Write the funniest answer you can think of on your phone…'); });
    at(12300, function () { say('her', '…and then everyone votes for the best one. Here comes the performance! 🎤'); });
    at(16300, function () { [].forEach.call(ov.querySelectorAll('.grbub'), function (x) { x.classList.remove('on'); }); ov.classList.add('leaving'); whooshes([0, 300]); });
    at(17300, function () { ov.remove(); then(); });
  }
  function quipAll() {
    G.quipLoad = true; G.quips = null; G.draw = null; G.best = null; G.q = null;
    G.phase = 'loading'; push(); loadSong();
  }
  // The song is ready (called where a quiz question would start): hand out the question and play.
  // Bluff!: the same round, but the question is what a title in another language means. Everyone makes up
  // a translation; the real one is mixed in, and everyone tries to find it. Hard languages go first.
  var EASY_LANG = { english: 1, french: 1, german: 1, dutch: 1, spanish: 1, italian: 1 };
  function lookAlike(title, en) {   // a word of the title is in the translation, or starts like a word of the translation (4 letters or more): too easy to guess
    var norm = function (x) { return String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var a = norm(title).match(/[a-z]+/g) || [], b = norm(en).match(/[a-z]+/g) || [];
    if (norm(title).trim() === norm(en).trim()) return true;
    if (b.some(function (w) { return w.length >= 2 && a.indexOf(w) >= 0; })) return true;   // the same word in both (Amor = Love is fine, Love Me Tonight = Love Me Tonight is not)
    return b.some(function (w) { return w.length >= 4 && a.some(function (v) { return v.length >= 4 && v.slice(0, 4) === w.slice(0, 4); }); });
  }
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
    // Always a hard one: not in a language most people half know (French, Spanish, …), and not a title that gives itself
    // away because it looks like the English (Foi Magia = It Was Magic, Moja Generacija = My Generation).
    // None in this selection: a hard one from any year, rather than an easy one.
    var hardOk = function (s) { return !EASY_LANG[String(s[10]).toLowerCase()] && !lookAlike(s[3], TITLE_EN[s[4]]); };
    var hard = can.filter(hardOk);
    if (!hard.length) hard = playSongs().filter(function (s) { return TITLE_EN[s[4]] && !BAD_VIDEOS[s[4]] && !G.used[s[4]] && hardOk(s); });
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
        G.bluffFakes = {}; opts.forEach(function (o) { if (o.pid) G.bluffFakes[o.pid] = sameCase(o.text); });   // (kept for a tie-break: the funniest fake)
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
  var BEST_MS = 25000, BEST_PTS = 3, bestKey = '', RANK_PTS = [12, 10, 8];
  // In a Party game these rounds sit between 12-point quiz questions, so they are worth four times as much.
  function partyX() { return G.atype === 'party' ? 4 : 1; }
  function drawVote() {
    var g = G.gallery; g.vote = false;
    var pids = (g.shown || []).filter(function (k) { return players[k] && g.items[k]; });
    if (pids.length < 2) return false;
    stopTimers(); G.draw = null; G.song = null; G.clip = null;
    G.best = { id: g.id, pids: pids, tally: null, wins: null, ranked: true };   // Eurovision style: 12, 10 and 8 points for your three favourites
    G.q = { subject: 'best', type: 'mc', text: 'Give your 12, 10 and 8 points to the best drawings!', hint: '', options: pids.map(function (k) { return players[k].name; }), correct: -1, answer: '', noclip: true };
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
    if (!sing) rows.push(['Category', optText('s-subject')], ['Scoring', G.scoring === 'ladder' ? 'Ladder' : optText('s-scoring')], ['Round selection', optText('s-qmode')], ['Final', optText('s-final')]);
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
    try { localStorage.setItem('esc-picks', JSON.stringify({ t: types, p: party, peelSeen: 1, blurSeen: 1, known: Object.keys(TYPE_WEIGHT) })); } catch (e) {}
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
      // a type that did not exist yet when the choice was saved joins in, switched on
      var known = pk.known || ['facts', 'odd', 'mistake', 'higher', 'newer', 'lost'].concat(pk.peelSeen ? ['peel'] : [], pk.blurSeen ? ['blur'] : []);
      if (pk.t && pk.t.length) Object.keys(TYPE_WEIGHT).forEach(function (t) { if (known.indexOf(t) < 0 && pk.t.indexOf(t) < 0) pk.t.push(t); });   // everything was on before this type existed: it joins in
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
    if (REMOTE || bots.length >= (window.BOT_MAX || 12) || G.phase !== 'lobby') return;
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
    $('botadd').disabled = bots.length >= (window.BOT_MAX || 12); $('botadd').textContent = bots.length ? 'Add another test bot (' + bots.length + ' of ' + (window.BOT_MAX || 12) + ')' : 'Add a test bot';
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
      if (b.key !== key) { b.key = key; b.at = Date.now() + (ph === 'guess' && G.q && G.q.peel ? 20000 + Math.random() * 8000 : ph === 'guess' && isPair() ? 14000 + Math.random() * 3000 : ph === 'srec' ? 9000 + Math.random() * 2500 : 1200 + Math.random() * 3500); b.done = false; }   // (and about 10 seconds to "record")
      if (b.done || Date.now() < b.at) return;
      b.done = true;
      if (ph === 'guess' && G.q && G.q.options) {
        var can = []; G.q.options.forEach(function (o, i) { if (!(G.best && G.best.pids[i] === pid)) can.push(i); });
        // A question with a right answer: right 40% of the time, otherwise one of the wrong answers. (Votes are random.)
        var known = !G.best && !G.q.battle && G.q.correct >= 0, smart = known && Math.random() < (window.BOT_SMART == null ? 0.4 : window.BOT_SMART);
        var wrong = known ? can.filter(function (i) { return i !== G.q.correct; }) : can;
        if (can.length && G.best && G.best.ranked) H.guess({ pid: pid, ranks: shuffle(can.slice()).slice(0, 3) });   // a bot's 12, 10 and 8
        else if (can.length) H.guess({ pid: pid, choice: smart ? G.q.correct : pick(wrong.length ? wrong : can) });
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
    $('partybox').classList.toggle('hidden', !party); $('partypickbox').classList.toggle('hidden', !party); var qlo = $('s-qmode').querySelector('option[value="ladder"]'); if (qlo) qlo.disabled = party; if (party && $('s-qmode').value === 'ladder') $('s-qmode').value = 'standard';   // the Ladder is a Quiz game
    $('scoringbox').classList.toggle('hidden', party); $('s-partypick').disabled = !party;   // (scoring is a Quiz setting: a Party game scores the standard way)   // the party settings only show for a Party game
    if (lo) lo.disabled = party;
    
    // Party needs ten songs to fit both Sing! and Draw!: five is not on offer there.
    var lad = !on && !party && $('s-qmode').value === 'ladder'; $('s-scoring').disabled = on || lad;   // the Ladder is its own way of scoring   // Ladder: no song count and no hidden scores
    var tour = party && $('s-partypick').value === 'order';   // Grand tour sets its own length: every minigame once
    $('s-rounds').disabled = lad; $('s-show').disabled = lad;   // (a Grand Tour too: the questions in each round between the party games)
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
  try { var fm = localStorage.getItem('esc-final'); if (fm && $('s-final').querySelector('option[value="' + fm + '"]')) $('s-final').value = fm; } catch (e) {}
  if (!$('s-scoring').value) $('s-scoring').value = 'correct';   // (a Ladder saved from before it moved to Quiz mode)
  try { var qm = localStorage.getItem('esc-qmode'); if (qm && $('s-qmode').querySelector('option[value="' + qm + '"]')) $('s-qmode').value = qm; } catch (e) {}
  $('s-partypick').addEventListener('change', scoreHelp);
  $('s-qmode').addEventListener('change', function () { try { localStorage.setItem('esc-qmode', $('s-qmode').value); } catch (e) {} singToggle(); });
  $('s-final').addEventListener('change', function () { try { localStorage.setItem('esc-final', $('s-final').value); } catch (e) {} singToggle(); });
  function scoreHelp() {
    var show = $('s-show').value === 'end' ? ' Totals stay hidden until the final scoreboard.' : '';
    $('scorehelp').textContent = '';
    var at = $('s-atype').value, qm = $('s-qmode').value;
    var gameTxt = at === 'party' ? PARTY_HELP + ' ' + (PARTY_MODE_HELP[$('s-partypick').value] || '') + (qm === 'random' || qm === 'vote' ? ' ' + ROUND_HELP[qm].replace('each round', 'each block of questions') : '') : at === 'mc' ? (ROUND_HELP[qm] || '') : '';
    $('finalhelp').innerHTML = (gameTxt ? '<span>' + esc(gameTxt) + '</span><br>' : '') + '<span>' + esc(FINAL_HELP[$('s-final').value] || '') + '</span>';
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
    list().forEach(function (p) { p.score = 0; p.qbank = 0; p.rcrown = false; });   // a game that is over leaves no scores behind
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
    G.era = $('s-era').value; G.cat = $('s-cat').value; G.robin = $('s-atype').value === 'robin'; G.atype = G.robin ? 'mc' : $('s-atype').value; G.subject = $('s-subject').value; G.finalMode = $('s-final').value; G.scoring = $('s-atype').value === 'party' ? 'correct' : $('s-atype').value === 'mc' && $('s-qmode').value === 'ladder' ? 'ladder' : $('s-scoring').value || 'correct'; G.showScore = 'always';   /* the scores are always in view (only the Big Five hides them) */
    if (!ytReadyOrRemote() || !buildPool()) return false;
    // Rounds: a quiz can be played in several rounds of so many songs each. With "Spin the years" each
    // round gets its own decade, picked by a spin; a decade that has been played is out of the draw.
    if (G.robin) { G.era = '1956-2100'; buildPool(); }
    G.per = +$('s-rounds').value; G.parts = G.atype === 'mc' ? +$('s-parts').value || 1 : 1;
    G.partLadder = G.atype === 'mc' && G.scoring === 'ladder' && G.parts > 1; G.partN = 0; G.partNext = true; G.partStart = 1;
    list().forEach(function (p) { p.bank = 0; });
    G.qmode = G.atype === 'mc' || (G.atype === 'party' && $('s-qmode').value !== 'ladder') ? $('s-qmode').value : 'standard'; G.eraBlock = -1; var oneEra = G.era && G.era.indexOf(',') < 0 && G.era !== '1956-2100';   // only one era picked: that era is the rule, no spin or vote
    G.eraSpin = G.robin || (!oneEra && (G.qmode === 'random' || G.qmode === 'vote'));   /* (ladder: G.scoring) */ G.eraVote = G.qmode === 'vote'; G.eraNow = ''; G.eraUsed = []; G.part = null; G.partDone = {};
    G.total = G.per * G.parts; G.guessMs = (+$('s-time').value + AFTER) * 1000;
    if (ladderGame()) { G.total = ENDLESS; G.showScore = 'always'; }   // the ladder is the score, and it goes on until someone is at the top   // the clip, then 5 seconds more to answer
    G.round = 0; G.used = {}; fails = 0; note('');
    list().forEach(function (p) { p.score = 0; p.rs = 0; p.rh = []; p.qbank = 0; p.rcrown = false; p.inv = []; p.sitout = ''; p.sitNow = ''; p.flagged = 0; p.flagNow = false; p.rung = 0; p.moved = ''; p.heel = 0; p.bribed = 0; p.uses = {}; p.halfQ = 0; p.halfNow = false; p.cardQ = 0; p.cardNow = ''; p.cardBy = ''; }); G.heels = []; G.sold = {}; G.mgLive = false; G.shopTalked = false; G.recap = false; G.recapAt = 0; G.ladderWon = false; G.mode = 'mc'; G.gallery = null; G.quips = null; G.quipUsed = []; G.bluffSong = null; G.lastParty = ''; G.pspin = null; list().forEach(function (p) { p.champ = false; }); G.chase = null; G.chaseLost = ''; G.chaseOv = null; G.shop = null; G.shopQ = []; G.bribes = []; G.starterGiven = false; G.bomb = null; G.shopFirst = false; G.mgBase = null; G.mgTest = false; G.standingsShown = false; G.opened = false; G.skipOpening = false; G.typeLast = []; G.typeWait = {}; G.battle = null; G.battleQ = null; G.clue = null; clearTimeout(clueTimer); Music.dread(false); G.note = null; clearTimeout(noteTimer); G.qj = null; clearTimeout(qjTimer); clearInterval(qjTick); G.partyIdx = 0; G.afterParty = $('s-atype').value === 'party'; G.partyDone = [];   // a Party game opens with the Quiz card too
    G.partyPick = $('s-partypick').value; G.tourLast = false; G.tourFinal = false; G.tourDone = false; G.tourEnd = false; G.bigCard = false; G.tour = G.atype === 'party' && G.partyPick === 'order'; if (G.tour) G.total = ENDLESS;   // Grand tour: three questions and a minigame, until every minigame has been played
    // Trivia between the party games: three questions a block; on a Grand Tour the number set is the number of
    // questions in each round between the party games (and in the last round before the end).
    G.block = G.tour ? Math.max(1, G.per) : 3;
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
    if (triviaQ()) toEnd = false;   // (no song plays at this answer: Did you know?, and Edgar's questions)
    // Until the end: follow the player. If nothing is playing (or it cannot be read), fall back to a fixed wait.
    autoEnd = Date.now() + (G.clue && G.clue.st === 'ask' ? 6 : toEnd ? REMOTE ? (G.remain > 0 ? Math.max(5, G.remain + 1 - (G.q && G.q.noclip ? 0 : Math.min(clipSecs(), (Date.now() - (G.guessAt || Date.now())) / 1000))) : 30) : 20 : G.draw && !lastSong() ? Math.min(10, +$('autolen').value || 10) : +$('autolen').value) * 1000;
    var t0 = Date.now(), last = t0, held = false;
    var draw = function () {
      if (G.phase !== 'reveal') { autoStop(); return; }
      // An ad in front of the song (or the song has not started yet): the countdown waits for it.
      var now = Date.now(), hold = REMOTE || G.sing || triviaQ() || (isPair() && G.q.correct === 1) ? '' : revealHold(yt, clipStart);   // (nothing to wait for when no video plays)
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
      if (toEnd) $('autoleft').textContent = ''; else $('autoleft').textContent = (lastSong() ? 'Final scores in ' : 'Next question in ') + clock(left);
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
  // ---------- end of a round: the scoreboard moves from its corner to the middle, bigger, with what everyone scored this round ----------
  var recapTimer = null;
  function recapDue() {
    if (REMOTE || G.phase !== 'reveal' || G.atype === 'party' || ladderGame() || G.tourFinal || G.tour || !G.per || G.recapAt === G.round || !list().length) return false;
    if (G.round % G.per !== 0) return false;
    if (!lastSong()) return G.parts > 1;   // a new round comes next
    return G.parts > 1 || (G.finalMode === 'double' && G.total < ENDLESS) || chaseWanted();   // the last of several rounds (the scores are added up), or the Big Five or the Grand Final comes next
  }
  function recapShow() {
    G.recapAt = G.round; G.recap = true;
    var side = $('board').closest('aside'), r = side.getBoundingClientRect();
    var ps = list().slice().sort(function (a, b) { return b.score - a.score; });
    var gain = function (p) { return p.score - (p.rs || 0); }, top = Math.max.apply(null, ps.map(gain));
    var nRound = G.parts > 1 ? Math.min(G.partN || 1, G.parts) : 1;
    ps.forEach(function (p) { p.rh = p.rh || []; if (nRound) p.rh[nRound - 1] = gain(p); });
    var nextTxt = !lastSong() ? 'Next up: round ' + (nRound + 1) + (G.parts > 1 ? ' of ' + G.parts : '') : chaseWanted() ? 'Next up: the Grand Final' : G.finalMode === 'double' && G.total < ENDLESS ? 'Next up: Big Five' : 'And the winner is…';
    if (lastSong()) { recapTally(ps, nextTxt); return; }   // the last round: from 0, player by player, round by round
    var bg = document.createElement('div'); bg.id = 'recapbg'; bg.className = 'recapbg'; document.body.appendChild(bg);
    var c = document.createElement('div'); c.id = 'recap'; c.className = 'card recap';
    var rank = 0, prev = null;
    c.innerHTML = '<h3>' + (nRound ? 'End of round ' + nRound + (G.parts > 1 ? ' of ' + G.parts : '') : 'End of the quiz') + '</h3><ol class="board">' + ps.map(function (p, i) {
      if (p.score !== prev) { rank = i + 1; prev = p.score; }
      var g = gain(p), first = true;   // between rounds: just the standings (the points per round are added up at the end)
      return '<li class="' + (g === top && top > 0 && !first ? 'best' : '') + '" style="--i:' + i + '"><span class="rk">' + rank + '</span><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="gain">' + (first ? '' : g > 0 ? '+' + g : g < 0 ? '−' + (-g) : '+0') + '</span><span class="tot">' + p.score + '</span></li>';
    }).join('') + '</ol><p class="recapnext">' + esc(nextTxt) + '</p>';
    document.body.appendChild(c);
    // it starts exactly where the scoreboard is, and grows into the middle of the screen
    var w = c.offsetWidth, h = c.offsetHeight, L = Math.round((innerWidth - w) / 2), T = Math.round((innerHeight - h) / 2);
    c.style.left = L + 'px'; c.style.top = T + 'px';
    c.style.transform = 'translate(' + (r.left - L) + 'px,' + (r.top - T) + 'px) scale(' + (r.width / w) + ')'; c.style.opacity = '.6';
    side.classList.add('recapgone'); c.getBoundingClientRect();
    bg.classList.add('on'); c.classList.add('go'); c.style.transform = ''; c.style.opacity = '';
    Music.woosh();
    ps.forEach(function (p, i) { setTimeout(function () { if (G.recap) Music.plop(i); }, 1100 + i * 220); });
    clearTimeout(recapTimer); recapTimer = setTimeout(recapEnd, 7500 + ps.length * 220);
  }
  // The last of several rounds: everyone starts at 0, and the rounds are added up one at a time.
  function recapTally(ps, nextTxt) {
    var side = $('board').closest('aside'), r = side.getBoundingClientRect(), R = G.parts;
    var bg = document.createElement('div'); bg.id = 'recapbg'; bg.className = 'recapbg'; document.body.appendChild(bg);
    var c = document.createElement('div'); c.id = 'recap'; c.className = 'card recap tally'; c.style.setProperty('--R', R);
    c.innerHTML = '<h3>' + (R > 1 ? 'All rounds added up' : 'The scores so far') + '</h3><p class="rstep">&nbsp;</p><ol class="board">' + ps.map(function (p) {
      return '<li data-pid="' + esc(p.pid) + '"><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="tot">0</span><span class="gain"></span></li>';
    }).join('') + '</ol><p class="recapnext">' + esc(nextTxt) + '</p>';
    document.body.appendChild(c);
    var w = c.offsetWidth, h = c.offsetHeight, L = Math.round((innerWidth - w) / 2), T = Math.round((innerHeight - h) / 2);
    c.style.left = L + 'px'; c.style.top = T + 'px';
    c.style.transform = 'translate(' + (r.left - L) + 'px,' + (r.top - T) + 'px) scale(' + (r.width / w) + ')'; c.style.opacity = '.6';
    side.classList.add('recapgone'); c.getBoundingClientRect();
    bg.classList.add('on'); c.classList.add('go'); c.style.transform = ''; c.style.opacity = '';
    Music.woosh();
    var tot = {}; ps.forEach(function (p) { tot[p.pid] = 0; });
    var ol = c.querySelector('ol');
    var resort = function () {   // the rows glide to their new places
      var lis = [].slice.call(ol.children), was = {};
      lis.forEach(function (li) { was[li.getAttribute('data-pid')] = li.getBoundingClientRect().top; });
      lis.sort(function (a, b) { return tot[b.getAttribute('data-pid')] - tot[a.getAttribute('data-pid')]; }).forEach(function (li) { ol.appendChild(li); });
      lis.forEach(function (li) { var dy = was[li.getAttribute('data-pid')] - li.getBoundingClientRect().top; if (Math.abs(dy) < 2) return; li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)'; li.getBoundingClientRect(); li.style.transition = 'transform .8s cubic-bezier(.22,.8,.3,1)'; li.style.transform = ''; });
    };
    var count = function (el, from, to) {   // the total counts up
      var t0 = Date.now(), d = 700; (function f() { if (!el.isConnected) return; var q = Math.min(1, (Date.now() - t0) / d); el.textContent = Math.round(from + (to - from) * q); if (q < 1) requestAnimationFrame(f); })();
    };
    var STEP = 1900 + ps.length * 180;
    for (var k = 0; k < R; k++) (function (k) {
      setTimeout(function () {
        if (!G.recap) return;
        var stp = c.querySelector('.rstep'); stp.textContent = R > 1 ? 'Round ' + (k + 1) : ''; stp.classList.remove('rpop'); void stp.offsetWidth; stp.classList.add('rpop');
        ps.forEach(function (p, i) {
          setTimeout(function () {
            if (!G.recap) return;
            var li = ol.querySelector('li[data-pid="' + p.pid + '"]'); if (!li) return;
            var g = (p.rh || [])[k] || 0, from = tot[p.pid], ge = li.querySelector('.gain');
            ge.textContent = g < 0 ? '−' + (-g) : '+' + g; ge.classList.remove('on', 'off'); void ge.offsetWidth; ge.classList.add('on');   // the +points pop up …
            setTimeout(function () { tot[p.pid] += g; count(li.querySelector('.tot'), from, tot[p.pid]); ge.classList.add('off'); }, 450);   // … and fly into the total
            Music.plop(i);
          }, i * 180);
        });
        setTimeout(function () { if (G.recap) resort(); }, ps.length * 180 + 1250);
      }, 1300 + k * STEP);
    })(k);
    setTimeout(function () { if (!G.recap) return; var f = ol.firstElementChild, hi = f ? tot[f.getAttribute('data-pid')] : 0; [].forEach.call(ol.children, function (li) { if (tot[li.getAttribute('data-pid')] === hi) li.classList.add('best'); }); c.querySelector('.recapnext').classList.add('on'); Music.ding(); }, 1300 + R * STEP + 300);
    clearTimeout(recapTimer); recapTimer = setTimeout(recapEnd, 1300 + R * STEP + 4200);
  }
  function recapEnd() {
    if (!G.recap) return;
    G.recap = false; clearTimeout(recapTimer);
    var c = $('recap'), bg = $('recapbg'), side = $('board').closest('aside');
    if (c) { c.classList.add('leave'); bg && bg.classList.remove('on'); setTimeout(function () { c.remove(); bg && bg.remove(); side.classList.remove('recapgone'); }, 550); } else side.classList.remove('recapgone');
    goOn();
  }
  function goNext() {
    if (G.recap) { recapEnd(); return; }   // Next during the summary: on to what comes next
    if (G.phase !== 'reveal' && G.phase !== 'paused') return;
    autoStop(); note('');
    if (recapDue()) { recapShow(); return; }
    goOn();
  }
  function roundsAddUp() { list().forEach(function (p) { p.rcrown = false; if (p.qbank) { p.score += p.qbank; p.qbank = 0; } }); }   // after the last round: all rounds together
  function goOn() {
    if (lastSong() && G.shopQ && G.shopQ.length) { shopDeliver(goOn); return; }   // Eurofan Shop items still on their way land before the final scores
    if (lastSong()) roundsAddUp();
    if (lastSong() && G.atype === 'party' && !G.standingsShown && !REMOTE) { G.standingsShown = true; partyStandings(goOn); return; }   // Party: the final scores first, where the envelopes pay out
    if (lastSong() && G.bribes && G.bribes.length) { ebuPay(goOn); return; }   // the envelopes for the EBU pay out before the final
    // Big Five: when the rounds are done, five more questions for double points, with the scores hidden
    if (lastSong() && G.finalMode === 'double' && !G.tourFinal && !G.tour && !ladderGame() && G.total < ENDLESS) { G.tourFinal = true; G.total += 5; G.bigCard = true; G.quizRun = 0; G.eraNow = ''; buildPool(); startRound(); return; }   // (the Big Five: all selected eras again)
    if (lastSong()) {
      // a Ladder game in rounds: the last round is added to what was banked before
      if (G.partLadder) list().forEach(function (p) { p.score = (p.bank || 0) + LADDER[Math.floor(p.rung || 0)]; });
      if (chaseWanted()) { chaseStart(false); return; }   // the Grand Final decides the winner
      try { yt.stopVideo(); } catch (e) {} G.go = {}; G.phase = 'end'; push();
    } else startRound();   // nobody is 'ready' for the next game yet
  }
  $('again').addEventListener('click', toLobby);   // End game: back to the lobby
  $('again2').addEventListener('click', function () { toLobby(); setTimeout(function () { if (G.phase === 'lobby' && list().length) beginGame(); }, 300); });   // a new game straight away, same players and settings

  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    try { var sk = localStorage.getItem('esc-skip'); if (sk && $('s-skip').querySelector('option[value="' + sk + '"]')) { $('s-skip').value = sk; G.skip = sk; } } catch (e) {}
    ready();
  }).catch(function () { $('start').textContent = 'Could not load songs'; });
  fetch('chorus.json?v=43').then(function (r) { return r.json(); }).then(function (d) { chorus = d || {}; }).catch(function () {});
  keepSettings(['s-time', 's-scoring', 's-rounds']);   // shared with solo play (the eras have their own switches here)
  // ---------- volume: a button in the top right corner, with a slider for music and one for sound effects ----------
  (function () {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'volbtn'; b.className = 'volbtn'; b.setAttribute('aria-label', 'Volume'); b.textContent = '🔊';
    var pnl = document.createElement('div'); pnl.id = 'volpanel'; pnl.className = 'volpanel hidden';
    pnl.innerHTML = '<label>🎵 Music<input type="range" min="0" max="100" id="volmusic"></label><label>💥 Sound effects<input type="range" min="0" max="100" id="volfx"></label>';
    document.body.appendChild(b); document.body.appendChild(pnl);
    var sync = function () { $('volmusic').value = Math.round(Music.vol.music * 100); $('volfx').value = Math.round(Music.vol.fx * 100); b.textContent = Music.vol.music + Music.vol.fx === 0 ? '🔇' : '🔊'; };
    sync();
    b.addEventListener('click', function (e) { e.stopPropagation(); pnl.classList.toggle('hidden'); });
    pnl.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { pnl.classList.add('hidden'); });
    $('volmusic').addEventListener('input', function () { Music.setVol('music', this.value / 100); ytVolApply(); sync(); });
    $('volfx').addEventListener('input', function () { Music.setVol('fx', this.value / 100); Music.ding(); sync(); });
  })();
  restore();
  render();
})();
