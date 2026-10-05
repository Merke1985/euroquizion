// Soepele antwoordcontrole: negeert hoofdletters, accenten, leestekens en kleine typfouten.
(function (root) {
  var SPECIAL = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ħ': 'h' };
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[ßøæœđłðþıħ]/g, function (c) { return SPECIAL[c]; })
      .replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function variants(title) {
    var out = [], add = function (s) { s = norm(s); if (s && out.indexOf(s) < 0) out.push(s); };
    add(title);
    add(title.replace(/\([^)]*\)/g, ' '));
    (title.match(/\(([^)]*)\)/g) || []).forEach(function (p) { if (norm(p).length >= 4) add(p); });
    title.replace(/\([^)]*\)/g, ' ').split(/\s[\/–-]\s/).forEach(function (p) { if (norm(p).length >= 4) add(p); });
    return out;
  }
  function lev(a, b) {
    if (a === b) return 0;
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function tol(n) { return n <= 3 ? 0 : n <= 6 ? 1 : n <= 12 ? 2 : 3; }
  // Geeft 'ok', 'close' of 'no'
  function check(guess, title) {
    var g = norm(guess), best = 'no';
    if (!g) return 'no';
    var vs = variants(title);
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], t = tol(v.length);
      var d = Math.min(lev(g, v), lev(g.replace(/ /g, ''), v.replace(/ /g, '')));
      if (d <= t) return 'ok';
      // titel staat letterlijk in een langer antwoord ("abba waterloo")
      if (v.length >= 4 && (' ' + g + ' ').indexOf(' ' + v + ' ') >= 0) return 'ok';
      if (v.length > 3 && (d <= t + 2 || (g.length >= 4 && v.indexOf(g) >= 0))) best = 'close';
    }
    return best;
  }
  var api = { norm: norm, variants: variants, check: check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Match = api;
})(this);
