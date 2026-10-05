// Thin connection layer: Supabase Realtime (broadcast) or, without config, BroadcastChannel.
var EVENTS = ['hi', 'guess', 'state', 'result', 'sync'];
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
