import { PIECE_RADIUS, PLAY_HALF } from './constants.js';
import { isOffBoard } from './physics.js';

// A sliver thinner than this is too small to see or to get a finger under.
export const MIN_OVERHANG = 0.05;
export const MIN_HALF_FLIPS = 2;
export const MAX_HALF_FLIPS = 10;
// The flick comes from below and outside the board, so it throws the checker back over the
// board more often than not, but it can go off up to this far either side of straight in.
export const DRIFT_SPREAD_DEGREES = 135;
// Sideways drift per half-flip: a harder flick spins it more and keeps it in the air longer.
const DRIFT_PER_HALF_FLIP = [0.06, 0.18];
// A checker that keeps landing on the edge is left there rather than tossed for ever.
const MAX_TOSSES = 12;

const overBy = (coordinate) => Math.max(0, Math.abs(coordinate) + PIECE_RADIUS - PLAY_HALF);

/** How far a checker on the board sticks out past the edge, 0 if it does not. */
export const overhang = (p) => Math.max(overBy(p.x), overBy(p.z));

export const overhangs = (p) => p.onBoard !== false && overhang(p) > MIN_OVERHANG;

/**
 * One flick from under the overhanging rim: how many half-flips it makes and where it comes
 * down. An odd number of half-flips lands it the other way up.
 */
export function toss(p, random = Math.random) {
  const span = MAX_HALF_FLIPS - MIN_HALF_FLIPS + 1;
  const halfFlips = MIN_HALF_FLIPS + Math.min(span - 1, Math.floor(random() * span));
  // Straight in is away from the edge (or the corner) it hangs over.
  const inward = Math.atan2(-Math.sign(p.z) * overBy(p.z), -Math.sign(p.x) * overBy(p.x));
  const angle = inward + (random() * 2 - 1) * ((DRIFT_SPREAD_DEGREES * Math.PI) / 180);
  const [low, high] = DRIFT_PER_HALF_FLIP;
  const drift = halfFlips * (low + (high - low) * random());
  return {
    halfFlips,
    x: p.x + Math.cos(angle) * drift,
    z: p.z + Math.sin(angle) * drift,
  };
}

/**
 * Tosses every overhanging checker, one after another, until each has come down off the board
 * (out), flat on it (the right way up, or flipped to a traitor) or crushed by another landing.
 * Returns the checkers still on the board and the tosses, in order, for the replay.
 */
export function traitorCheck(pieces, random = Math.random) {
  const board = pieces.filter((p) => p.onBoard).map((p) => ({ ...p }));
  const tosses = [];
  const queue = board.filter(overhangs).map((p) => p.id);
  for (const id of queue) {
    for (let tries = 0; tries < MAX_TOSSES; tries++) {
      const p = board.find((b) => b.id === id);
      if (!p || !overhangs(p)) break;
      const landing = toss(p, random);
      const from = { x: p.x, z: p.z };
      const flippedBefore = Boolean(p.flipped);
      p.x = landing.x;
      p.z = landing.z;
      p.flipped = landing.halfFlips % 2 === 1 ? !flippedBefore : flippedBefore;
      const off = isOffBoard(p.x, p.z);
      const killed = off
        ? []
        : board
            .filter((o) => o !== p && Math.hypot(o.x - p.x, o.z - p.z) < PIECE_RADIUS * 2)
            .map((o) => o.id);
      tosses.push({
        id,
        from,
        to: { x: p.x, z: p.z },
        halfFlips: landing.halfFlips,
        flippedBefore,
        flippedAfter: p.flipped,
        result: off ? 'off' : overhangs(p) ? 'edge' : 'board',
        killed,
      });
      for (const victim of killed)
        board.splice(
          board.findIndex((b) => b.id === victim),
          1,
        );
      if (off) {
        board.splice(board.indexOf(p), 1);
        break;
      }
    }
  }
  return { pieces: board, tosses };
}

/**
 * The odds that a checker hanging `depth` over one edge is lost (out) or turned (flipped and
 * still on the board) by the check, ignoring other checkers. Bots score overhangs with these.
 */
export function tossOdds(depth, { samples = 4000, random = Math.random } = {}) {
  let out = 0;
  let turned = 0;
  for (let i = 0; i < samples; i++) {
    const p = { id: 0, color: 'light', x: 0, z: PLAY_HALF + depth - PIECE_RADIUS, onBoard: true };
    const [after] = traitorCheck([p], random).pieces;
    if (!after) out++;
    else if (after.flipped) turned++;
  }
  return { out: out / samples, turned: turned / samples };
}
