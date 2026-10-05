(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // One player id per tab; survives a refresh.
  var pid = null;
  try { pid = sessionStorage.getItem('esc-pid'); } catch (e) {}
  if (!pid) pid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try { sessionStorage.setItem('esc-pid', pid); } catch (e) {}
  var net = null, name = '', room = '', state = null, endsAt = 0, countries = {}, joinTimer = null, hiTimer = null, lastPhaseKey = '';

  $('name').value = store.get('esc-name') || '';
  var k = new URLSearchParams(location.search).get('k');
  if (k) $('code').value = k.toUpperCase().slice(0, 4);
  fetch('songs.json').then(function (r) { return r.json(); }).then(function (d) { countries = d.countries; }).catch(function () {});

  function show(id) { ['v-join', 'v-wait', 'v-guess', 'v-reveal'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); }); }

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
    var hi = function () {
      var m = me();
      net.send('hi', { pid: pid, name: name, score: m ? m.score : null,
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
    $('me').textContent = name + (m ? ' · ' + m.score : '');
    var key = s.phase + ':' + s.round;
    var fresh = key !== lastPhaseKey; lastPhaseKey = key;
    if (s.phase === 'lobby') { show('v-wait'); $('waittitle').textContent = 'You’re in!'; $('waitsub').textContent = 'Watch the big screen. The game starts soon.'; }
    else if (s.phase === 'paused') { show('v-wait'); $('waittitle').textContent = 'Game restored'; $('waitsub').textContent = 'The host will continue in a moment.'; }
    else if (s.phase === 'loading') { show('v-wait'); $('waittitle').textContent = 'Ears open…'; $('waitsub').textContent = 'Round ' + s.round + ' of ' + s.total; }
    else if (s.phase === 'guess') {
      if (m && m.got) { show('v-wait'); $('waittitle').textContent = 'Correct! +' + m.pts; $('waitsub').textContent = 'Waiting for the others…'; }
      else {
        show('v-guess'); $('roundlabel').textContent = 'Round ' + s.round + ' of ' + s.total;
        if (fresh) { $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb'; $('guess').focus(); }
      }
    }
    else if (s.phase === 'reveal' || s.phase === 'end') {
      show('v-reveal');
      var r = s.reveal || {};
      $('verdict').className = 'fb ' + (m && m.got ? 'ok' : 'no');
      $('verdict').textContent = s.phase === 'end' ? 'Game over!' : (m && m.got ? 'You got it! +' + m.pts : 'Not this time');
      $('rtitle').textContent = r.title || '';
      $('rmeta').textContent = r.title ? r.artist + ' · ' + flag(r.code) + ' ' + (countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('rres').textContent = (s.phase === 'reveal' && r.result) || '';
      $('myscore').textContent = m ? m.score : 0;
      var rank = m ? s.players.filter(function (p) { return p.score > m.score; }).length + 1 : 0;
      $('myrank').textContent = rank ? 'Place ' + rank + ' of ' + s.players.length : '';
    }
  }

  function onResult(r) {
    if (r.pid !== pid) return;
    var fb = $('fb');
    if (r.res === 'ok') return; // a state update follows
    fb.className = 'fb ' + (r.res === 'close' ? 'close' : 'no');
    fb.textContent = r.res === 'close' ? 'So close! Check your spelling.' : 'Nope, that’s not it. Try again!';
    if (r.res !== 'close') $('guess').value = '';
    $('guess').focus();
  }

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
