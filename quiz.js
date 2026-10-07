// Builds the question for a song: what is asked (country, artist, placement or title)
// and how it is answered (multiple choice or typed). Shared by the host screen and solo mode.
var Q_TEXT = { title: 'Which song is this?', artist: 'Who performs this song?', country: 'Which country sent this song?', place: 'Where did this song finish in the final?', points: 'How many points did this song get?', year: 'Which year is this song from?' };
var Q_HINT = { title: 'Type the title…', artist: 'Type the artist…', country: 'Type the country…', place: 'Type the position, e.g. 5', points: 'Type the number of points', year: 'Type the year, e.g. 2012' };
var COUNTRY_ALIASES = { gb: ['UK', 'Great Britain', 'Britain', 'England'], nl: ['Holland', 'The Netherlands', 'Nederland'], cz: ['Czech Republic'], ba: ['Bosnia', 'Bosnia and Herzegovina'],
  mk: ['Macedonia', 'FYR Macedonia'], cs: ['Serbia and Montenegro'], md: ['Moldavia'], tr: ['Türkiye', 'Turkiye'], by: ['Belorussia'], ru: ['Russian Federation'] };
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
// The placement answer: a position in the final, or "Did not qualify" for songs that stayed in a semi-final.
function placeLabel(s) {
  if (s[6] == null) return null;
  return s[8] != null ? 'Did not qualify' : ordinal(s[6]) + ' place';
}
function pointsLabel(n) { return n + (n === 1 ? ' point' : ' points'); }
// Odd one out: four songs by name, no clip. Three of them share a country or a year; the round's
// song is the one that doesn't belong. Nothing else may tie the odd one to the group.
// ---------- Lost in translation ----------
// English translations of the titles that are not in English (titles_en.json: video id -> translation).
// The question shows the translation; the four answers are original titles, the three wrong ones in
// the same language where possible. There is no clip: the song only plays at the answer.
var TITLE_EN = {};
if (typeof fetch === 'function' && typeof document !== 'undefined' && document.getElementById('s-subject')) {
  fetch('titles_en.json?v=1').then(function (r) { return r.json(); }).then(function (d) { TITLE_EN = d || {}; }).catch(function () {});
}
function makeLost(song, allSongs, opt) {
  var has = function (s) { return !!TITLE_EN[s[4]]; }, swap = null;
  if (!has(song)) {
    // the song that was drawn has no translation (an English title, a name): take one that has, from the same selection
    var c = shuffle(((opt && opt.pool) || allSongs).filter(has));
    if (!c.length) return null;
    song = swap = c[0];
  }
  var picks = [song], seen = {}; seen[song[3].toLowerCase()] = 1;
  var add = function (s) { if (picks.length < 4 && has(s) && !seen[s[3].toLowerCase()]) { seen[s[3].toLowerCase()] = 1; picks.push(s); } };
  shuffle(allSongs.filter(function (s) { return s[10] === song[10]; })).forEach(add);
  if (picks.length < 4) shuffle(allSongs.slice()).forEach(add);
  if (picks.length < 4) return null;
  picks = shuffle(picks);
  return { subject: 'lost', type: 'mc', text: 'Language barrier: which song is “' + TITLE_EN[song[4]] + '”?', hint: '', answer: song[3],
    options: picks.map(function (s) { return s[3]; }), reveal: picks.map(function (s) { return s[3] + ' – ' + s[2]; }), correct: picks.indexOf(song), noclip: true, swap: swap };
}
function makeOdd(song, allSongs, countries) {
  var label = function (s) { return s[3] + ' – ' + s[2]; };
  var byYear = Math.random() < 0.5, tries = [byYear, !byYear], group = null, why = '', same = '';
  for (var t = 0; t < 2 && !group; t++) {
    var keyIdx = tries[t] ? 0 : 1, otherIdx = tries[t] ? 1 : 0, buckets = {};
    allSongs.forEach(function (s) {
      if (s[0] === song[0] || s[1] === song[1] || s[4] === song[4]) return;   // shares nothing with the odd one
      (buckets[s[keyIdx]] = buckets[s[keyIdx]] || []).push(s);
    });
    var keys = shuffle(Object.keys(buckets));
    for (var k = 0; k < keys.length && !group; k++) {
      var seen = {}, got = [];
      shuffle(buckets[keys[k]]).forEach(function (s) { if (got.length < 3 && !seen[s[otherIdx]]) { seen[s[otherIdx]] = 1; got.push(s); } });
      if (got.length === 3) { group = got; same = tries[t] ? 'year' : 'country'; why = tries[t] ? 'from ' + got[0][0] : 'from ' + (countries[got[0][1]] || got[0][1]); }
    }
  }
  if (!group) return null;
  var answer = label(song), opts = shuffle(group.map(label).concat([answer]));
  return { subject: 'odd', type: 'mc', text: 'Odd one out: three of these songs are from the same ' + same + '. Which one is not?', hint: '', answer: answer, options: opts, correct: opts.indexOf(answer), noclip: true,
    explain: 'Odd one out: ' + song[3] + '. The other three are all ' + why + '.' };
}
// Find the mistake: four facts about the song that is playing, one of them wrong. The facts are the
// country, the artist, the title and whether it reached the final (for years without semi-finals, or
// where that is unclear, the year takes its place). The wrong one is made believable: a country from
// the same contest, an artist of the same kind, a title in the same language.
function makeMistake(song, allSongs, countries, winners) {
  var cname = function (c) { return countries[c] || c; };
  var semis = !winners && song[0] >= 2004 && song[0] !== 2020 && song[9] !== 'dq' && song[9] !== 'cancelled';
  var qualified = !(song[5] === 1 || song[8] != null);
  var facts = [
    { k: 'Country', v: cname(song[1]) },
    { k: 'Artist', v: song[2] },
    { k: 'Song title', v: song[3] },
    semis ? { k: 'Reached the final', v: qualified ? 'Yes' : 'No' } : { k: 'Year', v: String(song[0]) }
  ];
  var wrong = Math.floor(Math.random() * 4), f = facts[wrong], truth = f.v, lie = null, near;
  if (wrong === 0) {
    near = shuffle(allSongs.filter(function (s) { return s[0] === song[0] && s[1] !== song[1]; }));
    lie = near.length ? cname(near[0][1]) : cname(pick(Object.keys(countries).filter(function (c) { return c !== song[1]; })));
  } else if (wrong === 1 || wrong === 2) {
    var idx = wrong === 1 ? 2 : 3, g = song[11], solo = g === 'm' || g === 'f', lang = song[10];
    var like = function (s) { return wrong === 1 ? (solo ? s[11] === g : (s[11] !== 'm' && s[11] !== 'f')) : (!lang || s[10] === lang); };
    near = shuffle(allSongs.filter(function (s) { return s[idx] !== song[idx] && s[1] !== song[1] && like(s) && Math.abs(s[0] - song[0]) <= 8; }));
    if (!near.length) near = shuffle(allSongs.filter(function (s) { return s[idx] !== song[idx]; }));
    lie = near[0][idx];
  } else if (semis) lie = qualified ? 'No' : 'Yes';
  else { var last = 0; allSongs.forEach(function (s) { if (s[0] > last) last = s[0]; }); do { lie = song[0] + pick([-4, -3, -2, -1, 1, 2, 3, 4]); } while (lie < 1956 || lie > last); lie = String(lie); }
  f.v = lie;
  var opts = facts.map(function (x) { return x.k + ': ' + x.v; });
  var fix = wrong === 3 && semis ? (qualified ? 'It did reach the final.' : 'It did not reach the final.') : 'It should be ' + truth + '.';
  return { subject: 'mistake', type: 'mc', text: 'Which of these is wrong?', hint: '', answer: opts[wrong], options: opts, correct: wrong,
    explain: 'The mistake: ' + f.k.toLowerCase() + '. ' + fix };
}
// Two-clip questions: two songs are played one after the other (10 seconds each) and the players pick one.
// "higher": both from the same contest, four to eight places apart; which finished higher?
// "newer": one to five years apart; which is the newer song?
var PAIR_CLIP = 10, PAIR_MS = (PAIR_CLIP * 2 + 5) * 1000;
function makePair(song, kind, allSongs, countries) {
  var inFinal = function (s) { return s[6] != null && s[8] == null && s[9] !== 'cancelled' && s[9] !== 'dq'; }, other;
  if (kind === 'higher') {
    if (!inFinal(song)) { song = shuffle(allSongs.filter(function (s) { return s[0] === song[0] && inFinal(s) && !BAD_VIDEOS[s[4]]; }))[0]; if (!song) return null; }   // not a finalist: take one from the same contest
    // Four to eight places apart: close enough to need thought, far enough to be fair. Small contests fall back to any gap of two or more.
    var near = function (lo, hi) { return shuffle(allSongs.filter(function (s) { var gap = Math.abs(s[6] - song[6]); return s[0] === song[0] && s[4] !== song[4] && inFinal(s) && gap >= lo && gap <= hi && !BAD_VIDEOS[s[4]]; }))[0]; };
    other = near(4, 8) || near(2, 30);
  } else {
    other = shuffle(allSongs.filter(function (s) { return s[0] !== song[0] && Math.abs(s[0] - song[0]) <= 5 && !BAD_VIDEOS[s[4]]; }))[0];
  }
  if (!other) return null;
  var pair = Math.random() < 0.5 ? [song, other] : [other, song];
  var correct = kind === 'higher' ? (pair[0][6] < pair[1][6] ? 0 : 1) : (pair[0][0] > pair[1][0] ? 0 : 1);
  var fact = function (s) { return kind === 'higher' ? ordinal(s[6]) + ' place' : String(s[0]); };
  return { subject: kind, type: 'mc', hint: '', pair: pair, correct: correct,
    text: kind === 'higher' ? 'Which song finished higher?' : 'Which song is newer?',
    options: ['Song 1', 'Song 2'], answer: 'Song ' + (correct + 1),
    reveal: pair.map(function (s, i) { return 'Song ' + (i + 1) + ': ' + s[3] + ' – ' + s[2] + ' · ' + fact(s); }),
    explain: kind === 'higher' ? 'Both from ' + song[0] + ': ' + fact(pair[0]) + ' against ' + fact(pair[1]) + '.' : fact(pair[0]) + ' against ' + fact(pair[1]) + '.' };
}
// The second video player of a two-clip question: loads its song silently, parks it at a random spot
// and plays it when asked. Created lazily in the element with the given id.
// Phones and tablets only let a video with sound start in a player the user has touched, and the spare
// player never was. There the second song of a two-clip question plays in the main player instead:
// same interface as SecondPlayer, but nothing can be loaded ahead, so it starts with a short pause.
var ONE_PLAYER = typeof navigator !== 'undefined' && (/iP(hone|ad|od)|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || '')));
function SharedSecond(main, first) {
  var self = this, id = null, on = false;   // on: the second video is the one in the main player right now
  self.ready = false; self.start = 0; self.shared = true;
  self.make = function () {};
  self.load = function (vid) { id = vid; on = false; self.start = 30 + Math.floor(Math.random() * 50); self.ready = true; };
  self.play = function () { try { var p = main(); p.loadVideoById({ videoId: id, startSeconds: self.start }); p.unMute(); p.setVolume(100); p.playVideo(); on = true; } catch (e) {} };
  self.resume = function () { if (!on) { self.play(); return; } try { var p = main(); p.unMute(); p.setVolume(100); p.playVideo(); } catch (e) {} };
  self.pause = function () { try { if (on) main().pauseVideo(); } catch (e) {} };
  self.stop = function () { id = null; on = false; self.ready = false; };
  self.left = function () { try { var p = main(), st = p.getPlayerState(), d = p.getDuration() || 0, t = p.getCurrentTime() || 0; if (st === 0) return 0; if (st === 1 && d > 0) return Math.max(0, d - t); } catch (e) {} return null; };
  // at the answer, when the first song was the right one: bring it back into the player
  self.back = function () { if (!on) return false; on = false; try { var f = first(), p = main(); p.loadVideoById({ videoId: f.id, startSeconds: f.start }); p.unMute(); p.setVolume(100); p.playVideo(); } catch (e) {} return true; };
}
function SecondPlayer(elId) {
  var self = this, p = null, ok = false, want = null, poll = null, onFail = null;
  self.ready = false; self.start = 0;
  self.make = function () {
    if (p || !window.YT || !YT.Player || !document.getElementById(elId)) return;
    p = new YT.Player(elId, { width: '100%', height: '100%', playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ok = true; if (want) self.load(want[0], want[1], want[2]); }, onError: function () { if (onFail && !self.ready) onFail(); } } });
  };
  self.load = function (id, len, fail) {
    self.ready = false; onFail = fail; clearInterval(poll);
    if (!ok) { want = [id, len, fail]; self.make(); return; }
    want = null;
    var frac = Math.random(), seekAt = 0, t0 = Date.now();
    try { p.mute(); p.loadVideoById(id); } catch (e) {}
    poll = setInterval(function () {
      var st = -1, t = 0, d = 0; try { st = p.getPlayerState(); t = p.getCurrentTime() || 0; d = p.getDuration() || 0; } catch (e) {}
      if (st !== 1 || d <= 0) return;
      if (d < 100 && Date.now() - t0 < 40000) return;   // an ad, most likely
      var cs = d < 45 ? 0 : Math.floor(15 + frac * (d - 15 - 20 - len));
      self.start = cs;
      if (t >= cs && t < cs + 5) { clearInterval(poll); try { p.pauseVideo(); } catch (e) {} self.ready = true; }
      else if (Date.now() - seekAt > 2500) { seekAt = Date.now(); try { p.seekTo(cs, true); } catch (e) {} }
    }, 120);
  };
  self.play = function () { try { p.seekTo(self.start, true); p.unMute(); p.setVolume(100); p.playVideo(); } catch (e) {} };
  self.resume = function () { try { p.unMute(); p.setVolume(100); p.playVideo(); } catch (e) {} };
  self.pause = function () { try { if (p && ok) p.pauseVideo(); } catch (e) {} };
  self.stop = function () { clearInterval(poll); want = null; self.ready = false; self.pause(); };
  self.left = function () { try { var st = p.getPlayerState(), d = p.getDuration() || 0, t = p.getCurrentTime() || 0; if (st === 0) return 0; if (st === 1 && d > 0) return Math.max(0, d - t); } catch (e) {} return null; };
}
// opt.types: the question types that are switched on (facts, odd, mistake, higher, newer, lost). With
// "random" one of those is drawn, in the usual proportions.
var TYPE_WEIGHT = { facts: 42.5, higher: 12.5, newer: 12.5, mistake: 12.5, odd: 10, lost: 10 };
function makeQuestion(song, subjectSetting, typeSetting, allSongs, countries, opt) {
  if (opt && opt.types && subjectSetting === 'random') {
    var on = opt.types.filter(function (t) { return TYPE_WEIGHT[t] && (opt.pair || (t !== 'higher' && t !== 'newer')) && !(opt.cat === 'win' && t === 'higher'); });
    if (on.length && on.length < 6) {
      var total = 0, r, t = on[0], o2 = {}, k;
      on.forEach(function (x) { total += TYPE_WEIGHT[x]; });
      r = Math.random() * total;
      for (var i = 0; i < on.length; i++) { r -= TYPE_WEIGHT[on[i]]; if (r <= 0) { t = on[i]; break; } }
      for (k in opt) if (k !== 'types') o2[k] = opt[k];
      var made = makeQuestion(song, t, typeSetting, allSongs, countries, o2);
      var kind = ['country', 'artist', 'title', 'year', 'place'].indexOf(made.subject) >= 0 ? 'facts' : made.subject;
      if (on.indexOf(kind) >= 0) return made;
      // that type could not be made for this song: one that is switched on and always works, if there is one
      if (on.indexOf('facts') >= 0) return makeQuestion(song, 'facts', typeSetting, allSongs, countries, o2);
      if (on.indexOf('mistake') >= 0) return makeQuestion(song, 'mistake', typeSetting, allSongs, countries, o2);
      return made;
    }
  }
  var pairOk = !!(opt && opt.pair), winners = !!(opt && opt.cat === 'win');   // only winners in play: every placing question would answer itself
  if (winners && (subjectSetting === 'place' || subjectSetting === 'higher')) subjectSetting = 'random';
  if (pairOk && (subjectSetting === 'higher' || subjectSetting === 'newer' || (subjectSetting === 'random' && Math.random() < 0.25))) {   // 12.5% each for higher/lower and newer
    var pk = subjectSetting === 'random' ? (winners ? 'newer' : pick(['higher', 'newer'])) : subjectSetting, pq = makePair(song, pk, allSongs, countries) || (subjectSetting === 'higher' ? makePair(song, 'newer', allSongs, countries) : null);
    if (pq) return pq;
  }
  if (subjectSetting === 'higher' || subjectSetting === 'newer') subjectSetting = 'random';
  if (subjectSetting === 'odd' || (subjectSetting === 'random' && Math.random() < 2 / 15)) { var odd = makeOdd(song, allSongs, countries); if (odd) return odd; }
  if (subjectSetting === 'lost' || (subjectSetting === 'random' && Math.random() < 0.154)) { var lost = makeLost(song, allSongs, opt); if (lost) return lost; }   // 10% overall
  var canPlace = placeLabel(song) != null, canPoints = song[7] != null;
  var kinds = ['country', 'artist', 'title', 'year', 'mistake'];
  if (canPlace && !winners) kinds.push('place');
  // "Song facts" bundles the plain questions about the song that is playing: country, artist, title, year
  // and placing. Older saved games that still name one of those are treated the same way.
  var FACTS = ['country', 'artist', 'title', 'year', 'place'];
  if (FACTS.indexOf(subjectSetting) >= 0) subjectSetting = 'facts';
  var subject = subjectSetting === 'facts' ? pick(kinds.filter(function (k) { return FACTS.indexOf(k) >= 0; })) : subjectSetting === 'random' || subjectSetting === 'odd' || subjectSetting === 'lost' ? (Math.random() < 5 / 22 ? 'mistake' : pick(kinds.filter(function (k) { return k !== 'mistake'; }))) : subjectSetting;   // find the mistake: 12.5% overall, the same as each two-clip question
  if (subject === 'mistake') return makeMistake(song, allSongs, countries, winners);
  if (kinds.indexOf(subject) < 0) subject = 'country';             // no known result (1956, 2020, a few others)
  var type = typeSetting === 'mix' ? pick(['mc', 'open']) : typeSetting;
  if (subject === 'place' && song[8] != null) type = 'mc';         // "did not qualify" cannot be typed as a position
  var answer = subject === 'title' ? song[3] : subject === 'artist' ? song[2] : subject === 'country' ? (countries[song[1]] || song[1]) : subject === 'points' ? pointsLabel(song[7]) : subject === 'year' ? String(song[0]) : placeLabel(song);
  var q = { subject: subject, type: type, text: Q_TEXT[subject], hint: Q_HINT[subject], answer: answer, options: null, correct: -1 };
  if (type !== 'mc') return q;
  var opts = [answer], seen = {};
  seen[answer.toLowerCase()] = 1;
  var add = function (v) { if (v && opts.length < 4 && !seen[String(v).toLowerCase()]) { seen[String(v).toLowerCase()] = 1; opts.push(v); } };
  if (subject === 'country') {
    // Prefer countries that took part that year, so every option is plausible.
    shuffle(allSongs.filter(function (s) { return s[0] === song[0]; })).forEach(function (s) { add(countries[s[1]]); });
    shuffle(Object.keys(countries)).forEach(function (c) { add(countries[c]); });
  } else if (subject === 'points') {
    // Wrong options are the real score scaled up or down, so they stay believable for that year's voting system.
    var p = song[7];
    shuffle([0.35, 0.5, 0.65, 0.8, 1.25, 1.5, 1.8, 2.3]).forEach(function (f) { var v = Math.round(p * f); if (v !== p) add(pointsLabel(v)); });
    for (var k = 1; opts.length < 4; k++) { add(pointsLabel(p + k)); if (p - k >= 0) add(pointsLabel(p - k)); }
  } else if (subject === 'year') {
    // Wrong years are close by (within 6 years), never in the future and never before the first contest.
    var ys = [], last = 0;
    allSongs.forEach(function (s) { if (s[0] > last) last = s[0]; });
    for (var d = -6; d <= 6; d++) { var y = song[0] + d; if (d && y >= 1956 && y <= last) ys.push(y); }
    shuffle(ys).forEach(function (y) { add(String(y)); });
  } else if (subject === 'place') {
    if (song[0] >= 2004 && song[0] !== 2020) add('Did not qualify');
    var n = [];
    for (var i = 1; i <= 26; i++) n.push(i);
    shuffle(n).forEach(function (x) { add(ordinal(x) + ' place'); });
  } else {
    var idx = subject === 'title' ? 3 : 2, tiers = [];
    if (subject === 'artist') {
      // A man is only offered next to men, a woman next to women, and a group next to groups (or acts we cannot place).
      var g = song[11], solo = g === 'm' || g === 'f';
      tiers.push(function (s) { return solo ? s[11] === g : (s[11] !== 'm' && s[11] !== 'f'); });
    } else {
      // A title in, say, French is only offered next to French titles, topped up with English ones if needed.
      var lang = song[10];
      if (lang) tiers.push(function (s) { return s[10] === lang; });
      if (lang && lang !== 'english') tiers.push(function (s) { return s[10] === 'english'; });
    }
    tiers.push(function () { return true; });
    tiers.forEach(function (ok) {
      shuffle(allSongs.filter(function (s) { return ok(s) && Math.abs(s[0] - song[0]) <= 8; })).forEach(function (s) { add(s[idx]); });
      shuffle(allSongs.filter(ok)).forEach(function (s) { add(s[idx]); });
    });
  }
  if (subject === 'place' || subject === 'points' || subject === 'year') opts.sort(function (a, b) { var x = parseInt(a, 10), y = parseInt(b, 10); return (isNaN(x) ? 999 : x) - (isNaN(y) ? 999 : y); }); else shuffle(opts);
  q.options = opts; q.correct = opts.indexOf(answer);
  return q;
}
// Draw!: one player draws a song on their phone, the others guess. Lines travel as small batches of
// points on an 800 x 600 canvas; the same code paints them on the host screen and on the other phones.
var DRAW_W = 800, DRAW_H = 600, DRAW_MS = 60000, DRAW_PICK_MS = 20000;
var PARTY_HELP = 'Quiz questions mixed in with party games.';
var DRAW_HELP = 'Postcard: everyone gets four songs, picks one and draws it on their phone, all within a minute. Then each drawing is a question for the others. A right guess scores points, and the artist gets 12 points divided by the number of players who answered, for each of them who guessed it.';
var DRAW_COLORS = ['#111111', '#ffffff', '#e11d48', '#f97316', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#ec4899', '#92400e', '#9ca3af', '#ffffff'];   // the last one is the eraser: it paints in the background colour
var DRAW_SIZES = [3, 7, 14];
// The paper colour is remembered on the canvas, so that the eraser knows what to paint with.
// bg: the paper colour, as a pencil colour's number plus one (nothing: white).
function drawBg(bg) { return (bg > 0 && bg < DRAW_COLORS.length && DRAW_COLORS[bg - 1]) || '#ffffff'; }
function drawClear(cv, bg) { var c = cv.getContext('2d'); cv._bg = drawBg(bg); c.fillStyle = cv._bg; c.fillRect(0, 0, DRAW_W, DRAW_H); }
function drawPaint(cv, m) {
  if (!m) return;
  if (m.clear) { drawClear(cv, m.bg); return; }
  var p = m.p, c = cv.getContext('2d');
  if (!p || p.length < 2) return;
  c.strokeStyle = c.fillStyle = m.c === DRAW_COLORS.length - 1 ? (cv._bg || '#ffffff') : (DRAW_COLORS[m.c] || DRAW_COLORS[0]);
  c.lineWidth = Math.max(2, Math.min(40, +m.w || 6)); c.lineCap = c.lineJoin = 'round';
  if (p.length === 2) { c.beginPath(); c.arc(p[0], p[1], c.lineWidth / 2, 0, 7); c.fill(); return; }
  c.beginPath(); c.moveTo(p[0], p[1]);
  for (var i = 2; i + 1 < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.stroke();
}
function songLabel(s) { return s[3] + ' – ' + s[2]; }
// Autoplay countdown: plain seconds, or minutes:seconds when the rest of the song is still long.
function clock(secs) { return secs < 60 ? String(secs) : Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2); }
var AD_TEXT = 'YouTube is showing an ad first. Watch it or skip it on the screen; the song starts right after, there is no rush. If you want to play without ads, log into a YouTube Premium account in a different tab.';
// Checks a typed answer. Returns 'ok', 'close' or 'no'.
function checkOpen(q, song, guess, countries) {
  var best = 'no', i, r;
  var better = function (r) { if (r === 'ok' || (r === 'close' && best === 'no')) best = r; };
  if (q.subject === 'title') return Match.check(guess, song[3]);
  if (q.subject === 'year') {
    var y = parseInt(String(guess).replace(/[^0-9]/g, ''), 10);
    if (isNaN(y)) return 'no';
    if (y < 100) y += y <= 30 ? 2000 : 1900;   // "98" or "12" also count
    return y === song[0] ? 'ok' : Math.abs(y - song[0]) <= 2 ? 'close' : 'no';
  }
  if (q.subject === 'place' || q.subject === 'points') {
    var n = parseInt(String(guess).replace(/[^0-9]/g, ''), 10);
    if (isNaN(n)) return 'no';
    if (q.subject === 'place') return n === song[6] ? 'ok' : Math.abs(n - song[6]) <= 2 ? 'close' : 'no';
    // Points have to be exact; within 10% (or 5 points) counts as close.
    return n === song[7] ? 'ok' : Math.abs(n - song[7]) <= Math.max(5, song[7] * 0.1) ? 'close' : 'no';
  }
  if (q.subject === 'artist') {
    var parts = [song[2]].concat(song[2].split(/\s+(?:&|feat\.?|ft\.?|x|and|with|vs\.?)\s+|,\s+/i));
    for (i = 0; i < parts.length; i++) if (i === 0 || Match.norm(parts[i]).length >= 4) better(Match.check(guess, parts[i]));
    return best;
  }
  // Country: similar names (Austria/Australia, Iceland/Ireland) must not pass as typos of each other.
  var g = Match.norm(guess), code;
  for (code in countries) {
    if (code === song[1]) continue;
    var others = [countries[code]].concat(COUNTRY_ALIASES[code] || []);
    for (i = 0; i < others.length; i++) if (Match.norm(others[i]) === g) return 'no';
  }
  var names = [countries[song[1]] || song[1]].concat(COUNTRY_ALIASES[song[1]] || []);
  for (i = 0; i < names.length; i++) { r = Match.check(guess, names[i]); better(names[i].length <= 3 && r !== 'ok' ? 'no' : r); }
  return best;
}
// Speed scoring: a right answer within the first 3 seconds is worth 12 points.
// After that it loses a point every second, down to a minimum of 1.
function scoreFor(elapsedMs) {
  return Math.max(1, 12 - Math.ceil(Math.max(0, elapsedMs - 3000) / 1000));
}
// The four options as shown at the reveal: the right one green, a wrong pick red.
// pts = what this player scored (leave it out on the shared screen). The player's own bar gets a mark on
// the right: a tick with the points, or a cross. No answer at all: the cross sits on the right answer.
function revealOptions(q, pick, pts) {
  if (!q || !q.options) return '';
  var shown = q.reveal || q.options;   // two-clip questions name the songs at the reveal
  var mine = pts != null, none = mine && (pick == null || pick < 0 || !q.options[pick]);
  return shown.map(function (o, i) {
    var tag = '';
    if (mine && i === pick) tag = i === q.correct ? '<span class="mark">✓ +' + pts + '</span>' : '<span class="mark">✗ ' + (pts < 0 ? '−' + (-pts) : 0) + '</span>';   // Ladder: a wrong answer costs points
    else if (none && i === q.correct) tag = '<span class="mark none">No answer · ' + (pts < 0 ? '−' + (-pts) : 0) + '</span>';
    return '<div class="opt' + (i === q.correct ? ' right' : i === pick ? ' wrong' : ' dim') + '"><b>' + 'ABCD'[i] + '</b><span class="otext">' + esc(o) + '</span>' + tag + '</div>';
  }).join('');
}
// The Eurovision opening fanfare, streamed from YouTube like the songs: video id and how long it plays.
// These were checked to play when embedded; the first one that works is used.
var INTRO = { ids: ['itP7H6Uo29s', 'g6sunstIdf8', 'SK5aHV732b8', 'PT9zvm7Wf5M'], ms: 19000, audio: '', audioAt: 0, audioMs: 19000 };   // (audio: a sound file to play instead, if there ever is one)   // the first clip lasts 18 seconds; the countdown runs one second longer
// The three ways to score a correct answer, and the line that explains the selected one.
var ESC_POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
// With several players Speedy goes by who was first; solo it goes by the clock.
var HOST_SCORING_HELP = {
  correct: 'Standard: every right answer scores a flat 12 points.',
  speed: 'Speedy: the first player with the right answer scores 12 points, the second 10, the third 8, then 7, 6, 5, 4, 3, 2 and 1.',
  ladder: ''
};
var SCORING_HELP = {
  correct: 'Standard: every right answer scores a flat 12 points.',
  speed: 'Speedy: a right answer within the first 3 seconds scores 12 points. After that it drops a point every second, down to 1.',
  ladder: 'Ladder: everyone climbs the same ladder. A right answer takes you one rung up, a wrong answer or no answer half a rung down. The rungs are worth 1, 2, 3, 4, 5, 6, 7, 8, 10 and 12 points, and the game goes on until the first player reaches the top. With more rounds, every round is a new climb and the rungs reached are added up.'
};
// The ladder: rung 0 is the ground, rung 10 the top. Each rung is worth a Eurovision score.
var LADDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
// rank = how many players were right before this one (only used for "order").
function pointsFor(scoring, elapsedMs, totalMs, rank) {
  if (scoring === 'correct') return 12;
  if (scoring === 'order') return ESC_POINTS[rank] || 1;   // never lower than 1
  return scoreFor(elapsedMs, totalMs);
}
// The final scoreboard. One player at a time, in random order: their row lights up and the score counts up
// point by point with a ping per step; then the row slides to its place in the ranking. When everyone has
// been counted the winner gets a big border. sound: play the pings (host screen, or phones playing online).
var finalRun = 0;
function finalBoard(el, players, mePid, onDone, sound, instant) {
  var run = ++finalRun, live = function () { return run === finalRun; };
  var ps = players.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var max = 0; ps.forEach(function (p) { if (p.score > max) max = p.score; });
  el.innerHTML = ps.map(function (p) {
    return '<li data-pid="' + esc(p.pid) + '"' + (p.pid === mePid ? ' class="me"' : '') + '><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="num">0</span></li>';
  }).join('') || '<li class="mute">No players</li>';
  var rows = {}, val = {};
  [].forEach.call(el.querySelectorAll('li[data-pid]'), function (li) { rows[li.getAttribute('data-pid')] = li; });
  ps.forEach(function (p) { val[p.pid] = 0; });
  // Put the rows in ranking order and let them glide from where they were.
  var resort = function () {
    var before = {}, pid;
    for (pid in rows) before[pid] = rows[pid].getBoundingClientRect().top;
    ps.slice().sort(function (a, b) { return val[b.pid] - val[a.pid] || a.name.localeCompare(b.name); }).forEach(function (p) { el.appendChild(rows[p.pid]); });
    for (pid in rows) (function (li, dy) {
      if (!dy) return;
      li.style.transition = 'none'; li.style.transform = 'translateY(' + dy + 'px)';
      li.getBoundingClientRect();
      li.style.transition = 'transform .8s cubic-bezier(.22,.8,.3,1)'; li.style.transform = '';
    })(rows[pid], before[pid] - rows[pid].getBoundingClientRect().top);
  };
  var order = shuffle(ps.slice()), k = 0;
  var finish = function () {
    if (!live()) return;
    var wins = ps.filter(function (p) { return max > 0 && p.score === max; });
    wins.forEach(function (p) {
      rows[p.pid].classList.remove('reached'); rows[p.pid].classList.add('winner');
    });
    if (onDone) onDone(wins);
  };
  // The scores were in view all game: no counting up, just the final ranking with the winner marked.
  if (instant) {
    ps.forEach(function (p) { val[p.pid] = p.score; rows[p.pid].querySelector('.num').textContent = p.score; rows[p.pid].classList.add('reached'); });
    ps.slice().sort(function (a, b) { return val[b.pid] - val[a.pid] || a.name.localeCompare(b.name); }).forEach(function (p) { el.appendChild(rows[p.pid]); });
    finish(); return;
  }
  var next = function () {
    if (!live()) return;
    if (k >= order.length) { setTimeout(finish, 500); return; }
    var p = order[k++], li = rows[p.pid], num = li.querySelector('.num'), total = p.score;
    // 1. the player lights up, with a sound
    li.classList.add('counting');
    if (sound && window.Music) Music.plop(k);
    // 2. a second later the points are added one at a time, a ping for each (long scores go faster,
    //    but never so fast that the steps blur: at most about five seconds per player)
    var gap = total > 0 ? Math.max(40, Math.min(140, 5000 / total)) : 0, v = 0;
    var done = function () {
      // 3. the total is in: a flash and a different sound, then the row slides to its rank. It keeps its yellow
      //    border on the way, and stays lit for a second where it lands before the next player's turn.
      li.classList.add('flash'); val[p.pid] = total;
      if (sound && window.Music) Music.ding();
      setTimeout(function () {
        if (!live()) return;
        li.classList.remove('flash'); resort();
        setTimeout(function () {
          if (!live()) return;
          li.classList.add('landed');
          setTimeout(function () { if (!live()) return; li.classList.remove('counting'); li.classList.remove('landed'); li.classList.add('reached'); setTimeout(next, 250); }, 1000);
        }, 850);
      }, 800);
    };
    var step = function () {
      if (!live()) return;
      if (v >= total) { done(); return; }
      v++; num.textContent = v;
      if (sound && window.Music) Music.ping(v, total);
      setTimeout(step, gap);
    };
    setTimeout(step, 1000);
  };
  setTimeout(next, 600);
}

HOST_SCORING_HELP.ladder = SCORING_HELP.ladder;

// At the answer: is something other than the song in the player? 'ad' = what plays is far too short to be
// a song, or is not at the spot that was asked for (YouTube put an ad in front); 'wait' = nothing plays yet.
function revealHold(yt, clipStart) {
  try {
    var st = yt.getPlayerState(), d = yt.getDuration() || 0, t = yt.getCurrentTime() || 0;
    if (st === 1 && d > 0 && (d < 100 || t < clipStart - 3)) return 'ad';
    if (st === 3 || st === -1 || st === 5) return 'wait';
  } catch (e) {}
  return '';
}

// ---------- Quip! ----------
// A song plays and everyone answers a question about it; then the room votes for the best answer.
// 'h' is the house answer, used when only one player wrote something.
var QUIP_HELP = 'Green Room: a song plays, with a question about it. Everyone writes their funniest answer, then the room votes for the best one. Every vote scores points: 12 divided by the number of other players, so 4 per vote with four players.';
var QUIP_MS = 30000, QUIP_VOTE_MS = 25000, QUIP_WIN = 3, QUIP_HOUSE = 'EuroQuizion';
var QUIPS = [
  { p: 'What is this song really about?', h: 'Losing the car keys, with feeling' },
  { p: 'Give this song a better title', h: 'Three Minutes of This' },
  { p: 'What is the singer thinking right now?', h: 'Did I leave the oven on?' },
  { p: 'What did the TV commentator say during this performance?', h: 'Well. That is certainly a choice.' },
  { p: 'What did the jury write on the scoresheet?', h: 'Nice hat. Shame about the rest.' },
  { p: 'Describe this performance in three words', h: 'Glitter, smoke, panic' },
  { p: 'What goes wrong ten seconds from now?', h: 'A key change nobody asked for' },
  { p: 'What was the director\'s one instruction for this act?', h: 'More wind. No, more.' },
  { p: 'Which product is this performance secretly an advert for?', h: 'Extra-strong hairspray' },
  { p: 'What is the backing dancer thinking?', h: 'Left. No, the other left.' },
  { p: 'Translate the lyrics (wrong answers only)', h: 'My goat has left me for the sea' },
  { p: 'What should this act have brought on stage?', h: 'A live goose with opinions' },
  { p: 'Write the first line of the newspaper review', h: 'Europe will need a moment.' },
  { p: 'What did the singer\'s mum say afterwards?', h: 'You looked warm enough, at least' },
  { p: 'What is the honest name for this genre?', h: 'Sad disco for tall people' },
  { p: 'What was this song called before the record label stepped in?', h: 'Untitled Demo 4 (Final) (Really Final)' },
  { p: 'What did the delegation promise the singer for doing this?', h: 'A sandwich and a taxi home' },
  { p: 'What would make this performance twice as good?', h: 'A trampoline' },
  { p: 'What is the camera operator muttering?', h: 'Just stand still for one second' },
  { p: 'Finish the sentence: "Good evening Europe, this song is…"', h: '…longer than it looks' },
  { p: 'What did the neighbours say about the rehearsals?', h: 'We preferred the drilling' },
  { p: 'What is this act\'s rider (backstage demands)?', h: 'Forty towels and a fog machine' },
  { p: 'Why does this song deserve douze points?', h: 'Somebody has to explain it to the others' },
  { p: 'What is the dance move in this song called?', h: 'The confused windmill' },
  // a bit cheekier
  { p: 'What is this singer like on a first date?', h: 'Brings their own wind machine' },
  { p: 'What happened at the afterparty?', h: 'Nobody is allowed to say' },
  { p: 'What is this song actually a very thin excuse for?', h: 'Taking the shirt off' },
  { p: 'Who is this song secretly about?', h: 'The Swedish head of delegation' },
  { p: 'What did this act get up to in the hotel?', h: 'Room service. So much room service.' },
  { p: 'Write this singer\'s dating profile in one line', h: 'Loves long walks and key changes' },
  { p: 'What is hiding under that costume?', h: 'A second, worse costume' },
  { p: 'What is the worst thing to whisper to someone during this song?', h: 'This reminds me of my ex' },
  { p: 'Where should you definitely not play this song?', h: 'At your grandmother\'s funeral' },
  { p: 'What did the singer text their ex right after this?', h: 'Did you see me on TV? Thought so.' },
  { p: 'How many drinks does this song need before it sounds good?', h: 'Twelve. Douze, even.' },
  { p: 'What is this song the perfect soundtrack for?', h: 'A walk of shame through Malmö' },
  { p: 'What is the backing singer doing with the lead singer after the show?', h: 'Splitting the taxi. Allegedly.' },
  { p: 'What is the real reason the trousers are that tight?', h: 'They shrank in the hotel sauna' },
  { p: 'Which bad decision does this song make you want to make?', h: 'Texting someone at 3 a.m.' },
  { p: 'What would the bedroom version of this song be called?', h: 'Nul Points' }
];

// The lobby settings are remembered on this device and shared by the host screen and solo play:
// what is set in one is there in the other (as far as it has that choice).
function keepSettings(ids) {
  ids.forEach(function (id) {
    var el = document.getElementById(id); if (!el) return;
    try {
      var v = localStorage.getItem('esc-set-' + id), ok = false;
      if (v !== null && v !== el.value) [].forEach.call(el.options, function (o) { if (o.value === v && !o.disabled) ok = true; });
      if (ok) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }
    } catch (e) {}
    el.addEventListener('change', function () { try { localStorage.setItem('esc-set-' + id, el.value); } catch (e) {} });
  });
}

// A question without a clip shows a picture of its own on the stage instead of a plain question mark.
function noClipArt(q) { return q && q.subject === 'odd' ? ['🧩', 'Odd one out'] : q && q.subject === 'lost' ? ['🗣️', 'Language barrier'] : ['?', '']; }
