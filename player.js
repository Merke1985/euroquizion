(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // One player id per tab; survives a refresh.
  var pid = null;
  try { pid = sessionStorage.getItem('esc-pid'); } catch (e) {}
  if (!pid) pid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try { sessionStorage.setItem('esc-pid', pid); } catch (e) {}
  var net = null, name = '', room = '', state = null, endsAt = 0, countries = {}, joinTimer = null, hiTimer = null, lastPhaseKey = '', builtKey = '', want = null, picking = false, hi = function () {};
  try { want = sessionStorage.getItem('esc-char'); } catch (e) {}

  $('name').value = store.get('esc-name') || '';
  var qs = new URLSearchParams(location.search), k = qs.get('k');
  // Inside the host's own page (a game without a shared screen) the hosting buttons make no sense.
  if (qs.get('embed')) { document.body.classList.add('embed'); $('hostlinks').classList.add('hidden'); }
  if (k) $('code').value = k.toUpperCase().slice(0, 4);
  fetch('songs.json?v=34').then(function (r) { return r.json(); }).then(function (d) { countries = d.countries; }).catch(function () {});

  function show(id) { ['v-join', 'v-pick', 'v-wait', 'v-guess', 'v-sing', 'v-reveal'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }

  $('joinform').addEventListener('submit', function (e) {
    e.preventDefault();
    room = $('code').value.trim().toUpperCase(); name = $('name').value.trim();
    if (room.length !== 4 || !name) return;
    store.set('esc-name', name);
    $('joinerr').textContent = '';
    state = null;
    net = escConnect(room);
    $('demo').classList.toggle('hidden', !net.demo);
    net.on('state', onState);
    net.on('chat', chatAdd);
    net.on('result', onResult);
    // Each hello carries what this phone last knew, so a host that reconnects can restore the game.
    hi = function () {
      var m = me();
      net.send('hi', { pid: pid, name: name, char: want, score: m ? m.score : null,
        last: state ? { phase: state.phase, round: state.round, total: state.total, total_ms: state.total_ms, cfg: state.cfg } : null });
    };
    net.on('_open', hi);
    net.on('sync', hi);
    clearInterval(hiTimer); hiTimer = setInterval(hi, 4000);
    show('v-wait'); $('waittitle').textContent = 'Connecting…'; $('waitsub').textContent = 'Room ' + room;
    clearTimeout(joinTimer);
    joinTimer = setTimeout(function () {
      if (state) return;
      clearInterval(hiTimer); show('v-join');
      $('joinerr').textContent = 'No game found with code ' + room + '. Is the code right?';
    }, 7000);
  });

  function me() { return state && state.players.filter(function (p) { return p.pid === pid; })[0]; }

  function onState(s) {
    onState2(s);
    remoteVideo(s);
  }
  function onState2(s) {
    state = s; clearTimeout(joinTimer);
    endsAt = Date.now() + (s.left || 0);
    var m = me();
    $('me').innerHTML = (m ? charSvg(m.char) : '') + esc(name + (m && !s.hide ? ' · ' + m.score : ''));   // s.hide: totals stay secret until the end
    $('mychar').innerHTML = m ? charSvg(m.char) : '';
    $('changechar').classList.toggle('hidden', s.phase !== 'lobby');
    // Not in the game until a character is yours; the grid updates live as others pick.
    if (!m || picking) {
      if (m && s.phase !== 'lobby') picking = false;
      else { renderPicker(s, m); show('v-pick'); return; }
    }
    var key = s.phase + ':' + s.round;
    if (s.phase !== 'guess') builtKey = '';
    var fresh = key !== lastPhaseKey; lastPhaseKey = key;
    if (s.sing && s.phase !== 'reveal' && s.phase !== 'end' && s.phase !== 'lobby' && s.phase !== 'paused' && s.phase !== 'guess') { renderSing(s, m); return; }
    if (s.phase === 'lobby') { show('v-wait'); $('waittitle').textContent = 'You’re in!'; $('waitsub').textContent = 'Watch the big screen. The game starts soon.'; }
    else if (s.phase === 'paused') { show('v-wait'); $('waittitle').textContent = 'Game restored'; $('waitsub').textContent = 'The host will continue in a moment.'; }
    else if (s.phase === 'loading' && s.remote) { show('v-wait'); $('waittitle').textContent = 'Get ready…'; $('waitsub').textContent = 'Song ' + s.round + ' of ' + s.total + '. Turn your sound on.'; }
    else if (s.phase === 'loading') { show('v-wait'); $('waittitle').textContent = 'Ears open…'; $('waitsub').textContent = 'Song ' + s.round + ' of ' + s.total; }
    else if (s.phase === 'guess') {
      var q = s.q || { type: 'open', text: 'Which song is this?', hint: 'Type the title…' };
      if (m && m.got) { show('v-wait'); $('waittitle').textContent = 'Correct! +' + m.pts; $('waitsub').textContent = 'Waiting for the others…'; }
      else if (m && m.done) { show('v-wait'); $('waittitle').textContent = 'Not this time'; $('waitsub').textContent = 'Your answer is locked in. Waiting for the others…'; }
      else {
        show('v-guess'); $('roundlabel').textContent = 'Song ' + s.round + ' of ' + s.total;
        $('qtext').textContent = q.text;
        var mc = q.type === 'mc';
        $('guessform').classList.toggle('hidden', mc); $('opts').classList.toggle('hidden', !mc);
        if (builtKey !== key) {   // build the question once per song, so typing is never wiped
          builtKey = key;
          $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb';
          $('guess').placeholder = q.hint || ''; $('guess').inputMode = (q.subject === 'place' || q.subject === 'points') ? 'numeric' : 'text';
          $('opts').innerHTML = mc ? q.options.map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '.</b> ' + esc(o) + '</button>'; }).join('') : '';
          if (!mc) $('guess').focus();
        }
      }
    }
    else if (s.phase === 'reveal' || s.phase === 'end') {
      show('v-reveal');
      var r = s.reveal || {};
      $('verdict').className = 'fb ' + (m && m.got ? 'ok' : 'no');
      $('verdict').textContent = s.phase === 'end' ? 'Game over!' : (m && m.got ? 'You got it!' : 'Not this time');
      var rev = s.phase === 'reveal';
      $('ropts').innerHTML = rev && s.q ? revealOptions(s.q, m ? m.pick : null) : '';
      $('rpts').textContent = rev && m ? (m.got ? '+' + m.pts + ' points' : 'No points this time') : '';
      $('rpts').className = 'rpts ' + (m && m.got ? 'ok' : 'no');
      if (rev && s.sing) {
        // A Sing! round: show the votes instead of right or wrong.
        var mine = (s.sing.result || []).filter(function (r) { return r.pid === pid; })[0];
        $('verdict').className = 'fb ' + (mine ? 'ok' : 'no');
        $('verdict').textContent = mine ? (mine.win ? 'Best singer!' : mine.votes + (mine.votes === 1 ? ' vote' : ' votes') + ' for you') : 'You didn’t sing this one';
        $('ropts').innerHTML = (s.sing.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
        $('rpts').textContent = mine ? '+' + mine.pts + ' points' : 'No points this time';
        $('rpts').className = 'rpts ' + (mine ? 'ok' : 'no');
      }
      $('ranswer').textContent = s.phase === 'reveal' && s.q && s.q.answer ? s.q.text + ' ' + s.q.answer : '';
      $('rtitle').textContent = r.title || '';
      $('rmeta').textContent = r.title ? r.artist + ' · ' + flag(r.code) + ' ' + (countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('rres').textContent = (s.phase === 'reveal' && r.result) || '';
      $('myscorebox').classList.toggle('hidden', !!s.hide);
      $('myscore').textContent = m ? m.score : 0;
      var rank = m ? s.players.filter(function (p) { return p.score > m.score; }).length + 1 : 0;
      $('myrank').textContent = rank ? 'Place ' + rank + ' of ' + s.players.length : '';
    }
  }


  // ---------- Sing! ----------
  // Voting (for the song, then for the best singer) and recording up to 10 seconds of audio.
  var REC_MAX = 10000, sKey = '', rec = null, recStream = null, recChunks = [], recBlob = null, recTick = null, recT0 = 0, recSent = '';
  function recRelease() { if (recStream) { recStream.getTracks().forEach(function (t) { t.stop(); }); recStream = null; } }
  function recReset() {
    clearInterval(recTick);
    if (rec && rec.state !== 'inactive') { try { rec.onstop = null; rec.stop(); } catch (e) {} }
    rec = null; recBlob = null; recChunks = [];
    $('srecbtn').textContent = 'Start recording'; $('srecbtn').classList.remove('live'); $('srecbtn').classList.remove('hidden');
    $('sprev').classList.add('hidden'); $('srecdone').classList.add('hidden'); $('srecstate').textContent = '';
  }
  function renderSing(s, m) {
    var sg = s.sing, key = s.phase + ':' + s.round, fresh = key !== sKey;
    sKey = key;
    show('v-sing');
    $('sround').textContent = 'Song ' + s.round + ' of ' + s.total + ' · Sing!';
    var poll = s.phase === 'svote' || s.phase === 'sbest', recPhase = s.phase === 'srec' && !(m && m.in);
    $('sopts').classList.toggle('hidden', !poll); $('srec').classList.toggle('hidden', !recPhase);
    if (fresh) { $('sfb').textContent = ''; $('sfb').className = 'fb'; if (s.phase !== 'srec') { recReset(); recRelease(); } }
    var name = sg.song ? sg.song.title + ' – ' + sg.song.artist : '';
    if (s.phase === 'svote') {
      $('stitle').textContent = 'Which song shall we sing?'; $('ssub').textContent = 'Vote for one. The most votes wins.';
      if (fresh) $('sopts').innerHTML = (sg.options || []).map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '.</b> ' + esc(o) + '</button>'; }).join('');
    } else if (s.phase === 'sbest') {
      $('stitle').textContent = 'Who sang it best?'; $('ssub').textContent = 'You can’t vote for yourself.';
      if (fresh) $('sopts').innerHTML = (sg.order || []).map(function (o, i) { return o.pid === pid ? '' : '<button type="button" class="opt" data-i="' + i + '">' + esc(o.name) + '</button>'; }).join('');
    } else if (s.phase === 'srec') {
      $('stitle').textContent = m && m.in ? 'Got it!' : 'Your turn to sing!';
      $('ssub').textContent = m && m.in ? 'Waiting for the others…' : name + '. Record up to 10 seconds.';
      if (fresh) { recReset(); recSent = ''; }
    } else if (s.phase === 'splay') {
      $('stitle').textContent = sg.now ? 'Now singing: ' + sg.now : 'Showtime!'; $('ssub').textContent = 'Listen on the big screen.';
    } else {
      $('stitle').textContent = 'We’re singing'; $('ssub').textContent = name ? name + '. Listen first, then it’s your turn.' : 'Get ready…';
    }
  }
  $('sopts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || !net) return;
    [].forEach.call($('sopts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    net.send('poll', { pid: pid, choice: +b.getAttribute('data-i') });
    $('sfb').className = 'fb close'; $('sfb').textContent = 'Vote in. You can still change it.';
  });
  function recStop() { clearInterval(recTick); if (rec && rec.state !== 'inactive') rec.stop(); }
  $('srecbtn').addEventListener('click', function () {
    if (rec && rec.state === 'recording') { recStop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $('srecstate').className = 'fb no'; $('srecstate').textContent = 'This browser can’t record sound. You can still vote.'; return; }
    $('srecstate').className = 'fb'; $('srecstate').textContent = 'Allow the microphone…';
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream; recChunks = []; recBlob = null;
      var types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'], mime = '';
      for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
      var opt = { audioBitsPerSecond: 32000 }; if (mime) opt.mimeType = mime;
      rec = new MediaRecorder(stream, opt);
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      rec.onstop = function () {
        recBlob = new Blob(recChunks, { type: (rec && rec.mimeType) || mime || 'audio/webm' });
        recRelease();
        $('srecbtn').classList.add('hidden'); $('srecbtn').classList.remove('live');
        $('sprev').src = URL.createObjectURL(recBlob); $('sprev').classList.remove('hidden'); $('srecdone').classList.remove('hidden');
        $('srecstate').className = 'fb'; $('srecstate').textContent = 'Happy with it?';
      };
      rec.start(); recT0 = Date.now();
      $('srecbtn').textContent = 'Stop'; $('srecbtn').classList.add('live'); $('srecstate').className = 'fb close';
      recTick = setInterval(function () {
        var left = REC_MAX - (Date.now() - recT0);
        $('srecstate').textContent = 'Recording… ' + Math.max(0, Math.ceil(left / 1000)) + ' s left';
        if (left <= 0) recStop();
      }, 100);
    }).catch(function () { $('srecstate').className = 'fb no'; $('srecstate').textContent = 'No access to the microphone. Allow it in your browser, or skip this one.'; });
  });
  $('sredo').addEventListener('click', recReset);
  $('sskip').addEventListener('click', function () { recReset(); recRelease(); if (net) net.send('clip', { pid: pid, skip: true }); });
  $('ssend').addEventListener('click', function () {
    if (!recBlob || !net || recSent === sKey) return;
    recSent = sKey; $('srecstate').className = 'fb'; $('srecstate').textContent = 'Sending…';
    var fr = new FileReader();
    fr.onload = function () {
      // Sent in small pieces: the room connection has a size limit per message.
      var b64 = String(fr.result).split(',')[1] || '', size = 40000, n = Math.max(1, Math.ceil(b64.length / size)), key = Math.random().toString(36).slice(2), i = 0;
      if (n > 16) { recSent = ''; $('srecstate').className = 'fb no'; $('srecstate').textContent = 'That recording is too large. Please record again.'; return; }
      var step = function () {
        net.send('clip', { pid: pid, key: key, i: i, n: n, mime: recBlob.type, data: b64.slice(i * size, (i + 1) * size) });
        if (++i < n) setTimeout(step, 120);
      };
      step();
    };
    fr.readAsDataURL(recBlob);
  });


  // ---------- playing without a shared screen ----------
  // Every phone plays the clip itself. The host only says which video and where to start; the
  // phone loads it silently, reports when it is ready, and plays when the guessing starts.
  var CLIP = 15, yt = null, ytWanted = false, ytReady = false, clipKey = '', clipStart = 0, vStage = 'idle', vPoll = null, vWatch = null, vPlayed = '';
  function vCover(on, icon, text) { $('cover').classList.toggle('hidden', !on); if (on) { $('covericon').textContent = icon; $('covertext').textContent = text || ''; } }
  function vMasks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  function vStop() { clearInterval(vPoll); clearTimeout(vWatch); $('tapplay').classList.add('hidden'); try { if (yt && ytReady) yt.pauseVideo(); } catch (e) {} }
  function ytLoad() {
    if (ytWanted) return;
    ytWanted = true;
    window.onYouTubeIframeAPIReady = function () {
      yt = new YT.Player('yt', { width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
        events: { onReady: function () { ytReady = true; if (state) remoteVideo(state); },
          onError: function () { if (vStage === 'probe' || vStage === 'seek') { vStop(); vStage = 'bad'; if (net) net.send('ready', { pid: pid, key: clipKey, bad: true }); } } } });
    };
    var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  }
  function vPrepare(clip) {
    vStop(); vStage = 'probe'; vPlayed = '';
    vCover(true, '♪', 'Selecting song'); vMasks(true);
    yt.mute(); yt.loadVideoById(clip.id);
    vWatch = setTimeout(function () { if (vStage === 'probe' || vStage === 'seek') { vStage = 'slow'; if (net) net.send('ready', { pid: pid, key: clipKey, slow: true }); } }, 10000);
    vPoll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0;
      if ((vStage === 'probe' || vStage === 'slow') && st === 1 && d > 0) {
        clipStart = d < 45 ? 0 : Math.floor(15 + clip.frac * (d - 15 - 20 - CLIP));   // same spot on every phone
        vStage = 'seek'; yt.seekTo(clipStart, true);
      } else if (vStage === 'seek' && st === 1 && t >= clipStart && t < clipStart + 5) {
        clearInterval(vPoll); clearTimeout(vWatch); yt.pauseVideo(); vStage = 'ready';
        if (net) net.send('ready', { pid: pid, key: clipKey });
        if (state) remoteVideo(state);
      }
    }, 120);
  }
  function vPlay(full) {
    clearInterval(vPoll); vStage = full ? 'full' : 'clip';
    try { yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    vCover(false); vMasks(!full);
    // Phones may refuse to start sound without a touch: offer a button if nothing is playing.
    clearTimeout(vWatch);
    vWatch = setTimeout(function () { try { if (yt.getPlayerState() !== 1) $('tapplay').classList.remove('hidden'); } catch (e) {} }, 1800);
    if (full) return;
    vPoll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + CLIP) { clearInterval(vPoll); yt.pauseVideo(); vStage = 'paused'; $('tapplay').classList.add('hidden'); if (state && state.phase === 'guess') vCover(true, '?', ''); }
    }, 100);
  }
  $('tapplay').addEventListener('click', function () { $('tapplay').classList.add('hidden'); try { yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {} });
  function remoteVideo(s) {
    var m = me(), on = !!(s.remote && s.clip && m && (s.phase === 'loading' || s.phase === 'guess' || s.phase === 'reveal'));
    $('pstage').classList.toggle('hidden', !on);
    $('chatbtn').classList.toggle('hidden', !(s.remote && m));
    if (!s.remote) return;
    ytLoad();
    if (!on) { if (vStage !== 'idle') { vStop(); vStage = 'idle'; clipKey = ''; } return; }
    if (!ytReady) return;
    var key = s.clip.id + ':' + s.round;
    if (key !== clipKey) { clipKey = key; vPrepare(s.clip); return; }
    var ready = vStage === 'ready' || vStage === 'clip' || vStage === 'paused' || vStage === 'full';
    if (!ready) return;
    if (s.phase === 'guess' && vPlayed !== 'clip' && vPlayed !== 'full') { vPlayed = 'clip'; vPlay(false); }
    else if (s.phase === 'reveal' && vPlayed !== 'full') { vPlayed = 'full'; vPlay(true); }
  }

  // ---------- chat (games without a shared screen) ----------
  var chatOpen = false, chatLog = [];
  function chatAdd(c) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) return;
    chatLog.push({ name: String(c.name || '?').slice(0, 16), char: c.char, text: c.text.slice(0, 200), mine: c.pid === pid });
    if (chatLog.length > 100) chatLog.shift();
    var el = $('chatlog');
    el.innerHTML = chatLog.map(function (x) { return '<div class="msg' + (x.mine ? ' mine' : '') + '">' + charSvg(x.char) + '<div><b>' + esc(x.name) + '</b><span>' + esc(x.text) + '</span></div></div>'; }).join('');
    el.scrollTop = el.scrollHeight;
    if (!chatOpen && c.pid !== pid) { $('chatdot').classList.remove('hidden'); $('chatbtn').classList.add('lit'); }
  }
  function chatToggle(open) {
    chatOpen = open; $('chat').classList.toggle('hidden', !open);
    if (open) { $('chatdot').classList.add('hidden'); $('chatbtn').classList.remove('lit'); $('chatlog').scrollTop = $('chatlog').scrollHeight; $('chatin').focus(); }
  }
  $('chatbtn').addEventListener('click', function () { chatToggle(!chatOpen); });
  $('chatclose').addEventListener('click', function () { chatToggle(false); });
  $('chatform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('chatin').value.trim(), m = me();
    if (!t || !net || !m) return;
    var c = { pid: pid, name: name, char: m.char, text: t.slice(0, 200) };
    net.send('chat', c); chatAdd(c); $('chatin').value = '';
  });

  var pickKey = '';
  function renderPicker(s, m) {
    var taken = {};
    s.players.forEach(function (p) { if (p.pid !== pid && p.char) taken[p.char] = p.name; });
    // Only redraw when something changed, so the photos do not reload on every update.
    var k = JSON.stringify(taken) + '|' + (m ? m.char : '');
    if (k !== pickKey) {
      pickKey = k;
      $('chars').innerHTML = CHARS.map(function (c) {
        return '<button type="button" data-char="' + c.id + '"' + (taken[c.id] ? ' disabled title="Taken by ' + esc(taken[c.id]) + '"' : '') +
          (m && m.char === c.id ? ' class="mine"' : '') + '>' + charSvg(c.id) + '<span>' + esc(c.name) + '</span></button>';
      }).join('');
    }
    var left = CHARS.filter(function (c) { return !taken[c.id]; }).length;
    $('pickerr').textContent = left ? (want && taken[want] ? 'Too slow, ' + taken[want] + ' just took that one. Pick another!' : '') : 'All characters are taken, so this game is full.';
    if (want && taken[want]) want = null;
  }
  $('chars').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-char]');
    if (!b || b.disabled) return;
    want = b.getAttribute('data-char'); picking = false;
    try { sessionStorage.setItem('esc-char', want); } catch (err) {}
    $('pickerr').textContent = ''; hi();
  });
  $('changechar').addEventListener('click', function () { picking = true; if (state) onState(state); });

  function onResult(r) {
    if (r.pid !== pid) return;
    var fb = $('fb');
    if (r.res === 'ok') return; // a state update follows
    fb.className = 'fb ' + (r.res === 'close' ? 'close' : 'no');
    fb.textContent = r.res === 'close' ? 'So close! Check your spelling.' : 'Nope, that’s not it. Try again!';
    if (r.res !== 'close') $('guess').value = '';
    $('guess').focus();
  }

  // Multiple choice: a tap holds the answer; whether it was right only shows at the reveal.
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || b.disabled || !net) return;
    [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    $('fb').className = 'fb close'; $('fb').textContent = 'Answer in. You can still change it until everyone has answered.';
    net.send('guess', { pid: pid, choice: +b.getAttribute('data-i') });
  });
  $('guessform').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('guess').value.trim();
    if (!t || !net) return;
    net.send('guess', { pid: pid, text: t.slice(0, 80) });
    $('fb').className = 'fb'; $('fb').textContent = '…';
  });

  setInterval(function () {
    if (!state) return;
    var ms = state.bar_ms || state.total_ms, f = ms ? Math.max(0, Math.min(1, (endsAt - Date.now()) / ms)) : 0;
    if (state.phase === 'guess') $('pbar').style.transform = 'scaleX(' + f + ')';
    else if (state.sing) $('sbar').style.transform = 'scaleX(' + (state.phase === 'loading' || state.phase === 'splay' ? 0 : f) + ')';
  }, 100);
})();
