import { PIECE_RADIUS, PLAY_HALF } from './constants.js';

export const MAX_SPEED = 11;
// Sliding friction as a constant deceleration, in squares per second squared.
const FRICTION = 3;
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
 * and `hits` (collision times and strengths, for sound).
 */
export function simulateShot(pieces, { pieceId, vx, vz }) {
  const bodies = pieces.map((p) => ({
    ...p,
    vx: p.id === pieceId ? vx : 0,
    vz: p.id === pieceId ? vz : 0,
  }));
  const frames = [];
  const falls = [];
  const hits = [];
  const record = () => frames.push(bodies.map((b) => [b.x, b.z]));
  record();

  const maxSteps = Math.round(MAX_SECONDS / STEP);
  for (let step = 1; step <= maxSteps; step++) {
    const time = step * STEP;
    const sliding = bodies.filter((b) => b.onBoard);

    for (const b of sliding) {
      const speed = Math.hypot(b.vx, b.vz);
      if (speed === 0) continue;
      const slowed = Math.max(0, speed - FRICTION * STEP) / speed;
      b.vx *= slowed;
      b.vz *= slowed;
      b.x += b.vx * STEP;
      b.z += b.vz * STEP;
    }

    for (let i = 0; i < sliding.length; i++) {
      for (let j = i + 1; j < sliding.length; j++) {
        const strength = collide(sliding[i], sliding[j]);
        if (strength > 0) hits.push({ time, strength });
      }
    }

    for (const b of sliding) {
      if (!isOffBoard(b.x, b.z)) continue;
      b.onBoard = false;
      falls.push({ id: b.id, time, x: b.x, z: b.z, vx: b.vx, vz: b.vz });
    }

    const resting = bodies.every((b) => !b.onBoard || (b.vx === 0 && b.vz === 0));
    if (resting || step % STEPS_PER_FRAME === 0) record();
    if (resting) break;
  }

  const final = bodies.map(({ id, color, x, z, onBoard }) => ({ id, color, x, z, onBoard }));
  return { pieces: final, frames, falls, hits };
}

// Equal-mass elastic-ish collision between two discs; returns the impulse, 0 if they miss.
function collide(a, b) {
  let nx = b.x - a.x;
  let nz = b.z - a.z;
  const distance = Math.hypot(nx, nz);
  const overlap = PIECE_RADIUS * 2 - distance;
  if (overlap <= 0 || distance === 0) return 0;
  nx /= distance;
  nz /= distance;

  // Separate first so resting neighbours never stick together.
  a.x -= (nx * overlap) / 2;
  a.z -= (nz * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.z += (nz * overlap) / 2;

  const approach = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  if (approach >= 0) return 0;
  const impulse = (-(1 + RESTITUTION) * approach) / 2;
  a.vx -= impulse * nx;
  a.vz -= impulse * nz;
  b.vx += impulse * nx;
  b.vz += impulse * nz;
  return impulse;
}
