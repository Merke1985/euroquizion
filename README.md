# Douze Points!

A Jackbox-style Eurovision guessing game. The host screen (`host.html`) plays a random 15-second clip; players join on their phones (`index.html`) with a room code and type the song title.

- `songs.json` – 1808 entries (1956–2026, including semi-finals) with YouTube video IDs, placing and points. Sources: Spijkervet/eurovision-dataset (1956–2023); the official Eurovision YouTube playlists and Wikipedia results (2024–2026).
- `config.js` – Supabase URL and public key. Empty = demo mode (tabs in the same browser only).
- `match.js` – forgiving answer check (accents, punctuation, typos).
- No build step: serve the folder from any static host such as GitHub Pages.

Try it locally: run `python3 -m http.server` in this folder and open `http://localhost:8000/host.html`.
