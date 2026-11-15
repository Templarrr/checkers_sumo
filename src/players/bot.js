import { PIECE_RADIUS, PLAY_HALF, opponent } from '../game/constants.js';
import { FRICTION, MAX_SPEED, simulateShot } from '../game/physics.js';
import { scatterShot } from '../game/rules.js';

export const EASY = 'easy';
export const MEDIUM = 'medium';

// Flicks are continuous; bots only try a grid of them so the search is finite.
const ANGLE_STEPS = 360;
const POWER_STEPS = 10;
const MEDIUM_SAMPLES = 10;
// Ties between equally good shots are broken at random, so the bot does not always repeat itself.
const TIE = 1e-6;

const LEVELS = {
  // Aims only straight at enemy pieces and trusts the shot to go exactly there.
  [EASY]: { enemyTargetsOnly: true, samples: 0 },
  // Considers any shot that touches a piece and averages several imagined scattered outcomes.
  [MEDIUM]: { enemyTargetsOnly: false, samples: MEDIUM_SAMPLES },
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
export function candidateShots(state, { enemyTargetsOnly }) {
  const enemy = opponent(state.turn);
  const shots = [];
  for (const shooter of state.pieces) {
    if (!shooter.onBoard || shooter.color !== state.turn) continue;
    for (let a = 0; a < ANGLE_STEPS; a++) {
      const angle = (a / ANGLE_STEPS) * 2 * Math.PI;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const contact = firstContact(shooter, state.pieces, dx, dz);
      if (!contact || (enemyTargetsOnly && contact.target.color !== enemy)) continue;
      for (let step = 1; step <= POWER_STEPS; step++) {
        const speed = (step / POWER_STEPS) * MAX_SPEED;
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
  const shots = candidateShots(state, LEVELS[level]);
  // A blocked Easy bot (every enemy hidden behind its own pieces) falls back to any contact.
  return shots.length ? shots : candidateShots(state, { enemyTargetsOnly: false });
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
