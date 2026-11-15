import { bestShot } from './bot.js';

self.onmessage = ({ data: { job, state, level, part, parts } }) => {
  self.postMessage({ job, best: bestShot(state, level, { part, parts }) });
};
