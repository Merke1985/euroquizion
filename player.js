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
  var k = new URLSearchParams(location.search).get('k');
  if (k) $('code').value = k.toUpperCase().slice(0, 4);
  fetch('songs.json?v=20').then(function (r) { return r.json(); }).then(function (d) { countries = d.countries; }).catch(function () {});

  function show(id) { ['v-join', 'v-pick', 'v-wait', 'v-guess', 'v-reveal'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }

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
    state = s; clearTimeout(joinTimer);
    endsAt = Date.now() + (s.left || 0);
    var m = me();
    $('me').innerHTML = (m ? charSvg(m.char) : '') + esc(name + (m ? ' · ' + m.score : ''));
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
    if (s.phase === 'lobby') { show('v-wait'); $('waittitle').textContent = 'You’re in!'; $('waitsub').textContent = 'Watch the big screen. The game starts soon.'; }
    else if (s.phase === 'paused') { show('v-wait'); $('waittitle').textContent = 'Game restored'; $('waitsub').textContent = 'The host will continue in a moment.'; }
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
          $('guess').placeholder = q.hint || ''; $('guess').inputMode = q.subject === 'place' ? 'numeric' : 'text';
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
      $('ranswer').textContent = s.phase === 'reveal' && s.q && s.q.answer ? s.q.text + ' ' + s.q.answer : '';
      $('rtitle').textContent = r.title || '';
      $('rmeta').textContent = r.title ? r.artist + ' · ' + flag(r.code) + ' ' + (countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('rres').textContent = (s.phase === 'reveal' && r.result) || '';
      $('myscore').textContent = m ? m.score : 0;
      var rank = m ? s.players.filter(function (p) { return p.score > m.score; }).length + 1 : 0;
      $('myrank').textContent = rank ? 'Place ' + rank + ' of ' + s.players.length : '';
    }
  }

  function renderPicker(s, m) {
    var taken = {};
    s.players.forEach(function (p) { if (p.pid !== pid && p.char) taken[p.char] = p.name; });
    $('chars').innerHTML = CHARS.map(function (c) {
      return '<button type="button" data-char="' + c.id + '"' + (taken[c.id] ? ' disabled title="Taken by ' + esc(taken[c.id]) + '"' : '') +
        (m && m.char === c.id ? ' class="mine"' : '') + '>' + charSvg(c.id) + '<span>' + esc(c.name) + '</span></button>';
    }).join('');
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
    if (!state || state.phase !== 'guess' || !state.total_ms) return;
    $('pbar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, (endsAt - Date.now()) / state.total_ms)) + ')';
  }, 100);
})();
