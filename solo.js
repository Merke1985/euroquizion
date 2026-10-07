// Solo mode: one device plays the clip and takes the guesses. No room, no connection.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var COUNT = 3, AFTER = 5;   // countdown before the clip; seconds to answer after it
  function clipSecs() { return Math.max(5, Math.round(S.guessMs / 1000) - AFTER); }
  var songs = [], countries = {}, pool = [], used = {};
  var S = { phase: 'setup', round: 0, total: 10, guessMs: 20000, score: 0, right: 0, song: null, q: null, picked: -1, pickMs: 0, got: false, pts: 0, endsAt: 0, showVideo: true };
  var yt = null, ytReady = false, clipStart = 0, stage = 'idle', poll = null, watchdog = null, endTimer = null, fails = 0;
  var loadT0 = 0, loadTick = null, clipReady = false;

  function show(id) { ['v-setup', 'v-game', 'v-end'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want(id === 'v-setup' || (id === 'v-game' && S.phase === 'guess' && !!S.q && !!S.q.noclip)); }   // menu music, also under questions without a clip
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
  function hud() { $('hud').textContent = S.phase === 'setup' || S.phase === 'end' ? '' : 'Song ' + S.round + ' / ' + S.total + ' · ' + S.score + (S.score === 1 ? ' point' : ' points'); }   // tiny, under the logo
  function bestKey() { return 'esc-solo-best3-' + [S.total, S.guessMs, $('s-era').value, $('s-cat').value, $('s-atype').value, (types || ['all']).join('+'), skip, $('s-scoring').value].join('|'); }
  function getBest() { try { return +localStorage.getItem(bestKey()) || 0; } catch (e) { return 0; } }

  // ---------- settings shared with the host screen: question types and songs to leave out ----------
  var types = null, skip = '';
  function skipped(code) { return !!skip && skip.split(',').indexOf(code) >= 0; }
  function playSongs() { return skip ? songs.filter(function (s) { return !skipped(s[1]); }) : songs; }
  function playCountries() { if (!skip) return countries; var c = {}, k; for (k in countries) if (!skipped(k)) c[k] = countries[k]; return c; }
  function readTypes(save) {
    var all = $('typebox').querySelectorAll('input:not([data-all])'), on = [];
    [].forEach.call(all, function (el) { if (el.checked) on.push(el.getAttribute('data-type')); });
    types = on.length ? on : null;
    $('typesum').textContent = !on.length || on.length === all.length ? 'All' : 'Custom';
    if (save) try { var pk = JSON.parse(localStorage.getItem('esc-picks') || 'null') || {}; pk.t = on; localStorage.setItem('esc-picks', JSON.stringify(pk)); } catch (e) {}
  }
  try {
    var pk0 = JSON.parse(localStorage.getItem('esc-picks') || 'null');
    if (pk0 && pk0.t && pk0.t.length) [].forEach.call($('typebox').querySelectorAll('input:not([data-all])'), function (el) { el.checked = pk0.t.indexOf(el.getAttribute('data-type')) >= 0; });
    var sk0 = localStorage.getItem('esc-skip'); if (sk0 && $('s-skip').querySelector('option[value="' + sk0 + '"]')) $('s-skip').value = sk0;
  } catch (e) {}
  skip = $('s-skip').value; readTypes(false);
  multiAll($('typebox'));
  $('typebox').addEventListener('change', function () { readTypes(true); ready(); });
  $('s-skip').addEventListener('change', function () { skip = $('s-skip').value; try { localStorage.setItem('esc-skip', skip); } catch (e) {} ready(); });
  (function () {
    var m = $('typebox'), b = m.querySelector('.multibtn'), p = m.querySelector('.multipanel');
    function shut() { p.classList.add('hidden'); b.setAttribute('aria-expanded', 'false'); }
    b.addEventListener('click', function (e) { e.stopPropagation(); b.setAttribute('aria-expanded', p.classList.toggle('hidden') === false ? 'true' : 'false'); });
    p.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', shut);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
  })();

  function ready() {
    if (!songs.length) return;
    pool = poolFor(playSongs(), $('s-era').value, $('s-cat').value);
    S.total = +$('s-rounds').value; S.guessMs = (+$('s-time').value + AFTER) * 1000;
    $('songcount').textContent = pool.length ? pool.length + ' songs in this selection.'
      : 'No songs match this combination. Semi-finals only started in 2004, so there are no non-qualifiers before that.';
    var b = getBest(); $('best').textContent = b ? 'Your best with these settings: ' + b + ' points.' : '';
    $('start').disabled = !(ytReady && pool.length);
    $('start').textContent = ytReady ? 'Start' : 'Loading player…';
  }
  // Only winners in play: "Higher or lower" would always be the winner, so it cannot be chosen.
  function winnersLock() {
    var win = $('s-cat').value === 'win', o = $('s-subject').querySelector('option[value="higher"]');
    if (o) o.disabled = win;
    if (win && $('s-subject').value === 'higher') $('s-subject').value = 'random';
  }
  $('s-cat').addEventListener('change', winnersLock); winnersLock();
  function scoreHelp() { $('scorehelp').textContent = SCORING_HELP[$('s-scoring').value] || ''; }
  $('s-scoring').addEventListener('change', scoreHelp); scoreHelp();
  ['s-era', 's-cat', 's-rounds', 's-time', 's-atype', 's-subject', 's-scoring'].forEach(function (id) { $(id).addEventListener('change', ready); });

  var yt2 = ONE_PLAYER ? new SharedSecond(function () { return yt; }, function () { return { id: loadedId, start: clipStart }; }) : new SecondPlayer('yt2'), pairStep = 0, pairTimer = null, loadedId = '';
  function stageEl() { return document.querySelector('#v-game .stage'); }
  function pairTag(t) { $('pairtag').textContent = t; $('pairtag').classList.toggle('hidden', !t); }
  function isPair() { return !!(S.q && S.q.pair); }
  function clipLen() { return isPair() ? PAIR_CLIP : clipSecs(); }
  function roundMs() { return isPair() ? PAIR_MS : S.guessMs; }
  // Speed scoring on a two-clip question only starts counting when the second clip begins.
  function speedMs(ms) { return isPair() ? Math.max(0, ms - PAIR_CLIP * 1000) : ms; }
  window.onYouTubeIframeAPIReady = function () {
    yt2.make();
    yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
      events: { onReady: function () { ytReady = true; ready(); }, onError: function () { if (stage === 'probe' || stage === 'seek') { if (loadedId) markBad(loadedId); badSong(); } } }
    });
  };
  var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);

  function stopTimers() { clearInterval(poll); clearTimeout(watchdog); clearTimeout(endTimer); clearTimeout(pairTimer); }
  function countStop() { clearInterval(loadTick); loadT0 = 0; }
  function countStart() {
    clipReady = false;
    if (loadT0) return;
    loadT0 = Date.now(); clearInterval(loadTick);
    var draw = function () {
      var left = COUNT - Math.floor((Date.now() - loadT0) / 1000);
      if (left >= 1) { $('covericon').textContent = left; $('covertext').textContent = 'Selecting song'; }
      else if (clipReady && isPair() && !yt2.ready) { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; if (Date.now() - loadT0 > 30000) badSong(); }
      else if (clipReady) { countStop(); beginGuess(); }
      else { $('covericon').textContent = '♪'; $('covertext').textContent = 'Almost there…'; }
    };
    draw(); loadTick = setInterval(draw, 100);
  }
  function loadSong() {
    stopTimers(); stuck = false;
    var free = pool.filter(function (s) { return !used[s[4]]; });
    if (!free.length) { used = {}; free = pool; }
    S.song = free[Math.floor(Math.random() * free.length)]; used[S.song[4]] = 1;
    S.q = makeQuestion(S.song, $('s-subject').value, $('s-atype').value, playSongs(), playCountries(), { pair: true, cat: $('s-cat').value, pool: pool, types: types }); S.picked = -1;
    if (S.q.swap) { S.song = S.q.swap; used[S.song[4]] = 1; }   // the question brought its own song
    stage = 'probe';
    cover(true, '', 'Selecting song'); countStart(); masks(true);
    // A two-clip question: the first song in the main player, the second in the spare one (see host.js).
    stageEl().classList.remove('second'); pairTag(''); pairStep = 0; loadedId = S.song[4];
    stageEl().classList.toggle('novideo', !!S.q.noclip);   // odd one out: the video stays invisible until the answer
    if (isPair()) {
      var pr = S.q.pair, second = pr[1][4];
      loadedId = pr[0][4]; used[pr[0][4]] = 1; used[pr[1][4]] = 1; S.song = pr[S.q.correct];
      yt2.load(second, PAIR_CLIP, function () { markBad(second); if (S.phase === 'loading') badSong(); });
    } else yt2.stop();
    adNote(false);
    // Odd one out has no clip: the video is not loaded at all until the answer, so nothing can be glimpsed.
    lateLoad = !!S.q.noclip;
    if (lateLoad) { try { yt.stopVideo(); } catch (e) {} fails = 0; stage = 'ready'; clipReady = true; return; }
    yt.mute(); yt.loadVideoById(loadedId);
    var frac = Math.random(), seekAt = 0, loadAt = Date.now();
    watchdog = setTimeout(function wd() {
      var s0 = -1; try { s0 = yt.getPlayerState(); } catch (e) {}
      // An ad (or a very slow start): leave plenty of time to watch or skip it. A real refusal by YouTube
      // comes in as an error and moves on at once; the Skip button is there for anything else.
      if ((adShown || s0 === 1 || s0 === 3) && Date.now() - loadAt < 120000) { watchdog = setTimeout(wd, 4000); return; }
      badSong();
    }, 12000);
    // See host.js: an ad before the video cannot be skipped from here, so the jump is repeated until
    // the real video is at the right spot, and the player is uncovered so the ad can be skipped by hand.
    poll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0, late = Date.now() - loadAt;
      // Odd one out has no clip: never show the player before the answer. Slow or behind an ad: just start.
      if (S.q && S.q.noclip && late > 6000) { clearInterval(poll); clearTimeout(watchdog); fails = 0; try { yt.pauseVideo(); } catch (e) {} stage = 'ready'; clipReady = true; return; }
      if (late > 6000) adNote(true);   // stuck for whatever reason: show the player, so an ad or an error is visible and can be clicked
      if (st !== 1 || d <= 0) return;
      if (d < 100 && late < 40000) { if (late > 2500) adNote(true); return; }
      var cs = d < 45 ? 0 : Math.floor(15 + frac * (d - 15 - 20 - clipLen()));
      if (stage === 'probe' || cs !== clipStart) { clipStart = cs; stage = 'seek'; seekAt = 0; }
      if (t >= clipStart && t < clipStart + 5) {
        clearInterval(poll); clearTimeout(watchdog); fails = 0; adNote(false);
        yt.pauseVideo(); stage = 'ready'; clipReady = true;
      } else if (Date.now() - seekAt > 2500) {
        seekAt = Date.now(); yt.seekTo(clipStart, true);
        if (late > 6000) adNote(true);
      }
    }, 120);
  }
  var adShown = false;
  function adNote(on) {
    if (on && S.q && S.q.noclip) return;   // never uncover the video of a question that has no clip
    if (on === adShown) return;
    adShown = on;
    document.querySelector('#v-game .shield').classList.toggle('hidden', on);
    if (on) { cover(false); $('mb').classList.add('hidden'); $('err').textContent = AD_TEXT; }
    else {
      // the wait is over: put back the bottom mask (it hides the caption with the country) and clear the note
      $('mb').classList.remove('hidden');
      if ($('err').textContent === AD_TEXT) $('err').textContent = '';
    }
    $('adskip').classList.toggle('hidden', !on);
  }
  var stuck = false;
  function badSong() {
    stopTimers(); fails++; adNote(false);
    if (fails >= 6) {
      stuck = true;
      stage = 'idle'; countStop(); cover(true, '!', 'Videos won’t start');
      $('err').textContent = 'YouTube isn’t playing anything. Check your connection, or skip this song.';
      S.phase = 'guess'; S.endsAt = Date.now(); render(); return;
    }
    loadSong();
  }
  function playClip() {
    clearInterval(poll); stage = 'clip';
    yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo();
    cover(false);   // the video is always visible during the clip
    poll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipLen()) {
        clearInterval(poll); yt.pauseVideo(); stage = 'paused';
        if (isPair() && S.phase === 'guess' && pairStep === 0) {
          pairStep = 1; if (!yt2.shared) stageEl().classList.add('second'); pairTag('Song 2'); yt2.play();
          pairTimer = setTimeout(function () { yt2.pause(); pairTag(''); if (S.phase === 'guess') cover(true, '?', ''); }, PAIR_CLIP * 1000);
          return;
        }
        if (S.phase === 'guess') cover(true, '?', '');   // the question itself stays below the video
      }
    }, 100);
  }
  function beginGuess() {
    $('err').textContent = '';
    S.phase = 'guess'; S.endsAt = Date.now() + roundMs();
    if (isPair()) { pairStep = 0; stageEl().classList.remove('second'); pairTag('Song 1'); }
    $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb';
    var mc = S.q.type === 'mc';
    $('qtext').textContent = S.q.text; $('guess').placeholder = S.q.hint; $('guess').inputMode = (S.q.subject === 'place' || S.q.subject === 'points' || S.q.subject === 'year') ? 'numeric' : 'text';
    $('guessform').classList.toggle('hidden', mc); $('opts').classList.toggle('hidden', !mc);
    $('opts').innerHTML = mc ? S.q.options.map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button>'; }).join('') : '';
    $('confirm').classList.add('hidden');
    if (S.q.noclip) { clearInterval(poll); stage = 'paused'; var art = noClipArt(S.q); cover(true, art[0], art[1]); } else playClip();   // odd one out has no clip
    render(); if (!mc) $('guess').focus();
    endTimer = setTimeout(reveal, roundMs());
  }
  var lateLoad = false;
  function reveal() {
    if (S.phase !== 'guess') return;
    stopTimers(); S.phase = 'reveal'; stage = 'reveal';
    // Multiple choice is scored now, from the answer that was being held.
    if (S.q.type === 'mc' && S.picked === S.q.correct && !S.got) {
      S.pts = pointsFor($('s-scoring').value, speedMs(S.pickMs), S.guessMs, 0); S.score += S.pts; S.right++; S.got = true;
    }
    Music.ding();
    cover(false); masks(false);
    clearTimeout(pairTimer); pairTag('');
    if (isPair()) {
      var second = S.q.correct === 1;   // the right answer's song plays on
      stageEl().classList.toggle('second', second && !yt2.shared);
      try { if (second) { if (!yt2.shared) yt.pauseVideo(); if (pairStep === 0) yt2.play(); else yt2.resume(); } else if (yt2.shared && yt2.back()) { /* the first song is back in the one player */ } else { yt2.pause(); yt.unMute(); yt.setVolume(100); yt.playVideo(); } } catch (e) {}
    } else if (lateLoad) {
      lateLoad = false; clipStart = Math.floor(35 + Math.random() * 50);
      try { yt.unMute(); yt.setVolume(100); yt.loadVideoById({ videoId: S.song[4], startSeconds: clipStart }); } catch (e) {}
    } else {
    try { var tNow = yt.getCurrentTime() || 0; if (!(tNow >= clipStart - 1 && tNow <= clipStart + clipSecs() + 2)) yt.seekTo(clipStart, true); yt.unMute(); yt.playVideo(); } catch (e) {}   // carries on from where the clip stopped
    }
    render(); autoStart(); revealWatch();
  }
  // At the answer: while an ad is playing instead of the song, the player can be clicked (Skip ad).
  var revealTick = null;
  function revealWatch() {
    clearInterval(revealTick);
    var sh = document.querySelector('#v-game .shield');
    sh.classList.add('hidden');
    revealTick = setInterval(function () {
      if (S.phase !== 'reveal') { clearInterval(revealTick); sh.classList.toggle('hidden', adShown); return; }
      sh.classList.add('hidden');   // the whole time the answer is up: an ad cannot always be told apart from the song
    }, 400);
  }
  function startRound() {
    yt2.pause(); stageEl().classList.remove('second'); pairTag('');
    S.round++; S.phase = 'loading'; S.got = false; S.pts = 0;
    render(); loadSong();
  }
  function render() {
    stageEl().classList.toggle('novideo', !!(S.q && S.q.noclip) && S.phase !== 'reveal' && S.phase !== 'end');
    hud();
    if (S.phase === 'setup' || S.phase === 'end') { $('ctrl').classList.add('hidden'); $('next').classList.add('hidden'); }
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
    $('guess').disabled = $('skip').disabled = S.phase !== 'guess';
    $('skip').classList.toggle('hidden', !(stuck && S.phase === 'guess'));   // only when YouTube will not play anything
    $('ctrl').classList.remove('hidden'); $('next').classList.remove('hidden'); $('next').disabled = !rev;
    if (rev) {
      $('rq').textContent = S.q.text;   // the question stays where it was, so the bars do not move
      $('ropts').innerHTML = revealOptions(S.q, S.picked, S.got ? S.pts : 0);
      $('rwhy').textContent = S.q.explain || ''; $('ranswer').textContent = '';
      $('rtitle').textContent = S.song[3];
      $('rmeta').textContent = S.song[2] + ' · ' + flag(S.song[1]) + ' ' + (countries[S.song[1]] || S.song[1]) + ' ' + S.song[0];
      $('rres').textContent = resultText(S.song);
      $('next').textContent = S.round >= S.total ? 'Final score' : 'Next';
    }
  }
  setInterval(function () {
    if (S.phase !== 'guess') return;
    $('tbar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, (S.endsAt - Date.now()) / roundMs())) + ')';
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
    S.picked = +b.getAttribute('data-i'); S.pickMs = roundMs() - (S.endsAt - Date.now());
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
  try { $('auto').checked = localStorage.getItem('esc-auto2') !== '0'; var al = localStorage.getItem('esc-autolen2'); if (al && $('autolen').querySelector('option[value="' + al + '"]')) $('autolen').value = al; } catch (e) {}
  // Seconds left of the song that is playing, or null when that cannot be told right now.
  function songLeft() {
    if (isPair() && S.q.correct === 1) return yt2.left();
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
    var t0 = Date.now(), last = t0;
    var draw = function () {
      if (S.phase !== 'reveal') { autoStop(); return; }
      // An ad in front of the song (or the song has not started yet): the countdown waits for it.
      var now = Date.now(), hold = isPair() && S.q.correct === 1 ? '' : revealHold(yt, clipStart);
      if (hold && now - t0 < (hold === 'ad' ? 120000 : 12000)) {
        autoEnd = toEnd ? now + 20000 : autoEnd + (now - last); last = now;
        $('autoleft').textContent = hold === 'ad' ? 'Waiting for the ad to finish' : '';
        return;
      }
      last = now;
      if (toEnd) { var rem = songLeft(); if (rem != null) autoEnd = Date.now() + rem * 1000; }
      var left = Math.ceil((autoEnd - Date.now()) / 1000);
      if (left <= 0) { autoStop(); goNext(); return; }
      if (toEnd) $('autoleft').textContent = ''; else $('autoleft').textContent = (S.round >= S.total ? 'Final score in ' : 'Next song in ') + clock(left);
    };
    draw(); autoTick = setInterval(draw, 200);
  }
  $('auto').addEventListener('change', function () {
    try { localStorage.setItem('esc-auto2', $('auto').checked ? '1' : '0'); } catch (e) {}
    autoStart();
  });
  $('autolen').addEventListener('change', function () {
    try { localStorage.setItem('esc-autolen2', $('autolen').value); } catch (e) {}
    autoStart();
  });
  $('start').addEventListener('click', function () {
    ready(); if (!pool.length) return;
    if (!$('pickbox').classList.contains('hidden')) pickSave();
    S.round = 0; S.score = 0; S.right = 0; used = {}; fails = 0;
    startRound();
  });
  $('skip').addEventListener('click', reveal);
  $('adskip').addEventListener('click', function () { if (adShown && S.phase === 'loading') { fails = 0; badSong(); } });
  $('next').addEventListener('click', goNext);
  function goNext() {
    if (S.phase !== 'reveal') return;
    autoStop();
    if (S.round >= S.total) { try { yt.stopVideo(); } catch (e) {} S.phase = 'end'; render(); } else startRound();
  }
  $('again').addEventListener('click', function () { S.phase = 'setup'; S.round = 0; ready(); render(); });

  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) { songs = d.songs; countries = d.countries; ready(); })
    .catch(function () { $('start').textContent = 'Could not load songs'; });
  keepSettings(['s-era', 's-cat', 's-time', 's-scoring', 's-rounds']);   // shared with the host screen
  render();
})();
