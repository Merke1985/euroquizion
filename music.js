// Menu music: a short original synth-pop loop, made on the spot with the Web Audio API (no file, nothing
// to license). Pages say when they want it with Music.want(true/false); it starts after the first tap or
// key press, because browsers do not let a page make sound before that. The speaker button mutes it.
var Music = (function () {
  var ctx = null, master = null, wanted = false, playing = false, timer = null, step = 0, nextT = 0, btn = null;
  var muted = false;
  // Volume: one slider for music (the menu loop here, and the songs on the host) and one for sound effects.
  var vol = { music: 1, fx: 1 }, fxNode = null;
  try { var sv = JSON.parse(localStorage.getItem('esc-vol') || 'null'); if (sv) { vol.music = +sv.music >= 0 ? +sv.music : 1; vol.fx = +sv.fx >= 0 ? +sv.fx : 1; } } catch (e) {}
  function fxOut() { if (!fxNode) { fxNode = ctx.createGain(); fxNode.gain.value = vol.fx; fxNode.connect(ctx.destination); } return fxNode; }
  function musicLevel() { return Math.max(0.0001, 0.28 * vol.music); }
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
  // The host page can swap the synth loop for a music file (Music.useLoop): it loops without a gap, and when it
  // stops it remembers where it was, so it carries on from there the next time (synth: true still asks for the synth).
  var loopSrc = '', loopBuf = null, loopLoading = false, loopNode = null, loopGain = null, loopAt = 0, loopT0 = 0, synthNow = false, wantSynth = false;
  var loopLen = 0, loopSpan = 1, loopA0 = -1;
  function loopEdge() {   // where the music really starts in the decoded file (an mp3 has a few milliseconds of silence up front)
    if (loopA0 >= 0) return loopA0;
    var d = loopBuf.getChannelData(0), i = 0, n = Math.min(d.length, loopBuf.sampleRate);
    while (i < n && Math.abs(d[i]) < 0.02) i++;
    loopA0 = i < n ? i / loopBuf.sampleRate : 0; return loopA0;
  }
  function loopLevel() { return Math.max(0.0001, 0.55 * vol.music); }
  function loopStart() {
    if (!loopBuf) {
      if (!loopLoading) { loopLoading = true; fetch(loopSrc).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Promise(function (ok, no) { ctx.decodeAudioData(b, ok, no); }); }).then(function (buf) { loopBuf = buf; loopLoading = false; if (playing && !synthNow) loopStart(); }).catch(function () { loopLoading = false; loopSrc = ''; if (playing) { playing = false; start(); } }); }
      return;
    }
    if (loopNode) return;
    if (!loopGain) { loopGain = ctx.createGain(); loopGain.connect(ctx.destination); }
    loopGain.gain.cancelScheduledValues(ctx.currentTime); loopGain.gain.setValueAtTime(0.0001, ctx.currentTime); loopGain.gain.exponentialRampToValueAtTime(loopLevel(), ctx.currentTime + 0.6);
    loopNode = ctx.createBufferSource(); loopNode.buffer = loopBuf; loopNode.loop = true; loopNode.connect(loopGain);
    var a0 = loopEdge(), len = loopLen && a0 + loopLen <= loopBuf.duration + 0.01 ? Math.min(loopLen, loopBuf.duration - a0) : loopBuf.duration - a0;
    loopNode.loopStart = a0; loopNode.loopEnd = a0 + len; loopSpan = len;   // (exactly so many bars, from the first beat: no hiccup where it goes round)
    loopT0 = ctx.currentTime - loopAt; loopNode.start(0, a0 + loopAt % len);
  }
  function loopStop() {
    if (!loopNode) return;
    var n = loopNode; loopNode = null; loopAt = (ctx.currentTime - loopT0) % loopSpan;
    try { loopGain.gain.cancelScheduledValues(ctx.currentTime); loopGain.gain.setValueAtTime(loopGain.gain.value, ctx.currentTime); loopGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4); n.stop(ctx.currentTime + 0.45); } catch (e) {}
  }
  function start() {
    if (playing || !wanted || muted) return;
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      if (ctx.state !== 'running') { setTimeout(function () { if (ctx.state === 'running') start(); }, 300); return; }
      playing = true; synthNow = !loopSrc || wantSynth;
      if (!synthNow) { loopStart(); return; }
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0.0001, ctx.currentTime); master.gain.exponentialRampToValueAtTime(musicLevel(), ctx.currentTime + 0.8);
      step = 0; nextT = ctx.currentTime + 0.08; tick(); timer = setInterval(tick, 60);
    } catch (e) {}
  }
  function stop() {
    if (!playing) return;
    playing = false;
    if (!synthNow) { loopStop(); return; }
    clearInterval(timer);
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
        o.connect(g); g.connect(fxOut()); o.start(t + n[1]); o.stop(t + n[1] + 0.36);
      });
    } catch (e) {}
  }
  // Talking: one short, soft syllable blip; 'him' is lower, 'her' higher, each a little different so it sounds like speech.
  function talk(who) {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.005, base = who === 'her' ? 330 : who === 'juliet' ? 300 : who === 'lynda' ? 270 : 190, f = base * (0.85 + Math.random() * 0.35);
      var o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'square'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 0.9 : 1.08), t + 0.07);
      bp.type = 'bandpass'; bp.frequency.value = f * 3; bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      o.connect(bp); bp.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.09);
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
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.22);
    } catch (e) {}
  }
  // A camera shutter with a flash pop (the Turquoise Carpet photographers)
  var snapBuf = null;
  function snap() {
    try {
      if (!ac()) return;
      if (!snapBuf) { snapBuf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate); var d = snapBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var t = ctx.currentTime + 0.01;
      [0, 0.055].forEach(function (dt, k) {
        var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        s.buffer = snapBuf; f.type = 'bandpass'; f.frequency.value = k ? 2600 : 4200; f.Q.value = 0.9;
        g.gain.setValueAtTime(k ? 0.28 : 0.4, t + dt); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.05);
        s.connect(f); f.connect(g); g.connect(fxOut()); s.start(t + dt); s.stop(t + dt + 0.07);
      });
    } catch (e) {}
  }
  // A clock tick for the last seconds (n: seconds left; the last one is a little higher)
  function clock(n) {
    try {
      if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume();
      var t = ctx.currentTime + 0.01, f = n <= 1 ? 2400 : 1700;
      [0, 0.09].forEach(function (d, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(i ? f * 0.75 : f, t + d);
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.05);
        o.connect(g); g.connect(fxOut()); o.start(t + d); o.stop(t + d + 0.06);
      });
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
        o.connect(g); g.connect(fxOut()); o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.05);
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
        o.connect(g); g.connect(fxOut()); o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.05);
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
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.08);
    } catch (e) {}
  }
  // ---- The Final Chase: a nervous heartbeat under everything, eerie wails now and then, and a chomp ----

  // A mysterious loop (Where the Hell Is Edgar?'s story): a slow detective walk in D minor. Plucked bass, a soft pad,
  // a music-box melody with an echo, and a quiet tick-tock. keep(): checked all the time; once it says no, it fades out.
  var myT = null, myOut = null, myStep = 0, myNext = 0, myKeep = null;
  var MY_BARS = [[38, [62, 65, 69]], [34, [62, 65, 70]], [31, [62, 67, 70]], [33, [61, 64, 67]]];
  var MY_MEL = [74, null, null, 77, null, 76, null, null, 72, null, null, null, 70, null, 69, null, 70, null, 74, null, null, 72, null, null, 73, null, null, null, null, null, 69, null];
  var MY_E = 60 / 76 / 2;   // (an eighth at 76 bpm)
  function myTone(type, f, t, len, v, cut, att) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cut || 2000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (att || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); lp.connect(g); g.connect(myOut); o.start(t); o.stop(t + len + 0.05);
  }
  function mySched(i, t) {
    var bar = Math.floor(i / 8) % 4, e = i % 8, ch = MY_BARS[bar], r = ch[0];
    if (e === 0 || e === 3 || e === 4 || e === 6) myTone('triangle', hz(r + [0, 0, 0, 7, 12, 0, 7, 0][e] + 12), t, 0.32, 0.16, 700);   // the plucked bass
    if (e === 0) ch[1].forEach(function (n) { myTone('sine', hz(n - 12), t, MY_E * 8.5, 0.03, 900, 0.6); });   // the pad
    var m = MY_MEL[i % 32]; if (m != null && Math.floor(i / 32) % 2 === 1) { myTone('sine', hz(m), t, 1.4, 0.07, 5000); myTone('sine', hz(m) * 2.01, t, 0.6, 0.015, 6000); }   // the music box (every other time round)
    if (e % 2 === 0) { if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1; }
      var sn = ctx.createBufferSource(), ng = ctx.createGain(), bf = ctx.createBiquadFilter(); sn.buffer = noiseBuf; bf.type = 'bandpass'; bf.frequency.value = e % 4 === 0 ? 2600 : 1900; bf.Q.value = 8;
      ng.gain.setValueAtTime(0.09, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); sn.connect(bf); bf.connect(ng); ng.connect(myOut); sn.start(t); sn.stop(t + 0.05); }   // tick… tock…
  }
  function mystery(on, keep) {
    if (!on) { if (myT) { clearInterval(myT); myT = null; try { var o = myOut; o.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(function () { try { o.disconnect(); } catch (e) {} }, 2500); } catch (e) {} myOut = null; } return; }
    if (myT || !ac()) return;
    try {
      myKeep = keep || null;
      myOut = ctx.createGain(); myOut.gain.value = 0.0001; myOut.gain.setTargetAtTime(Math.max(0.0001, 0.9 * vol.music), ctx.currentTime, 0.15);
      var dl = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(); dl.delayTime.value = MY_E * 1.5; fb.gain.value = 0.32; wet.gain.value = 0.35;   // an echo, for the mystery
      myOut.connect(ctx.destination); myOut.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(ctx.destination);
      myStep = 0; myNext = ctx.currentTime + 0.1;
      myT = setInterval(function () {
        if (myKeep && !myKeep()) { mystery(false); return; }
        if (muted) return;
        while (myNext < ctx.currentTime + 0.3) { mySched(myStep, myNext); myStep++; myNext += MY_E; }
      }, 80);
    } catch (e) {}
  }

  // Floating in space (Zero Gravity's intro): slow shimmering pads, a deep drone and twinkling high notes with a long echo.
  var spT = null, spOut = null, spStep = 0, spNext = 0, spKeep = null, SP_E = 0.5;
  var SP_CH = [[45, [57, 64, 69, 71]], [41, [53, 60, 65, 69]], [43, [55, 62, 67, 71]], [40, [52, 59, 64, 67]]];
  var SP_TW = [81, 88, 83, 86, 79, 84, 88, 91];
  function spTone(type, f, t, att, len, v, cut, det) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; if (det) o.detune.value = det; lp.type = 'lowpass'; lp.frequency.value = cut || 2000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); lp.connect(g); g.connect(spOut); o.start(t); o.stop(t + len + 0.1);
  }
  function spSched(i, t) {
    var bar = Math.floor(i / 8) % 4, e = i % 8, ch = SP_CH[bar];
    if (e === 0) { spTone('sine', hz(ch[0]), t, 1.2, 4.2, 0.16, 400); ch[1].forEach(function (n, k) { spTone('sawtooth', hz(n), t, 1.6, 4.4, 0.014, 900 + k * 150, (k % 2 ? 7 : -7)); spTone('sine', hz(n), t, 1.4, 4.2, 0.03, 3000); }); }   // a slow pad and a deep drone
    if (e % 2 === 1 || Math.random() < 0.3) { var tw = SP_TW[(i * 5 + bar) % SP_TW.length]; spTone('sine', hz(tw), t, 0.01, 1.4, 0.05, 9000); spTone('triangle', hz(tw) * 2, t, 0.01, 0.5, 0.008, 9000); }   // twinkling stars
  }
  function space(on, keep) {
    if (!on) { if (spT) { clearInterval(spT); spT = null; try { var o = spOut; o.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); setTimeout(function () { try { o.disconnect(); } catch (e) {} }, 3000); } catch (e) {} spOut = null; } return; }
    if (spT || !ac()) return;
    try {
      spKeep = keep || null;
      spOut = ctx.createGain(); spOut.gain.value = 0.0001; spOut.gain.setTargetAtTime(Math.max(0.0001, 0.9 * vol.music), ctx.currentTime, 0.6);
      var dl = ctx.createDelay(1.5), fb = ctx.createGain(), wet = ctx.createGain(); dl.delayTime.value = 0.75; fb.gain.value = 0.45; wet.gain.value = 0.4;   // a long space echo
      spOut.connect(ctx.destination); spOut.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(ctx.destination);
      spStep = 0; spNext = ctx.currentTime + 0.1;
      spT = setInterval(function () {
        if (spKeep && !spKeep()) { space(false); return; }
        if (muted) return;
        while (spNext < ctx.currentTime + 0.4) { spSched(spStep, spNext); spStep++; spNext += SP_E; }
      }, 100);
    } catch (e) {}
  }

  // A cheerful fairground-organ loop (Sja-la-lie's intro): oom-pah bass, bright chords, a bouncy glockenspiel tune.
  var chT = null, chOut = null, chStep = 0, chNext = 0, chKeep = null, CH_E = 60 / 132 / 2;
  var CH_BARS = [[48, [64, 67, 72]], [53, [65, 69, 72]], [43, [62, 67, 71]], [48, [64, 67, 72]]];
  var CH_MEL = [76, 79, 81, 79, 76, null, 72, null, 77, 81, 84, 81, 77, null, 74, null, 74, 77, 79, 77, 74, 71, 67, null, 72, 76, 79, 76, 72, null, null, null];
  function chTone(type, f, t, len, v, cut) {
    var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cut || 3000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); lp.connect(g); g.connect(chOut); o.start(t); o.stop(t + len + 0.05);
  }
  function chSched(i, t) {
    var bar = Math.floor(i / 8) % 4, e = i % 8, ch = CH_BARS[bar];
    if (e % 2 === 0) chTone('triangle', hz(ch[0] + (e % 4 === 0 ? 0 : 7)), t, 0.22, 0.2, 900);   // oom…
    else ch[1].forEach(function (n) { chTone('square', hz(n), t, 0.12, 0.028, 2200); });   // …pah
    var m = CH_MEL[i % 32]; if (m != null) { chTone('sine', hz(m), t, 0.35, 0.09, 6000); chTone('sine', hz(m) * 3, t, 0.12, 0.012, 8000); }   // the glockenspiel
  }
  function cheer(on, keep) {
    if (!on) { if (chT) { clearInterval(chT); chT = null; try { var o = chOut; o.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25); setTimeout(function () { try { o.disconnect(); } catch (e) {} }, 1500); } catch (e) {} chOut = null; } return; }
    if (chT || !ac()) return;
    try {
      chKeep = keep || null; chOut = ctx.createGain(); chOut.gain.value = 0.0001; chOut.gain.setTargetAtTime(Math.max(0.0001, 0.8 * vol.music), ctx.currentTime, 0.1); chOut.connect(ctx.destination);
      chStep = 0; chNext = ctx.currentTime + 0.08;
      chT = setInterval(function () {
        if (chKeep && !chKeep()) { cheer(false); return; }
        if (muted) return;
        while (chNext < ctx.currentTime + 0.3) { chSched(chStep, chNext); chStep++; chNext += CH_E; }
      }, 80);
    } catch (e) {}
  }

  function laser() {   // pew: a fast falling zap
    if (!ac()) return;
    try {
      var t = ctx.currentTime + .01;
      [0, .09].forEach(function (d, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(); o.type = i ? 'square' : 'sawtooth';
        o.frequency.setValueAtTime(2200 - i * 400, t + d); o.frequency.exponentialRampToValueAtTime(140, t + d + .38);
        g.gain.setValueAtTime(.0001, t + d); g.gain.exponentialRampToValueAtTime(.16, t + d + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d + .4);
        o.connect(g); g.connect(fxOut()); o.start(t + d); o.stop(t + d + .42);
      });
    } catch (e) {}
  }
  function ac() {
    if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function thump(t, f, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.25);
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
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(fxOut()); o.start(); o2.start(); lfo.start();
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
      o.connect(f); f.connect(g); g.connect(fxOut()); o.start(t); v.start(t); o.stop(t + len + 0.05); v.stop(t + len + 0.05);
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();
      s.buffer = noiseBuf; s.loop = true; nf.type = 'bandpass'; nf.frequency.setValueAtTime(400, t); nf.frequency.exponentialRampToValueAtTime(2400, t + 1.2); nf.Q.value = 2;
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.06, t + 0.8); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      s.connect(nf); nf.connect(ng); ng.connect(fxOut()); s.start(t); s.stop(t + 1.7);
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
        o.connect(g); g.connect(fxOut()); o.start(t + d); o.stop(t + d + 0.22);
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
      o.connect(f); o2.connect(f); f.connect(g); g.connect(fxOut());
      [o, o2, v].forEach(function (x) { x.start(t); x.stop(t + len + 0.05); });
    } catch (e) {}
  }
  // The monster wheel: a dark tick (a low, hollow knock with a dissonant metal ring) and a demonic hit when it lands
  function darkTick(n) {
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01, f0 = 110 + ((n || 0) % 3) * 6;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.24);
      [311, 440].forEach(function (f) {   // a tritone apart: the "devil's interval"
        var m = ctx.createOscillator(), mg = ctx.createGain(), bp = ctx.createBiquadFilter();
        m.type = 'square'; m.frequency.value = f; bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
        mg.gain.setValueAtTime(0.0001, t); mg.gain.exponentialRampToValueAtTime(0.035, t + 0.004); mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        m.connect(bp); bp.connect(mg); mg.connect(fxOut()); m.start(t); m.stop(t + 0.2);
      });
    } catch (e) {}
  }
  // While the monster wheel spins: a dark, rising drone (low detuned voices and a rumble), ending as it lands
  // Rules the World: two dancers bump into each other (a soft body thud with a cartoon "bonk"), the dizzy
  // twirl of the stun, and the sparkling star (picked up, and smashing into someone with it)
  function bonk() {
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      var o = ctx.createOscillator(), g = ctx.createGain();   // the thud
      o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.2);
      var b = ctx.createOscillator(), bg = ctx.createGain();   // the bonk: a hollow, wobbling pitch drop
      b.type = 'triangle'; b.frequency.setValueAtTime(620, t + 0.01); b.frequency.exponentialRampToValueAtTime(240, t + 0.16);
      var w = ctx.createOscillator(), wg = ctx.createGain(); w.frequency.value = 28; wg.gain.value = 40; w.connect(wg); wg.connect(b.frequency);
      bg.gain.setValueAtTime(0.0001, t + 0.01); bg.gain.exponentialRampToValueAtTime(0.3, t + 0.02); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      b.connect(bg); bg.connect(fxOut()); [b, w].forEach(function (x) { x.start(t + 0.01); x.stop(t + 0.32); });
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();   // the slap of the impact
      s.buffer = noiseBuf; nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
      ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(nf); nf.connect(ng); ng.connect(fxOut()); s.start(t); s.stop(t + 0.06);
    } catch (e) {}
  }
  function dizzy() {   // little birds circling: a fast, high warble that slowly sinks
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.2;
      [0, 1].forEach(function (k) {
        var o = ctx.createOscillator(), g = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(1900 + k * 500, t); o.frequency.exponentialRampToValueAtTime(1100 + k * 300, t + 1.1);
        l.frequency.value = 11 + k * 3; lg.gain.value = 260; l.connect(lg); lg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05); g.gain.setValueAtTime(0.05, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
        o.connect(g); g.connect(fxOut()); [o, l].forEach(function (x) { x.start(t); x.stop(t + 1.2); });
      });
    } catch (e) {}
  }
  function starGet() {   // a bright, rising sparkle
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      [72, 76, 79, 84, 88, 91, 96].forEach(function (m, i) {
        var o = ctx.createOscillator(), g = ctx.createGain(), at = t + i * 0.055;
        o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = hz(m);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.16, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        o.connect(g); g.connect(fxOut()); o.start(at); o.stop(at + 0.55);
      });
      for (var k = 0; k < 10; k++) (function (at) { var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 3000 + Math.random() * 3000; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.05, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12); o.connect(g); g.connect(fxOut()); o.start(at); o.stop(at + 0.14); })(t + 0.35 + Math.random() * 0.7);
    } catch (e) {}
  }
  function starRun(ms) {   // while the star lasts: a fast, bright, twinkling run of notes going round and round
    if (!ac()) return;
    try {
      var t0 = ctx.currentTime + 0.02, end = t0 + (ms || 5000) / 1000, step = 0.075, seq = [72, 76, 79, 84, 79, 76, 74, 77, 81, 86, 81, 77], i = 0;
      for (var t = t0; t < end; t += step, i++) {
        var o = ctx.createOscillator(), g = ctx.createGain(), m = seq[i % seq.length] + (Math.floor(i / seq.length) % 2 ? 2 : 0), fade = Math.min(1, (end - t) / 0.6);
        o.type = i % 2 ? 'square' : 'triangle'; o.frequency.value = hz(m);
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045 * fade + 0.0002, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.9);
        o.connect(lp); lp.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + step);
      }
    } catch (e) {}
  }
  function loopClose() {   // a loop closed: a loud rising sweep into a bright chord with a sparkle on top
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1760, t + 0.35);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(5000, t + 0.35);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(lp); lp.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.45);
      [72, 76, 79, 84, 88].forEach(function (m, i) {
        var a = ctx.createOscillator(), b = ctx.createOscillator(), ag = ctx.createGain(), at = t + 0.33 + i * 0.03;
        a.type = 'square'; b.type = 'triangle'; a.frequency.value = hz(m); b.frequency.value = hz(m) * 1.005;
        var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3500;
        ag.gain.setValueAtTime(0.0001, at); ag.gain.exponentialRampToValueAtTime(0.12, at + 0.01); ag.gain.setValueAtTime(0.12, at + 0.25); ag.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        a.connect(f); b.connect(f); f.connect(ag); ag.connect(fxOut()); a.start(at); b.start(at); a.stop(at + 0.95); b.stop(at + 0.95);
      });
      for (var k = 0; k < 12; k++) (function (at) { var s2 = ctx.createOscillator(), sg = ctx.createGain(); s2.type = 'sine'; s2.frequency.value = 2500 + Math.random() * 3500; sg.gain.setValueAtTime(0.0001, at); sg.gain.exponentialRampToValueAtTime(0.07, at + 0.004); sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.15); s2.connect(sg); sg.connect(fxOut()); s2.start(at); s2.stop(at + 0.17); })(t + 0.4 + Math.random() * 0.8);
    } catch (e) {}
  }
  function starHit() {   // smashing into someone with the star: a punchy "pow" with a sparkle
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.22);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(lp); lp.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.27);
      [88, 91, 96].forEach(function (m, i) { var a = ctx.createOscillator(), ag = ctx.createGain(), at = t + 0.08 + i * 0.05; a.type = 'sine'; a.frequency.value = hz(m); ag.gain.setValueAtTime(0.0001, at); ag.gain.exponentialRampToValueAtTime(0.1, at + 0.006); ag.gain.exponentialRampToValueAtTime(0.0001, at + 0.3); a.connect(ag); ag.connect(fxOut()); a.start(at); a.stop(at + 0.32); });
    } catch (e) {}
    bonk();
  }
  function darkDrone(len) {
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02, L = len || 6;
      [[33, 1], [34, 0.7], [40, 0.6], [45, 0.35]].forEach(function (n) {   // a low cluster: root, minor second, fifth-ish, octave
        var a = ctx.createOscillator(), b = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        a.type = 'sawtooth'; b.type = 'sawtooth'; a.frequency.setValueAtTime(hz(n[0]), t); b.frequency.setValueAtTime(hz(n[0]) * 1.008, t);
        a.frequency.exponentialRampToValueAtTime(hz(n[0] + 3), t + L); b.frequency.exponentialRampToValueAtTime(hz(n[0] + 3) * 1.008, t + L);   // (slowly rising: the tension builds)
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(180, t); lp.frequency.exponentialRampToValueAtTime(900, t + L); lp.Q.value = 4;
        lfo.frequency.value = 0.3 + Math.random() * 0.4; lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency);   // (a slow, breathing wobble)
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * n[1], t + 1.2); g.gain.setValueAtTime(0.05 * n[1], t + L - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + L + 0.2);
        a.connect(lp); b.connect(lp); lp.connect(g); g.connect(fxOut());
        [a, b, lfo].forEach(function (x) { x.start(t); x.stop(t + L + 0.3); });
      });
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();   // a deep rumble underneath
      s.buffer = noiseBuf; s.loop = true; nf.type = 'lowpass'; nf.frequency.value = 120;
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.35, t + L * 0.8); ng.gain.exponentialRampToValueAtTime(0.0001, t + L + 0.2);
      s.connect(nf); nf.connect(ng); ng.connect(fxOut()); s.start(t); s.stop(t + L + 0.3);
    } catch (e) {}
  }
  function darkHit() {
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.02;
      // a deep boom
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 1.65);
      // a low, detuned, dissonant chord (root, minor second, tritone) that swells and sinks
      [[36, 0], [37, 0.12], [42, 0.06], [48, -0.1]].forEach(function (n) {
        var a = ctx.createOscillator(), b = ctx.createOscillator(), cg = ctx.createGain(), lp = ctx.createBiquadFilter();
        a.type = 'sawtooth'; b.type = 'sawtooth'; a.frequency.value = hz(n[0]); b.frequency.value = hz(n[0]) * 1.012; a.detune.value = n[1] * 100;
        a.frequency.exponentialRampToValueAtTime(hz(n[0]) * 0.8, t + 2.4); b.frequency.exponentialRampToValueAtTime(hz(n[0]) * 0.81, t + 2.4);
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(220, t + 2.4);
        cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.07, t + 0.08); cg.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        a.connect(lp); b.connect(lp); lp.connect(cg); cg.connect(fxOut()); a.start(t); b.start(t); a.stop(t + 2.65); b.stop(t + 2.65);
      });
      // a dark gong-like noise wash
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();
      s.buffer = noiseBuf; s.loop = true; nf.type = 'bandpass'; nf.frequency.setValueAtTime(700, t); nf.frequency.exponentialRampToValueAtTime(150, t + 2); nf.Q.value = 2;
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.3, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      s.connect(nf); nf.connect(ng); ng.connect(fxOut()); s.start(t); s.stop(t + 2.25);
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
      s.connect(f); f.connect(g); g.connect(fxOut()); s.start(t); s.stop(t + 1.35);
      for (var k = 0; k < 6; k++) (function (at) { var c2 = ctx.createBufferSource(), cg = ctx.createGain(), cf = ctx.createBiquadFilter(); c2.buffer = noiseBuf; cf.type = 'highpass'; cf.frequency.value = 1600; cg.gain.setValueAtTime(0.3, at); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.06); c2.connect(cf); cf.connect(cg); cg.connect(fxOut()); c2.start(at); c2.stop(at + 0.08); })(t + 0.05 + Math.random() * 0.9);
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
      s.connect(f); f.connect(g); g.connect(fxOut()); s.start(t); s.stop(t + 0.8);
    } catch (e) {}
  }
  // Hold That Note: the diva's high note (a sung "aah": a buzzy tone through two vowel formants, with vibrato),
  // held until it is cut off; then the cut itself, a crackle and a falling glitch.
  var divaV = null;
  function diva(on) {
    if (divaV) { try { var v = divaV; v.g.gain.cancelScheduledValues(ctx.currentTime); v.g.gain.setValueAtTime(v.g.gain.value, ctx.currentTime); v.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.04); setTimeout(function () { try { v.o.stop(); v.o2.stop(); v.lfo.stop(); } catch (e) {} }, 120); } catch (e) {} divaV = null; }
    if (!on || !ac()) return;
    try {
      var t = ctx.currentTime + 0.02, f0 = 880;
      var o = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      var f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), mix = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'triangle'; o.frequency.setValueAtTime(f0 * 0.94, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.35); o2.frequency.value = f0 * 2;
      lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + 1.6);   // the vibrato comes in after the attack
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      f1.type = 'bandpass'; f1.frequency.value = 1050; f1.Q.value = 5; f2.type = 'bandpass'; f2.frequency.value = 2900; f2.Q.value = 7;
      var og2 = ctx.createGain(); og2.gain.value = 0.25;
      o.connect(f1); o.connect(f2); o2.connect(og2); og2.connect(mix); f1.connect(mix); f2.connect(mix); mix.connect(g); g.connect(fxOut());
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.45); g.gain.linearRampToValueAtTime(0.45, t + 12);
      o.start(t); o2.start(t); lfo.start(t);
      divaV = { o: o, o2: o2, lfo: lfo, g: g };
    } catch (e) {}
  }
  function zap() {   // the note is cut: crackle and a falling glitch
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      var crackle = function (at, len, vol, hp) {   // (through the effects volume, not the menu music)
        var n = ctx.sampleRate * len, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0); for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.2);
        var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gg = ctx.createGain(); src.buffer = buf; f.type = 'highpass'; f.frequency.value = hp;
        gg.gain.setValueAtTime(vol, at); gg.gain.exponentialRampToValueAtTime(0.0001, at + len); src.connect(f); f.connect(gg); gg.connect(fxOut()); src.start(at); src.stop(at + len + 0.02);
      };
      crackle(t, 0.35, 0.5, 1500); crackle(t + 0.12, 0.2, 0.35, 3000);
      var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.5);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55); o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.6);
    } catch (e) {}
  }
  function micdrop() {   // she drops her microphone: a thud, a clatter, and a squeal of feedback
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01, out = fxOut();
      var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
      [0.08, 0.2, 0.29].forEach(function (d, i) { var c = ctx.createOscillator(), cg = ctx.createGain(); c.type = 'square'; c.frequency.value = 520 - i * 90; cg.gain.setValueAtTime(0.12 / (i + 1), t + d); cg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.06); c.connect(cg); cg.connect(out); c.start(t + d); c.stop(t + d + 0.08); });
      // static: a hiss of white noise that crackles and fades, like a sound system breaking down
      var len = 1.8, n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var k = 0; k < n; k++) { var crack = Math.random() < 0.002 ? 1 : 0; d[k] = (Math.random() * 2 - 1) * (0.55 + 0.45 * Math.sin(k / ctx.sampleRate * 2 * Math.PI * 11)) + (crack ? (Math.random() < 0.5 ? -1 : 1) : 0); }
      var st = ctx.createBufferSource(), sf = ctx.createBiquadFilter(), sg = ctx.createGain(); st.buffer = buf; sf.type = 'bandpass'; sf.frequency.value = 3000; sf.Q.value = 0.6;
      sg.gain.setValueAtTime(0.0001, t + 0.02); sg.gain.exponentialRampToValueAtTime(0.32, t + 0.08); sg.gain.setValueAtTime(0.32, t + 0.9); sg.gain.exponentialRampToValueAtTime(0.0001, t + len);
      st.connect(sf); sf.connect(sg); sg.connect(out); st.start(t + 0.02); st.stop(t + len + 0.05);
      var f = ctx.createOscillator(), fg = ctx.createGain(); f.type = 'sine'; f.frequency.setValueAtTime(2600, t + 0.35); f.frequency.linearRampToValueAtTime(3100, t + 1.2);
      fg.gain.setValueAtTime(0.0001, t + 0.35); fg.gain.exponentialRampToValueAtTime(0.08, t + 0.6); fg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3); f.connect(fg); fg.connect(out); f.start(t + 0.35); f.stop(t + 1.35);
    } catch (e) {}
  }
  // A snare drum roll that swells for ms milliseconds (the end of a count), then a cymbal crash. roll(false) stops it.
  var rollT = null;
  function roll(on, ms) {
    clearTimeout(rollT); rollT = null; if (rollG) { try { rollG.gain.cancelScheduledValues(0); rollG.gain.value = 0; } catch (e) {} rollG = null; }
    if (!on || !ac()) return;
    try {
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var t0 = ctx.currentTime + 0.02, len = Math.max(0.5, (ms || 3000) / 1000), G = ctx.createGain(); G.gain.setValueAtTime(0.05, t0); G.gain.linearRampToValueAtTime(0.32, t0 + len); G.connect(fxOut()); rollG = G;
      for (var t = 0; t < len; t += 0.045) { var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(); s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = .7; g.gain.setValueAtTime(t % 0.09 < 0.045 ? 1 : 0.7, t0 + t); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.06); s.connect(f); f.connect(g); g.connect(G); s.start(t0 + t, Math.random() * 0.2); s.stop(t0 + t + 0.07); }
      rollT = setTimeout(function () { rollT = null; rollG = null; crash(); }, len * 1000);
    } catch (e) {}
  }
  var rollG = null;
  function climb(fr, vol) {   // a counting blip that climbs: fr from 0 to 1 (up an octave and a half)
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain(), f = 420 * Math.pow(2, Math.max(0, Math.min(1, fr)) * 1.5);
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.06);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28 * (vol > 0 ? vol : 1), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 0.14);
    } catch (e) {}
  }
  function crash() {   // a cymbal crash (and a low boom under it)
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(), n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = n.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
      s.buffer = n; f.type = 'highpass'; f.frequency.value = 3500; g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      s.connect(f); f.connect(g); g.connect(fxOut()); s.start(t); s.stop(t + 1.9); thump(t, 110, 0.5);
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
        o.connect(f); f.connect(g); g.connect(fxOut()); o.start(t + n[1]); o.stop(t + n[1] + 0.22);
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
      o.connect(f); f.connect(g); g.connect(fxOut()); o.start(t); v.start(t); o.stop(t + 1.75); v.stop(t + 1.75);
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
      o.connect(f); f.connect(g); g.connect(fxOut()); o.start(t); o.stop(t + 1);
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      for (var k = 0; k < 14; k++) (function (at, len, vol) {
        var s = ctx.createBufferSource(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
        s.buffer = noiseBuf; sf.type = 'highpass'; sf.frequency.value = 2500 + Math.random() * 3000;
        sg.gain.setValueAtTime(vol, at); sg.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(sf); sf.connect(sg); sg.connect(fxOut()); s.start(at, Math.random() * 0.2); s.stop(at + len + 0.01);
      })(t + Math.pow(Math.random(), 1.6) * 0.8, 0.015 + Math.random() * 0.05, 0.2 + Math.random() * 0.35);
      var z = ctx.createOscillator(), zg = ctx.createGain();   // a final zap
      z.type = 'square'; z.frequency.setValueAtTime(1800, t + 0.05); z.frequency.exponentialRampToValueAtTime(120, t + 0.3);
      zg.gain.setValueAtTime(0.0001, t + 0.05); zg.gain.exponentialRampToValueAtTime(0.12, t + 0.06); zg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      z.connect(zg); zg.connect(fxOut()); z.start(t + 0.05); z.stop(t + 0.34);
    } catch (e) {}
  }
  function soft() {   // a gentle two-note chime, for the answer in the chase
    if (!ac()) return;
    try {
      var t = ctx.currentTime + 0.01;
      [[587, 0], [880, 0.09]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]); g.gain.exponentialRampToValueAtTime(0.05, t + n[1] + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.5);
        o.connect(g); g.connect(fxOut()); o.start(t + n[1]); o.stop(t + n[1] + 0.55);
      });
    } catch (e) {}
  }
  function stepSnd() { if (!ac()) return; try { var t = ctx.currentTime + 0.01; thump(t, 160, 0.18); } catch (e) {} }
  function setVol(k, v) {
    vol[k] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('esc-vol', JSON.stringify(vol)); } catch (e) {}
    try { if (fxNode) fxNode.gain.value = vol.fx; if (playing && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(musicLevel(), ctx.currentTime); } if (loopNode && loopGain) { loopGain.gain.cancelScheduledValues(ctx.currentTime); loopGain.gain.setValueAtTime(loopLevel(), ctx.currentTime); } } catch (e) {}
    if (window.onVolume) window.onVolume(vol);
  }
  return { loopClose: loopClose, starRun: starRun, bonk: bonk, dizzy: dizzy, starGet: starGet, starHit: starHit, darkDrone: darkDrone, darkTick: darkTick, darkHit: darkHit, roll: roll, crash: crash, climb: climb, space: space, laser: laser, cheer: cheer, mystery: mystery, vol: vol, setVol: setVol, dread: dread, creep: creep, chomp: chomp, soft: soft, scream: scream, short: short, woosh: woosh, buzz: buzz, defeat: defeat, crumble: crumble, step: stepSnd, blip: blip, talk: talk, diva: diva, zap: zap, micdrop: micdrop, plop: plop, clock: clock, snap: snap, ding: ding, douze: douze, ping: ping, menuOn: function () { return !muted; }, setMenu: function (on) { muted = !on; try { localStorage.setItem('esc-music', muted ? '0' : '1'); } catch (x) {} if (muted) stop(); else start(); draw(); }, useLoop: function (src, len) { loopSrc = src || ''; loopLen = +len || 0; }, loopReset: function () { loopAt = 0; }, want: function (on, synth) { on = !!on; synth = !!synth; if (on === wanted && (!on || synth === wantSynth)) return; if (on && wanted) stop(); wanted = on; wantSynth = synth; if (on) start(); else stop(); draw(); } };
})();
