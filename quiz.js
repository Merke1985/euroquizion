// Builds the question for a song: what is asked (country, artist, placement or title)
// and how it is answered (multiple choice or typed). Shared by the host screen and solo mode.
var Q_TEXT = { title: 'Which song is this?', artist: 'Who performs this song?', country: 'Which country sent this song?', place: 'Where did this song finish?', points: 'How many points did this song get?', year: 'Which year is this song from?' };
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
function makeOdd(song, allSongs, countries) {
  var label = function (s) { return s[3] + ' – ' + s[2]; };
  var byYear = Math.random() < 0.5, tries = [byYear, !byYear], group = null, why = '';
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
      if (got.length === 3) { group = got; why = tries[t] ? 'from ' + got[0][0] : 'from ' + (countries[got[0][1]] || got[0][1]); }
    }
  }
  if (!group) return null;
  var answer = label(song), opts = shuffle(group.map(label).concat([answer]));
  return { subject: 'odd', type: 'mc', text: 'Which song is the odd one out?', hint: '', answer: answer, options: opts, correct: opts.indexOf(answer), noclip: true,
    explain: 'Odd one out: ' + song[3] + '. The other three are all ' + why + '.' };
}
function makeQuestion(song, subjectSetting, typeSetting, allSongs, countries) {
  if (subjectSetting === 'odd' || (subjectSetting === 'random' && Math.random() < 1 / 6)) { var odd = makeOdd(song, allSongs, countries); if (odd) return odd; }
  var canPlace = placeLabel(song) != null, canPoints = song[7] != null;
  var kinds = ['country', 'artist', 'title', 'year'];
  if (canPlace) kinds.push('place');
  if (canPoints) kinds.push('points');
  var subject = subjectSetting === 'random' || subjectSetting === 'odd' ? pick(kinds) : subjectSetting;
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
var DRAW_HELP = 'Draw!: players take turns drawing a song. The first to guess it gets 12 points, the next 10, then 8, 7, 6 and so on. The drawer gets 12 when someone guesses it.';
var DRAW_COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'];   // the last one is the eraser
function drawClear(cv) { var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, DRAW_W, DRAW_H); }
function drawPaint(cv, m) {
  if (!m) return;
  if (m.clear) { drawClear(cv); return; }
  var p = m.p, c = cv.getContext('2d');
  if (!p || p.length < 2) return;
  c.strokeStyle = c.fillStyle = DRAW_COLORS[m.c] || DRAW_COLORS[0];
  c.lineWidth = Math.max(2, Math.min(40, +m.w || 6)); c.lineCap = c.lineJoin = 'round';
  if (p.length === 2) { c.beginPath(); c.arc(p[0], p[1], c.lineWidth / 2, 0, 7); c.fill(); return; }
  c.beginPath(); c.moveTo(p[0], p[1]);
  for (var i = 2; i + 1 < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  c.stroke();
}
function songLabel(s) { return s[3] + ' – ' + s[2]; }
// Autoplay countdown: plain seconds, or minutes:seconds when the rest of the song is still long.
function clock(secs) { return secs < 60 ? String(secs) : Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2); }
var AD_TEXT = 'YouTube is slow to start this song, probably because of an ad. Skip the ad on the screen if it lets you; the song starts right after.';
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
  var mine = pts != null, none = mine && (pick == null || pick < 0 || !q.options[pick]);
  return q.options.map(function (o, i) {
    var tag = '';
    if (mine && i === pick) tag = i === q.correct ? '<span class="mark">✓ +' + pts + '</span>' : '<span class="mark">✗ 0</span>';
    else if (none && i === q.correct) tag = '<span class="mark none">No answer · 0</span>';
    return '<div class="opt' + (i === q.correct ? ' right' : i === pick ? ' wrong' : ' dim') + '"><b>' + 'ABCD'[i] + '</b><span class="otext">' + esc(o) + '</span>' + tag + '</div>';
  }).join('');
}
// The Eurovision opening fanfare, streamed from YouTube like the songs: video id and how long it plays.
// These were checked to play when embedded; the first one that works is used.
var INTRO = { ids: ['itP7H6Uo29s', 'g6sunstIdf8', 'SK5aHV732b8', 'PT9zvm7Wf5M'], ms: 19000 };   // the first clip lasts 18 seconds; the countdown runs one second longer
// The three ways to score a correct answer, and the line that explains the selected one.
var ESC_POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
var SCORING_HELP = {
  correct: 'Basic: every right answer scores a flat 12 points.',
  speed: 'Speed: a right answer within the first 3 seconds scores 12 points. After that it drops a point every second, down to 1.',
  order: 'Order: Eurovision style. The first player with the right answer gets 12 points, the second 10, then 8, 7, 6, 5, 4, 3, 2 and 1. Nobody with the right answer gets less than 1.'
};
// rank = how many players were right before this one (only used for "order").
function pointsFor(scoring, elapsedMs, totalMs, rank) {
  if (scoring === 'correct') return 12;
  if (scoring === 'order') return ESC_POINTS[rank] || 1;   // never lower than 1
  return scoreFor(elapsedMs, totalMs);
}
// The final scoreboard, Eurovision style: every score counts up point by point over 5 seconds.
// A row's border turns yellow when that player's total is reached; the winner turns green at the end.
var finalRun = null;
function finalBoard(el, players, mePid, onDone) {
  clearInterval(finalRun);
  var ps = players.slice().sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
  var max = ps.length ? ps[0].score : 0, T = 5000, t0 = Date.now();
  el.innerHTML = ps.map(function (p, i) {
    return '<li data-i="' + i + '"' + (p.pid === mePid ? ' class="me"' : '') + '><span class="who">' + charSvg(p.char) + esc(p.name) + '</span><span class="num">0</span></li>';
  }).join('') || '<li class="mute">No players</li>';
  var rows = el.querySelectorAll('li[data-i]');
  var tick = function () {
    var f = Math.min(1, (Date.now() - t0) / T), cur = Math.floor(max * f), done = f >= 1;
    ps.forEach(function (p, i) {
      var v = done ? p.score : Math.min(p.score, cur);
      rows[i].querySelector('.num').textContent = v;
      if (done && max > 0 && p.score === max) { rows[i].classList.remove('reached'); rows[i].classList.add('winner'); }
      else if (v >= p.score && (max > p.score || done)) rows[i].classList.add('reached');
    });
    if (done) { clearInterval(finalRun); finalRun = null; if (onDone) onDone(ps.filter(function (p) { return max > 0 && p.score === max; })); }
  };
  tick(); finalRun = setInterval(tick, 40);
}
