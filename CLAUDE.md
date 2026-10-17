# EuroQuizion: notes for Claude

A Eurovision party game for friends (Jackbox-style): the big screen is the host, everyone plays on their phone.
Live at https://merke1985.github.io/euroquizion/ (GitHub Pages, branch `main`). Friends-only, never paid.

## The files

- `host.html` + `host.js`: the big screen (quiz, party games, Woodruff's Boutique shop, Grand Final).
- `index.html` + `player.js`: the phones. `net.js`: the connection (Supabase broadcast; falls back to a
  BroadcastChannel when `config.js` is empty). `quiz.js`, `style.css`, `music.js`, `chars.js`, `shapes.js`.
- Prototypes, each its own page: `bossbattle.html`, `blackbird.html` (+ its phone controller `bbpad.html`),
  `wheeltest.html`. They use their own fixed `?v=` script versions.
- `IDEAS.md`: ideas on the shelf. `REQUESTS.md`: how the scheduled task works through requests from Supabase.

## Workflow for every change

1. **Pull first** (other chats work on this repo too): `git pull --rebase -q`.
2. Make the change. Keep to the files of the part you're working on where you can.
3. Syntax check:
   - big JS files: `node -e "new Function(require('fs').readFileSync('host.js','utf8'))"`
   - HTML pages: take the last `<script>` block, e.g.
     `python3 -c "import re;t=open('blackbird.html').read();open('/tmp/x.js','w').write(re.findall(r'<script>(.*?)</script>',t,re.S)[-1])"`
     then run `new Function` on it.
4. Test in a headless browser (Playwright, Chromium at `/opt/pw-browsers/chromium`): serve the repo with
   `python3 -m http.server 8765`, route `config.js` to `window.ESC_CONFIG={};` so phones use the BroadcastChannel,
   and look at screenshots.
5. Bump the version: `sed -i 's/?v=NNNN/?v=NNNN+1/g' index.html host.html solo.html credits.html`
   (check the current number with `grep -o '?v=[0-9]*' index.html | head -1`).
6. Commit with a short message, then push: `(git push -q || (git pull --rebase -q && git push -q))`.
7. Tell Maarten in plain language what changed, ending with "Refresh in a few minutes (Ctrl+Shift+R if needed)".

## Rules

- **Comments in code go at the END of a line.** A `//` in the middle of a line has swallowed code several times.
- **Never commit the copyrighted mp3** (`Miriana_Conte_-_SERVING_KANT.mp3`), or any other copyrighted audio.
- Original characters and designs only; no real brand logos; no flag emoji (use flagcdn images instead).
- Gender-neutral texts ("their", "everyone").
- Keep the 🧪 Test buttons (and add one for anything new worth testing).
- Nothing voiced (ElevenLabs) unless Maarten asks: credits are limited.
- Ask before big or hard-to-undo changes; small tweaks just get done and reported.
- Don't change the scheduled task "Process EuroQuizion requests" without Maarten's explicit OK.
