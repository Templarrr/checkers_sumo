// Plays bot against bot without rendering and prints the score.
// Usage: node scripts/tournament.js [games=50] [levelA=medium] [levelB=easy]
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DARK, LIGHT } from '../src/game/constants.js';
import { DRAW, newMatch, nextRound, playShot } from '../src/game/rules.js';
import { bestShot, fumbleAim } from '../src/players/bot.js';

// A game that runs this long is stuck (say, two pieces that keep missing each other).
const MAX_SHOTS = 2000;

function playGame(levels) {
  let state = newMatch();
  let shots = 0;
  let replays = 0;
  while (!state.matchWinner) {
    if (state.roundWinner) {
      if (state.roundWinner === DRAW) replays++;
      state = nextRound(state);
    }
    if (++shots > MAX_SHOTS) return { winner: null, shots, replays, rounds: state.round };
    const level = levels[state.turn];
    const best = bestShot(state, level);
    state = playShot(state, fumbleAim(best.shot, level)).state;
  }
  return { winner: state.matchWinner, shots, replays, rounds: state.round };
}

if (!isMainThread) {
  parentPort.on('message', (game) => {
    if (game === null) return process.exit(0);
    const { a, b } = workerData;
    // Alternate who plays Light, and so who shoots first.
    const levels = game % 2 === 0 ? { [LIGHT]: a, [DARK]: b } : { [LIGHT]: b, [DARK]: a };
    const result = playGame(levels);
    const winner = result.winner && levels[result.winner];
    parentPort.postMessage({ game, first: levels[LIGHT], ...result, winner });
  });
} else {
  const games = Number(process.argv[2] ?? 50);
  const a = process.argv[3] ?? 'medium';
  const b = process.argv[4] ?? 'easy';
  const results = [];
  let next = 0;
  const threads = Math.min(availableParallelism(), games);
  await Promise.all(
    Array.from({ length: threads }, () => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { a, b } });
      return new Promise((resolve) => {
        const feed = () => worker.postMessage(next < games ? next++ : null);
        worker.on('message', (r) => {
          results.push(r);
          console.log(
            `game ${r.game + 1}: ${r.first} first, ${r.winner ?? 'unfinished'} wins, ` +
              `${r.rounds} rounds, ${r.shots} shots, ${r.replays} replays`,
          );
          feed();
        });
        worker.on('exit', resolve);
        feed();
      });
    }),
  );
  const count = (f) => results.filter(f).length;
  console.log(`\n${games} games, ${a} vs ${b}`);
  for (const level of [a, b]) {
    console.log(
      `${level}: ${count((r) => r.winner === level)} wins ` +
        `(${count((r) => r.winner === level && r.first === level)} when shooting first)`,
    );
  }
  console.log(`unfinished: ${count((r) => !r.winner)}`);
  console.log(`replayed rounds: ${results.reduce((n, r) => n + r.replays, 0)}`);
}
