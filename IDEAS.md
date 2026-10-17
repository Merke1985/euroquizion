# EuroQuizion: ideas on the shelf

Ideas talked through but not built yet. Nothing here is in the game; pick one up and build it when wanted.

## Grand Final

- **Monster moves in the real game.** Built in test mode only (🧪 Test → "The monster moves (new)"): the Diva's
  High Note (half spaces next question), the Neon Goblin's Cha-cha Swap (leader and last swap places), the Phoenix
  Queen's Firewall (cross the burning row: back 2), the Phantom Fiddler's Frozen Tune (the leader stays put).
  To go live: set `c.moves = true` for every Grand Final (it triggers after question 4). No voice lines yet.
- **Boss Battle** (a second Grand Final mode, Slay the Spire style). Everyone together against the monster; its
  intent shown above its head each turn. Each player has a hand of 3 cards on the phone; playing one means answering
  a question (right = it works): Strike (easy, 6 damage), Power Ballad (hard, 15), Sequin Shield (block 8), Duet
  (block 6 for a teammate), Encore (heal 6), Key Change (next attack double). Knocked out = backup dancer.
  **Test version built:** 🧪 Test → "⚔️ Boss Battle (prototype)" (bossbattle.html): you plus computer teammates on
  one screen, all four monsters with a special move every 3rd turn. Choices made: trophy = damage + half of
  shielding/healing (plus an MVP for support); everyone picks and answers at the same time (14 s). Still to do:
  phones for every player, then hook it into the real Grand Final as an alternative mode.

## Duo games (partners, no shouting needed)

- **Split puzzles.** A gate ahead of a rolling disco ball; each partner sees half the clue and both pick on their own
  phone; the same pick opens it. Types: country + year → the song; lyrics line + titles; flag colours tapped in
  order; higher/lower with one side's points hidden; an artist's name split in two halves.
- **Light Show.** Simon Says for two: a sequence of coloured stage lights; partner A has two colours, partner B the
  other two, so they press one at a time, in order, without talking. One light more each round; later rounds
  faster, backwards, or from memory. Duos side by side; 3 mistakes and your stage goes dark.
- Other duo ideas: Perfect Harmony (both pick the same answer without talking), Running Order (the cards split over
  both phones), Duet Drawing, Mirror Dance (Serving with half the arrows each).

- **Douze Points Code** (Mastermind): guess the hidden order of 4 countries; feedback is 12/10/8 points for right
  spot, right country wrong spot.
- **Nul Points Roulette** (Honeycomb Havoc variant): lives instead of elimination, everyone gets equal turns, a pass
  option, two belts so big groups move faster.

## Other party games

- **The Glitter Tower** (speed climbing). Stella, the tower keeper (a new character: lilac beehive, night-sky gown,
  crescent-moon balcony), lights the next ledge with her wand: always straight up or one column to the side. Tap
  ↖ ↑ ↗ on the phone fast; wrong ledge or too slow = fall 3 floors. 3 rounds of 15 s turns, 1–3 climbers at once;
  highest floor wins. **Test version built:** 🧪 Test → "✨ Glitter Tower (prototype)" (tower.html, phones on
  towerpad.html). Still to do: stage intro, hook into the roster, boutique winners; stream lag may hurt speed.
- **Timeline.** A song card without its year; place it in the right gap on a growing timeline (Hitster-like).
  Others vote right/wrong and can steal. To decide: title shown or hidden, clip length, which eras.
- **"Nul Points!"** (Liar's Dice with Eurovision symbols 🎤 🪩 ❤️ 🌈 👑 and a wild ⭐). 3 dice each, 5 rounds,
  about 3 minutes; most dice left wins. From 9 players two tables at once. Out = guess "lie or truth" for bonus.
- **Ghost on the Dance Floor.** We Will Rule the World with one invisible ghost whose tiles change late; catch it.
- **The Phantom of the Arena.** Dark arena from above, trophies to steal; 1–2 invisible phantoms see the whole map,
  the others steer spotlights; two lights on a phantom = caught. Clues: footsteps, props falling, the crowd.
- **The Leaked Scoreboard.** A secret insider sees the answers and tries to steer the others to a wrong one;
  vote who it was.
- **Europe map games.** Where's That Song? (a clip plays, pin the country; closer = more points), Conquer Europe
  (claim countries by answering about their songs), Pin the Host City, The Tour Bus.

## Other

- **Stream boost** for Discord: louder voice lines and sound effects (YouTube itself can't go above 100%).
