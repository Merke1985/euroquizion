// The vault's riddles: three chests (gold, silver, bronze), one holds the treasure. At least one chest tells only the truth, at least one only lies; a chest with two statements may mix (at most one such chest); a blank chest neither tells the truth nor lies. A puzzle is good when exactly one chest can hold the treasure.
var CN = ['gold', 'silver', 'bronze'];
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
var KINDS = {
  inX: { t: function (c, x) { return x === c ? 'The treasure is in this chest.' : 'The treasure is in the ' + CN[x] + ' chest.'; }, v: function (c, x, p) { return p === x; } },
  notX: { t: function (c, x) { return x === c ? 'This chest is empty.' : 'The ' + CN[x] + ' chest is empty.'; }, v: function (c, x, p) { return p !== x; } },
  either: { t: function (c, x, y) { return 'The treasure is in the ' + CN[x] + ' or the ' + CN[y] + ' chest.'; }, v: function (c, x, p, S, y) { return p === x || p === y; } },
  next: { t: function () { return 'The treasure is in a chest right next to this one.'; }, v: function (c, x, p) { return Math.abs(p - c) === 1; } },
  outer: { t: function () { return 'The treasure is in one of the two outer chests.'; }, v: function (c, x, p) { return p !== 1; } },
  left: { t: function (c) { return c === 0 ? 'The treasure is to the right of this chest.' : 'The treasure is to the left of this chest.'; }, v: function (c, x, p) { return c === 0 ? p > c : p < c; } },
  truth: { t: function (c, x) { return 'The ' + CN[x] + ' chest tells the truth.'; }, v: function (c, x, p, S) { return S[x] === 'T'; } },
  liar: { t: function (c, x) { return 'The ' + CN[x] + ' chest lies.'; }, v: function (c, x, p, S) { return S[x] === 'F'; } },
  oneT: { t: function () { return 'Only one chest here tells the truth.'; }, v: function (c, x, p, S) { return S.filter(function (s) { return s === 'T'; }).length === 1; } },
  twoF: { t: function () { return 'Two chests here are lying.'; }, v: function (c, x, p, S) { return S.filter(function (s) { return s === 'F'; }).length === 2; } },
  empty2: { t: function () { return 'Two of these chests are empty.'; }, v: function () { return true; } },
  sameAs: { t: function (c, x) { return 'This chest and the ' + CN[x] + ' chest are both honest or both liars.'; }, v: function (c, x, p, S) { return S[x] === S[c]; } }
};
function stmt(k, c, x, y) { return { k: k, c: c, x: x, y: y, text: KINDS[k].t(c, x, y) }; }
function val(st, p, S) { return KINDS[st.k].v(st.c, st.x, p, S, st.y); }
function solve(P) {   // every (treasure, honesty) combination that fits the rules; P = [[statements of gold], [silver], [bronze]]
  var sols = [], opts = P.map(function (b) { return !b.length ? ['B'] : b.length > 1 ? ['T', 'F', 'M'] : ['T', 'F']; });
  for (var p = 0; p < 3; p++) opts[0].forEach(function (a) { opts[1].forEach(function (b) { opts[2].forEach(function (c) {
    var S = [a, b, c]; if (S.indexOf('T') < 0 || S.indexOf('F') < 0 || S.filter(function (s) { return s === 'M'; }).length > 1) return;
    var ok = P.every(function (box, i) { if (!box.length) return true; var vs = box.map(function (st) { return val(st, p, S); }); return S[i] === 'T' ? vs.every(Boolean) : S[i] === 'F' ? !vs.some(Boolean) : vs.some(Boolean) && !vs.every(Boolean); });
    if (ok) sols.push({ p: p, S: S });
  }); }); });
  return sols;
}
function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
function randStmt(c, kinds, blankAt) {
  var k = rnd(kinds), o = [0, 1, 2].filter(function (i) { return i !== c && i !== blankAt; }), x = null, y = null;
  if (k === 'inX' || k === 'notX') x = rnd([0, 1, 2]);
  if (k === 'either') { var two = [0, 1, 2].sort(function () { return Math.random() - 0.5; }); x = Math.min(two[0], two[1]); y = Math.max(two[0], two[1]); }
  if (k === 'truth' || k === 'liar' || k === 'sameAs') { if (!o.length) return null; x = rnd(o); }
  if (k === 'left' && c === 1) return null;
  return stmt(k, c, x, y);
}
var LEVELS = [   // (from easy to devious: which kinds of statement, a blank chest, two statements on a chest)
  { kinds: ['inX', 'notX', 'either', 'outer'], blank: 0, two: 0 },
  { kinds: ['inX', 'notX', 'either', 'next', 'left', 'outer'], blank: 0, two: 0 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'either'], blank: 0, two: 0 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'next', 'outer', 'left'], blank: 0.5, two: 0 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'oneT', 'empty2', 'either'], blank: 0.3, two: 0 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'next', 'either', 'left'], blank: 0, two: 1 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'oneT', 'twoF', 'sameAs', 'next'], blank: 0.3, two: 1 },
  { kinds: ['inX', 'notX', 'truth', 'liar', 'oneT', 'twoF', 'sameAs', 'outer', 'left'], blank: 0, two: 2 }
];
function makePuzzle(lv, want) {
  var L = LEVELS[Math.min(lv, LEVELS.length - 1)];
  for (var tries = 0; tries < 4000; tries++) {
    var blankAt = Math.random() < L.blank ? Math.floor(Math.random() * 3) : -1, twoAt = [0, 1, 2].filter(function (i) { return i !== blankAt; }).sort(function () { return Math.random() - 0.5; }).slice(0, L.two);
    var P = [0, 1, 2].map(function (c) { if (c === blankAt) return []; var n = twoAt.indexOf(c) >= 0 ? 2 : 1, b = []; for (var i = 0; i < n; i++) { var s = randStmt(c, L.kinds, blankAt); if (!s || b.some(function (q) { return q.text === s.text; })) return null; b.push(s); } return b; });
    if (P.some(function (b) { return b === null; })) continue;
    var sols = solve(P), ps = {}; sols.forEach(function (s) { ps[s.p] = 1; });
    if (Object.keys(ps).length !== 1) continue;
    if (want != null && sols[0].p !== want) continue;   // (the right chest is chosen beforehand, so it's spread evenly)
    var all = [].concat(P[0], P[1], P[2]); if (lv >= 2 && all.every(function (s) { return s.k === 'inX' || s.k === 'notX'; })) continue;   // (from round 3 on, at least one statement about honesty or position)
    return { boxes: P.map(function (b) { return b.map(function (s) { return s.text; }); }), p: sols[0].p, S: sols[0].S, n: sols.length };
  }
  return want != null ? makePuzzle(lv) : null;
}
if (typeof module !== 'undefined') module.exports = { makePuzzle: makePuzzle, solve: solve };
