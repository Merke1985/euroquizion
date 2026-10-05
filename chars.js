// The cast: original characters built from Eurovision clichés. Each can be picked by one player per room.
var FACE = function (x, y, s, mood) {
  s = s || 1;
  var mouth = mood === 'sad' ? 'M' + (x - 5 * s) + ' ' + (y + 9 * s) + ' q' + 5 * s + ' ' + (-5 * s) + ' ' + 10 * s + ' 0'
    : 'M' + (x - 5 * s) + ' ' + (y + 6 * s) + ' q' + 5 * s + ' ' + 5 * s + ' ' + 10 * s + ' 0';
  return '<circle cx="' + (x - 5 * s) + '" cy="' + y + '" r="' + 1.9 * s + '" fill="#1b1340"/><circle cx="' + (x + 5 * s) + '" cy="' + y + '" r="' + 1.9 * s + '" fill="#1b1340"/>' +
    '<path d="' + mouth + '" fill="none" stroke="#1b1340" stroke-width="' + 1.8 * s + '" stroke-linecap="round"/>';
};
// Artist photos come from Wikimedia Commons under Creative Commons licences; see credits.html.
function commons(file) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=330'; }
var CHARS = [
  { id: 'kaarija', name: 'Käärijä', file: 'Käärijä esiintymässä Louhela Jam -tapahtumassa (Vantaa, 2023) – 01 (cropped) (cropped).jpg', by: 'Sanni Penttinen', lic: 'CC BY 4.0', licUrl: 'https://creativecommons.org/licenses/by/4.0' },
  { id: 'loreen', name: 'Loreen', file: 'Loreen - Melodifestivalen 2023, Malmö 118 (cropped).jpg', by: 'Jonatan Svensson Glad', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0' },
  { id: 'verka', name: 'Verka Serduchka', file: 'Verka Serduchka 2017 1 (cropped).jpg', by: 'Serecki', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  { id: 'logan', name: 'Johnny Logan', file: 'Johnny Logan - NDR Hafengeburtstag 2017 20.jpg', by: 'Frank Schwichtenberg', lic: 'CC BY-SA 4.0', licUrl: 'https://creativecommons.org/licenses/by-sa/4.0' },
  { id: 'conchita', name: 'Conchita Wurst', file: 'Conchita Wurst at Berlinale 2026-6.jpg', by: 'Elena Ternovaja', lic: 'CC BY-SA 3.0', licUrl: 'https://creativecommons.org/licenses/by-sa/3.0' },
  { id: 'disco', name: 'Disco Ball', bg: ['#6a3df0', '#2de2e6'], art:
    '<path d="M32 6v10" stroke="#fff" stroke-width="2"/><circle cx="32" cy="35" r="19" fill="#eef1ff"/>' +
    '<path d="M13 35h38M16 25h32M16 45h32M32 16v38M22 19c-4 10-4 22 0 32M42 19c4 10 4 22 0 32" fill="none" stroke="#a9b2e8" stroke-width="1.6"/>' +
    '<path d="M50 14l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="#ffd60a"/>' + FACE(32, 33) },
  { id: 'fan', name: 'Wind Machine', bg: ['#0aa5c9', '#7cf0c8'], art:
    '<path d="M26 50h12l3 8H23z" fill="#22305c"/><circle cx="30" cy="30" r="20" fill="#22305c"/><circle cx="30" cy="30" r="16" fill="#dff6ff"/>' +
    '<g fill="#5b7bd6"><ellipse cx="30" cy="20" rx="5" ry="9"/><ellipse cx="30" cy="20" rx="5" ry="9" transform="rotate(120 30 30)"/><ellipse cx="30" cy="20" rx="5" ry="9" transform="rotate(240 30 30)"/></g>' +
    '<circle cx="30" cy="30" r="4" fill="#22305c"/><path d="M53 20h8M55 30h7M53 40h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' },
  { id: 'key', name: 'Key Change', bg: ['#ff2e88', '#ff9d3d'], art:
    '<g transform="rotate(-38 32 32)"><circle cx="18" cy="32" r="11" fill="#ffd60a"/><circle cx="18" cy="32" r="4.5" fill="#c2185b"/>' +
    '<path d="M28 29h28v6h-5v7h-6v-7h-4v5h-5v-5h-8z" fill="#ffd60a"/></g>' +
    '<path d="M47 12v12" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="44" cy="24.500" rx="3.6" ry="2.8" fill="#fff"/><path d="M47 12l7 3" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' },
  { id: 'flame', name: 'Pyro', bg: ['#3a0ca3', '#f72585'], art:
    '<path d="M32 6c3 10 16 15 16 30a16 16 0 0 1-32 0c0-7 4-10 6-15 2 4 4 5 6 5 0-8 1-14 4-20z" fill="#ff7b1c"/>' +
    '<path d="M32 26c2 5 8 8 8 15a8 8 0 0 1-16 0c0-5 5-8 8-15z" fill="#ffd60a"/>' + FACE(32, 40, 0.9) },
  { id: 'mic', name: 'Golden Mic', bg: ['#14213d', '#5a4fcf'], art:
    '<path d="M27 30h10l-2 26a3 3 0 0 1-6 0z" fill="#ffd60a"/><rect x="25" y="27" width="14" height="5" rx="2" fill="#b8860b"/>' +
    '<circle cx="32" cy="18" r="12" fill="#e9ecf5"/><path d="M21 14h22M20 19h24M22 24h20M27 7v22M32 6v24M37 7v22" stroke="#9aa3c7" stroke-width="1.3"/>' + FACE(32, 16, 0.9) },
  { id: 'douze', name: 'Douze', bg: ['#ffb703', '#fb5607'], art:
    '<circle cx="32" cy="32" r="22" fill="#fff"/><text x="32" y="42" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="27" fill="#d00070">12</text>' },
  { id: 'nul', name: 'Nul Points', bg: ['#495057', '#adb5bd'], art:
    '<ellipse cx="32" cy="32" rx="18" ry="23" fill="#fff"/><ellipse cx="32" cy="32" rx="9" ry="14" fill="#ced4da"/>' + FACE(32, 28, 0.9, 'sad') +
    '<path d="M40 31c0 3-3 3-3 6a3 3 0 0 0 6 0c0-3-3-3-3-6z" fill="#4cc9f0"/>' },
  { id: 'boot', name: 'Glitter Boot', bg: ['#b5179e', '#7209b7'], art:
    '<path d="M22 8h16v26l14 8c3 2 4 5 4 8H18V34z" fill="#e9ecf5"/><path d="M16 50h42v6H16z" fill="#ffd60a"/><path d="M18 50h10v6H18z" fill="#ffb703"/>' +
    '<path d="M30 16l1.6 4.200 4.200 1.600-4.200 1.600L30 27.600l-1.600-4.200-4.200-1.600 4.200-1.600z" fill="#ff2e88"/><circle cx="33" cy="34" r="1.600" fill="#7209b7"/><circle cx="27" cy="40" r="1.600" fill="#2de2e6"/><circle cx="42" cy="44" r="1.600" fill="#ff2e88"/>' },
  { id: 'bolt', name: 'Thunder', bg: ['#03045e', '#0096c7'], art:
    '<path d="M38 4L14 36h14l-6 24 28-34H35z" fill="#ffd60a" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' },
  { id: 'star', name: 'Superstar', bg: ['#f72585', '#7209b7'], art:
    '<path d="M32 5l7.600 16.400 18 2.200-13.300 12.300 3.500 17.800L32 44.800l-15.800 8.900 3.500-17.800L6.400 23.600l18-2.200z" fill="#ffd60a"/>' +
    '<path d="M20 26h24v3a5 5 0 0 1-10 0h-4a5 5 0 0 1-10 0z" fill="#1b1340"/><path d="M26 38q6 5 12 0" fill="none" stroke="#1b1340" stroke-width="2" stroke-linecap="round"/>' },
  { id: 'comet', name: 'Comet', bg: ['#10002b', '#5a189a'], art:
    '<path d="M6 12l26 16M4 24l24 10M12 6l22 18" stroke="#2de2e6" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="40" cy="40" r="15" fill="#ff9d3d"/><circle cx="36" cy="46" r="3" fill="#e07a1f"/><circle cx="48" cy="34" r="2" fill="#e07a1f"/>' + FACE(40, 38, 0.85) },
  { id: 'drum', name: 'Drum Roll', bg: ['#d00000', '#ffba08'], art:
    '<path d="M12 8l20 16M52 8L32 24" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="8" r="3" fill="#fff"/><circle cx="52" cy="8" r="3" fill="#fff"/>' +
    '<path d="M12 30v20c0 5 9 8 20 8s20-3 20-8V30z" fill="#3a0ca3"/><ellipse cx="32" cy="30" rx="20" ry="8" fill="#f8f9fa"/>' +
    '<path d="M12 34l10 18 10-12 10 12 10-18" fill="none" stroke="#ffd60a" stroke-width="2"/>' },
  { id: 'confetti', name: 'Confetti', bg: ['#00b4d8', '#90e0ef'], art:
    '<path d="M8 56l12-32 20 20z" fill="#ff2e88"/><path d="M13 43l14 9M17 32l17 15" stroke="#ffd60a" stroke-width="3"/>' +
    '<rect x="38" y="10" width="6" height="6" fill="#ffd60a" transform="rotate(20 41 13)"/><rect x="50" y="24" width="6" height="6" fill="#7209b7" transform="rotate(-15 53 27)"/>' +
    '<circle cx="30" cy="12" r="3" fill="#7209b7"/><circle cx="52" cy="42" r="3" fill="#ff2e88"/><circle cx="46" cy="32" r="2.500" fill="#fff"/>' +
    '<path d="M34 24q4-6 0-10M44 22q8 0 10-8" fill="none" stroke="#fff" stroke-width="2.400" stroke-linecap="round"/>' },
  { id: 'crown', name: 'Your Majesty', bg: ['#240046', '#c77dff'], art:
    '<path d="M10 46l-4-26 14 12 12-20 12 20 14-12-4 26z" fill="#ffd60a"/><rect x="10" y="46" width="44" height="8" rx="2" fill="#ffb703"/>' +
    '<circle cx="6" cy="20" r="3" fill="#ff2e88"/><circle cx="32" cy="12" r="3.500" fill="#2de2e6"/><circle cx="58" cy="20" r="3" fill="#ff2e88"/>' +
    '<circle cx="22" cy="50" r="2" fill="#ff2e88"/><circle cx="32" cy="50" r="2" fill="#2de2e6"/><circle cx="42" cy="50" r="2" fill="#ff2e88"/>' + FACE(32, 34, 0.85) },
  { id: 'moon', name: 'Midnight', bg: ['#0b132b', '#3a506b'], art:
    '<path d="M40 8a24 24 0 1 0 14 40A20 20 0 0 1 40 8z" fill="#ffe9a8"/>' +
    '<path d="M24 30q3-3 6 0" fill="none" stroke="#1b1340" stroke-width="2" stroke-linecap="round"/><path d="M26 40q5 4 9 0" fill="none" stroke="#1b1340" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M50 14l1.200 3.200 3.200 1.200-3.200 1.200L50 23l-1.200-3.200-3.200-1.200 3.200-1.200z" fill="#fff"/><circle cx="56" cy="30" r="1.500" fill="#fff"/><circle cx="44" cy="6" r="1.200" fill="#fff"/>' },
  { id: 'note', name: 'Earworm', bg: ['#2d6a4f', '#95d5b2'], art:
    '<path d="M24 12l26-6v8l-26 6z" fill="#1b1340"/><path d="M24 12v32M50 6v32" stroke="#1b1340" stroke-width="4"/>' +
    '<ellipse cx="17" cy="46" rx="10" ry="8" fill="#ff2e88"/><ellipse cx="43" cy="40" rx="10" ry="8" fill="#ff2e88"/>' + FACE(17, 45, 0.7) + FACE(43, 39, 0.7) }
];
var CHAR_BY_ID = {};
CHARS.forEach(function (c) { CHAR_BY_ID[c.id] = c; });
var charSeq = 0;
function charSvg(id) {
  var c = CHAR_BY_ID[id];
  if (!c) return '';
  if (c.file) return '<img class="char" src="' + commons(c.file) + '" alt="' + c.name + '" style="object-position:' + (c.pos || '50% 20%') + '">';
  var u = c.id + '-' + (++charSeq);   // unique ids, so a copy inside a hidden section never breaks the others
  return '<svg class="char" viewBox="0 0 64 64" role="img" aria-label="' + c.name + '"><defs><linearGradient id="cg-' + u + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + c.bg[0] + '"/><stop offset="1" stop-color="' + c.bg[1] + '"/></linearGradient>' +
    '<clipPath id="cc-' + u + '"><circle cx="32" cy="32" r="32"/></clipPath></defs>' +
    '<circle cx="32" cy="32" r="32" fill="url(#cg-' + u + ')"/><g clip-path="url(#cc-' + u + ')" transform="translate(32 32) scale(.8) translate(-32 -32)">' + c.art + '</g></svg>';
}
