(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CLIP = 10;            // seconden fragment
  var room = '', net, songs = [], countries = {};
  var players = {};         // pid -> {pid,name,score,got,pts,last}
  var G = { phase: 'lobby', round: 0, total: 10, guessMs: 30000, endsAt: 0, song: null, used: {}, pool: [], showVideo: true };
  var yt = null, ytReady = false, clipStart = 0, stage = 'idle', poll = null, watchdog = null, endTimer = null, fails = 0;

  // ---------- kamer ----------
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (var i = 0; i < 4; i++) room += A[Math.floor(Math.random() * A.length)];
  var joinUrl = new URL('./?k=' + room, location.href).href;
  $('roomcode').textContent = room; $('codebig').textContent = room;
  $('joinurl').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\?k=.*$/, '');
  $('joinhint').textContent = joinUrl.replace(/^https?:\/\//, '').replace(/\?k=.*$/, '');
  try { var q = qrcode(0, 'M'); q.addData(joinUrl); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { $('qr').classList.add('hidden'); }

  net = escConnect(room);
  $('demo').classList.toggle('hidden', !net.demo);
  net.on('hi', function (m) {
    if (!m || !m.pid) return;
    var p = players[m.pid], isNew = !p;
    var nm = String(m.name || '').slice(0, 16) || 'Speler';
    if (!p) p = players[m.pid] = { pid: m.pid, name: nm, score: 0, got: false, pts: 0 };
    var changed = isNew || p.name !== nm || p.off;
    p.name = nm; p.last = Date.now(); p.off = false;
    if (changed) push();
  });
  net.on('guess', function (m) {
    var p = m && players[m.pid];
    if (!p || G.phase !== 'guess' || p.got) return;
    var res = Match.check(m.text, G.song[3]);
    if (res === 'ok') {
      var frac = Math.max(0, (G.endsAt - Date.now()) / G.guessMs);
      p.pts = Math.round((500 + 500 * frac) / 10) * 10; p.score += p.pts; p.got = true;
    }
    net.send('result', { pid: p.pid, res: res });
    if (res === 'ok') {
      push();
      var act = list().filter(function (x) { return !x.off; });
      if (act.length && act.every(function (x) { return x.got; })) setTimeout(function () { if (G.phase === 'guess') reveal(); }, 900);
    }
  });

  function list() { return Object.keys(players).map(function (k) { return players[k]; }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); }); }
  function snapshot() {
    var s = { phase: G.phase, round: G.round, total: G.total, total_ms: G.guessMs, left: Math.max(0, G.endsAt - Date.now()),
      players: list().map(function (p) { return { pid: p.pid, name: p.name, score: p.score, got: p.got, pts: p.pts }; }) };
    if ((G.phase === 'reveal' || G.phase === 'end') && G.song) s.reveal = { year: G.song[0], code: G.song[1], artist: G.song[2], title: G.song[3] };
    return s;
  }
  function push() { net.send('state', snapshot()); render(); }
  setInterval(function () {
    var now = Date.now(), ch = false;
    list().forEach(function (p) { var off = now - p.last > 12000; if (off !== !!p.off) { p.off = off; ch = true; } });
    net.send('state', snapshot()); if (ch) render();
  }, 3000);

  // ---------- weergave ----------
  function show(id) { ['v-lobby', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }
  function boardHtml(showGot) {
    return list().map(function (p) {
      return '<li class="' + (showGot && p.got ? 'got ' : '') + (p.off ? 'off' : '') + '"><span>' + esc(p.name) + '</span><span>' + p.score +
        (showGot && p.got ? '<span class="pts">+' + p.pts + '</span>' : '') + '</span></li>';
    }).join('') || '<li class="mute">Nog geen spelers</li>';
  }
  function render() {
    var ps = list();
    $('players').innerHTML = ps.map(function (p) { return '<span class="chip' + (p.off ? ' off' : '') + '">' + esc(p.name) + '</span>'; }).join('') || '<span class="mute">Wachten op spelers…</span>';
    $('pcount').textContent = ps.length ? '(' + ps.length + ')' : '';
    $('board').innerHTML = boardHtml(G.phase === 'guess' || G.phase === 'reveal');
    if (G.phase === 'lobby') show('v-lobby');
    else if (G.phase === 'end') {
      show('v-end');
      var top = ps[0];
      $('winner').textContent = top ? top.name + ' · ' + top.score + ' punten' : 'Niemand?!';
      $('final').innerHTML = boardHtml(false);
    } else {
      show('v-game');
      $('roundlabel').textContent = 'Ronde ' + G.round + ' / ' + G.total;
      $('guessui').classList.toggle('hidden', G.phase === 'reveal');
      $('revealui').classList.toggle('hidden', G.phase !== 'reveal');
      $('replay').disabled = $('skip').disabled = G.phase !== 'guess';
      if (G.phase === 'reveal') {
        $('rtitle').textContent = G.song[3];
        $('rmeta').textContent = G.song[2] + ' · ' + flag(G.song[1]) + ' ' + (countries[G.song[1]] || G.song[1]) + ' ' + G.song[0];
        $('next').textContent = G.round >= G.total ? 'Eindstand' : 'Volgende';
      }
    }
  }
  function cover(on, icon, text, pulse) {
    $('cover').classList.toggle('hidden', !on);
    if (on) { $('covericon').textContent = icon; $('covertext').textContent = text; $('covericon').classList.toggle('pulse', !!pulse); }
  }
  function masks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  setInterval(function () {
    if (G.phase !== 'guess') return;
    $('tbar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, (G.endsAt - Date.now()) / G.guessMs)) + ')';
  }, 100);

  // ---------- YouTube ----------
  window.onYouTubeIframeAPIReady = function () {
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () { if (stage === 'probe' || stage === 'seek') badSong(); } }
    });
  };
  var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); }

  function loadSong() {
    stopTimers();
    var free = G.pool.filter(function (s) { return !G.used[s[4]]; });
    if (!free.length) { G.used = {}; free = G.pool; }
    G.song = free[Math.floor(Math.random() * free.length)]; G.used[G.song[4]] = 1;
    stage = 'probe';
    cover(true, '♪', 'Fragment laden…', true); masks(true);
    yt.mute(); yt.loadVideoById(G.song[4]);
    watchdog = setTimeout(badSong, 12000);
    // Wacht tot de video echt speelt, spring dan naar een willekeurig punt.
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0;
      if (stage === 'probe' && st === 1 && d > 0) {
        clipStart = d < 45 ? 0 : Math.floor(15 + Math.random() * (d - 15 - 20 - CLIP));
        stage = 'seek'; yt.seekTo(clipStart, true);
      } else if (stage === 'seek' && st === 1 && t >= clipStart && t < clipStart + 5) {
        clearInterval(poll); clearTimeout(watchdog); fails = 0; beginGuess();
      }
    }, 120);
  }
  function badSong() {
    stopTimers(); fails++;
    if (fails >= 6) {
      stage = 'idle'; cover(true, '!', 'Video’s willen niet starten', false);
      $('err').textContent = 'YouTube speelt niets af. Controleer je internet of klik op “Toon antwoord” en probeer de volgende ronde.';
      G.phase = 'guess'; G.endsAt = Date.now(); push(); return;
    }
    loadSong();
  }
  function playClip() {
    clearInterval(poll);
    stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    if (G.showVideo) cover(false); else cover(true, '♪', 'Luister goed…', true);
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + CLIP) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (G.phase === 'guess') cover(true, '?', 'Welk liedje was dit?', false);
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    G.phase = 'guess'; G.endsAt = Date.now() + G.guessMs;
    playClip(); push();
    endTimer = setTimeout(reveal, G.guessMs);
  }
  function reveal() {
    if (G.phase !== 'guess') return;
    stopTimers(); G.phase = 'reveal'; stage = 'reveal';
    cover(false); masks(false);
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.playVideo(); } catch (e) {}
    push();
  }
  function startRound() {
    G.round++; G.phase = 'loading';
    list().forEach(function (p) { p.got = false; p.pts = 0; });
    push(); loadSong();
  }

  // ---------- knoppen ----------
  function ready() {
    if (!ytReady || !songs.length) return;
    $('start').disabled = false; $('start').textContent = 'Start het spel';
  }
  $('start').addEventListener('click', function () {
    var era = $('s-era').value.split('-').map(Number);
    G.pool = songs.filter(function (s) { return s[0] >= era[0] && s[0] <= era[1]; });
    G.total = +$('s-rounds').value; G.guessMs = +$('s-time').value * 1000; G.showVideo = $('s-video').checked;
    G.round = 0; G.used = {}; fails = 0;
    list().forEach(function (p) { p.score = 0; });
    startRound();
  });
  $('replay').addEventListener('click', function () { if (G.phase === 'guess' && (stage === 'paused' || stage === 'clip')) playClip(); });
  $('skip').addEventListener('click', reveal);
  $('next').addEventListener('click', function () {
    if (G.phase !== 'reveal') return;
    if (G.round >= G.total) { try { yt.stopVideo(); } catch (e) {} G.phase = 'end'; push(); } else startRound();
  });
  $('again').addEventListener('click', function () { G.phase = 'lobby'; G.round = 0; G.song = null; push(); });

  fetch('songs.json').then(function (r) { return r.json(); }).then(function (d) {
    songs = d.songs; countries = d.countries;
    $('songcount').textContent = songs.length + ' inzendingen, van 1956 t/m ' + Math.max.apply(null, songs.map(function (s) { return s[0]; })) + ', inclusief halve finales.';
    ready();
  }).catch(function () { $('start').textContent = 'Liedjes laden mislukt'; });
  render();
})();
