// Builds the question for a song: what is asked (country, artist, placement or title)
// and how it is answered (multiple choice or typed). Shared by the host screen and solo mode.
var Q_TEXT = { title: 'Which song is this?', artist: 'Who performs this song?', country: 'Which country sent this song?', place: 'Where did this song finish?', points: 'How many points did this song get?' };
var Q_HINT = { title: 'Type the title…', artist: 'Type the artist…', country: 'Type the country…', place: 'Type the position, e.g. 5', points: 'Type the number of points' };
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
function makeQuestion(song, subjectSetting, typeSetting, allSongs, countries) {
  var canPlace = placeLabel(song) != null, canPoints = song[7] != null;
  var kinds = ['country', 'artist', 'title'];
  if (canPlace) kinds.push('place');
  if (canPoints) kinds.push('points');
  var subject = subjectSetting === 'random' ? pick(kinds) : subjectSetting;
  if (kinds.indexOf(subject) < 0) subject = 'country';             // no known result (1956, 2020, a few others)
  var type = typeSetting === 'mix' ? pick(['mc', 'open']) : typeSetting;
  if (subject === 'place' && song[8] != null) type = 'mc';         // "did not qualify" cannot be typed as a position
  var answer = subject === 'title' ? song[3] : subject === 'artist' ? song[2] : subject === 'country' ? (countries[song[1]] || song[1]) : subject === 'points' ? pointsLabel(song[7]) : placeLabel(song);
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
  if (subject === 'place' || subject === 'points') opts.sort(function (a, b) { var x = parseInt(a, 10), y = parseInt(b, 10); return (isNaN(x) ? 999 : x) - (isNaN(y) ? 999 : y); }); else shuffle(opts);
  q.options = opts; q.correct = opts.indexOf(answer);
  return q;
}
// Checks a typed answer. Returns 'ok', 'close' or 'no'.
function checkOpen(q, song, guess, countries) {
  var best = 'no', i, r;
  var better = function (r) { if (r === 'ok' || (r === 'close' && best === 'no')) best = r; };
  if (q.subject === 'title') return Match.check(guess, song[3]);
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
// Points for a correct answer: 100, plus a speed bonus of up to 50.
// The full bonus holds for the first 3 seconds, then ticks down to 0 at the end of the guessing time.
function scoreFor(elapsedMs, totalMs) {
  var grace = 3000, left = Math.max(0, totalMs - Math.max(elapsedMs, grace));
  return 100 + Math.round(50 * left / Math.max(1, totalMs - grace));
}
// The four options as shown at the reveal: the right one green, a wrong pick red.
function revealOptions(q, pick) {
  if (!q || !q.options) return '';
  return q.options.map(function (o, i) {
    return '<div class="opt' + (i === q.correct ? ' right' : i === pick ? ' wrong' : ' dim') + '"><b>' + 'ABCD'[i] + '.</b> ' + esc(o) + '</div>';
  }).join('');
}
// The three ways to score a correct answer, and the line that explains the selected one.
var ESC_POINTS = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
var SCORING_HELP = {
  correct: 'Correct: every right answer scores a flat 100 points.',
  speed: 'Speed: 100 points for a right answer, plus up to 50 for speed. The full bonus holds for 3 seconds, then ticks down.',
  order: 'Order: Eurovision style. The first player with the right answer gets 12 points, the second 10, then 8, 7, 6, 5, 4, 3, 2 and 1. Nobody with the right answer gets less than 1.'
};
// rank = how many players were right before this one (only used for "order").
function pointsFor(scoring, elapsedMs, totalMs, rank) {
  if (scoring === 'correct') return 100;
  if (scoring === 'order') return ESC_POINTS[rank] || 1;   // never lower than 1
  return scoreFor(elapsedMs, totalMs);
}
