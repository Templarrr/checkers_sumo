import { PIECE_RADIUS, PLAY_HALF, opponent, sideOf } from '../game/constants.js';
import { FRICTION, MAX_SPEED, simulateShot } from '../game/physics.js';
import { scatterShot } from '../game/rules.js';
import { MIN_OVERHANG, overhang, tossOdds } from '../game/traitors.js';

export const EASY = 'easy';
export const MEDIUM = 'medium';
export const HARD = 'hard';

// Flicks are continuous; bots only try a grid of them so the search is finite. A coarser grid
// misses more good shots, which makes a weaker bot.
const FINE = { angleSteps: 360, powerSteps: 10 };
const COARSE = { angleSteps: 72, powerSteps: 4 };
const MEDIUM_SAMPLES = 10;
// Odd, so the straight shot is one of them; about Medium's cost.
const HARD_SAMPLES = 9;
// Ties between equally good shots are broken at random, so the bot does not always repeat itself.
const TIE = 1e-6;

export const LEVELS = {
  // Tries 5° and 25% power steps, aims only straight at enemy pieces and trusts the shot to go
  // exactly there, then fumbles its aim by up to 5° either way.
  [EASY]: { ...COARSE, enemyTargetsOnly: true, samples: 0, aimErrorDegrees: 5 },
  // Tries 1° and 10% power steps, considers any shot that touches a piece and averages several
  // imagined scattered outcomes.
  [MEDIUM]: {
    ...FINE,
    enemyTargetsOnly: false,
    samples: MEDIUM_SAMPLES,
    aimErrorDegrees: 0,
    attackLastPiece: true,
  },
  // Same shots as Medium, but imagines them evenly across the whole spread, edges included, and
  // judges each by its worst outcome, so it avoids shots that only pay off with luck.
  [HARD]: {
    ...FINE,
    enemyTargetsOnly: false,
    samples: HARD_SAMPLES,
    worstCase: true,
    aimErrorDegrees: 0,
    attackLastPiece: true,
  },
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
    if (!shooter.onBoard || sideOf(shooter) !== state.turn) continue;
    for (let a = 0; a < angleSteps; a++) {
      const angle = (a / angleSteps) * 2 * Math.PI;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const contact = firstContact(shooter, state.pieces, dx, dz);
      if (!contact || (enemyTargetsOnly && sideOf(contact.target) !== enemy)) continue;
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

// What the traitor check is expected to cost the owner of a checker overhanging by a given
// depth, in checkers: one if it goes out, two if it turns, a checker lost and one gained by the
// other side. Worked out once from the check itself, in steps of OVERHANG_STEP; landings on
// other checkers are left out.
const OVERHANG_STEP = 0.025;
const OVERHANG_COST = Array.from(
  { length: Math.ceil(PIECE_RADIUS / OVERHANG_STEP) + 1 },
  (_, i) => {
    const depth = Math.max(MIN_OVERHANG + 1e-9, i * OVERHANG_STEP);
    const { out, turned } = tossOdds(depth, { samples: 1500, random: seeded(i + 1) });
    return out + 2 * turned;
  },
);

export function overhangCost(p) {
  const depth = overhang(p);
  if (depth <= MIN_OVERHANG) return 0;
  return OVERHANG_COST[Math.min(OVERHANG_COST.length - 1, Math.round(depth / OVERHANG_STEP))];
}

// The bot's own idea of chance must not differ between workers, or their scores disagree.
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

/**
 * Enemy pieces knocked off minus own pieces lost. With the traitor check on, a piece left
 * overhanging counts as the share of a piece the check is expected to take from its side.
 * Otherwise a small bonus for leaving enemy pieces near the edge and own pieces away from it,
 * worth less than one piece in total, picks between shots that knock nothing off.
 */
export function scoreOutcome(before, after, side, { traitorCheck = false } = {}) {
  let score = 0;
  for (const p of after) {
    const sign = sideOf(p) === side ? -1 : 1;
    const wasOn = before.find((b) => b.id === p.id).onBoard;
    if (wasOn && !p.onBoard) score += sign;
    else if (!p.onBoard) continue;
    else if (traitorCheck && overhang(p) > MIN_OVERHANG) score += sign * overhangCost(p);
    else score += (sign * edgeCloseness(p)) / 20;
  }
  return score;
}

export function evaluateShot(state, shot, level, random = Math.random) {
  const { samples, worstCase } = LEVELS[level];
  const outcome = (played) =>
    scoreOutcome(
      state.pieces,
      simulateShot(state.pieces, played, { record: false }).pieces,
      state.turn,
      state,
    );
  if (!samples) return outcome(shot);
  if (worstCase) {
    let worst = Infinity;
    for (let i = 0; i < samples; i++) {
      // scatterShot maps 0 and 1 to the two edges of the spread.
      const edgeToEdge = i / (samples - 1);
      worst = Math.min(worst, outcome(scatterShot(shot, () => edgeToEdge)));
    }
    return worst;
  }
  let total = 0;
  for (let i = 0; i < samples; i++) total += outcome(scatterShot(shot, random));
  return total / samples;
}

export function shotsFor(state, level) {
  const options = { ...LEVELS[level] };
  // Against a lone enemy piece, nudging own pieces about and waiting for the opponent to miss
  // wins, but drags every round out. Only shots straight at it are allowed.
  const enemies = state.pieces.filter((p) => p.onBoard && sideOf(p) === opponent(state.turn));
  if (options.attackLastPiece && enemies.length === 1) options.enemyTargetsOnly = true;
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
