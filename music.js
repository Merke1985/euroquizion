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
  function plop(n, vol) {   // vol: 1 by default, lower for a quiet tick
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain(), f = 520 + ((n || 0) % 5) * 45;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.34, t + 0.13);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * (vol > 0 ? vol : 1), t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
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
  // Douze points! A rising fanfare of five notes ending on a bright held chord, with a sparkle on top.
  function douze() {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.02;
      [[72, 0, 0.14, 'triangle', 0.26], [76, 0.1, 0.14, 'triangle', 0.26], [79, 0.2, 0.14, 'triangle', 0.27], [84, 0.3, 0.2, 'triangle', 0.28],
        [88, 0.46, 1.1, 'triangle', 0.3], [84, 0.46, 1.1, 'triangle', 0.2], [79, 0.46, 1.1, 'sine', 0.16], [96, 0.5, 0.9, 'sine', 0.1], [100, 0.62, 0.7, 'sine', 0.07], [103, 0.74, 0.6, 'sine', 0.05]].forEach(function (n) {
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
  // ---- The Final Chase: a nervous heartbeat under everything, eerie wails now and then, and a chomp ----
  function ac() {
    if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function thump(t, f, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.25);
  }
  var dreadT = null, dreadDrone = null;
  function dread(on, fast) {
    clearInterval(dreadT); dreadT = null;
    if (dreadDrone) { try { var dd = dreadDrone; dd.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); setTimeout(function () { try { dd.o.stop(); dd.o2.stop(); dd.lfo.stop(); } catch (e) {} }, 900); } catch (e) {} dreadDrone = null; }
    if (!on || !ac()) return;
    try {
      // a low, slowly wobbling drone
      var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 55; o2.type = 'sawtooth'; o2.frequency.value = 58.3; lp.type = 'lowpass'; lp.frequency.value = 260;
      lfo.frequency.value = 0.35; lg.gain.value = 120; lfo.connect(lg); lg.connect(lp.frequency);
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.03, ctx.currentTime, 1.2);
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(); o2.start(); lfo.start();
      dreadDrone = { o: o, o2: o2, g: g, lfo: lfo };
      // and a heartbeat: lub-dub
      var beat = function () { if (!ctx) return; var t = ctx.currentTime + 0.02; thump(t, 70, 0.5); thump(t + 0.2, 60, 0.32); };
      beat(); dreadT = setInterval(beat, fast ? 620 : 900);
    } catch (e) {}
  }
  function creep() {   // an eerie, wavering wail sliding down, with a breathy whoosh
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02, len = 2.4, o = ctx.createOscillator(), v = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      var hi = 700 + Math.random() * 400;
      o.type = 'sine'; o.frequency.setValueAtTime(hi, t); o.frequency.exponentialRampToValueAtTime(hi * 0.42, t + len);
      v.frequency.value = 6.5; vg.gain.value = 18; v.connect(vg); vg.connect(o.frequency);
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); v.start(t); o.stop(t + len + 0.05); v.stop(t + len + 0.05);
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();
      s.buffer = noiseBuf; s.loop = true; nf.type = 'bandpass'; nf.frequency.setValueAtTime(400, t); nf.frequency.exponentialRampToValueAtTime(2400, t + 1.2); nf.Q.value = 2;
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.06, t + 0.8); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      s.connect(nf); nf.connect(ng); ng.connect(ctx.destination); s.start(t); s.stop(t + 1.7);
    } catch (e) {}
  }
  function chomp() {   // caught
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02;
      [0, 0.16].forEach(function (d) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(220, t + d); o.frequency.exponentialRampToValueAtTime(40, t + d + 0.18);
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
        o.connect(g); g.connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.22);
      });
      thump(t + 0.32, 55, 0.6);
    } catch (e) {}
  }
  function scream() {   // caught: a short, shrill scream that falls away
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02, len = 1.15, o = ctx.createOscillator(), o2 = ctx.createOscillator(), v = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square';
      o.frequency.setValueAtTime(820, t); o.frequency.linearRampToValueAtTime(1050, t + 0.18); o.frequency.exponentialRampToValueAtTime(360, t + len);
      o2.frequency.setValueAtTime(828, t); o2.frequency.linearRampToValueAtTime(1062, t + 0.18); o2.frequency.exponentialRampToValueAtTime(366, t + len);
      v.frequency.value = 9; vg.gain.value = 45; v.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.05); g.gain.setValueAtTime(0.16, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination);
      [o, o2, v].forEach(function (x) { x.start(t); x.stop(t + len + 0.05); });
    } catch (e) {}
  }
  function crumble() {   // stone breaking: a rumble with cracks in it
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02;
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 380;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t); s.stop(t + 1.35);
      for (var k = 0; k < 6; k++) (function (at) { var c2 = ctx.createBufferSource(), cg = ctx.createGain(), cf = ctx.createBiquadFilter(); c2.buffer = noiseBuf; cf.type = 'highpass'; cf.frequency.value = 1600; cg.gain.setValueAtTime(0.3, at); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06); c2.connect(cf); cf.connect(cg); cg.connect(ctx.destination); c2.start(at); c2.stop(at + 0.08); })(t + 0.05 + Math.random() * 0.9);
    } catch (e) {}
  }
  function woosh() {   // everyone moves forward
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.Q.value = 1.6;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.35); f.frequency.exponentialRampToValueAtTime(900, t + 0.7);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(t); s.stop(t + 0.8);
    } catch (e) {}
  }
  function buzz() {   // not good enough: a short error buzzer, two low notes
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      [[196, 0], [147, 0.18]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'square'; o.frequency.value = n[0]; f.type = 'lowpass'; f.frequency.value = 1200;
        g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(0.18, t + n[1] + 0.01); g.gain.setValueAtTime(0.18, t + n[1] + 0.14); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.2);
        o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t + n[1]); o.stop(t + n[1] + 0.22);
      });
    } catch (e) {}
  }
  function defeat() {   // the monster goes down: a long, falling howl and a thud
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02, o = ctx.createOscillator(), v = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(70, t + 1.6);
      v.frequency.value = 7; vg.gain.value = 25; v.connect(vg); vg.connect(o.frequency);
      f.type = 'lowpass'; f.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); v.start(t); o.stop(t + 1.75); v.stop(t + 1.75);
      thump(t + 1.5, 50, 0.7);
    } catch (e) {}
  }
  function short() {   // the music dies: a short circuit, sparks crackling over a mains hum that drops away
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(100, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.02); g.gain.setValueAtTime(0.32, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
      o.connect(f); f.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1);
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      for (var k = 0; k < 14; k++) (function (at, len, vol) {
        var s = ctx.createBufferSource(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
        s.buffer = noiseBuf; sf.type = 'highpass'; sf.frequency.value = 2500 + Math.random() * 3000;
        sg.gain.setValueAtTime(vol, at); sg.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(sf); sf.connect(sg); sg.connect(ctx.destination); s.start(at, Math.random() * 0.2); s.stop(at + len + 0.01);
      })(t + Math.pow(Math.random(), 1.6) * 0.8, 0.015 + Math.random() * 0.05, 0.2 + Math.random() * 0.35);
      var z = ctx.createOscillator(), zg = ctx.createGain();   // a final zap
      z.type = 'square'; z.frequency.setValueAtTime(1800, t + 0.05); z.frequency.exponentialRampToValueAtTime(120, t + 0.3);
      zg.gain.setValueAtTime(0.0001, t + 0.05); zg.gain.exponentialRampToValueAtTime(0.12, t + 0.06); zg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      z.connect(zg); zg.connect(ctx.destination); z.start(t + 0.05); z.stop(t + 0.34);
    } catch (e) {}
  }
  function stepSnd() { if (!ac()) return; try { var t = ctx.currentTime + 0.01; thump(t, 160, 0.18); } catch (e) {} }
  return { dread: dread, creep: creep, chomp: chomp, scream: scream, short: short, woosh: woosh, buzz: buzz, defeat: defeat, crumble: crumble, step: stepSnd, blip: blip, plop: plop, ding: ding, douze: douze, ping: ping, want: function (on) { on = !!on; if (on === wanted) return; wanted = on; if (on) start(); else stop(); draw(); } };
})();
