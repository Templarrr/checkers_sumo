import { PIECE_RADIUS, PLAY_HALF, opponent } from '../game/constants.js';
import { FRICTION, MAX_SPEED, simulateShot } from '../game/physics.js';
import { scatterShot } from '../game/rules.js';

export const EASY = 'easy';
export const MEDIUM = 'medium';

// Flicks are continuous; bots only try a grid of them so the search is finite. A coarser grid
// misses more good shots, which makes a weaker bot.
const FINE = { angleSteps: 360, powerSteps: 10 };
const COARSE = { angleSteps: 72, powerSteps: 4 };
const MEDIUM_SAMPLES = 10;
// Ties between equally good shots are broken at random, so the bot does not always repeat itself.
const TIE = 1e-6;

export const LEVELS = {
  // Tries 5° and 25% power steps, aims only straight at enemy pieces and trusts the shot to go
  // exactly there, then fumbles its aim by up to 5° either way.
  [EASY]: { ...COARSE, enemyTargetsOnly: true, samples: 0, aimErrorDegrees: 5 },
  // Tries 1° and 10% power steps, considers any shot that touches a piece and averages several
  // imagined scattered outcomes.
  [MEDIUM]: { ...FINE, enemyTargetsOnly: false, samples: MEDIUM_SAMPLES, aimErrorDegrees: 0 },
};

// The piece a shot along (dx, dz) would touch first if it went straight, and how far it slides
// before touching it.
function firstContact(shooter, pieces, dx, dz) {
  let target = null;
  let distance = Infinity;
  const reach = PIECE_RADIUS * 2;
  for (const p of pieces) {
    if (p === shooter || !p.onBoard) continue;
    const rx = p.x - shooter.x;
    const rz = p.z - shooter.z;
    const along = rx * dx + rz * dz;
    if (along <= 0) continue;
    const sideways2 = rx * rx + rz * rz - along * along;
    if (sideways2 >= reach * reach) continue;
    const contact = along - Math.sqrt(reach * reach - sideways2);
    if (contact < distance) {
      distance = contact;
      target = p;
    }
  }
  return target && { target, distance };
}

/** Every grid shot for the side to move that would go straight into a piece. */
export function candidateShots(state, { enemyTargetsOnly, angleSteps, powerSteps }) {
  const enemy = opponent(state.turn);
  const shots = [];
  for (const shooter of state.pieces) {
    if (!shooter.onBoard || shooter.color !== state.turn) continue;
    for (let a = 0; a < angleSteps; a++) {
      const angle = (a / angleSteps) * 2 * Math.PI;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const contact = firstContact(shooter, state.pieces, dx, dz);
      if (!contact || (enemyTargetsOnly && contact.target.color !== enemy)) continue;
      for (let step = 1; step <= powerSteps; step++) {
        const speed = (step / powerSteps) * MAX_SPEED;
        // Distance slid before friction stops it.
        if ((speed * speed) / (2 * FRICTION) <= contact.distance) continue;
        shots.push({ pieceId: shooter.id, vx: dx * speed, vz: dz * speed });
      }
    }
  }
  return shots;
}

// Pieces near the edge are easier to knock off next time.
const edgeCloseness = (p) => Math.max(Math.abs(p.x), Math.abs(p.z)) / PLAY_HALF;

/**
 * Enemy pieces knocked off minus own pieces lost. A small bonus for leaving enemy pieces near
 * the edge and own pieces away from it, worth less than one piece in total, picks between shots
 * that knock nothing off.
 */
export function scoreOutcome(before, after, side) {
  let score = 0;
  for (const p of after) {
    const sign = p.color === side ? -1 : 1;
    const wasOn = before.find((b) => b.id === p.id).onBoard;
    if (wasOn && !p.onBoard) score += sign;
    else if (p.onBoard) score += (sign * edgeCloseness(p)) / 20;
  }
  return score;
}

export function evaluateShot(state, shot, level, random = Math.random) {
  const { samples } = LEVELS[level];
  const outcome = (played) =>
    scoreOutcome(
      state.pieces,
      simulateShot(state.pieces, played, { record: false }).pieces,
      state.turn,
    );
  if (!samples) return outcome(shot);
  let total = 0;
  for (let i = 0; i < samples; i++) total += outcome(scatterShot(shot, random));
  return total / samples;
}

export function shotsFor(state, level) {
  const options = LEVELS[level];
  // A bot with no shot of its own kind (every enemy hidden, or slipping between grid lines)
  // falls back to any contact, on the fine grid as a last resort.
  for (const fallback of [{}, { enemyTargetsOnly: false }, { ...FINE, enemyTargetsOnly: false }]) {
    const shots = candidateShots(state, { ...options, ...fallback });
    if (shots.length) return shots;
  }
  return [];
}

/**
 * Scores the candidate shots whose index falls in this `part` of `parts`, so the search can be
 * split across workers. Returns the best of them, ties already broken at random.
 */
export function bestShot(state, level, { part = 0, parts = 1, random = Math.random } = {}) {
  const shots = shotsFor(state, level);
  const scored = [];
  for (let i = part; i < shots.length; i += parts) {
    scored.push({ shot: shots[i], score: evaluateShot(state, shots[i], level, random) });
  }
  return pickBest(scored, random);
}

export function pickBest(scored, random = Math.random) {
  const valid = scored.filter(Boolean);
  if (!valid.length) return null;
  const top = Math.max(...valid.map((s) => s.score));
  const best = valid.filter((s) => s.score >= top - TIE);
  return best[Math.floor(random() * best.length)];
}

/**
 * Turns the chosen shot by the level's own aiming error. It comes on top of the scatter every
 * shot gets in playShot, and the bot does not account for it when choosing.
 */
export function fumbleAim(shot, level, random = Math.random) {
  const error = (LEVELS[level].aimErrorDegrees * Math.PI) / 180;
  if (!error) return shot;
  const turn = (random() * 2 - 1) * error;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { ...shot, vx: shot.vx * cos - shot.vz * sin, vz: shot.vx * sin + shot.vz * cos };
}
