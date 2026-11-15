import { bestShot, pickBest } from './bot.js';

// The search runs in workers so the page keeps animating while a bot thinks, split across
// cores because Medium imagines over a hundred thousand shots on a full board.
const WORKERS = Math.min(Math.max((globalThis.navigator?.hardwareConcurrency ?? 4) - 1, 1), 8);
// Even an instant answer waits this long, so the human can follow what happens.
const MIN_THINK_MS = 700;
const PREVIEW_MS = 800;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPool() {
  let workers = [];
  let job = 0;

  function search(state, level) {
    if (typeof Worker === 'undefined') return Promise.resolve(bestShot(state, level));
    if (!workers.length) {
      workers = Array.from(
        { length: WORKERS },
        () => new Worker(new URL('./botWorker.js', import.meta.url), { type: 'module' }),
      );
    }
    const current = ++job;
    const parts = workers.map(
      (worker, part) =>
        new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => data.job === current && resolve(data.best);
          worker.onerror = reject;
          worker.postMessage({ job: current, state, level, part, parts: workers.length });
        }),
    );
    return Promise.all(parts).then((best) => pickBest(best));
  }

  return {
    search,
    // Stops a search mid-way; its promise never settles, like a human who walks away.
    stop() {
      workers.forEach((worker) => worker.terminate());
      workers = [];
    },
  };
}

/**
 * A computer player with the same interface as the human one. `aim` shows the chosen shot for
 * a moment before it is played.
 */
export function createBotPlayer(level, { aim } = {}) {
  const pool = createPool();
  let thinking = 0;
  return {
    name: level,
    isBot: true,
    async chooseShot(state) {
      const current = ++thinking;
      const [best] = await Promise.all([pool.search(state, level), wait(MIN_THINK_MS)]);
      if (current !== thinking) return new Promise(() => {});
      aim?.preview(state, best.shot);
      await wait(PREVIEW_MS);
      if (current !== thinking) return new Promise(() => {});
      aim?.preview(state, null);
      return best.shot;
    },
    cancel() {
      thinking++;
      pool.stop();
      aim?.preview(null, null);
    },
  };
}
