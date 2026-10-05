// Solo mode: one device plays the clip and takes the guesses. No room, no connection.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CLIP = 15, COUNT = 5;
  var songs = [], countries = {}, pool = [], used = {};
  var S = { phase: 'setup', round: 0, total: 10, guessMs: 30000, score: 0, right: 0, song: null, q: null, picked: -1, pickMs: 0, got: false, pts: 0, endsAt: 0, showVideo: true };
  var yt = null, ytReady = false, clipStart = 0, stage = 'idle', poll = null, watchdog = null, endTimer = null, fails = 0;
  var loadT0 = 0, loadTick = null, clipReady = false;

  function show(id) { ['v-setup', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }
  function cover(on, icon, text) { $('cover').classList.toggle('hidden', !on); if (on) { $('covericon').textContent = icon; $('covertext').textContent = text; } }
  function masks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  // The avatar is only for show in solo; the choice is remembered on this device.
  var myChar = null;
  try { myChar = localStorage.getItem('esc-solo-char'); } catch (e) {}
  if (!CHAR_BY_ID[myChar]) myChar = CHARS[Math.floor(Math.random() * CHARS.length)].id;   // a random one until you choose
  function renderChars() {
    $('chars').innerHTML = CHARS.map(function (c) {
      return '<button type="button" data-char="' + c.id + '"' + (c.id === myChar ? ' class="mine"' : '') + '>' + charSvg(c.id) + '<span>' + esc(c.name) + '</span></button>';
    }).join('');
  }
  $('chars').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-char]');
    if (!b) return;
    myChar = b.getAttribute('data-char');
    try { localStorage.setItem('esc-solo-char', myChar); } catch (err) {}
    [].forEach.call($('chars').querySelectorAll('button'), function (x) { x.classList.toggle('mine', x === b); });
    $('mychar').innerHTML = charSvg(myChar);
  });
  renderChars();
  // Name and avatar sit in one small row with an Edit button, like on the other screens.
  var myName = '';
  try { myName = localStorage.getItem('esc-name') || ''; } catch (e) {}
  function who() { return myName || 'Player'; }
  function profile() { $('mychar').innerHTML = charSvg(myChar); $('myname').textContent = who(); }
  function pickOpen(on) {
    $('pickbox').classList.toggle('hidden', !on); $('changechar').classList.toggle('hidden', on);
    if (on) { $('editname').value = myName; }
  }
  function pickSave() {
    var n = $('editname').value.trim().slice(0, 16);
    if (n) { myName = n; try { localStorage.setItem('esc-name', n); } catch (e) {} }
    profile(); pickOpen(false);
  }
  $('changechar').addEventListener('click', function () { pickOpen(true); });
  $('pickdone').addEventListener('click', pickSave);
  $('editname').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pickSave(); } });
  profile();
  function hud() { $('hud').innerHTML = S.phase === 'setup' ? '' : charSvg(myChar) + '<span><b>' + esc(who()) + '</b><br>' + esc('Song ' + S.round + ' / ' + S.total + ' · ' + S.score + ' points') + '</span>'; }
  function bestKey() { return 'esc-solo-best3-' + [S.total, S.guessMs, $('s-era').value, $('s-cat').value, $('s-atype').value, $('s-subject').value, $('s-scoring').value].join('|'); }
  function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

  function ready() {
    if (!songs.length) return;
    pool = poolFor(songs, $('s-era').value, $('s-cat').value);
    S.total = +$('s-rounds').value; S.guessMs = +$('s-time').value * 1000;
    $('songcount').textContent = pool.length ? pool.length + ' songs in this selection.'
      : 'No songs match this combination. Semi-finals only started in 2004, so there are no non-qualifiers before that.';
    var b = getBest(); $('best').textContent = b ? 'Your best with these settings: ' + b + ' points.' : '';
    $('start').disabled = !(ytReady && pool.length);
    $('start').textContent = ytReady ? 'Start' : 'Loading player…';
  }
  function scoreHelp() { $('scorehelp').textContent = SCORING_HELP[$('s-scoring').value] || ''; }
  $('s-scoring').addEventListener('change', scoreHelp); scoreHelp();
  ['s-era', 's-cat', 's-rounds', 's-time', 's-atype', 's-subject', 's-scoring'].forEach(function (id) { $(id).addEventListener('change', ready); });

  window.onYouTubeIframeAPIReady = function () {
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () { if (stage === 'probe' || stage === 'seek') { if (S.song) markBad(S.song[4]); badSong(); } } }
    });
  };
  var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); }
  function countStop() { clearInterval(loadTick); loadT0 = 0; }
  function countStart() {
    clipReady = false;
    if (loadT0) return;
    loadT0 = Date.now(); clearInterval(loadTick);
    var draw = function () {
      var left = COUNT - Math.floor((Date.now() - loadT0) / 1000);
      if (left >= 1) { $('covericon').textContent = left; $('covertext').textContent = 'Selecting song'; }
      else if (clipReady) { countStop(); beginGuess(); }
      else { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }
    };
    draw(); loadTick = setInterval(draw, 100);
  }
  function loadSong() {
    stopTimers();
    var free = pool.filter(function (s) { return !used[s[4]]; });
    if (!free.length) { used = {}; free = pool; }
    S.song = free[Math.floor(Math.random() * free.length)]; used[S.song[4]] = 1;
    S.q = makeQuestion(S.song, $('s-subject').value, $('s-atype').value, songs, countries); S.picked = -1;
    stage = 'probe';
    cover(true, '', 'Selecting song'); countStart(); masks(true);
    yt.mute(); yt.loadVideoById(S.song[4]);
    watchdog = setTimeout(badSong, 12000);
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0;
      if (stage === 'probe' && st === 1 && d > 0) {
        clipStart = d < 45 ? 0 : Math.floor(15 + Math.random() * (d - 15 - 20 - CLIP));
        stage = 'seek'; yt.seekTo(clipStart, true);
      } else if (stage === 'seek' && st === 1 && t >= clipStart && t < clipStart + 5) {
        clearInterval(poll); clearTimeout(watchdog); fails = 0;
        yt.pauseVideo(); stage = 'ready'; clipReady = true;
      }
    }, 120);
  }
  function badSong() {
    stopTimers(); fails++;
    if (fails >= 6) {
      stage = 'idle'; countStop(); cover(true, '!', 'Videos won’t start');
      $('err').textContent = 'YouTube isn’t playing anything. Check your connection and try again.';
      S.phase = 'guess'; S.endsAt = Date.now(); render(); return;
    }
    loadSong();
  }
  function playClip() {
    clearInterval(poll); stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + CLIP) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (S.phase === 'guess') cover(true, '?', '');   // the question itself stays below the video
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    S.phase = 'guess'; S.endsAt = Date.now() + S.guessMs;
    $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb';
    var mc = S.q.type === 'mc';
    $('qtext').textContent = S.q.text; $('guess').placeholder = S.q.hint; $('guess').inputMode = (S.q.subject === 'place' || S.q.subject === 'points' || S.q.subject === 'year') ? 'numeric' : 'text';
    $('guessform').classList.toggle('hidden', mc); $('opts').classList.toggle('hidden', !mc);
    $('opts').innerHTML = mc ? S.q.options.map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '.</b> ' + esc(o) + '</button>'; }).join('') : '';
    $('confirm').classList.add('hidden');
    if (S.q.noclip) { clearInterval(poll); stage = 'paused'; cover(true, '?', ''); } else playClip();   // odd one out has no clip
    $('replay').classList.toggle('hidden', !!S.q.noclip);
    render(); if (!mc) $('guess').focus();
    endTimer = setTimeout(reveal, S.guessMs);
  }
  function reveal() {
    if (S.phase !== 'guess') return;
    stopTimers(); S.phase = 'reveal'; stage = 'reveal';
    // Multiple choice is scored now, from the answer that was being held.
    if (S.q.type === 'mc' && S.picked === S.q.correct && !S.got) {
      S.pts = pointsFor($('s-scoring').value, S.pickMs, S.guessMs, 0); S.score += S.pts; S.right++; S.got = true;
    }
    cover(false); masks(false);
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.playVideo(); } catch (e) {}
    render(); autoStart();
  }
  function startRound() {
    S.round++; S.phase = 'loading'; S.got = false; S.pts = 0;
    render(); loadSong();
  }
  function render() {
    hud();
    if (S.phase === 'setup') { show('v-setup'); return; }
    if (S.phase === 'end') {
      show('v-end');
      var best = getBest(), isBest = S.score > best;
      if (isBest) { try { localStorage.setItem(bestKey(), S.score); } catch (e) {} }
      $('final').textContent = S.score + ' points'; $('endchar').innerHTML = charSvg(myChar); $('endname').textContent = who();
      $('endbest').textContent = S.right + ' of ' + S.total + ' right. ' + (isBest ? (best ? 'A new personal best!' : '') : 'Your best is ' + best + '.');
      return;
    }
    show('v-game');
    var rev = S.phase === 'reveal';
    $('guessui').classList.toggle('hidden', S.phase !== 'guess');   // nothing to answer while the next song loads
    $('revealui').classList.toggle('hidden', !rev);
    $('guess').disabled = $('replay').disabled = $('skip').disabled = S.phase !== 'guess';
    if (rev) {
      $('verdict').className = 'fb ' + (S.got ? 'ok' : 'no');
      $('verdict').textContent = S.got ? 'Correct' : 'Incorrect';
      $('ropts').innerHTML = revealOptions(S.q, S.picked);
      $('rpts').textContent = (S.got ? S.pts : 0) + ((S.got ? S.pts : 0) === 1 ? ' point' : ' points');
      $('rpts').className = 'rpts ' + (S.got ? 'ok' : 'no');
      $('rwhy').textContent = S.q.explain || ''; $('ranswer').textContent = S.q.explain ? '' : S.q.text + ' ' + S.q.answer;
      $('rtitle').textContent = S.song[3];
      $('rmeta').textContent = S.song[2] + ' · ' + flag(S.song[1]) + ' ' + (countries[S.song[1]] || S.song[1]) + ' ' + S.song[0];
      $('rres').textContent = resultText(S.song);
      $('next').textContent = S.round >= S.total ? 'Final score' : 'Next';
    }
  }
  setInterval(function () {
    if (S.phase !== 'guess') return;
    $('tbar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, (S.endsAt - Date.now()) / S.guessMs)) + ')';
  }, 100);

  $('guessform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('guess').value.trim();
    if (!t || S.phase !== 'guess') return;
    var res = checkOpen(S.q, S.song, t, countries);
    if (res === 'ok') { win(); return; }
    $('fb').className = 'fb ' + (res === 'close' ? 'close' : 'no');
    $('fb').textContent = res === 'close' ? 'So close! Check your spelling.' : 'Nope, that’s not it. Try again!';
    if (res !== 'close') $('guess').value = '';
    $('guess').focus();
  });
  function win() {
    S.pts = pointsFor($('s-scoring').value, S.guessMs - (S.endsAt - Date.now()), S.guessMs, 0); S.score += S.pts; S.right++; S.got = true;
    reveal();
  }
  // Multiple choice: a tap holds the answer (it can still be changed). The answer shows
  // when the time is up, or straight away with "Confirm answer".
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || S.phase !== 'guess') return;
    S.picked = +b.getAttribute('data-i'); S.pickMs = S.guessMs - (S.endsAt - Date.now());
    [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    // With speed scoring every second counts, so the first tap is final and goes straight to the answer.
    if ($('s-scoring').value === 'speed') { reveal(); return; }
    $('confirm').classList.remove('hidden');
    $('fb').className = 'fb close'; $('fb').textContent = 'Answer held until the time is up.';
  });
  $('confirm').addEventListener('click', function () { if (S.phase === 'guess' && S.picked >= 0) reveal(); });
  // Autoplay: with the box ticked the next song starts by itself, after 10, 20 or 30 seconds or when
  // the song that is playing has finished ("Until the end").
  var autoTick = null, autoEnd = 0;
  try { $('auto').checked = localStorage.getItem('esc-auto') === '1'; var al = localStorage.getItem('esc-autolen'); if (al && $('autolen').querySelector('option[value="' + al + '"]')) $('autolen').value = al; } catch (e) {}
  // Seconds left of the song that is playing, or null when that cannot be told right now.
  function songLeft() {
    try { var st = yt.getPlayerState(), d = yt.getDuration() || 0, t = yt.getCurrentTime() || 0; if (st === 0) return 0; if (st === 1 && d > 0) return Math.max(0, d - t); } catch (e) {}
    return null;
  }
  function autoStop() { clearInterval(autoTick); autoTick = null; $('autoleft').textContent = ''; }
  function autoStart() {
    autoStop();
    if (!$('auto').checked || S.phase !== 'reveal') return;
    var toEnd = $('autolen').value === 'end';
    // Until the end: follow the player. If nothing is playing (or it cannot be read), fall back to a fixed wait.
    autoEnd = Date.now() + (toEnd ? 20 : +$('autolen').value) * 1000;
    var draw = function () {
      if (toEnd) { var rem = songLeft(); if (rem != null) autoEnd = Date.now() + rem * 1000; }
      var left = Math.ceil((autoEnd - Date.now()) / 1000);
      if (S.phase !== 'reveal') { autoStop(); return; }
      if (left <= 0) { autoStop(); goNext(); return; }
      $('autoleft').textContent = (S.round >= S.total ? 'Final scores in ' : 'Playing next song in ') + clock(left);
    };
    draw(); autoTick = setInterval(draw, 200);
  }
  $('auto').addEventListener('change', function () {
    try { localStorage.setItem('esc-auto', $('auto').checked ? '1' : '0'); } catch (e) {}
    autoStart();
  });
  $('autolen').addEventListener('change', function () {
    try { localStorage.setItem('esc-autolen', $('autolen').value); } catch (e) {}
    autoStart();
  });
  $('start').addEventListener('click', function () {
    ready(); if (!pool.length) return;
    if (!$('pickbox').classList.contains('hidden')) pickSave();
    S.round = 0; S.score = 0; S.right = 0; used = {}; fails = 0;
    startRound();
  });
  $('replay').addEventListener('click', function () { if (S.phase === 'guess' && !S.q.noclip && (stage === 'paused' || stage === 'clip')) playClip(); });
  $('skip').addEventListener('click', reveal);
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (S.phase !== 'reveal') return;
    autoStop();
    if (S.round >= S.total) { try { yt.stopVideo(); } catch (e) {} S.phase = 'end'; render(); } else startRound();
  }
  $('again').addEventListener('click', function () { S.phase = 'setup'; S.round = 0; ready(); render(); });

  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) { songs = d.songs; countries = d.countries; ready(); })
    .catch(function () { $('start').textContent = 'Could not load songs'; });
  render();
})();
