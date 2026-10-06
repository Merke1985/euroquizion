// Menu music: a short original synth-pop loop, made on the spot with the Web Audio API (no file, nothing
// to license). Pages say when they want it with Music.want(true/false); it starts after the first tap or
// key press, because browsers do not let a page make sound before that. The speaker button mutes it.
var Music = (function () {
  var ctx = null, master = null, wanted = false, playing = false, timer = null, step = 0, nextT = 0, btn = null;
  var muted = false;
  try { muted = localStorage.getItem('esc-music') === '0'; } catch (e) {}
  var BPM = 118, S16 = 60 / BPM / 4;
  // Four bars: Am, F, C, G. Roots for the bass, three notes for the pad and the arpeggio.
  var CH = [[45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]]];
  var LEAD = [76, null, 72, null, 69, null, 72, 74, null, 72, null, 69, 67, null, 69, null];   // a small hook, every other pass
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function tone(type, f, t, len, vol, cut) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cut || 2500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.03);
  }
  function kick(t) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
  }
  var noiseBuf = null;
  function noise(t, len, vol, hp) {
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + len + 0.02);
  }
  function sched(i, t) {
    var bar = Math.floor(i / 16) % 4, s = i % 16, ch = CH[bar], pass = Math.floor(i / 64) % 2;
    if (s % 4 === 0) kick(t);
    if (s % 4 === 2) noise(t, 0.05, 0.12, 7000);                       // hi-hat on the off-beat
    if (s === 4 || s === 12) noise(t, 0.14, 0.22, 1800);               // clap
    if (s % 2 === 0) tone('sawtooth', hz(ch[0] - (s % 4 === 2 ? 0 : 12)), t, 0.16, 0.2, 500);   // bouncing bass
    if (s === 0) ch[1].forEach(function (n) { tone('sawtooth', hz(n), t, S16 * 15, 0.035, 900); });   // soft pad
    tone('triangle', hz(ch[1][[0, 1, 2, 1][s % 4]] + 12), t, 0.12, 0.07, 3000);   // arpeggio
    if (pass && LEAD[s] != null && bar % 2 === 0) tone('square', hz(LEAD[s]), t, 0.2, 0.045, 2200);
  }
  function tick() {
    while (nextT < ctx.currentTime + 0.25) { sched(step, nextT); step++; nextT += S16; }
  }
  function start() {
    if (playing || !wanted || muted) return;
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      if (ctx.state !== 'running') { setTimeout(function () { if (ctx.state === 'running') start(); }, 300); return; }
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0.0001, ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.8);
      playing = true; step = 0; nextT = ctx.currentTime + 0.08; tick(); timer = setInterval(tick, 60);
    } catch (e) {}
  }
  function stop() {
    if (!playing) return;
    playing = false; clearInterval(timer);
    try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime); master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4); } catch (e) {}
  }
  function draw() {
    if (!btn) return;
    btn.classList.toggle('hidden', !wanted); btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Turn menu music on' : 'Turn menu music off'); btn.title = muted ? 'Music off' : 'Music on';
  }
  function make() {
    btn = document.createElement('button'); btn.type = 'button'; btn.id = 'musicbtn'; btn.className = 'musicbtn hidden';
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); muted = !muted;
      try { localStorage.setItem('esc-music', muted ? '0' : '1'); } catch (x) {}
      if (muted) stop(); else start();
      draw();
    });
    document.body.appendChild(btn); draw();
  }
  if (document.body) make(); else document.addEventListener('DOMContentLoaded', make);
  // The first tap or key press anywhere unlocks sound.
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { if (wanted && !muted && !playing) start(); }, true); });
  // A short rising chime, used when a player joins. Plays whether or not the menu music is on.
  function blip() {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.02;
      [[72, 0], [76, 0.09], [79, 0.18], [84, 0.27]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = hz(n[0]);
        g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(0.22, t + n[1] + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.32);
        o.connect(g); g.connect(ctx.destination); o.start(t + n[1]); o.stop(t + n[1] + 0.36);
      });
    } catch (e) {}
  }
  // A soft "plop": a sine that drops in pitch. n shifts it a little so a row of them does not sound identical.
  function plop(n) {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain(), f = 520 + ((n || 0) % 5) * 45;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.34, t + 0.13);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    } catch (e) {}
  }
  // The right answer is revealed: a bright two-note "ta-daa" with a little shimmer on top.
  function ding() {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.02;
      [[79, 0, 0.18, 'triangle', 0.26], [84, 0.13, 0.7, 'triangle', 0.28], [88, 0.13, 0.7, 'sine', 0.14], [96, 0.16, 0.5, 'sine', 0.06]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = n[3]; o.frequency.value = hz(n[0]);
        g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(n[4], t + n[1] + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + n[2]);
        o.connect(g); g.connect(ctx.destination); o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.05);
      });
    } catch (e) {}
  }
  // Counting up a score: a short ping that climbs in pitch as the number gets closer to the total.
  function ping(v, total) {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.005, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 700 + 900 * (total ? v / total : 0);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08);
    } catch (e) {}
  }
  return { blip: blip, plop: plop, ding: ding, ping: ping, want: function (on) { on = !!on; if (on === wanted) return; wanted = on; if (on) start(); else stop(); draw(); } };
})();
