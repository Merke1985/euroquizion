// The cast: Eurovision artists, each of which can be picked by one player per room.
// The photos come from Wikimedia Commons under free licences; see credits.html.
function commons(file) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=330'; }
var CHARS = [
  { id: 'kaarija', name: 'Käärijä', file: 'Käärijä esiintymässä Louhela Jam -tapahtumassa (Vantaa, 2023) – 01 (cropped) (cropped).jpg', by: 'Sanni Penttinen', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0' },
  { id: 'loreen', name: 'Loreen', file: 'Loreen Eurovision 2012 winner.jpg', by: 'Vugarİbadov', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0', pos: '50% 45%' },
  { id: 'verka', name: 'Verka Serduchka', file: 'Verka Serduchka 2017 1 (cropped).jpg', by: 'Serecki', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  { id: 'logan', name: 'Johnny Logan', file: 'Eurovision Song Contest 1980 - Johnny Logan 4 (cropped).jpg', by: 'Hans van Dijk / Anefo', lic: 'CC0', licUrl: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en', pos: '50% 12%', face: [50, 30], zoom: 2.4 },
  { id: 'conchita', name: 'Conchita Wurst', file: 'Conchita Wurst, ESC2014 Meet & Greet 12 (crop).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0' },
  { id: 'lordi', name: 'Lordi', file: 'Lordi performing at the ESC 2007.jpg', by: 'Indrek Galetin', lic: 'Nagi BY-SA', licUrl: 'http://nagi.ee/lists/PhotoLicense/Attribution-ShareAlike', pos: '60% 50%', face: [55, 34], zoom: 1.7 },
  { id: 'babylasagna', name: 'Baby Lasagna', file: 'Baby Lasagna 01 (cropped).jpg', by: 'Pedro J Pacheco', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 20%', face: [50, 32], zoom: 1.5 },
  { id: 'perrelli', name: 'Charlotte Perrelli', file: 'Charlotte Perrelli, Melodifestivalen 2017 (cropped).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 30%' },
  { id: 'rybak', name: 'Alexander Rybak', file: 'Alexander Rybak during Eurovision 2009.jpg', by: 'Daniel Kruczynski', lic: 'CC BY-SA 2.0', licUrl: 'https://creativecommons.org/licenses/by-sa/2.0', pos: '50% 20%' },
  { id: 'joost', name: 'Joost Klein', file: 'Joost Klein Press Event 2024 (cropped) B.jpg', by: 'VDanDesign', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0', pos: '50% 10%' },
  { id: 'tyler', name: 'Bonnie Tyler', file: 'Bonnie Tyler, ESC2013 press conference 02 (cropped).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0', pos: '50% 30%' }
];
var CHAR_BY_ID = {};
CHARS.forEach(function (c) { CHAR_BY_ID[c.id] = c; });
// An avatar is a round frame with the photo inside. A photo can be zoomed in on the face: 'face' is
// where the face sits in the (square-cropped) picture in percent, 'zoom' how much to enlarge it.
function charSvg(id) {
  var c = CHAR_BY_ID[id];
  if (!c) return '';
  var z = c.zoom || 1, f = c.face || [50, 50];
  var tf = z > 1 ? ';transform:translate(' + ((50 - f[0]) * z).toFixed(1) + '%,' + ((50 - f[1]) * z).toFixed(1) + '%) scale(' + z + ')' : '';
  return '<span class="char"><img src="' + commons(c.file) + '" alt="' + c.name + '" style="object-position:' + (c.pos || '50% 20%') + tf + '"></span>';
}
