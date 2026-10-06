(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // One player id per tab; survives a refresh.
  var pid = null;
  try { pid = sessionStorage.getItem('esc-pid'); } catch (e) {}
  if (!pid) pid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try { sessionStorage.setItem('esc-pid', pid); } catch (e) {}
  var net = null, name = '', room = '', state = null, endsAt = 0, countries = {}, joinTimer = null, hiTimer = null, lastPhaseKey = '', builtKey = '', pickUntil = 0, want = null, picking = false, hi = function () {};
  try { want = sessionStorage.getItem('esc-char'); } catch (e) {}

  $('name').value = store.get('esc-name') || '';
  var qs = new URLSearchParams(location.search), k = qs.get('k');
  // Inside the host's own page (a game without a shared screen) the hosting buttons make no sense.
  if (qs.get('embed')) { document.body.classList.add('embed'); $('hostlinks').classList.add('hidden'); }
  if (k) $('code').value = k.toUpperCase().slice(0, 4);
  fetch('songs.json?v=43').then(function (r) { return r.json(); }).then(function (d) { countries = d.countries; }).catch(function () {});

  function show(id) { ['v-join', 'v-pick', 'v-brief', 'v-wait', 'v-guess', 'v-draw', 'v-sing', 'v-reveal'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); Music.want(!!(state && state.remote && ((state.phase === 'guess' && state.q && state.q.noclip) || (state.gallery && state.phase === 'dall') || (state.draw && state.phase === 'loading')))); }   // no music on the start page; only under clip-less questions in online games

  if (document.body.classList.contains('embed')) { setInterval(function () { if (!state || picking) tellHeight(); }, 500); }
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
    // A finished drawing comes from the host as packets of lines, when it is that drawing's turn to be guessed.
    net.on('draw', function (d) { if (!d || !d.batch || !state || !state.draw || d.pid !== state.draw.pid) return; if (d.first) drawClear($('pdraw')); d.batch.forEach(function (m) { drawPaint($('pdraw'), m); }); });
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

  function ptsText(n) { return n + (n === 1 ? ' point' : ' points'); }
  function me() { return state && state.players.filter(function (p) { return p.pid === pid; })[0]; }
  if (document.body.classList.contains('embed') && $('code').value.length === 4 && $('name').value.trim()) setTimeout(function () { $('joinform').querySelector('button').click(); }, 0);

  var revealAt = 0, nextAt = 0, toldParent = false, lastH = 0, endShown = false;
  // Inside the host's page the frame should be exactly as tall as its content while in the lobby.
  function tellHeight() {
    setTimeout(function () {
      var mn = document.querySelector('main'), h = mn.offsetTop + mn.scrollHeight + 8;
      if (Math.abs(h - lastH) > 4) { lastH = h; try { parent.postMessage({ esc: 'h', h: h }, location.origin); } catch (e) {} }
    }, 60);
  }
  function onState(s) {
    onState2(s);
    remoteVideo(s);
    rowUpdate();
    // During a game the screen keeps one fixed skeleton, so nothing jumps between question, waiting and answer.
    var ing = !!me() && ['lobby', 'brief', 'intro', 'end'].indexOf(s.phase) < 0;
    document.querySelector('main').classList.toggle('ingame', ing);
    // In the host's own page the lobby view shrinks to a pill around avatar, name and Edit.
    document.querySelector('main').classList.toggle('compact', document.body.classList.contains('embed') && !!me() && s.phase === 'lobby' && !picking);
    $('waitlabel').textContent = ing && s.round ? 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total) : '';
    if (s.phase !== 'end') endShown = false;
    revealAt = (s.phase === 'guess' || s.phase === 'svote' || s.phase === 'sbest') && s.reveal_in ? Date.now() + s.reveal_in : 0;
    nextAt = s.phase === 'reveal' && s.next_in ? Date.now() + s.next_in : 0;
    // Inside the host's page: let it know once this player is in, so the lobby can open up.
    if (document.body.classList.contains('embed')) tellHeight();
    if (!toldParent && me() && document.body.classList.contains('embed')) { toldParent = true; try { parent.postMessage({ esc: 'joined' }, location.origin); } catch (e) {} }
  }
  function onState2(s) {
    state = s; clearTimeout(joinTimer);
    endsAt = Date.now() + (s.left || 0);
    var m = me();
    $('me').innerHTML = s.phase === 'lobby' ? '' : (m ? charSvg(m.char) : '') + esc(name + (m && !s.hide ? ' · ' + m.score : ''));   // s.hide: totals stay secret until the end
    $('mychar').innerHTML = m && s.phase === 'lobby' ? charSvg(m.char) : '';   // the big avatar only belongs in the lobby
    // In the lobby: a small avatar and your name on top, with an Edit button for both.
    $('profile').classList.toggle('hidden', !(m && s.phase === 'lobby'));
    $('myname').textContent = name;
    // The host hands out a random free avatar on joining; "Select avatar" lets you change it in the lobby.
    if (!m) {
      var full = s.players.length >= CHARS.length;
      show('v-wait'); $('waittitle').textContent = full ? 'This game is full' : 'Joining…'; $('waitsub').textContent = full ? 'All avatars are in use.' : '';
      return;
    }
    if (m.char && want !== m.char && Date.now() > pickUntil) { want = m.char; try { sessionStorage.setItem('esc-char', want); } catch (e) {} }
    if (picking) {
      if (s.phase !== 'lobby') picking = false;
      else { renderPicker(s, m); show('v-pick'); return; }
    }
    var key = s.phase + ':' + s.round;
    if (s.phase !== 'guess') builtKey = '';
    if (!s.gallery && !s.draw) dKey = '';
    if (!s.sing) sKey = '';
    var fresh = key !== lastPhaseKey; lastPhaseKey = key;
    if (fresh && s.phase === 'reveal' && s.remote && !s.sing && m) Music.ding();   // no shared screen: every phone plays the reveal sound itself
    if (s.sing && s.phase !== 'reveal' && s.phase !== 'end' && s.phase !== 'lobby' && s.phase !== 'paused' && s.phase !== 'guess') { renderSing(s, m); return; }
    if (s.phase === 'brief' || s.phase === 'intro') {
      // The briefing before the first song: the settings, how scoring works, and a Ready button.
      var b = s.brief || { rows: [], scoring: '' }, n = s.players.filter(function (p) { return p.in; }).length;
      show('v-brief');
      $('briefset').innerHTML = b.rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
      $('briefscore').textContent = b.scoring || '';
      // Everyone in the room on top, with a green ring once they are ready.
      $('pbrief').innerHTML = s.players.slice().sort(function (x, y) { return x.name.localeCompare(y.name); }).map(function (p) {
        return '<div class="pl' + (p.in || s.phase === 'intro' ? ' in' : '') + (p.off ? ' off' : '') + '">' + charSvg(p.char) + '<span>' + esc(p.name) + '</span></div>';
      }).join('');
      var intro = s.phase === 'intro';
      $('readybtn').classList.toggle('hidden', !!m.in || intro);
      $('briefwait').className = intro ? 'briefcd' : 'mute';
      $('briefwait').textContent = intro ? 'Starting in ' + Math.max(1, Math.ceil((s.left || 0) / 1000)) : m.in ? 'You’re ready. Waiting for the others (' + n + ' of ' + s.players.length + ')…' : n + ' of ' + s.players.length + ' ready';
      return;
    }
    $('v-wait').classList.toggle('lobbyview', s.phase === 'lobby');
    if (s.phase !== 'lobby') { $('lobbyready').classList.add('hidden'); $('lobbystart').classList.add('hidden'); }
    if (s.phase === 'lobby') {
      var emb = document.body.classList.contains('embed');   // the host already sees the lobby around this frame
      var nrdy = s.players.filter(function (p) { return p.in; }).length;
      // The big Ready button at the bottom: press to check it, press again to take it back.
      $('lobbyready').classList.remove('hidden'); $('lobbyready').classList.toggle('on', !!m.in); $('lobbyready').setAttribute('aria-pressed', m.in ? 'true' : 'false');
      $('lobbyreadytext').textContent = m.in ? 'Ready!' : 'Ready';
      $('lobbystart').classList.remove('hidden'); $('lobbystart').disabled = !s.all_ready;   // always there, greyed out until everyone is ready
      show('v-wait'); $('waittitle').textContent = emb ? '' : 'You’re in!'; $('waitsub').textContent = emb ? '' : s.all_ready ? 'Everyone is ready. Anyone can start the game.' : m.in ? 'You’re ready. Waiting for the others (' + nrdy + ' of ' + s.players.length + ')…' : 'Press Ready when you’re set. Start unlocks when everyone is ready.';
    }
    else if (s.phase === 'dall' && s.gallery) {
      // Draw!: everyone picks one of their own four songs and draws it, all within the minute.
      var go = s.gallery.opts[pid];
      if (dKey !== s.gallery.id) { dKey = s.gallery.id; padPicked = -1; padDone = false; padReset(); $('dopts').innerHTML = (go || []).map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button>'; }).join(''); }
      var gc = s.gallery.chosen[pid] != null ? s.gallery.chosen[pid] : padPicked;
      if (!go) { show('v-wait'); $('waittitle').textContent = 'Everyone is drawing'; $('waitsub').textContent = 'You can guess the drawings in a moment.'; }
      else if (s.gallery.done[pid] || padDone) { show('v-wait'); $('waittitle').textContent = padSkipped ? 'No drawing this time' : 'Drawing sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
      else { show('v-draw'); $('dround').textContent = 'Draw!'; drawView(go, gc); }
    }
    else if (s.phase === 'loading' && s.draw) { show('v-wait'); $('waittitle').textContent = 'Get ready…'; $('waitsub').textContent = s.draw.pid === pid ? 'Your drawing is next.' : 'Next: a drawing by ' + s.draw.name + '.'; }
    else if (s.phase === 'guess' && s.draw && s.draw.pid === pid) { show('v-wait'); $('waittitle').textContent = 'Your drawing!'; $('waitsub').textContent = 'The others are guessing what it is.'; }
    else if (s.phase === 'picks') { show('v-wait'); $('waittitle').textContent = 'Answers are in'; $('waitsub').textContent = 'Watch the big screen.'; }
    else if (s.phase === 'paused') { show('v-wait'); $('waittitle').textContent = 'Game restored'; $('waitsub').textContent = 'The host will continue in a moment.'; }
    else if (s.phase === 'loading' && s.remote) { show('v-wait'); $('waittitle').textContent = 'Get ready…'; $('waitsub').textContent = 'Turn your sound on.'; }
    else if (s.phase === 'loading') { show('v-wait'); $('waittitle').textContent = 'Ears open…'; $('waitsub').textContent = ''; }
    else if (s.phase === 'guess') {
      var q = s.q || { type: 'open', text: 'Which song is this?', hint: 'Type the title…' };
      if (m && m.got) { show('v-wait'); $('waittitle').textContent = 'Correct'; $('waitsub').textContent = ptsText(m.pts) + '. Waiting for the others…'; }
      else if (m && m.done) { show('v-wait'); $('waittitle').textContent = 'Incorrect'; $('waitsub').textContent = 'Your answer is locked in. Waiting for the others…'; }
      else {
        show('v-guess'); $('roundlabel').textContent = 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total);
        $('pdraw').classList.toggle('hidden', !s.draw);
        if (s.draw && builtKey !== key) drawClear($('pdraw'));
        $('qtext').textContent = q.text;
        var mc = q.type === 'mc';
        $('guessform').classList.toggle('hidden', mc); $('opts').classList.toggle('hidden', !mc);
        if (builtKey !== key) {   // build the question once per song, so typing is never wiped
          builtKey = key;
          $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb';
          $('guess').placeholder = q.hint || ''; $('guess').inputMode = (q.subject === 'place' || q.subject === 'points' || q.subject === 'year') ? 'numeric' : 'text';
          $('opts').innerHTML = mc ? q.options.map(function (o, i) { return '<button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button>'; }).join('') : '';
          if (!mc) $('guess').focus();
        }
      }
    }
    else if (s.phase === 'reveal' || s.phase === 'end') {
      show('v-reveal');
      var r = s.reveal || {};
      if (s.phase !== 'end') $('verdict').className = 'fb verdict' + (s.draw && s.draw.pid === pid ? (m && m.got ? ' ok' : ' no') : '');
      $('verdict').textContent = s.phase === 'end' ? $('verdict').textContent || 'Final scores' : (s.draw && s.draw.pid === pid ? (m && m.got ? 'They got it! +' + m.pts : 'Nobody guessed it') : (s.q && s.q.text) || '');   // the question stays where it was, so the bars do not move
      var why = s.phase === 'reveal' && s.q && s.q.explain;   // the odd-one-out reason takes the top line, right under the video
      $('rround').textContent = s.phase === 'end' ? '' : why || 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total);
      $('rround').className = why ? 'why' : 'mute';
      // The end of the game: no song any more, just the scoreboard counting up (once).
      var end = s.phase === 'end';
      $('songcard').classList.toggle('hidden', end); $('pfinal').classList.toggle('hidden', !end);
      if (end && !endShown) {
        endShown = true; $('verdict').className = 'fb verdict'; $('verdict').textContent = 'Final scores';
        finalBoard($('pfinal'), s.players, pid, function (wins) {
          var iWon = wins.some(function (w) { return w.pid === pid; });
          $('verdict').className = 'fb verdict ' + (iWon ? 'ok' : '');
          $('verdict').textContent = !wins.length ? 'Nobody scored' : iWon ? (wins.length > 1 ? 'You share the win!' : 'You win!') : wins.map(function (w) { return w.name; }).join(' & ') + (wins.length > 1 ? ' win!' : ' wins!');
        }, !!s.remote);
      }
      if (!end) endShown = false;
      var rev = s.phase === 'reveal';
      // Draw!: the finished drawing stays in view at the reveal (the drawer's own pad, or what the others saw).
      if (rev && s.draw && fresh) { try { $('rdraw').src = $(s.draw.pid === pid ? 'dcanvas' : 'pdraw').toDataURL('image/png'); } catch (e) {} }
      $('rdraw').classList.toggle('hidden', !(rev && s.draw));
      $('ropts').innerHTML = rev && s.q ? revealOptions(s.q, m ? m.pick : null, s.draw && s.draw.pid === pid ? null : m ? (m.pts || 0) : null) : '';
      $('rpts').textContent = '';
      $('rpts').className = 'rpts ' + (m && m.got ? 'ok' : 'no');
      if (rev && s.sing) {
        // A Sing! round: show the votes instead of right or wrong.
        var mine = (s.sing.result || []).filter(function (r) { return r.pid === pid; })[0];
        $('verdict').className = 'fb verdict ' + (mine ? 'ok' : 'no');
        $('verdict').textContent = mine ? (mine.win ? 'Best singer!' : mine.votes + (mine.votes === 1 ? ' vote' : ' votes') + ' for you') : 'You didn’t sing this one';
        $('ropts').innerHTML = (s.sing.result || []).map(function (r) { return '<div class="opt' + (r.win ? ' right' : '') + '">' + esc(r.name) + ' · ' + r.votes + (r.votes === 1 ? ' vote' : ' votes') + '</div>'; }).join('');
        $('rpts').textContent = ptsText(mine ? mine.pts : 0);
        $('rpts').className = 'rpts ' + (mine ? 'ok' : 'no');
      }
      $('ranswer').textContent = '';   // the green bar already says it
      $('rtitle').textContent = r.title || '';
      $('rmeta').textContent = r.title ? r.artist + ' · ' + flag(r.code) + ' ' + (countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('rres').textContent = (s.phase === 'reveal' && r.result) || '';
      $('myscorebox').classList.toggle('hidden', !!s.hide || end);
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
    $('sround').textContent = 'Song ' + s.round + (s.total >= 9999 ? '' : ' of ' + s.total) + ' · Sing!';
    var poll = s.phase === 'svote' || s.phase === 'sbest', recPhase = s.phase === 'srec' && !(m && m.in);
    $('sopts').classList.toggle('hidden', !poll); $('srec').classList.toggle('hidden', !recPhase);
    // While listening or recording: ask for another part of the song (a few times per round at most).
    $('sbad').classList.toggle('hidden', !((s.phase === 'slisten' || s.phase === 'srec') && sg.rerolls_left > 0)); if (fresh || sg.rerolls_left !== lastRerolls) { $('sbad').disabled = false; lastRerolls = sg.rerolls_left; }
    if (fresh) { $('sfb').textContent = ''; $('sfb').className = 'fb'; if (s.phase !== 'srec') { recReset(); recRelease(); } }
    var name = sg.song ? sg.song.title + ' – ' + sg.song.artist : '';
    if (poll && m && m.in && $('sfb').textContent === 'Sending your vote…') $('sfb').textContent = 'Vote received. You can still change it.';
    if (s.phase === 'svote') {
      $('stitle').textContent = 'Which song shall we sing?'; $('ssub').textContent = 'Vote for one. The most votes wins.';
      if (fresh) $('sopts').innerHTML = (sg.options || []).map(function (o, i) { return '<div class="optcol"><button type="button" class="opt" data-i="' + i + '"><b>' + 'ABCD'[i] + '</b>' + esc(o) + '</button><div class="voters" data-t="' + i + '"></div></div>'; }).join('');
      [].forEach.call($('sopts').querySelectorAll('.voters'), function (el) { var n = (sg.tally || [])[+el.getAttribute('data-t')] || 0; el.textContent = n ? n + (n === 1 ? ' vote' : ' votes') : 'No votes yet'; el.classList.toggle('mute', !n); });
    } else if (s.phase === 'sbest') {
      $('stitle').textContent = 'Who sang it best?'; $('ssub').textContent = 'You can’t vote for yourself.';
      if (fresh) $('sopts').innerHTML = (sg.order || []).map(function (o, i) { return o.pid === pid ? '' : '<button type="button" class="opt" data-i="' + i + '">' + esc(o.name) + '</button>'; }).join('');
    } else if (s.phase === 'srec') {
      $('stitle').textContent = m && m.in ? 'Got it!' : 'Your turn to sing!';
      $('ssub').textContent = m && m.in ? 'Waiting for the others…' : name + '. Record up to 10 seconds.';
      if (fresh) { recReset(); recSent = ''; }
    } else if (s.phase === 'sroll') {
      $('stitle').textContent = 'It’s a tie!'; $('ssub').textContent = 'Watch the big screen: the roulette decides.';
    } else if (s.phase === 'splay') {
      $('stitle').textContent = sg.now ? (sg.pass === 2 ? 'Once more: ' : 'Now singing: ') + sg.now : 'Showtime!'; $('ssub').textContent = 'Listen on the big screen.';
    } else {
      $('stitle').textContent = 'We’re singing'; $('ssub').textContent = name ? name + '. Listen first, then it’s your turn.' : 'Get ready…';
    }
  }
  $('sopts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || !net) return;
    [].forEach.call($('sopts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    var choice = +b.getAttribute('data-i'), vk = sKey, seq = ++voteSeq;
    net.send('poll', { pid: pid, choice: choice });
    // Messages over the room connection can get lost, so the vote is repeated a few times (the host just overwrites it).
    [700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (seq === voteSeq && sKey === vk && net) net.send('poll', { pid: pid, choice: choice }); }, ms); });
    $('sfb').className = 'fb close'; $('sfb').textContent = 'Sending your vote…';
  });
  var voteSeq = 0, sendTry = null, lastRerolls = -1;
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
  $('sbad').addEventListener('click', function () { if (!net) return; $('sbad').disabled = true; recReset(); recRelease(); net.send('poll', { pid: pid, reroll: true }); $('sfb').className = 'fb close'; $('sfb').textContent = 'Picking another part of the song…'; });
  $('sskip').addEventListener('click', function () { recReset(); recRelease(); if (net) net.send('clip', { pid: pid, skip: true }); });
  $('ssend').addEventListener('click', function () {
    if (!recBlob || !net || recSent === sKey) return;
    recSent = sKey; $('srecstate').className = 'fb'; $('srecstate').textContent = 'Sending…';
    var fr = new FileReader();
    fr.onload = function () {
      // Sent in small pieces: the room connection has a size limit per message.
      var b64 = String(fr.result).split(',')[1] || '', size = 40000, n = Math.max(1, Math.ceil(b64.length / size)), key = Math.random().toString(36).slice(2), i = 0;
      if (n > 16) { recSent = ''; $('srecstate').className = 'fb no'; $('srecstate').textContent = 'That recording is too large. Please record again.'; return; }
      var mime = recBlob.type, sk = sKey, tries = 0;
      var step = function () {
        if (sKey !== sk || !net) return;
        net.send('clip', { pid: pid, key: key, i: i, n: n, mime: mime, data: b64.slice(i * size, (i + 1) * size) });
        if (++i < n) setTimeout(step, 150);
      };
      step();
      // The host confirms through the game state. No confirmation: send everything again, twice at most.
      clearInterval(sendTry);
      sendTry = setInterval(function () {
        var mm = me();
        if (sKey !== sk || !state || state.phase !== 'srec' || (mm && mm.in)) { clearInterval(sendTry); return; }
        if (i < n) return;   // still sending
        if (++tries > 2) { clearInterval(sendTry); recSent = ''; $('srecstate').className = 'fb no'; $('srecstate').textContent = 'Your recording did not arrive. Tap “Send it” to try again.'; return; }
        $('srecstate').textContent = 'Still sending…'; i = 0; step();
      }, 4000);
    };
    fr.readAsDataURL(recBlob);
  });


  // ---------- playing without a shared screen ----------
  // Every phone plays the clip itself. The host only says which video and where to start; the
  // phone loads it silently, reports when it is ready, and plays when the guessing starts.
  var introTry = 0;
  function clipSecs() { return Math.max(5, Math.round(((state && state.total_ms) || 20000) / 1000) - 5); }   // the host's Video time setting
  var yt = null, ytWanted = false, ytReady = false, clipKey = '', clipStart = 0, vStage = 'idle', vPoll = null, vWatch = null, vPlayed = '';
  function vCover(on, icon, text) { $('cover').classList.toggle('hidden', !on); if (on) { $('covericon').textContent = icon; $('covertext').textContent = text || ''; } }
  function vMasks(on) { $('mt').classList.toggle('hidden', !on); $('mb').classList.toggle('hidden', !on); }
  function vStop() { if (vAdOn) vAd(false); document.querySelector('#pstage .shield').classList.remove('hidden'); clearInterval(vPoll); clearTimeout(vWatch); $('tapplay').classList.add('hidden'); try { if (yt && ytReady) yt.pauseVideo(); } catch (e) {} }
  function ytLoad() {
    if (ytWanted) return;
    ytWanted = true;
    window.onYouTubeIframeAPIReady = function () {
      yt = new YT.Player('yt', { width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, playsinline: 1, fs: 0, modestbranding: 1 },
        events: { onReady: function () { ytReady = true; if (state) remoteVideo(state); },
          onError: function () {
            // The fanfare video refuses to play here: try the next spare.
            if ((vStage === 'intro' || vStage === 'primed') && ++introTry < INTRO.ids.length) { try { yt.loadVideoById(INTRO.ids[introTry]); if (vStage === 'intro') { yt.unMute(); yt.playVideo(); } } catch (e) {} return; }
            if (vStage === 'probe' || vStage === 'seek') { vStop(); vStage = 'bad'; if (net) net.send('ready', { pid: pid, key: clipKey, bad: true }); } } } });
    };
    var tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(tag);
  }
  var vLate = '';
  function vPrepare(clip) {
    vStop(); vStage = 'probe'; vPlayed = '';
    vCover(true, '♪', 'Selecting song'); vMasks(true);
    // A question without a clip: the video is not loaded at all until the answer, so nothing can be glimpsed.
    vLate = clip.noclip ? clip.id : '';
    if (vLate) { try { yt.stopVideo(); } catch (e) {} vStage = 'ready'; if (net) net.send('ready', { pid: pid, key: clipKey }); setTimeout(function () { if (state) remoteVideo(state); }, 0); return; }
    yt.mute(); yt.loadVideoById(clip.id);
    vWatch = setTimeout(function () { if (vStage === 'probe' || vStage === 'seek') { vStage = 'slow'; if (net) net.send('ready', { pid: pid, key: clipKey, slow: true }); } }, 10000);
    var seekAt = 0, loadAt = Date.now(), got = false;
    vAd(false);
    // An ad before the video cannot be skipped from here: keep jumping until the real video is at the
    // right spot, and uncover the player so the ad can be skipped by hand.
    vPoll = setInterval(function () {
      var st = yt.getPlayerState(), t = yt.getCurrentTime() || 0, d = yt.getDuration() || 0, late = Date.now() - loadAt;
      // A question without a clip never shows the player before the answer: slow or behind an ad, just carry on.
      if (clip.noclip && late > 6000) { clearInterval(vPoll); clearTimeout(vWatch); try { yt.pauseVideo(); } catch (e) {} vStage = 'ready'; if (net) net.send('ready', { pid: pid, key: clipKey }); if (state) remoteVideo(state); return; }
      if (late > 6000) vAd(true);   // stuck for whatever reason: show the player, so an ad or an error is visible and can be clicked
      if (st !== 1 || d <= 0) return;
      if (d < 100 && late < 40000) { if (late > 2500) vAd(true); return; }   // shorter than any song
      var cs = d < 45 ? 0 : Math.floor(15 + clip.frac * (d - 15 - 20 - clipSecs()));   // same spot on every phone
      if (!got || cs !== clipStart) { got = true; clipStart = cs; seekAt = 0; }
      if (t >= clipStart && t < clipStart + 5) {
        clearInterval(vPoll); clearTimeout(vWatch); yt.pauseVideo(); vStage = 'ready'; vAd(false);
        if (net) net.send('ready', { pid: pid, key: clipKey, rem: Math.round(d - clipStart) });
        if (state) remoteVideo(state);
      } else if (Date.now() - seekAt > 1500) {
        seekAt = Date.now(); yt.seekTo(clipStart, true);
        if (late > 6000) vAd(true);
      }
    }, 120);
  }
  var vAdOn = false;
  function vAd(on) {
    if (on && state && state.clip && state.clip.noclip) return;   // never uncover the video of a question that has no clip
    if (on === vAdOn) return;
    vAdOn = on;
    document.querySelector('#pstage .shield').classList.toggle('hidden', on);
    if (on) { vCover(false); $('mb').classList.add('hidden'); $('tapplay').classList.add('hidden'); if (net) net.send('ready', { pid: pid, key: clipKey, ad: true }); }
    else $('mb').classList.remove('hidden');   // the bottom mask comes back: it hides the caption with the country
    $('adnote').textContent = on ? AD_TEXT : '';
  }
  function vPlay(full) {
    clearInterval(vPoll); vStage = full ? 'full' : 'clip';
    // At the reveal the video carries on from where the clip stopped; only the clip itself starts from its mark.
    if (full && vLate) { clipStart = Math.floor(35 + Math.random() * 50); try { yt.unMute(); yt.setVolume(100); yt.loadVideoById({ videoId: vLate, startSeconds: clipStart }); } catch (e) {} vLate = ''; }
    else try { var tNow = yt.getCurrentTime() || 0; if (!full || !(tNow >= clipStart - 1 && tNow <= clipStart + clipSecs() + 2)) yt.seekTo(clipStart, true); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {}
    vCover(false); vMasks(!full);
    // Phones may refuse to start sound without a touch: offer a button if nothing is playing.
    clearTimeout(vWatch);
    vWatch = setTimeout(function () { try { if (yt.getPlayerState() !== 1) $('tapplay').classList.remove('hidden'); } catch (e) {} }, 1800);
    if (full) {
      // while an ad plays instead of the song, the player can be tapped (Skip ad)
      var sh = document.querySelector('#pstage .shield');
      vPoll = setInterval(function () {
        if (vStage !== 'full') { clearInterval(vPoll); sh.classList.toggle('hidden', vAdOn); return; }
        sh.classList.toggle('hidden', revealHold(yt, clipStart) === 'ad');
      }, 400);
      return;
    }
    vPoll = setInterval(function () {
      if ((yt.getCurrentTime() || 0) >= clipStart + clipSecs()) { clearInterval(vPoll); yt.pauseVideo(); vStage = 'paused'; $('tapplay').classList.add('hidden'); if (state && state.phase === 'guess') vCover(true, '?', ''); }
    }, 100);
  }
  $('tapplay').addEventListener('click', function () { $('tapplay').classList.add('hidden'); try { yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {} });
  function remoteVideo(s) {
    var m = me();
    if (s.remote && m && s.phase === 'intro' && ytReady) {
      $('pstage').classList.remove('hidden'); $('pstage').classList.add('audioonly');   // the fanfare is sound only
      if (vStage !== 'intro') { vStage = 'intro'; clipKey = ''; try { yt.loadVideoById(INTRO.ids[introTry] || INTRO.ids[0]); yt.unMute(); yt.setVolume(100); yt.playVideo(); } catch (e) {} }
      return;
    }
    if (vStage === 'primed' && s.phase === 'brief') { try { if (yt.getPlayerState() === 1) yt.pauseVideo(); } catch (e) {} }
    $('pstage').classList.remove('audioonly');
    var on = !!(s.remote && s.clip && m && (s.phase === 'loading' || s.phase === 'guess' || s.phase === 'reveal'));
    $('pstage').classList.toggle('hidden', !on);
    // The chat bar sits at the bottom of the screen in games without a shared screen.
    var chatOn = !!(s.remote && m) && !(document.body.classList.contains('embed') && (s.phase === 'lobby' || s.phase === 'brief'));
    $('chatbar').classList.toggle('hidden', !chatOn); document.body.classList.toggle('haschat', chatOn);
    if (!s.remote) return;
    ytLoad();
    if (!on) { if (vStage !== 'idle') { vStop(); vStage = 'idle'; clipKey = ''; } return; }
    if (!ytReady) return;
    var key = s.clip.id + ':' + s.round;
    if (key !== clipKey) { clipKey = key; vPrepare(s.clip); return; }
    var ready = vStage === 'ready' || vStage === 'clip' || vStage === 'paused' || vStage === 'full';
    if (!ready) return;
    if (s.phase === 'guess' && s.q && s.q.noclip) { if (vPlayed !== 'none') { vPlayed = 'none'; vStage = 'paused'; vCover(true, '?', ''); } }   // odd one out: nothing plays until the answer
    else if (s.phase === 'guess' && vPlayed !== 'clip' && vPlayed !== 'full') { vPlayed = 'clip'; vPlay(false); }
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
    if (!chatOpen && c.pid !== pid) {
      // A new message pops up just above the bar for a few seconds; the ring marks it as unread.
      $('chatbtn').classList.add('lit');
      var x = chatLog[chatLog.length - 1], pop = document.createElement('div');
      pop.className = 'pop'; pop.innerHTML = charSvg(x.char) + '<span><b>' + esc(x.name) + '</b>' + esc(x.text) + '</span>';
      $('chatpop').appendChild(pop);
      while ($('chatpop').children.length > 3) $('chatpop').removeChild($('chatpop').firstChild);
      setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 5200);
    }
  }
  function rowUpdate() { $('stagerow').classList.toggle('hidden', $('pstage').classList.contains('hidden')); $('pstage').classList.toggle('novideo', !!(state && (state.draw || (state.clip && state.clip.noclip)) && state.phase !== 'reveal')); $('stagerow').classList.toggle('flat', $('pstage').classList.contains('audioonly') || !!(state && state.draw && state.phase === 'guess')); }
  function chatToggle(open) {
    chatOpen = open; $('chat').classList.toggle('hidden', !open);
    if (open) $('chatpop').innerHTML = '';
    if (open) { $('chatbtn').classList.remove('lit'); $('chatlog').scrollTop = $('chatlog').scrollHeight; }
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
  $('lobbystart').addEventListener('click', function () { if (net && state && state.phase === 'lobby' && state.all_ready) net.send('go', { pid: pid, start: true }); });
  var readySeq = 0;
  $('lobbyready').addEventListener('click', function () {
    if (!net || !state || state.phase !== 'lobby') return;
    var mm = me(), off = !!(mm && mm.in), msg = { pid: pid, off: off };
    $('lobbyready').classList.toggle('on', !off); $('lobbyreadytext').textContent = off ? 'Ready' : 'Ready!';
    var seq = ++readySeq;
    net.send('go', msg);
    setTimeout(function () { var m2 = me(); if (seq === readySeq && net && state && state.phase === 'lobby' && m2 && !!m2.in === off) net.send('go', msg); }, 1200);   // in case the first one got lost
  });
  $('readybtn').addEventListener('click', function () {
    if (!net) return;
    net.send('go', { pid: pid });
    $('readybtn').classList.add('hidden'); $('briefwait').textContent = 'You’re ready. Waiting for the others…';
    // Without a shared screen this tap also wakes up the phone's own video player, so sound can start later.
    if (state && state.remote && yt && ytReady) { try { yt.mute(); yt.loadVideoById(INTRO.ids[0]); vStage = 'primed'; } catch (e) {} }
  });
  function renderPicker(s, m) {
    var taken = {};
    s.players.forEach(function (p) { if (p.pid !== pid && p.char) taken[p.char] = p.name; });
    // Only redraw when something changed, so the photos do not reload on every update.
    var k = JSON.stringify(taken) + '|' + (m ? m.char : '') + '|' + (Date.now() < pickUntil ? want : '');
    if (k !== pickKey) {
      pickKey = k;
      $('chars').innerHTML = CHARS.map(function (c) {
        return '<button type="button" data-char="' + c.id + '"' + (taken[c.id] ? ' disabled title="Taken by ' + esc(taken[c.id]) + '"' : '') +
          ((Date.now() < pickUntil ? want : (m && m.char)) === c.id ? ' class="mine"' : '') + '>' + charSvg(c.id) + '<span>' + esc(c.name) + '</span></button>';
      }).join('');
    }
    var left = CHARS.filter(function (c) { return !taken[c.id]; }).length;
    $('pickerr').textContent = left ? (want && taken[want] ? 'Too slow, ' + taken[want] + ' just took that one. Pick another!' : '') : 'All other avatars are taken.';
    if (want && taken[want]) want = null;
  }
  $('chars').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-char]');
    if (!b || b.disabled) return;
    want = b.getAttribute('data-char'); pickUntil = Date.now() + 3000;   // give the host a moment to confirm; "Done" closes the editor
    try { sessionStorage.setItem('esc-char', want); } catch (err) {}
    $('pickerr').textContent = ''; hi(); if (state) onState(state);
  });
  // Two separate edit screens: one for the name, one for the avatar.
  function pickOpen(mode) {
    picking = true; $('editname').value = name;
    $('picktitle').textContent = mode === 'name' ? 'Your name' : 'Your avatar';
    $('pickname').classList.toggle('hidden', mode !== 'name');
    $('pickavnote').classList.toggle('hidden', mode === 'name'); $('chars').classList.toggle('hidden', mode === 'name');
    if (state) onState(state);
    if (mode === 'name') { try { $('editname').focus(); $('editname').select(); } catch (e) {} }
  }
  $('changechar').addEventListener('click', function () { pickOpen('avatar'); });
  $('changename').addEventListener('click', function () { pickOpen('name'); });
  $('pickdone').addEventListener('click', function () {
    var n = $('editname').value.trim().slice(0, 16);
    if (n) { name = n; store.set('esc-name', name); $('name').value = name; }
    picking = false; hi(); if (state) onState(state);
  });

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
  // ---------- Draw!: the drawer's pad ----------
  var padPicked = -1, padDone = false, padSkipped = false;
  // The pad screen: first the four songs (and a way out), then the canvas.
  function drawView(go, gc) {
    var picked = gc >= 0 && !!go[gc];
    $('dtitle').textContent = picked ? 'Draw: ' + go[gc] : 'Pick a song to draw';
    $('dopts').classList.toggle('hidden', picked); $('dpass').classList.toggle('hidden', picked); $('dpad').classList.toggle('hidden', !picked);
  }
  // Tell the host a few times, in case a message gets lost; it only takes the first.
  function drawTell(m) { var dk = dKey; m.pid = pid; [0, 700, 2000, 4500].forEach(function (ms) { setTimeout(function () { if (dKey === dk && state && state.phase === 'dall' && net) net.send('draw', m); }, ms); }); }
  function drawFinish(skip) { padFlush(); padDone = true; padSkipped = !!skip; drawTell(skip ? { skip: 1 } : { done: 1 }); show('v-wait'); $('waittitle').textContent = padSkipped ? 'No drawing this time' : 'Drawing sent!'; $('waitsub').textContent = 'Waiting for the others…'; }
  $('dpass').addEventListener('click', function () { drawFinish(true); });
  $('ddone').addEventListener('click', function () { drawFinish(false); });
  var dKey = '', padColor = 0, padWidth = 6, padBuf = [], padDown = false, padLast = null, padTick = null;
  function padTools() {
    $('dtools').innerHTML = DRAW_COLORS.map(function (c, i) {
      return '<button type="button" data-c="' + i + '" class="' + (i === padColor ? 'on' : '') + '" style="background:' + c + '" aria-label="' + (i === DRAW_COLORS.length - 1 ? 'Eraser' : 'Colour') + '">' + (i === DRAW_COLORS.length - 1 ? '⌫' : '') + '</button>';
    }).join('') + '<button type="button" data-w="1" class="wide">' + (padWidth > 6 ? 'Thick' : 'Thin') + '</button><button type="button" data-clear="1" class="wide">Clear</button>';
  }
  function padSend(m) { m.pid = pid; if (net) net.send('draw', m); }
  function padFlush() {
    if (padBuf.length < 2) return;
    var m = { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: padBuf };
    padSend(m); padBuf = padDown && padLast ? [padLast[0], padLast[1]] : [];   // the next batch continues from the last point
  }
  function padReset() { padBuf = []; padDown = false; padLast = null; drawClear($('dcanvas')); padTools(); clearInterval(padTick); padTick = setInterval(function () { if (padBuf.length > 2) padFlush(); }, 120); }
  function padPoint(e) { var r = $('dcanvas').getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * DRAW_W), Math.round((e.clientY - r.top) / r.height * DRAW_H)]; }
  function padLocal(a, b) { drawPaint($('dcanvas'), { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: b ? [a[0], a[1], b[0], b[1]] : [a[0], a[1]] }); }
  $('dcanvas').addEventListener('pointerdown', function (e) {
    if (!state || state.phase !== 'dall' || padDone) return;
    e.preventDefault(); try { $('dcanvas').setPointerCapture(e.pointerId); } catch (x) {}
    padDown = true; padLast = padPoint(e); padBuf = [padLast[0], padLast[1]]; padLocal(padLast);
  });
  $('dcanvas').addEventListener('pointermove', function (e) {
    if (!padDown) return;
    e.preventDefault(); var p = padPoint(e);
    if (Math.abs(p[0] - padLast[0]) + Math.abs(p[1] - padLast[1]) < 3) return;
    padLocal(padLast, p); padLast = p; padBuf.push(p[0], p[1]);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { $('dcanvas').addEventListener(ev, function () {
    if (!padDown) return;
    padDown = false; if (padBuf.length >= 2) { var m = { c: padColor, w: padColor === DRAW_COLORS.length - 1 ? padWidth * 4 : padWidth, p: padBuf }; padSend(m); } padBuf = [];
  }); });
  $('dtools').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-c')) padColor = +b.getAttribute('data-c');
    else if (b.hasAttribute('data-w')) padWidth = padWidth > 6 ? 6 : 14;
    else if (b.hasAttribute('data-clear')) { drawClear($('dcanvas')); padSend({ clear: 1 }); }
    padTools();
  });
  $('dopts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || !net) return;
    padPicked = +b.getAttribute('data-i'); padSkipped = false;
    drawTell({ pick: padPicked });
    if (state && state.gallery) drawView(state.gallery.opts[pid] || [], padPicked);   // straight to the pad
  });
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (!b || b.disabled || !net) return;
    [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.classList.remove('picked'); });
    b.classList.add('picked');
    var final = !!(state && state.draw);   // Draw!: the first guess counts
    if (final) [].forEach.call($('opts').querySelectorAll('button'), function (x) { x.disabled = true; });
    $('fb').className = 'fb close'; $('fb').textContent = final ? 'Answer in. No changing this one!' : 'Answer in. You can still change it until everyone has answered.';
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
    var cd = revealAt ? Math.max(0, Math.ceil((revealAt - Date.now()) / 1000)) : 0;
    var inGuess = !!(state && state.phase === 'guess');
    $('allin').textContent = cd && !inGuess ? 'Everyone has voted. Continuing in ' + cd : '';
    $('allinq').textContent = cd && inGuess ? (state.players.length > 1 ? 'Everyone answered, revealing in ' : 'Revealing in ') + cd : '';   // below the answer bars
    var nx = nextAt ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : 0;
    $('rnext').textContent = nx && state ? (state.round >= state.total || state.last ? 'Final scores in ' : 'Next song in ') + clock(nx) : '';   // same line as "All players answered"

    if (!state) return;
    if (state.phase === 'intro') $('briefwait').textContent = 'Starting in ' + Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
    var ms = state.bar_ms || state.total_ms, f = ms ? Math.max(0, Math.min(1, (endsAt - Date.now()) / ms)) : 0;
    if (state.gallery && state.phase === 'dall') $('dbar').style.transform = 'scaleX(' + f + ')';
    if (state.phase === 'guess') $('pbar').style.transform = 'scaleX(' + f + ')';
    else if (state.sing) $('sbar').style.transform = 'scaleX(' + (state.phase === 'loading' || state.phase === 'splay' ? 0 : f) + ')';
  }, 100);
})();
