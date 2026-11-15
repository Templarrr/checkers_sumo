import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../src/game/constants.js';
import { newMatch, playShot, shotError } from '../src/game/rules.js';
import { EASY, MEDIUM, bestShot, candidateShots } from '../src/players/bot.js';

const piece = (id, color, x, z) => ({ id, color, x, z, onBoard: true });
const position = (pieces) => ({ ...newMatch(), pieces });
const exact = { random: () => 0.5 };
const shotsFrom = (shots, id) => shots.filter((s) => s.pieceId === id);
const straightAhead = (shot) => Math.abs(shot.vx) < 1e-9 && shot.vz < 0;

// A Dark piece close to the far edge, straight in front of a Light piece.
const sitter = () =>
  position([piece(0, LIGHT, 0, 1), piece(1, DARK, 0, -3.5), piece(2, DARK, -3.5, 3.5)]);

describe('bots', () => {
  for (const level of [EASY, MEDIUM]) {
    it(`${level} knocks off a piece that is easy to hit`, () => {
      const { shot, score } = bestShot(sitter(), level);
      expect(score).toBeGreaterThan(0.5);
      const { state } = playShot(sitter(), shot, exact);
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
    const easy = shotsFrom(candidateShots(state, { enemyTargetsOnly: true }), 0);
    const medium = shotsFrom(candidateShots(state, { enemyTargetsOnly: false }), 0);
    expect(easy.some(straightAhead)).toBe(false);
    expect(medium.some(straightAhead)).toBe(true);
  });

  it('ignores shots too weak to reach anything', () => {
    const state = position([piece(0, LIGHT, 0, 3.5), piece(1, DARK, 0, -3.5)]);
    const shots = candidateShots(state, { enemyTargetsOnly: false });
    expect(shots.length).toBeGreaterThan(0);
    // Reaching a piece 6.2 squares away needs a little over half power.
    expect(shots.every((s) => Math.hypot(s.vx, s.vz) > 5.5)).toBe(true);
  });
});
