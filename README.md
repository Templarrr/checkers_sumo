# Checkers Sumo

Flick your checkers to knock your opponent's off the board. A browser game based on the
traditional Chapaev rules, rendered in 3D with [three.js](https://threejs.org/).

**Play it:** https://templarrr.github.io/checkers_sumo/ (once GitHub Pages is switched on, see
[Deploying](#deploying-to-github-pages))

![Dark aims a flick: the sector shows where the shot may go, wider and redder the harder it is](docs/screenshots/desktop.png)

<img src="docs/screenshots/mobile.png" alt="The same moment on a phone in portrait" width="300">

## Rules

- Each side has 8 checkers. In the first round Light lines up on its back row and Dark on the
  opposite back row. Light shoots first.
- On your turn you flick one of your own checkers. The board has a wooden frame around the
  cells; a checker that stops on the frame is still in play. Every checker whose centre ends up
  past the outer edge of the frame falls off and is out of the round.
- A flick never goes exactly where you aimed: it turns by a random angle of up to 3° either way
  for the softest shot, growing to 10° for a full-strength one.
- If your shot knocks off at least one enemy checker and none of your own, you shoot again.
  Otherwise the turn passes to your opponent.
- The round ends when only one colour is left on the board. The winner starts the next round,
  and their checkers line up one row further forward. The loser stays where they were.
- Once the two lines would meet, winning a round still moves you forward one row, and the loser
  is pushed back one row instead.
- When the loser has no row left to be pushed back to, the winner has crossed the whole board
  and wins the game.
- If both sides lose their last checker in the same shot, nobody wins the round and it is
  replayed from the same rows; the side that did not take that shot starts.

Not included (yet): the "traitor" rule for a checker flipped upside down, since checkers here
slide flat, and regional variants like "scissors" or stacking a second checker.

## How to play

- Press one of your checkers, pull back like a slingshot and let go. The sector in front of the
  checker shows every direction the shot may take; the further you pull, the harder the shot
  and the longer, wider and redder the sector.
  Let go close to the checker, or press Escape, to cancel.
- Drag anywhere else to orbit the camera, scroll or pinch to zoom. After each turn the camera
  swings round to the side that shoots next, so two players can share one screen.
- Pick who plays Dark in the box at the bottom: a second player on the same screen, or the Easy
  or Medium bot. You always play Light. Changing it starts a new game, and the choice is
  remembered next time.
- The line under the title shows the round and how many checkers each side has left on which
  row.

## Development

You need [Node.js](https://nodejs.org/) 22.12 or newer (`.nvmrc` pins the version).

```sh
npm install
npm run dev      # local server with live reload, open the URL it prints
npm test         # unit tests (Vitest)
npm run lint     # ESLint + Prettier check
npm run format   # fix lint and formatting issues
npm run check    # lint, test and build, the same steps CI runs
```

### Screenshots

The images in `docs/screenshots/` are shown in this README and in pull requests. Whenever the
look or the UI changes, regenerate them in the same change so they stay up to date:

```sh
npx playwright install chromium   # once, downloads the browser the script drives
npm run screenshots               # builds the game and rewrites docs/screenshots/*.png
```

Code style is enforced with [ESLint](https://eslint.org/) for code quality and
[Prettier](https://prettier.io/) for formatting; CI fails a pull request that does not pass
`npm run lint`.

### Code layout

- `src/game/`: the game itself, with no rendering. `physics.js` plays out a flick
  deterministically (sliding friction, checker collisions, falling off the edge); `rules.js`
  turns the result into Chapaev rules: whose turn it is, rounds, rows and the winner.
- `src/render/`: three.js scene, board, checkers, shot replay and the slingshot aiming.
- `src/players/`: who chooses the shots: the human (one instance serves both sides in hot seat)
  and the bots.
- `src/audio/`: collision and landing sounds, synthesised with Web Audio.

### Computer players

A player is any object with `chooseShot(state)` returning a promise of
`{ pieceId, vx, vz }` (the velocity it aims for, in squares per second) and an optional
`cancel()`. The random deviation is added afterwards by `playShot`, so it applies to bots too.
Players are wired up in the `OPPONENTS` map in `src/main.js`.

Both bots (`src/players/bot.js`) try every shot on a grid of 1° directions and 10% power steps,
keep only the ones that would run straight into a piece and are strong enough to reach it,
play each one out with `simulateShot` and pick the best score: enemy checkers knocked off minus
their own lost, with a tiny bonus for enemy checkers left near the edge to break ties.

- **Easy** only aims straight at enemy checkers and assumes every shot goes exactly where it
  aims (its real shots still scatter).
- **Medium** also aims at its own checkers to push enemies behind them, and scores each shot
  by the average of 10 imagined shots, each scattered like a real one.

Medium tries well over 100,000 shots on a full board, so the search runs in Web Workers
(`src/players/botPlayer.js`), split across the CPU's cores, and the page keeps animating while a
bot thinks. A Hard bot would be another entry in `LEVELS` in `bot.js`.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` lints, tests, builds and publishes the game on
every push to `main`. GitHub needs to be told once to accept that:

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. Merge the pull request (or push to `main`). The **Deploy to GitHub Pages** workflow runs on
   the **Actions** tab; when it turns green, the game is live at
   https://templarrr.github.io/checkers_sumo/.

If the workflow ran before step 2, re-run it from the **Actions** tab (open the run and choose
**Re-run all jobs**, or use **Run workflow** on the workflow page).
