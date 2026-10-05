# Douze Points!

Eurovisie-raadspel in Jackbox-stijl. Het hostscherm (`host.html`) speelt een willekeurig fragment van 10 seconden; spelers doen mee op hun telefoon (`index.html`) met een kamercode en typen de titel.

- `songs.json` – 1699 inzendingen (1956–2023, incl. halve finales) met YouTube-video-ID. Bron: Spijkervet/eurovision-dataset.
- `config.js` – Supabase-URL en publishable key. Leeg = demomodus (alleen tabbladen in dezelfde browser).
- `match.js` – soepele antwoordcontrole (accenten, leestekens, typfouten).
- Geen build-stap: zet de map op een statische host zoals GitHub Pages.

Lokaal proberen: `python3 -m http.server` in deze map en open `http://localhost:8000/host.html`.
