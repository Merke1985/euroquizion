// The cast: Eurovision artists, each of which can be picked by one player per room.
// The photos come from Wikimedia Commons under free licences; see credits.html.
function commons(file) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=330'; }
var CHARS = [
  { id: 'kaarija', name: 'Käärijä', file: 'Käärijä esiintymässä Louhela Jam -tapahtumassa (Vantaa, 2023) – 01 (cropped) (cropped).jpg', by: 'Sanni Penttinen', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0' },
  { id: 'loreen', name: 'Loreen', file: 'Loreen Eurovision 2012 winner.jpg', by: 'Vugarİbadov', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0', pos: '50% 45%' },
  { id: 'verka', name: 'Verka Serduchka', file: 'Verka Serduchka 2017 1 (cropped).jpg', by: 'Serecki', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  { id: 'logan', name: 'Johnny Logan', file: 'Johnny Logan - NDR Hafengeburtstag 2017 20.jpg', by: 'Frank Schwichtenberg', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  { id: 'conchita', name: 'Conchita Wurst', file: 'Conchita Wurst, ESC2014 Meet & Greet 12 (crop).jpg', by: 'Albin Olsson', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0' },
  { id: 'abba', name: 'ABBA', file: 'ABBA - TopPop 1974 5.png', by: 'AVRO / Beeld & Geluid', lic: 'CC BY-SA 3.0 NL', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0/nl/deed.en', pos: '50% 30%' },
  { id: 'maneskin', name: 'Måneskin', file: 'Maneskin 2018.jpg', by: 'Paolo Santambrogio', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pos: '50% 30%' },
  { id: 'lordi', name: 'Lordi', file: 'Mr lordi hrh-2.jpg', by: 'Tktt (cropped by -Majestic- and Bff)', lic: 'public domain', licUrl: '', pos: '50% 25%' }
];
var CHAR_BY_ID = {};
CHARS.forEach(function (c) { CHAR_BY_ID[c.id] = c; });
function charSvg(id) {
  var c = CHAR_BY_ID[id];
  if (!c) return '';
  return '<img class="char" src="' + commons(c.file) + '" alt="' + c.name + '" style="object-position:' + (c.pos || '50% 20%') + '">';
}
