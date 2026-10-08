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
  return { subject: 'lost', type: 'mc', text: 'Language barrier: which song is “' + TITLE_EN[song[4]].replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim() + '”?'   /* without the bit in brackets */, hint: '', answer: song[3],
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
    if (tries[t]) keys = keys.filter(function (y) { return Math.abs(+y - song[0]) <= 5; });   // by year: the odd one is at most five years away from the other three
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
    // a winner of the last 20 years is too easy to spot: they are left out
    var recentWin = function (s) { return s[6] === 1 && s[0] > new Date().getFullYear() - 20; };
    inFinal = (function (f) { return function (s) { return f(s) && !recentWin(s); }; })(inFinal);
    if (!inFinal(song)) { song = shuffle(allSongs.filter(function (s) { return s[0] === song[0] && inFinal(s) && !BAD_VIDEOS[s[4]]; }))[0]; if (!song) return null; }   // not a finalist (or a recent winner): take one from the same contest
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
    text: kind === 'higher' ? 'Which song finished higher?' : 'Which song came out later?',
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
// The music volume setting (Music.vol.music, 0 to 1) applies to the YouTube players too: every setVolume is scaled.
var YT_PLAYERS = [];
function ytVolWrap(p) {
  if (!p || p._volWrapped || typeof p.setVolume !== 'function') return p;
  var raw = p.setVolume.bind(p); p._volWrapped = true; p._want = 100;
  p.setVolume = function (v) { p._want = v; try { raw(Math.round(v * (window.Music && Music.vol ? Music.vol.music : 1))); } catch (e) {} };
  YT_PLAYERS.push(p); return p;
}
function ytVolApply() { YT_PLAYERS.forEach(function (p) { try { p.setVolume(p._want == null ? 100 : p._want); } catch (e) {} }); }
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
      events: { onReady: function () { ok = true; ytVolWrap(p); if (want) self.load(want[0], want[1], want[2]); }, onError: function () { if (onFail && !self.ready) onFail(); } } });
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
// peel ("Behind the curtain"): the silent video is uncovered bit by bit; only on a shared screen (opt.peel).
// blur ("Out of focus"): the same idea, but the silent video starts blurred and sharpens.
// flag ("Whose flag?"): a flag on the screen and four songs; one of them was sent by that country. No clip until the answer.
var TYPE_WEIGHT = { facts: 42.5, higher: 12.5, newer: 12.5, mistake: 12.5, odd: 10, lost: 10, peel: 10, blur: 10, flag: 10, host: 8, trivia: 10 };   // (map, "On the map", is switched off for now: give it a weight here and a switch in host.html to bring it back)
// map ("On the map"): the same, with the outline of the country in place of its flag (the smallest states are only a dot: left out).
function makeFlag(song, allSongs, countries, map) {
  if (map ? !(typeof SHAPES !== 'undefined' && SHAPES[song[1]]) : !flag(song[1])) return null;   // a country that no longer exists has no flag to show
  var lab = function (s) { return s[3] + ' – ' + s[2]; }, answer = lab(song), opts = [answer], seen = {}, lands = {}; seen[song[4]] = 1; lands[song[1]] = 1;
  var add = function (s) { if (opts.length < 4 && !seen[s[4]] && !lands[s[1]] && s[2] !== song[2]) { seen[s[4]] = 1; lands[s[1]] = 1; opts.push(lab(s)); } };
  shuffle(allSongs.filter(function (s) { return Math.abs(s[0] - song[0]) <= 6; })).forEach(add);
  shuffle(allSongs.slice()).forEach(add);
  if (opts.length < 4) return null;
  shuffle(opts);
  return { subject: map ? 'map' : 'flag', type: 'mc', flag: map ? '' : song[1], map: map ? song[1] : '', noclip: true, text: map ? 'Which song came from this country?' : 'Which song does this flag belong to?', hint: '', answer: answer, options: opts, correct: opts.indexOf(answer),
    explain: song[3] + ' was sent by ' + (countries[song[1]] || song[1]) + '.' };
}
// The flag as a picture (it looks the same on every computer; flag emoji are not drawn everywhere), with the emoji as a stand-in.
function mapHtml(code, dot) { return '<svg class="mapimg" viewBox="0 0 300 200" aria-hidden="true"><path d="' + SHAPES[code] + '" fill-rule="evenodd"/>' + (dot ? '<circle class="mapring" cx="' + dot[0] + '" cy="' + dot[1] + '" r="9"/><circle class="mapdot" cx="' + dot[0] + '" cy="' + dot[1] + '" r="5.5"/>' : '') + '</svg>'; }
// host ("Host city"): the country that held the contest of this song's year, with a dot where the hall stood; four host cities.
function makeHost(song, countries) {
  if (typeof HOSTS === 'undefined' || !HOSTS[song[0]]) return null;
  var city = HOSTS[song[0]], c = CITIES[city], opts = [city];
  var add = function (n) { if (opts.length < 4 && opts.indexOf(n) < 0) opts.push(n); };
  shuffle(Object.keys(CITIES).filter(function (n) { return CITIES[n][0] === c[0]; })).forEach(add);   // first the other host cities of the same country
  shuffle(Object.keys(CITIES)).forEach(add);
  shuffle(opts);
  return { subject: 'host', type: 'mc', map: c[0], dot: [c[1], c[2]], noclip: true, text: 'Which host city is the dot on this map?', hint: '', answer: city, options: opts, correct: opts.indexOf(city),
    explain: 'The ' + song[0] + ' contest was held in ' + city + (song[0] === 1990 || city === 'Luxembourg' ? '' : ', ' + (countries[c[0]] || '')) + '.' };
}
function flagHtml(code) { return '<img class="flagimg" src="https://flagcdn.com/w640/' + code + '.png" alt="" onerror="this.outerHTML=\'' + flag(code) + '\'">'; }
var PEEL_MS = 60000;
function peelPoints(ms, blur) {
  if (blur) { var h = PEEL_MS / 2; return ms < h ? 12 : [10, 8, 7, 6, 5, 4, 3, 2, 1][Math.min(8, Math.floor((ms - h) / (h / 9)))]; }   // Out of focus: 12 for the first half, then down to 1
  return [12, 10, 8, 7, 6, 5, 4, 3, 2, 1][Math.min(9, Math.floor(Math.max(0, ms) / (PEEL_MS / 10)))]; }   // like a Eurovision scoreboard: 12, 10, 8, 7 … 1, a step down every six seconds
function makePeel(song, allSongs, countries, opt) {
  // always the song itself: four bars with title and artist, the other three from about the same years
  // Only winners, on the screen and on the bars: a song that did not win makes way for a winner (from the years in play, if there is one).
  var wins = allSongs.filter(function (s) { return s[5] === 2; }), swap = null;
  if (wins.length < 4) return null;
  if (song[5] !== 2) {
    var yrs = {}, used = (opt && opt.used) || {}; ((opt && opt.pool) || []).forEach(function (s) { yrs[s[0]] = 1; });
    var near = wins.filter(function (s) { return yrs[s[0]]; }); if (!near.length) near = wins;
    var fresh = near.filter(function (s) { return !used[s[4]]; }); if (fresh.length) near = fresh;
    song = swap = near[Math.floor(Math.random() * near.length)];
  }
  var lab = function (s) { return s[3] + ' – ' + s[2]; }, answer = lab(song), opts = [answer], seen = {}; seen[song[4]] = 1;
  var add = function (s) { if (opts.length < 4 && !seen[s[4]] && s[3] !== song[3] && s[2] !== song[2]) { seen[s[4]] = 1; opts.push(lab(s)); } };
  shuffle(wins.filter(function (s) { return Math.abs(s[0] - song[0]) <= 8; })).forEach(add);
  shuffle(wins.slice()).forEach(add);
  if (opts.length < 4) return null;
  shuffle(opts);
  return { subject: 'peel', swap: swap, peel: true, type: 'mc', text: 'Behind the curtain: which song is this? The sooner you know, the more points.', hint: '', answer: answer, options: opts, correct: opts.indexOf(answer) };
}
// trivia ("Did you know?"): obscure Eurovision facts. s: the song the fact is about (year, country), played at the reveal if it is in the game.
// n: the options are numbers or years (shown in order). Each fact comes back only after all the others have had their turn.
var OBSCURE = [
  { q: 'In 1969, how many countries shared first place?', a: 'Four', w: ['Two', 'Three', 'Five'], e: 'Spain, the United Kingdom, the Netherlands and France all finished on 18 points, and there was no tie-break rule yet.', s: [1969, 'nl'] },
  { q: 'How many songs did each country send to the very first contest, in 1956?', a: 'Two', w: ['One', 'Three', 'Four'], e: 'In 1956 every country sent two songs, and only the winner was announced.', s: [1956, 'ch'] },
  { q: 'Johnny Logan won Eurovision three times. How did he win the third time, in 1992?', a: 'As the songwriter', w: ['As a duet partner', 'As the conductor', 'As a backing singer'], e: 'He wrote “Why Me?”, sung by Linda Martin for Ireland.', s: [1992, 'ie'] },
  { q: 'Ireland won three years in a row in the 1990s. Which years?', a: '1992, 1993, 1994', w: ['1991, 1992, 1993', '1993, 1994, 1995', '1994, 1995, 1996'], e: 'Linda Martin, Niamh Kavanagh, then Paul Harrington & Charlie McGettigan. Ireland won again in 1996.', s: [1993, 'ie'] },
  { q: 'By how many points did Céline Dion win for Switzerland in 1988?', a: '1 point', w: ['3 points', '6 points', '12 points'], e: '“Ne partez pas sans moi” beat the United Kingdom by a single point, decided by the very last vote.', s: [1988, 'ch'] },
  { q: 'Lordi gave Finland its first win in 2006. In which year had Finland first taken part?', a: '1961', w: ['1956', '1965', '1971'], n: true, e: 'Finland waited 45 years for its first win.', s: [2006, 'fi'] },
  { q: 'France Gall won in 1965 with a song by Serge Gainsbourg. Which country did she represent?', a: 'Luxembourg', w: ['France', 'Monaco', 'Belgium'], e: 'Luxembourg often picked French singers, and won five times.', s: [1965, 'lu'] },
  { q: 'Which African country took part only once, in 1980?', a: 'Morocco', w: ['Tunisia', 'Egypt', 'Algeria'], e: 'Morocco sent Samira Bensaïd in 1980 and finished second to last.', s: [1980, 'ma'] },
  { q: 'Australia first took part in 2015. What was the occasion for the invitation?', a: 'The contest’s 60th anniversary', w: ['Australia hosting a semi-final', 'A televote record in Australia', 'The first contest outside Europe'], e: 'It was meant as a one-off, but Australia has been taking part ever since.', s: [2015, 'au'] },
  { q: 'In which year was the scoring of 1 to 8, 10 and 12 points introduced?', a: '1975', w: ['1971', '1980', '1985'], n: true, e: 'The very first song of 1975, “Ding-a-dong” by Teach-In, went on to win.', s: [1975, 'nl'] },
  { q: 'From which year were countries free again to sing in any language they liked?', a: '1999', w: ['1990', '1994', '2004'], n: true, e: 'The language rule had also been dropped once before, from 1973 to 1976.', s: [1999, 'se'] },
  { q: 'In which year did a live orchestra play at Eurovision for the last time?', a: '1998', w: ['1994', '2001', '2004'], n: true, e: 'Birmingham 1998 was the last contest with an orchestra.', s: [1998, 'il'] },
  { q: 'Since which year have there been two semi-finals?', a: '2008', w: ['2004', '2006', '2010'], n: true, e: 'The first semi-final came in 2004; there were two from 2008 on.', s: [2008, 'ru'] },
  { q: 'Italy came back to Eurovision in 2011. When had it last taken part before that?', a: '1997', w: ['1993', '2001', '2004'], n: true, e: 'After 13 years away, Italy came back in 2011 and finished second.', s: [2011, 'it'] },
  { q: 'Serbia won in 2007 with “Molitva”. Which attempt was that as an independent country?', a: 'Its very first', w: ['Its second', 'Its third', 'Its fifth'], e: 'Serbia won the first time it took part on its own.', s: [2007, 'rs'] },
  { q: 'Sandie Shaw won for the United Kingdom in 1967. What was famous about her performance?', a: 'She sang barefoot', w: ['She sang lying down', 'She wore a mask', 'She sang at a piano'], e: '“Puppet on a String” was the United Kingdom’s first win.', s: [1967, 'gb'] },
  { q: 'Which winning act pulled the skirts off its two women during the performance?', a: 'Bucks Fizz', w: ['Brotherhood of Man', 'Teach-In', 'Herreys'], e: 'Bucks Fizz won in 1981 with “Making Your Mind Up”.', s: [1981, 'gb'] },
  { q: 'Sweden’s 1984 winners Herreys are remembered for which footwear?', a: 'Golden boots', w: ['Roller skates', 'Clogs', 'Silver trainers'], e: '“Diggi-Loo Diggi-Ley” and the golden boots.', s: [1984, 'se'] },
  { q: 'In 1978, as Israel headed for the win, what did Jordanian television show instead?', a: 'A picture of flowers', w: ['A cartoon', 'The news', 'A weather map'], e: 'Jordanian TV then told its viewers that Belgium had won.', s: [1978, 'il'] },
  { q: 'Which country has finished last more often than any other?', a: 'Norway', w: ['Finland', 'Portugal', 'Belgium'], e: 'Norway has also won three times.', s: [1978, 'no'] },
  { q: 'How many points did Jahn Teigen score for Norway in 1978?', a: '0', w: ['1', '3', '6'], n: true, e: 'He finished last, and the “nul points” made him even more popular at home.', s: [1978, 'no'] },
  { q: 'Portugal won for the first time in 2017. In which year had Portugal first taken part?', a: '1964', w: ['1956', '1971', '1980'], n: true, e: 'Portugal waited 53 years for “Amar pelos dois”.', s: [2017, 'pt'] },
  { q: '“Volare” (Nel blu dipinto di blu) became a worldwide hit. Where did it finish at Eurovision 1958?', a: '3rd', w: ['1st', '2nd', '5th'], n: true, e: 'One of the best-known Eurovision songs ever did not win.', s: [1958, 'it'] },
  { q: 'How many points did the United Kingdom jury give ABBA’s “Waterloo” in 1974?', a: '0', w: ['3', '8', '10'], n: true, e: 'ABBA won anyway, in Brighton.', s: [1974, 'se'] },
  { q: 'Very little video of which year’s contest survives, after the tape was lost?', a: '1964', w: ['1956', '1970', '1977'], n: true, e: 'Only a few short clips remain of Copenhagen 1964.', s: [1964, 'it'] },
  { q: 'In 1996, Germany missed the final for the only time. Why?', a: 'An audio-only pre-selection round', w: ['A boycott', 'A late entry', 'A broken voting line'], e: 'The juries picked the finalists from audio tapes, and Germany was left out.', s: [1996, 'no'] },
  { q: 'How many points did Alexander Rybak score with “Fairytale” in 2009, a record at the time?', a: '387', w: ['292', '365', '412'], n: true, e: 'The record stood until the new voting system of 2016.', s: [2009, 'no'] },
  { q: 'Before Loreen in 2023, who was the only performer to have won twice as the lead singer?', a: 'Johnny Logan', w: ['Lys Assia', 'Gigliola Cinquetti', 'Carola'], e: 'Johnny Logan won in 1980 and 1987; Loreen in 2012 and 2023.', s: [2023, 'se'] },
  { q: 'In which year did San Marino first take part?', a: '2008', w: ['2004', '2011', '2014'], n: true, e: 'San Marino finished last in its semi-final, then stayed away in 2009 and 2010.', s: [2008, 'sm'] },
  { q: 'Israel won in 1979 but did not host in 1980. Which country hosted instead?', a: 'The Netherlands', w: ['The United Kingdom', 'Ireland', 'Luxembourg'], e: 'The 1980 contest was held in The Hague, and Johnny Logan won it.', s: [1980, 'ie'] },
  { q: 'Dave Benton, who won for Estonia in 2001, was born where?', a: 'Aruba', w: ['Jamaica', 'Suriname', 'Curaçao'], e: 'He won together with Tanel Padar and 2XL, Estonia’s first win.', s: [2001, 'ee'] },
  { q: 'Ukraine won in 2004 with Ruslana. How many times had Ukraine taken part before?', a: 'Once', w: ['Never', 'Twice', 'Five times'], e: 'Ukraine’s debut was in 2003.', s: [2004, 'ua'] },
  { q: 'Which country has won Eurovision with a hard rock song in monster masks?', a: 'Finland', w: ['Norway', 'Iceland', 'Estonia'], e: 'Lordi won in 2006 with “Hard Rock Hallelujah”.', s: [2006, 'fi'] },
  { q: 'Which country has finished second twice and third twice, but never won?', a: 'Malta', w: ['Iceland', 'Cyprus', 'Hungary'], e: 'Malta was second in 2002 and 2005 (and third in 1992 and 1998), but has never won.', s: [2005, 'mt'] },
  { q: 'Which singer won Eurovision for Switzerland in 1988, before becoming a world star?', a: 'Céline Dion', w: ['Lara Fabian', 'Patricia Kaas', 'Nana Mouskouri'], e: 'Céline Dion is Canadian; she sang in French for Switzerland.', s: [1988, 'ch'] },
  { q: 'Lys Assia won the first contest in 1956. How many more times did she take part after that?', a: 'Twice', w: ['Never', 'Once', 'Four times'], e: 'She was back in 1957 and 1958, and tried to qualify again in her late eighties.', s: [1956, 'ch'] },
  { q: 'Which country won with the song “La, la, la” in 1968?', a: 'Spain', w: ['Italy', 'Portugal', 'Monaco'], e: 'Massiel sang it, after Joan Manuel Serrat had been dropped for wanting to sing in Catalan.', s: [1968, 'es'] },
  { q: 'Emmelie de Forest won in 2013 barefoot, just like which earlier winner?', a: 'Sandie Shaw', w: ['Lulu', 'Lys Assia', 'Dana International'], e: 'Sandie Shaw sang barefoot when she won for the United Kingdom in 1967.', s: [2013, 'dk'] },
  { q: 'The 2014 contest in Copenhagen was held in what kind of building?', a: 'An old shipyard hall', w: ['A football stadium', 'An airport hangar', 'A concert hall'], e: 'The B&W Hallerne on Refshaleøen used to be part of a shipyard.', s: [2014, 'at'] },
  { q: 'Sweden’s 2015 winner “Heroes” performed together with what on the screen behind him?', a: 'A little animated stick figure', w: ['A cartoon dog', 'A dancing robot', 'A choir of holograms'], e: 'Måns Zelmerlöw played with the little figure all through the song.', s: [2015, 'se'] },
  { q: 'From which year were the jury points and the televotes announced separately?', a: '2016', w: ['2013', '2014', '2019'], n: true, e: 'Since 2016 the juries come first, then the televotes for each country as one big total.', s: [2016, 'ua'] },
  { q: 'Jamala’s winning song “1944” (2016) was partly sung in which language?', a: 'Crimean Tatar', w: ['Ukrainian', 'Russian', 'Turkish'], e: 'The verses are in English, the chorus in Crimean Tatar.', s: [2016, 'ua'] },
  { q: 'Who wrote “Amar pelos dois”, Portugal’s winner of 2017?', a: 'His sister, Luísa Sobral', w: ['Salvador Sobral himself', 'His father', 'A Swedish songwriting team'], e: 'Luísa Sobral wrote it for her brother Salvador.', s: [2017, 'pt'] },
  { q: 'Netta’s winning song “Toy” (2018) is famous for which sounds?', a: 'Chicken clucks', w: ['Dog barks', 'Cat meows', 'Duck quacks'], e: 'She made them live, with a looper.', s: [2018, 'il'] },
  { q: 'Duncan Laurence’s win in 2019 was the Netherlands’ first since which year?', a: '1975', w: ['1969', '1983', '1999'], n: true, e: 'The win before that was Teach-In with “Ding-a-dong”.', s: [2019, 'nl'] },
  { q: 'Måneskin’s win in 2021 was Italy’s first since which year?', a: '1990', w: ['1964', '1997', '2011'], n: true, e: 'Toto Cutugno won in 1990 with “Insieme: 1992”.', s: [2021, 'it'] },
  { q: 'Kalush Orchestra won in 2022. Which city held that contest?', a: 'Turin', w: ['Milan', 'Rome', 'Sanremo'], e: 'Italy hosted after Måneskin’s win in 2021.', s: [2022, 'ua'] },
  { q: 'Why did Liverpool host the 2023 contest?', a: 'On behalf of Ukraine, the 2022 winner', w: ['The UK had won in 2022', 'Fans voted for Liverpool', 'It was the UK’s turn'], e: 'The United Kingdom had come second in 2022 and hosted for Ukraine.', s: [2023, 'gb'] },
  { q: 'Nemo won for Switzerland in 2024. When had Switzerland last won before that?', a: '1988', w: ['1979', '1993', '2005'], n: true, e: 'The win before that was Céline Dion’s “Ne partez pas sans moi”.', s: [2024, 'ch'] },
  { q: 'What was shown on TV instead of the cancelled contest of 2020?', a: 'Europe Shine a Light', w: ['Eurovision: Home Edition', 'The Big Night In', 'Songs of Europe'], e: 'The 41 songs of 2020 were all shown, but there was no competition.', s: [2021, 'nl'] },
  { q: 'Lena’s win in 2010 was Germany’s first since which year?', a: '1982', w: ['1972', '1990', '1999'], n: true, e: 'Nicole won in 1982 with “Ein bißchen Frieden”.', s: [2010, 'de'] },
  { q: 'In which year did Turkey win its only Eurovision?', a: '2003', w: ['1997', '2008', '2010'], n: true, e: 'Sertab Erener won in Riga with “Everyway That I Can”.', s: [2003, 'tr'] },
  { q: 'Latvia won in 2002. How many times had Latvia taken part before?', a: 'Twice', w: ['Never', 'Once', 'Five times'], e: 'Latvia made its debut in 2000.', s: [2002, 'lv'] },
  { q: 'Greece won for the first time in 2005. With which song?', a: 'My Number One', w: ['Shake It', 'Everything', 'Yassou Maria'], e: 'Helena Paparizou won it in Kyiv.', s: [2005, 'gr'] }
];
var obscureUsed = {};
function makeObscure(song, allSongs, opt) {
  // Only facts from the years in play, so they match the era; each one once until all have had their turn.
  var yrs = {}; ((opt && opt.pool) || allSongs || []).forEach(function (s) { yrs[s[0]] = 1; });
  var ok = function (f) { var y = f.s ? f.s[0] : 0; return !Object.keys(yrs).length || yrs[y]; };
  var fit = OBSCURE.filter(ok); if (!fit.length) return null;
  var fresh = fit.filter(function (f) { return !obscureUsed[f.q]; });
  if (!fresh.length) { fit.forEach(function (f) { delete obscureUsed[f.q]; }); fresh = fit; }
  var f = fresh[Math.floor(Math.random() * fresh.length)]; obscureUsed[f.q] = 1;
  var opts = [f.a].concat(f.w), swap = null;
  if (f.n) opts.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); }); else shuffle(opts);
  if (f.s) allSongs.forEach(function (s) { if (!swap && s[0] === f.s[0] && s[1] === f.s[1]) swap = s; });
  return { subject: 'trivia', swap: swap, type: 'mc', noclip: true, text: f.q, hint: '', answer: f.a, options: opts, correct: opts.indexOf(f.a), explain: f.e };
}
// fast ("Slow motion"; it began as double speed, hence the name): the clip at half speed, picture hidden; four bars with title and artist. Only on a shared screen.
function makeFast(song, allSongs) {
  var lab = function (s) { return s[3] + ' – ' + s[2]; }, answer = lab(song), opts = [answer], seen = {}; seen[song[4]] = 1;
  var add = function (s) { if (opts.length < 4 && !seen[s[4]] && s[3] !== song[3] && s[2] !== song[2]) { seen[s[4]] = 1; opts.push(lab(s)); } };
  shuffle(allSongs.filter(function (s) { return Math.abs(s[0] - song[0]) <= 6; })).forEach(add);
  shuffle(allSongs.slice()).forEach(add);
  if (opts.length < 4) return null;
  shuffle(opts);
  return { subject: 'fast', fast: true, type: 'mc', text: 'Slow motion: which song is this, at half speed?', hint: '', answer: answer, options: opts, correct: opts.indexOf(answer) };
}
function makeQuestion(song, subjectSetting, typeSetting, allSongs, countries, opt) {
  if (opt && opt.types && subjectSetting === 'random') {
    var on = opt.types.filter(function (t) { return TYPE_WEIGHT[t] && (opt.pair || (t !== 'higher' && t !== 'newer')) && !(opt.cat === 'win' && t === 'higher') && ((t !== 'peel' && t !== 'blur' && t !== 'fast') || opt.peel); });
    if (on.length) {   // (always by these weights: every type has its own share)
      var total = 0, r, t = on[0], o2 = {}, k;
      // a type that has been passed over gets a slightly bigger share each time (opt.wait: questions since it was last played)
      var wOf = function (x) { return TYPE_WEIGHT[x] * (1 + 0.15 * Math.min(20, (opt.wait && opt.wait[x]) || 0)); };
      on.forEach(function (x) { total += wOf(x); });
      r = Math.random() * total;
      for (var i = 0; i < on.length; i++) { r -= wOf(on[i]); if (r <= 0) { t = on[i]; break; } }
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
  if (opt && opt.peel && (subjectSetting === 'peel' || (subjectSetting === 'random' && opt.types && opt.types.indexOf('peel') >= 0 && Math.random() < 0.09))) { var pq2 = makePeel(song, allSongs, countries, opt); if (pq2) return pq2; }
  if (opt && opt.peel && (subjectSetting === 'blur' || (subjectSetting === 'random' && opt.types && opt.types.indexOf('blur') >= 0 && Math.random() < 0.09))) { var bq = makePeel(song, allSongs, countries, opt); if (bq) { bq.blur = true; bq.subject = 'blur'; bq.text = 'Out of focus: which song is this? The sooner you know, the more points.'; return bq; } }
  if (subjectSetting === 'peel' || subjectSetting === 'blur') subjectSetting = 'facts';
  if (subjectSetting === 'fast') { var xq = opt && opt.peel ? makeFast(song, allSongs) : null; if (xq) return xq; subjectSetting = 'facts'; }
  if (subjectSetting === 'trivia') { var oq = makeObscure(song, allSongs, opt); if (oq) return oq; subjectSetting = 'facts'; }
  if (subjectSetting === 'host') { var hq = makeHost(song, countries); if (hq) return hq; subjectSetting = 'facts'; }
  if (subjectSetting === 'map') { var mq = makeFlag(song, allSongs, countries, true); if (mq) return mq; subjectSetting = 'facts'; }
  if (subjectSetting === 'flag') { var fq = makeFlag(song, allSongs, countries); if (fq) return fq; subjectSetting = 'facts'; }
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
  random: 'Random: before each question a light climbs the Eurovision points and stops on what a right answer is worth this time, from 1 to 12.',
  speed: 'Speedy: the first player with the right answer scores 12 points, the second 10, the third 8, then 7, 6, 5, 4, 3, 2 and 1.',
  ladder: ''
};
var ROUND_HELP = {
  standard: 'Standard: the questions of each round are based on the selected eras.',
  random: 'Random: the game randomly picks one of the selected eras for each round.',
  vote: 'Vote: before each round the players vote for their favourite era.',
  ladder: 'Ladder: a right answer takes you a rung up, a wrong one half a rung down; the first to reach the top ends the climb.'
};
var PARTY_MODE_HELP = {
  order: 'Grand tour: three questions, then a minigame, until every minigame has been played.',
  spin: 'Random: three questions, then a spin picks the next minigame.',
  vote: 'Everyone votes for the next minigame.',
  one: 'One player picks the next minigame, a different player each time.'
};
var FINAL_HELP = {
  chase: 'Grand Final: after the last question everyone races up a runway to the stage, with a monster on their heels. The higher your score, the further ahead you start.',
  double: 'Big Five: after the rounds are completed, there will be 5 final questions with double points. The scores stay hidden until the end.',
  standard: 'Standard: the game ends after the final round. No surprises.'
};
var SCORING_HELP = {
  correct: 'Standard: every right answer scores a flat 12 points.',
  random: 'Random: before each question a light climbs the Eurovision points and stops on what a right answer is worth this time, from 1 to 12.',
  speed: 'Speedy: a right answer within the first 3 seconds scores 12 points. After that it drops a point every second, down to 1.',
  ladder: 'Ladder: everyone climbs the same ladder. A right answer takes you one rung up, a wrong answer or no answer half a rung down. The rungs are worth 1, 2, 3, 4, 5, 6, 7, 8, 10 and 12 points, and the game goes on until the first player reaches the top. With more rounds, every round is a new climb and the rungs reached are added up.'
};
// The ladder: rung 0 is the ground, rung 10 the top. Each rung is worth a Eurovision score.
var LADDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
// rank = how many players were right before this one (only used for "order").
function pointsFor(scoring, elapsedMs, totalMs, rank) {
  if (scoring === 'correct' || scoring === 'random') return 12;   // (random: the host hands out what was spun; 12 where there was no spin)
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
function noClipArt(q) { return q && q.subject === 'host' ? ['📍', 'Host city'] : q && q.subject === 'map' ? ['🗺️', 'On the map'] : q && q.subject === 'flag' ? [flag(q.flag), 'Whose flag?'] : q && q.subject === 'odd' ? ['🧩', 'Odd one out'] : q && q.subject === 'lost' ? ['🗣️', 'Language barrier'] : q && q.subject === 'trivia' ? ['🤓', 'Did you know?'] : ['?', '']; }

// A list of switches (question types, minigames, eras) gets a "Select all" switch on top: on switches
// everything on, pressing it again switches everything off.
function multiAll(box) {
  var panel = box && box.querySelector('.multipanel'); if (!panel || panel.querySelector('input[data-all]')) return;
  var row = document.createElement('label'); row.className = 'swrow allrow';
  row.innerHTML = '<span><b>Select all</b></span><input type="checkbox" data-all="1"><i class="sw" aria-hidden="true"></i>';
  panel.insertBefore(row, panel.firstChild);
  var all = row.querySelector('input'), rest = function () { return [].slice.call(panel.querySelectorAll('input:not([data-all])')); };
  // The field itself turns green when everything is on and orange for a selection of your own. (Where nothing
  // switched on plays everything, as with question types, eras and entries, that counts as everything too.)
  var sync = function () {
    var r = rest(), every = r.every(function (el) { return el.checked; }), none = !r.some(function (el) { return el.checked; });
    all.checked = every;
    var full = every || (none && box.hasAttribute('data-noneall'));
    box.classList.toggle('isall', full); box.classList.toggle('iscustom', !full);
  };
  box.addEventListener('change', function (e) {   // (registered before the page's own handler, which then reads the result)
    if (e.target === all) rest().forEach(function (el) { el.checked = all.checked; }); else sync();
  });
  setTimeout(sync, 0); box._allSync = sync;
}

// ---------- The Grand Final: three statements, each true or false ----------
// Every question has three songs; any number of them (none to all three) fit the question. A player ticks the
// ones they think fit, and moves one space for each song they judged right (ticked and true, or left and false).
var CHASE_NOT_HOSTS = ['Monte Carlo', 'Barcelona', 'Milan', 'Berlin', 'Hamburg', 'Cologne', 'Prague', 'Warsaw', 'Budapest', 'Bucharest', 'Sofia', 'Zurich', 'Geneva', 'Lyon', 'Marseille', 'Manchester', 'Glasgow', 'Cork', 'Antwerp', 'Utrecht', 'Florence', 'Venice', 'Porto', 'Seville', 'Valencia', 'Trondheim', 'Aarhus', 'Tampere', 'Krakow', 'Vilnius', 'Minsk', 'Tbilisi', 'Yerevan', 'Chisinau', 'Ljubljana', 'Bratislava', 'Valletta', 'Nicosia', 'Reykjavik', 'Ankara', 'Thessaloniki', 'Split', 'Sarajevo', 'Haifa', 'Salzburg', 'Bruges'];
function makeChase(allSongs, countries, used) {
  var ok = function (s) { return s[9] !== 'cancelled' && !(used && used[s[4]]); };
  var S = allSongs.filter(ok); if (S.length < 40) S = allSongs.filter(function (s) { return s[9] !== 'cancelled'; });
  var lab = function (s) { return s[3] + ' – ' + s[2]; };
  var pickN = function (arr, n, not) { return shuffle(arr.filter(function (s) { return not.indexOf(s) < 0; })).slice(0, n); };
  var years = {}; S.forEach(function (s) { (years[s[0]] = years[s[0]] || []).push(s); });
  var kinds = [
    function () {   // in the final (a semi-final from 2004)
      var y = pick(Object.keys(years).filter(function (y) { return +y >= 2004 && years[y].some(function (s) { return s[5] === 1; }); }));
      if (!y) return null;
      return { text: 'Which of these were in the ' + y + ' final?', yes: function (s) { return s[5] !== 1; }, pool: years[y], label: lab };
    },
    function () {   // from this year
      var y = +pick(Object.keys(years)), near = S.filter(function (s) { return Math.abs(s[0] - y) <= 3; });
      return { text: 'Which of these were in the ' + y + ' contest?', yes: function (s) { return s[0] === y; }, pool: near, label: lab };
    },
    function () {   // sent by this country
      var c = pick(Object.keys(countries).filter(function (k) { return S.filter(function (s) { return s[1] === k; }).length >= 6; }));
      if (!c) return null;
      return { text: 'Which of these did ' + countries[c] + ' send?', yes: function (s) { return s[1] === c; }, pool: S, label: lab, mixed: function (s) { return s[1] === c; } };
    },
    function () {   // winners
      return { text: 'Which of these won Eurovision?', yes: function (s) { return s[5] === 2; }, pool: S.filter(function (s) { return s[5] === 2 || (s[6] != null && s[6] <= 6); }), label: function (s) { return lab(s) + ' (' + s[0] + ')'; } };
    },
    function () {   // top five
      return { text: 'Which of these finished in the top 5?', yes: function (s) { return s[6] != null && s[6] <= 5; }, pool: S.filter(function (s) { return s[6] != null && (s[6] <= 5 || s[6] >= 10); }), label: function (s) { return lab(s) + ' (' + s[0] + ')'; } };
    }
  ];
  // host cities: which of these cities ever held the contest? (some well-known cities never did)
  if (typeof CITIES !== 'undefined' && Math.random() < 1 / 7) {
    var hosts = Object.keys(CITIES), nh = Math.floor(Math.random() * 4);
    var a2 = shuffle(hosts.slice()).slice(0, nh), b2 = shuffle(CHASE_NOT_HOSTS.slice()).slice(0, 3 - nh);
    return { text: 'Which of these cities have hosted Eurovision?', items: shuffle(a2.map(function (n) { return { label: n, ok: true, id: 'city:' + n }; }).concat(b2.map(function (n) { return { label: n, ok: false, id: 'city:' + n }; }))) };
  }
  for (var tries = 0; tries < 30; tries++) {
    var k = pick(kinds)(); if (!k) continue;
    var n = Math.floor(Math.random() * 4), yes = k.pool.filter(k.yes), no = k.pool.filter(function (s) { return !k.yes(s); });
    if (k.mixed) { var y0 = pick(yes); if (!y0) continue; no = S.filter(function (s) { return !k.yes(s) && Math.abs(s[0] - y0[0]) <= 8; }); }
    if (yes.length < n || no.length < 3 - n) continue;
    var a = pickN(yes, n, []), b = pickN(no, 3 - n, a), items = shuffle(a.concat(b));
    var seen = {}, dup = items.some(function (s) { var t = s[3].toLowerCase(); if (seen[t]) return true; seen[t] = 1; return false; });
    if (dup) continue;
    return { text: k.text, items: items.map(function (s) { return { label: k.label(s), ok: !!k.yes(s), id: s[4] }; }) };
  }
  return null;
}

// ---------- Eurofan Shop: the merchandise (more to come) ----------
// kind: 'lose' (the target loses points), 'blow' (they go to whoever has the fewest), 'steal' (the buyer takes them), 'sit' (no points for the open question)
var SHOP_ITEMS = [
  { id: 'wind', icon: '💨', name: 'Wind Machine', desc: 'Blow 12 points from another player to whoever has the fewest', kind: 'blow', amount: 12 },
  { id: 'hack', icon: '📲', name: 'Televote Hack', desc: 'Steal 8 points from another player', kind: 'steal', amount: 8 },
  { id: 'power', icon: '🔋', name: 'Marc’s Powerbank', desc: 'Throw it at another player to knock 12 points off', kind: 'lose', amount: 12 },
  { id: 'smoke', icon: '🌫️', name: 'Smoke Machine', desc: 'Use it before a question: its answers are hidden in smoke for everyone but you', kind: 'smoke' },
  { id: 'umbrella', icon: '☂️', name: 'Eurovision Umbrella', desc: 'Keep it in your bag: it blocks the next item used on you', kind: 'shield' },
  { id: 'flag', icon: '🚩', name: 'Giant Eurovision Flag', desc: 'Wave it in front of another player: for 3 questions they can’t read the question on their phone, and their answers are jumbled', kind: 'flag', amount: 3 },
  { id: 'bribe', icon: '✉️', name: 'Envelope for the EBU', desc: 'A little bribe. Nothing happens now… but right before the Grand Final it pays out', kind: 'bribe' },
  { id: 'pass', icon: '🎟️', name: 'Euroclub Wristband', desc: 'Get into the Euroclub and leave with a random item from a random player', kind: 'thief' },
  { id: 'mic', icon: '🎤', name: 'Broken Mic', desc: 'Use it during a question: someone gets no points for it, even with the right answer', kind: 'sit' }
];
var SHOP_PICKS = 2;   // free items per visit
var SHOP_START_ALL = false;   // every (human) player starts a Party game with one of each item (handy for trying them out)
function shopItem(id) { for (var i = 0; i < SHOP_ITEMS.length; i++) if (SHOP_ITEMS[i].id === id) return SHOP_ITEMS[i]; return null; }

// Who the Hell Is Edgar? (a Cluedo-style party game): a ghost called Edgar has been writing everyone's songs. Who is he
// possessing, where is he haunting, and what is he writing with? All made-up characters and things from the show itself.
// One of each is the secret answer; the others turn up as clues.
var CLUE_WHO = [
  { id: 'lynda', icon: '👠', name: 'Lynda' }, { id: 'felix', icon: '🎩', name: 'Felix' }, { id: 'stella', icon: '💃', name: 'Stella' },
  { id: 'monster', icon: '👹', name: 'The Monster' }, { id: 'manager', icon: '🎧', name: 'The Stage Manager' }, { id: 'scrut', icon: '📋', name: 'The Scrutineer' }];
var CLUE_WHERE = [
  { id: 'green', icon: '🛋️', name: 'Green Room', in: 'in the Green Room' }, { id: 'press', icon: '📰', name: 'Press Centre', in: 'in the Press Centre' },
  { id: 'club', icon: '🪩', name: 'Euroclub', in: 'in the Euroclub' }, { id: 'back', icon: '🎭', name: 'Backstage', in: 'backstage' },
  { id: 'shop', icon: '🛍️', name: 'Woodruff’s Boutique', in: 'in Woodruff’s Boutique' }, { id: 'arena', icon: '🏟️', name: 'The Arena', in: 'on the Arena stage' }];
var CLUE_WHAT = [
  { id: 'quill', icon: '🪶', name: 'Feather Quill' }, { id: 'pen', icon: '✒️', name: 'Fountain Pen' }, { id: 'piano', icon: '🎹', name: 'Grand Piano' },
  { id: 'candle', icon: '🕯️', name: 'Candlestick' }, { id: 'ball', icon: '🔮', name: 'Crystal Ball' }, { id: 'mic', icon: '🎤', name: 'Broken Mic' }];
var CLUE_SETS = { who: CLUE_WHO, where: CLUE_WHERE, what: CLUE_WHAT };
var CLUE_N = 4, CLUE_ACC_MS = 45000, CLUE_PART = 4, CLUE_BONUS = 6;   // four clue questions; 4 points per right part of the accusation, 6 more for all three
function clueCard(key) { var p = String(key).split(':'), set = CLUE_SETS[p[0]] || []; for (var i = 0; i < set.length; i++) if (set[i].id === p[1]) return { kind: p[0], c: set[i] }; return null; }
function clueText(key) {   // what a clue says: this one is not it
  var x = clueCard(key); if (!x) return '';
  return x.kind === 'who' ? x.c.icon + ' ' + x.c.name + ' is not possessed.' : x.kind === 'where' ? x.c.icon + ' Edgar is not haunting ' + x.c.in.replace(/^(in|on) /, '').replace(' stage', '') + '.' : x.c.icon + ' Edgar is not writing with the ' + x.c.name + '.';
}
