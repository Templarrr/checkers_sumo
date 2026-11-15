# Checkers Sumo

Flick your checkers to knock your opponent's off the board. A browser game based on the
traditional Chapaev rules, rendered in 3D with [three.js](https://threejs.org/).

**Play it:** https://templarrr.github.io/checkers_sumo/ (once GitHub Pages is switched on, see
[Deploying](#deploying-to-github-pages))

![Dark aims a flick: the arrow shows the direction and strength of the shot](docs/screenshots/desktop.png)

## Rules

- Each side has 8 checkers. In the first round Light lines up on its back row and Dark on the
  opposite back row. Light shoots first.
- On your turn you flick one of your own checkers. Every checker that ends up past the edge of
  the board falls off and is out of the round.
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

- Press one of your checkers, pull back like a slingshot and let go. The arrow shows where the
  checker will go; the further you pull, the longer and redder it gets and the harder the shot.
  Let go close to the checker, or press Escape, to cancel.
- Drag anywhere else to orbit the camera, scroll or pinch to zoom. After each turn the camera
  swings round to the side that shoots next, so two players can share one screen.
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

Code style is enforced with [ESLint](https://eslint.org/) for code quality and
[Prettier](https://prettier.io/) for formatting; CI fails a pull request that does not pass
`npm run lint`.

### Code layout

- `src/game/`: the game itself, with no rendering. `physics.js` plays out a flick
  deterministically (sliding friction, checker collisions, falling off the edge); `rules.js`
  turns the result into Chapaev rules: whose turn it is, rounds, rows and the winner.
- `src/render/`: three.js scene, board, checkers, shot replay and the slingshot aiming.
- `src/players/`: who chooses the shots. Right now one human player serves both sides.
- `src/audio/`: collision and landing sounds, synthesised with Web Audio.

### Adding a computer player

A player is any object with `chooseShot(state)` returning a promise of
`{ pieceId, vx, vz }` (a velocity in squares per second) and an optional `cancel()`. A bot can
call `simulateShot(state.pieces, shot)` from `src/game/physics.js` to try out candidate shots
and pick the one that knocks off the most enemy checkers. Plug it in by putting it in the
`players` map in `src/main.js`.

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
