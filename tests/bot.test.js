import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../src/game/constants.js';
import { newMatch, playShot, shotError } from '../src/game/rules.js';
import {
  EASY,
  HARD,
  LEVELS,
  MEDIUM,
  bestShot,
  candidateShots,
  evaluateShot,
  fumbleAim,
  shotsFor,
} from '../src/players/bot.js';

const piece = (id, color, x, z) => ({ id, color, x, z, onBoard: true });
const position = (pieces) => ({ ...newMatch(), pieces });
const exact = { random: () => 0.5 };
// Medium imagines randomly scattered shots; a fixed sequence keeps its choice repeatable.
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}
const shotsFrom = (shots, id) => shots.filter((s) => s.pieceId === id);
const straightAhead = (shot) => Math.abs(shot.vx) < 1e-9 && shot.vz < 0;

// A Dark piece close to the far edge, straight in front of a Light piece.
const sitter = (lightZ = 1) =>
  position([piece(0, LIGHT, 0, lightZ), piece(1, DARK, 0, -3.5), piece(2, DARK, -3.5, 3.5)]);

describe('bots', () => {
  for (const level of [EASY, MEDIUM, HARD]) {
    it(`${level} knocks off a piece that is easy to hit`, () => {
      // Close enough that even the edges of the spread hit it.
      const close = sitter(-2.2);
      const { shot, score } = bestShot(close, level, { random: seeded() });
      expect(score).toBeGreaterThan(0.5);
      const { state } = playShot(close, shot, exact);
      expect(state.lastShot.knockedOff).toBe(1);
    });
  }

  it('finds a legal opening shot', () => {
    const state = newMatch();
    const { shot } = bestShot(state, EASY);
    expect(shotError(state, shot)).toBeNull();
  });

  it('plays for Dark when it is Dark to move', () => {
    const state = { ...sitter(), turn: DARK };
    const { shot } = bestShot(state, EASY);
    expect(state.pieces.find((p) => p.id === shot.pieceId).color).toBe(DARK);
  });

  it('only lets Medium aim at its own piece to push an enemy behind it', () => {
    // Light 0 stands behind Light 1, which stands behind Dark 2.
    const state = position([piece(0, LIGHT, 0, 2), piece(1, LIGHT, 0, 1), piece(2, DARK, 0, -1)]);
    const easy = shotsFrom(candidateShots(state, { ...LEVELS[MEDIUM], enemyTargetsOnly: true }), 0);
    const medium = shotsFrom(candidateShots(state, LEVELS[MEDIUM]), 0);
    expect(easy.some(straightAhead)).toBe(false);
    expect(medium.some(straightAhead)).toBe(true);
  });

  it('gives Easy a coarser grid of shots than Medium', () => {
    const state = newMatch();
    const easy = candidateShots(state, { ...LEVELS[EASY], enemyTargetsOnly: false });
    const medium = candidateShots(state, LEVELS[MEDIUM]);
    expect(easy.length * 10).toBeLessThan(medium.length);
  });

  it('ignores shots too weak to reach anything', () => {
    const state = position([piece(0, LIGHT, 0, 3.5), piece(1, DARK, 0, -3.5)]);
    const shots = candidateShots(state, LEVELS[MEDIUM]);
    expect(shots.length).toBeGreaterThan(0);
    // Reaching a piece 6.2 squares away needs a little over half power.
    expect(shots.every((s) => Math.hypot(s.vx, s.vz) > 5.5)).toBe(true);
  });

  it('makes Hard judge a shot by its worst scatter, not its lucky ones', () => {
    // At full power and 4.5 squares the spread is wide enough to miss at its edges.
    const longShot = { pieceId: 0, vx: 0, vz: -11 };
    const { state } = playShot(sitter(), longShot, exact);
    expect(state.lastShot.knockedOff).toBe(1);
    expect(evaluateShot(sitter(), longShot, HARD)).toBeLessThan(0.5);
  });

  it('gives Hard the same shots to choose from as Medium', () => {
    const state = newMatch();
    expect(candidateShots(state, LEVELS[HARD])).toEqual(candidateShots(state, LEVELS[MEDIUM]));
  });

  it('makes Medium and Hard shoot only at the last enemy piece', () => {
    const lone = position([piece(0, LIGHT, 0, 2), piece(1, LIGHT, 1, 3), piece(2, DARK, 0, -2)]);
    const twoLeft = position([...lone.pieces, piece(3, DARK, 3, -3)]);
    // The shot's straight line passes close enough to Dark 2 to hit it.
    const atLastPiece = (state) => (shot) => {
      const from = state.pieces.find((p) => p.id === shot.pieceId);
      const speed = Math.hypot(shot.vx, shot.vz);
      const rx = 0 - from.x;
      const rz = -2 - from.z;
      const along = (rx * shot.vx + rz * shot.vz) / speed;
      return along > 0 && Math.abs(rx * shot.vz - rz * shot.vx) / speed < 0.8;
    };
    for (const level of [MEDIUM, HARD]) {
      expect(shotsFor(twoLeft, level).every(atLastPiece(twoLeft))).toBe(false);
      const shots = shotsFor(lone, level);
      expect(shots.length).toBeGreaterThan(0);
      expect(shots.every(atLastPiece(lone))).toBe(true);
    }
  });

  it('turns Easy aim by at most 5 degrees and leaves Medium aim alone', () => {
    const shot = { pieceId: 0, vx: 0, vz: -8 };
    const angle = ({ vx, vz }) => (Math.atan2(vx, -vz) * 180) / Math.PI;
    const extremes = [0, 1].map((r) => angle(fumbleAim(shot, EASY, () => r)));
    expect(extremes.map(Math.abs)).toEqual([expect.closeTo(5), expect.closeTo(5)]);
    expect(extremes[0]).toBeCloseTo(-extremes[1]);
    const turned = fumbleAim(shot, EASY, () => 0.9);
    expect(Math.hypot(turned.vx, turned.vz)).toBeCloseTo(8);
    expect(fumbleAim(shot, MEDIUM, () => 1)).toEqual(shot);
  });
});
