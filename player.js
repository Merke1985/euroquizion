(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // Per tabblad een eigen speler-id; blijft bewaard bij verversen.
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
    var hi = function () { net.send('hi', { pid: pid, name: name }); };
    net.on('_open', hi);
    clearInterval(hiTimer); hiTimer = setInterval(hi, 4000);
    show('v-wait'); $('waittitle').textContent = 'Verbinden…'; $('waitsub').textContent = 'Kamer ' + room;
    clearTimeout(joinTimer);
    joinTimer = setTimeout(function () {
      if (state) return;
      clearInterval(hiTimer); show('v-join');
      $('joinerr').textContent = 'Geen spel gevonden met code ' + room + '. Klopt de code?';
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
    if (s.phase === 'lobby') { show('v-wait'); $('waittitle').textContent = 'Je doet mee!'; $('waitsub').textContent = 'Kijk naar het grote scherm. Het spel begint zo.'; }
    else if (s.phase === 'loading') { show('v-wait'); $('waittitle').textContent = 'Oren open…'; $('waitsub').textContent = 'Ronde ' + s.round + ' van ' + s.total; }
    else if (s.phase === 'guess') {
      if (m && m.got) { show('v-wait'); $('waittitle').textContent = 'Goed! +' + m.pts; $('waitsub').textContent = 'Even wachten op de rest…'; }
      else {
        show('v-guess'); $('roundlabel').textContent = 'Ronde ' + s.round + ' van ' + s.total;
        if (fresh) { $('guess').value = ''; $('fb').textContent = ''; $('fb').className = 'fb'; $('guess').focus(); }
      }
    }
    else if (s.phase === 'reveal' || s.phase === 'end') {
      show('v-reveal');
      var r = s.reveal || {};
      $('verdict').className = 'fb ' + (m && m.got ? 'ok' : 'no');
      $('verdict').textContent = s.phase === 'end' ? 'Afgelopen!' : (m && m.got ? 'Goed geraden! +' + m.pts : 'Helaas, niet geraden');
      $('rtitle').textContent = r.title || '';
      $('rmeta').textContent = r.title ? r.artist + ' · ' + flag(r.code) + ' ' + (countries[r.code] || r.code.toUpperCase()) + ' ' + r.year : '';
      $('myscore').textContent = m ? m.score : 0;
      var rank = m ? s.players.filter(function (p) { return p.score > m.score; }).length + 1 : 0;
      $('myrank').textContent = rank ? 'Plek ' + rank + ' van ' + s.players.length : '';
    }
  }

  function onResult(r) {
    if (r.pid !== pid) return;
    var fb = $('fb');
    if (r.res === 'ok') return; // state-update volgt
    fb.className = 'fb ' + (r.res === 'close' ? 'close' : 'no');
    fb.textContent = r.res === 'close' ? 'Bijna! Kijk nog eens naar je spelling.' : 'Nee, dat is het niet. Probeer opnieuw!';
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
