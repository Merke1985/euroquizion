// The cast: Eurovision artists, each of which can be picked by one player per room.
// The photos come from Wikimedia Commons under free licences; see credits.html.
function commons(file) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=330'; }
var CHARS = [
  { id: 'kaarija', name: 'Käärijä', file: 'Käärijä esiintymässä Louhela Jam -tapahtumassa (Vantaa, 2023) – 01 (cropped) (cropped).jpg', by: 'Sanni Penttinen', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0', pos: '50% 0%', face: [45, 19], zoom: 2.6 },
  { id: 'loreen', name: 'Loreen', file: 'Loreen Melodifestivalen - 10 mars 2023.jpg', by: 'Anna Höök', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0', pos: '50% 50%', face: [42, 32], zoom: 1.9 },
  { id: 'verka', name: 'Verka Serduchka', file: 'Verka Serduchka 2017 1 (cropped).jpg', by: 'Serecki', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', face: [40, 55], zoom: 1.5 },
  { id: 'logan', name: 'Johnny Logan', file: 'Eurovision Song Contest 1980 postcards - Johnny Logan 05.png', by: 'NOS', lic: 'CC BY-SA 3.0 NL', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0/nl/deed.en', pos: '50% 50%', face: [36, 28], zoom: 2.1 },
  { id: 'conchita', name: 'Conchita Wurst', file: 'Conchita Wurst, ESC2014 Meet & Greet 12 (crop).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0', face: [51, 40], zoom: 1.8 },
  { id: 'lordi', name: 'Lordi', file: 'Lordi performing at the ESC 2007.jpg', by: 'Indrek Galetin', lic: 'Nagi BY-SA', licUrl: 'http://nagi.ee/lists/PhotoLicense/Attribution-ShareAlike', pos: '60% 50%', face: [53, 37], zoom: 3.0 },
  { id: 'babylasagna', name: 'Baby Lasagna', file: 'Baby Lasagna 01 (cropped).jpg', by: 'Pedro J Pacheco', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 20%', face: [51, 32], zoom: 1.9 },
  { id: 'perrelli', name: 'Charlotte Perrelli', file: 'Charlotte Perrelli, Melodifestivalen 2017 (cropped).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 30%', face: [50, 23], zoom: 2.1 },
  { id: 'rybak', name: 'Alexander Rybak', file: 'Alexander Rybak during Eurovision 2009.jpg', by: 'Daniel Kruczynski', lic: 'CC BY-SA 2.0', licUrl: 'https://creativecommons.org/licenses/by-sa/2.0', pos: '50% 20%', face: [50, 68], zoom: 1.6 },
  { id: 'joost', name: 'Joost Klein', file: 'Joost Klein Press Event 2024 (cropped) B.jpg', by: 'VDanDesign', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0', pos: '50% 10%', face: [42, 30], zoom: 1.8 },
  { id: 'tyler', name: 'Bonnie Tyler', file: 'Bonnie Tyler, ESC2013 press conference 02 (cropped).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0', pos: '50% 30%', face: [50, 42], zoom: 1.25 },
  { id: 'duncan', name: 'Duncan Laurence', file: 'Duncan Laurence with the 2019 Eurovision Trophy (cropped2).jpg', by: 'Martin Fjellanger, EuroVisionary', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 20%', face: [50, 48], zoom: 1.25 },
  { id: 'emmy', name: 'Emmy', file: 'PrepartyES - Emmy 02 (portrait).jpeg', by: 'Pedro J Pacheco', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 30%', face: [50, 38], zoom: 1.15 },
  { id: 'dustin', name: 'Dustin the Turkey', file: 'Dustin.jpg', by: 'AcerBen', lic: 'Public domain', licUrl: '', pos: '50% 50%', face: [52, 28], zoom: 1.6 },
  { id: 'sieneke', name: 'Sieneke', file: 'Sieneke (cropped).jpg', by: 'Vincent Hasselgård, Aktiv I Oslo.no', lic: 'CC BY-SA 2.0', licUrl: 'https://creativecommons.org/licenses/by-sa/2.0', pos: '50% 60%', face: [52, 62], zoom: 1.3 }
];
var CHAR_BY_ID = {};
CHARS.forEach(function (c) { CHAR_BY_ID[c.id] = c; });
// An avatar is a round frame with the photo inside. A photo can be zoomed in on the face: 'face' is
// where the face sits in the (square-cropped) picture in percent, 'zoom' how much to enlarge it.
/* each avatar holds a little flag: the fan-flag country of the player who has it (avatars are one per player) */
var CHAR_CC = {};
/* every player has one of 12 fixed colours (their body, and later their tiles, pole, phone…), easy to tell apart */
var PCOLS = [['#e53950', '#a3192f'], ['#2f80ed', '#1b4f99'], ['#f2c12e', '#b88a0c'], ['#27ae60', '#16723d'], ['#9b51e0', '#6a2aa6'], ['#f2994a', '#b8601a'], ['#ff6fb5', '#c43d82'], ['#1fc8c8', '#118585'], ['#8d6e63', '#5b4037'], ['#ffffff', '#b9b9c8'], ['#2b2b3a', '#121220'], ['#a3e635', '#5f8f12']];
/* players' own photos: avatar id 'u:<player id>' -> a small jpeg (data URL), sent around once */
var CHAR_IMG = {};
function picOk(d) { return typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(d) && d.length < 60000; }
function charCC(ps) { var m = {}; (ps || []).forEach(function (p) { if (p && p.char && p.cc) m[p.char] = p.cc; }); CHAR_CC = m; }
function charSvg(id) {
  var c = CHAR_BY_ID[id];
  if (!c && typeof id === 'string' && id.indexOf('u:') === 0) {   /* a player's own photo */
    var src = CHAR_IMG[id], ucc = CHAR_CC[id];
    return '<span class="char' + (ucc ? ' hasfl' : '') + '"><i class="chin">' + (src ? '<img src="' + src + '" alt="" style="object-position:50% 50%">' : '<b class="chnopic">🙂</b>') + '</i>' + (ucc ? '<i class="chflag"><b></b><img src="https://flagcdn.com/w40/' + ucc + '.png" alt=""></i>' : '') + '</span>';
  }
  if (!c) return '';
  var z = c.zoom || 1, f = c.face || [50, 50];
  var lim = 50 * (z - 1), cl = function (v) { return Math.max(-lim, Math.min(lim, v)); };   // (never past the photo's edge)
  var tf = z > 1 ? ';transform:translate(' + cl((50 - f[0]) * z).toFixed(1) + '%,' + cl((50 - f[1]) * z).toFixed(1) + '%) scale(' + z + ')' : '';
  var cc = CHAR_CC[id];
  return '<span class="char' + (cc ? ' hasfl' : '') + '"><i class="chin"><img src="' + commons(c.file) + '" alt="' + c.name + '" style="object-position:' + (c.pos || '50% 20%') + tf + '"></i>' +
    (cc ? '<i class="chflag"><b></b><img src="https://flagcdn.com/w40/' + cc + '.png" alt=""></i>' : '') + '</span>';
}

// Other photos in the game (not player characters), with their credits.
var EXTRA_PHOTOS = [
  { id: 'teyasalena', name: 'Teya & Salena (in Where the Hell Is Edgar?)', file: 'Teya and Salena (cropped).jpg', by: 'ESC Discord', lic: 'CC BY-SA 2.0', licUrl: 'https://creativecommons.org/licenses/by-sa/2.0' }
];
