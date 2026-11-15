import { PIECE_RADIUS, PLAY_HALF } from './constants.js';

export const MAX_SPEED = 11;
// Sliding friction as a constant deceleration, in squares per second squared.
export const FRICTION = 3;
const RESTITUTION = 0.9;
const STEP = 1 / 240;
// Positions are recorded every few steps, which gives smooth 60 fps playback.
const STEPS_PER_FRAME = 4;
export const FRAME_SECONDS = STEP * STEPS_PER_FRAME;
const MAX_SECONDS = 30;

export const isOffBoard = (x, z) => Math.abs(x) > PLAY_HALF || Math.abs(z) > PLAY_HALF;

/**
 * Plays out one flick to the end. Pure and deterministic, so a computer player can call it to
 * try shots before choosing one.
 *
 * Returns the final pieces plus everything needed to replay the shot: `frames` (one array of
 * [x, z] per frame, indexed like `pieces`), `falls` (when and how each piece left the board)
 * and `hits` (collision times and strengths, for sound). Bots trying thousands of shots pass
 * `{ record: false }` to skip the replay data and get only `pieces`.
 */
export function simulateShot(pieces, { pieceId, vx, vz }, { record: keep = true } = {}) {
  // Flat typed arrays rather than objects: bots run this tens of thousands of times per move.
  const n = pieces.length;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const vxs = new Float64Array(n);
  const vzs = new Float64Array(n);
  const on = new Uint8Array(n);
  pieces.forEach((p, i) => {
    x[i] = p.x;
    z[i] = p.z;
    on[i] = p.onBoard ? 1 : 0;
    if (p.id === pieceId && p.onBoard) {
      vxs[i] = vx;
      vzs[i] = vz;
    }
  });
  const moving = (i) => vxs[i] !== 0 || vzs[i] !== 0;
  const active = new Int32Array(n);
  const wasMoving = new Uint8Array(n);

  const frames = [];
  const falls = [];
  const hits = [];
  const record = () => {
    if (!keep) return;
    const frame = new Array(n);
    for (let i = 0; i < n; i++) frame[i] = [x[i], z[i]];
    frames.push(frame);
  };
  record();

  const contact = PIECE_RADIUS * 2;
  const maxSteps = Math.round(MAX_SECONDS / STEP);
  let nextGlide = 0;
  for (let step = 1; step <= maxSteps; step++) {
    const time = step * STEP;

    let movers = 0;
    for (let i = 0; i < n; i++) {
      if (!on[i] || !moving(i)) continue;
      active[movers++] = i;
      wasMoving[i] = 1;
      const speed = Math.hypot(vxs[i], vzs[i]);
      const slowed = Math.max(0, speed - FRICTION * STEP) / speed;
      vxs[i] *= slowed;
      vzs[i] *= slowed;
      x[i] += vxs[i] * STEP;
      z[i] += vzs[i] * STEP;
    }

    // Only pairs with a piece that was moving this step can touch: resting pieces never set
    // each other moving.
    for (let m = 0; m < movers; m++) {
      const i = active[m];
      for (let j = 0; j < n; j++) {
        if (j === i || !on[j] || (wasMoving[j] && j < i)) continue;
        if (Math.abs(x[j] - x[i]) >= contact || Math.abs(z[j] - z[i]) >= contact) continue;
        const strength = collide(x, z, vxs, vzs, i, j);
        if (strength > 0 && keep) hits.push({ time, strength });
      }
    }
    for (let m = 0; m < movers; m++) wasMoving[active[m]] = 0;

    let stillMoving = 0;
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      if (isOffBoard(x[i], z[i])) {
        on[i] = 0;
        if (keep) falls.push({ id: pieces[i].id, time, x: x[i], z: z[i], vx: vxs[i], vz: vzs[i] });
      } else if (moving(i)) {
        stillMoving++;
      }
    }

    const resting = stillMoving === 0;
    if (resting || step % STEPS_PER_FRAME === 0) record();
    if (resting) break;
    // Without replay data to record, pieces sliding freely can skip ahead. Pieces still
    // touching cannot, so after a failed try wait a few steps before trying again.
    if (!keep && step >= nextGlide) {
      const skipped = glide(x, z, vxs, vzs, on);
      step += skipped;
      if (!skipped) nextGlide = step + GLIDE_RETRY;
    }
  }

  const final = pieces.map(({ id, color }, i) => ({
    id,
    color,
    x: x[i],
    z: z[i],
    onBoard: !!on[i],
  }));
  return { pieces: final, frames, falls, hits };
}

const SAFETY = 0.02;
const GLIDE_RETRY = 4;
const SLOW = FRICTION * STEP;

// After k more steps a piece sliding at `speed` has slowed by k * SLOW and slid this far, the
// closed form of the step-by-step friction above.
const slid = (speed, k) => STEP * (k * speed - (SLOW * k * (k + 1)) / 2);

// Most steps a piece sliding at `speed` can take while sliding no further than `room`.
function stepsWithin(speed, room) {
  const stop = Math.floor(speed / SLOW);
  if (room <= 0) return 0;
  if (slid(speed, stop) <= room) return stop;
  const b = speed / SLOW - 0.5;
  const disc = b * b - (2 * room) / (STEP * SLOW);
  let k = disc < 0 ? stop : Math.floor(b - Math.sqrt(disc));
  while (k > 0 && slid(speed, k) > room) k--;
  return k;
}

/**
 * Moves the sliding pieces ahead by as many whole steps as none of them could get near another
 * piece or the edge in, and returns how many steps were skipped. Each slider gets a share of
 * the room it has: all of the gap to a resting piece or the edge, half the gap to another
 * slider, so no two can meet during the skipped steps.
 */
function glide(x, z, vx, vz, on) {
  const reach = PIECE_RADIUS * 2 + SAFETY;
  let skip = Infinity;
  const n = x.length;
  for (let i = 0; i < n && skip > 0; i++) {
    if (!on[i] || (vx[i] === 0 && vz[i] === 0)) continue;
    const speed = Math.hypot(vx[i], vz[i]);
    const dx = vx[i] / speed;
    const dz = vz[i] / speed;
    let room = Infinity;
    if (dx > 0) room = Math.min(room, (PLAY_HALF - x[i]) / dx);
    if (dx < 0) room = Math.min(room, (-PLAY_HALF - x[i]) / dx);
    if (dz > 0) room = Math.min(room, (PLAY_HALF - z[i]) / dz);
    if (dz < 0) room = Math.min(room, (-PLAY_HALF - z[i]) / dz);
    for (let j = 0; j < n; j++) {
      if (j === i || !on[j]) continue;
      const rx = x[j] - x[i];
      const rz = z[j] - z[i];
      if (vx[j] !== 0 || vz[j] !== 0) {
        room = Math.min(room, (Math.hypot(rx, rz) - reach) / 2);
        continue;
      }
      const along = rx * dx + rz * dz;
      const sideways2 = rx * rx + rz * rz - along * along;
      if (sideways2 >= reach * reach || along + reach < 0) continue;
      room = Math.min(room, along - Math.sqrt(reach * reach - sideways2));
    }
    skip = Math.min(skip, stepsWithin(speed, room - SAFETY));
  }
  if (!(skip > 0) || skip === Infinity) return 0;
  for (let i = 0; i < n; i++) {
    if (!on[i] || (vx[i] === 0 && vz[i] === 0)) continue;
    const speed = Math.hypot(vx[i], vz[i]);
    const distance = slid(speed, skip);
    x[i] += (vx[i] / speed) * distance;
    z[i] += (vz[i] / speed) * distance;
    const scale = (speed - skip * SLOW) / speed;
    vx[i] *= scale;
    vz[i] *= scale;
  }
  return skip;
}

// Equal-mass elastic-ish collision between discs i and j; returns the impulse, 0 if they miss.
function collide(x, z, vx, vz, i, j) {
  let nx = x[j] - x[i];
  let nz = z[j] - z[i];
  const distance = Math.hypot(nx, nz);
  const overlap = PIECE_RADIUS * 2 - distance;
  if (overlap <= 0 || distance === 0) return 0;
  nx /= distance;
  nz /= distance;

  // Separate first so resting neighbours never stick together.
  x[i] -= (nx * overlap) / 2;
  z[i] -= (nz * overlap) / 2;
  x[j] += (nx * overlap) / 2;
  z[j] += (nz * overlap) / 2;

  const approach = (vx[j] - vx[i]) * nx + (vz[j] - vz[i]) * nz;
  if (approach >= 0) return 0;
  const impulse = (-(1 + RESTITUTION) * approach) / 2;
  vx[i] -= impulse * nx;
  vz[i] -= impulse * nz;
  vx[j] += impulse * nx;
  vz[j] += impulse * nz;
  return impulse;
}
