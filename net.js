// Thin connection layer: Supabase Realtime (broadcast) or, without config, BroadcastChannel.
var EVENTS = ['hi', 'guess', 'state', 'result', 'sync', 'poll', 'clip', 'ready', 'chat', 'go', 'draw', 'quip', 'kick', 'chase', 'shop'];
function escConnect(room) {
  var cfg = window.ESC_CONFIG || {}, handlers = {};
  function emit(e, p) { if (handlers[e]) handlers[e](p); }
  var api = { on: function (e, f) { handlers[e] = f; }, demo: true, send: null };
  if (cfg.supabaseUrl && cfg.supabaseKey && window.supabase) {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    var ch = sb.channel('esc-' + room, { config: { broadcast: { self: false } } });
    var ready = false, queue = [];
    EVENTS.forEach(function (ev) { ch.on('broadcast', { event: ev }, function (m) { emit(ev, m.payload); }); });
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') { ready = true; queue.splice(0).forEach(function (m) { ch.send(m); }); emit('_open'); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { ready = false; emit('_error', status); }
    });
    api.demo = false;
    api.send = function (event, payload) {
      var m = { type: 'broadcast', event: event, payload: payload };
      if (ready) ch.send(m); else queue.push(m);
    };
    return api;
  }
  var bc = new BroadcastChannel('esc-' + room);
  bc.onmessage = function (e) { emit(e.data.event, e.data.payload); };
  api.send = function (event, payload) { bc.postMessage({ event: event, payload: payload }); };
  setTimeout(function () { emit('_open'); }, 0);
  return api;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function flag(code) {
  if (!/^[a-z]{2}$/.test(code) || code === 'yu' || code === 'cs') return '';
  return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 97, 0x1F1E6 + code.charCodeAt(1) - 97);
}

// How the entry did: "3rd place · 245 points", or its semi-final result if it did not qualify.
function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function resultText(s) {
  if (!s) return '';
  if (s[9] === 'cancelled') return 'Contest cancelled in 2020, so no result';
  if (s[9] === 'dq') return 'Qualified, but disqualified before the final';
  if (s[6] == null) return '';
  var pts = s[7] == null ? '' : ' · ' + s[7] + (s[7] === 1 ? ' point' : ' points');
  if (s[8] == null) return (s[6] === 1 ? 'Winner' : ordinal(s[6]) + ' place') + pts;
  return ordinal(s[6]) + ' in ' + (s[8] ? 'semi-final ' + s[8] : 'the semi-final') + pts + ' · did not qualify';
}
// Songs matching a years range ("1956-1979") and a category (all, nq, final, win).
// Videos YouTube refused to play in this browser (embedding blocked, removed, not available here).
// They are remembered on this device and no longer offered.
var BAD_VIDEOS = {};
try { (JSON.parse(localStorage.getItem('esc-badvideos') || '[]') || []).forEach(function (id) { BAD_VIDEOS[id] = 1; }); } catch (e) {}
function markBad(id) {
  if (!id || BAD_VIDEOS[id]) return;
  BAD_VIDEOS[id] = 1;
  try { localStorage.setItem('esc-badvideos', JSON.stringify(Object.keys(BAD_VIDEOS).slice(-600))); } catch (e) {}
}
function poolFor(songs, eraValue, cat) {
  // eraValue: one stretch of years ('1980-1999') or several, separated by commas
  var eras = String(eraValue || '1956-2100').split(',').map(function (r) { return r.split('-').map(Number); });
  // cat: 'all', or one or more of nq (did not qualify), final (every finalist), fin (finalists who did not win), win (winners)
  var cats = String(cat || 'all').split(',');
  var catOk = function (s) { return cats.some(function (c) { return c === 'all' || (c === 'nq' && s[5] === 1) || (c === 'final' && s[5] !== 1) || (c === 'fin' && s[5] !== 1 && s[5] !== 2) || (c === 'win' && s[5] === 2); }); };
  return songs.filter(function (s) {
    return !BAD_VIDEOS[s[4]] && eras.some(function (era) { return s[0] >= era[0] && s[0] <= era[1]; }) && catOk(s);
  });
}
