import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../src/game/constants.js';
import {
  DRAW,
  countPieces,
  newMatch,
  nextRound,
  playShot,
  rowsAfterRound,
  scatterShot,
  setupPieces,
} from '../src/game/rules.js';

const piece = (id, color, x, z) => ({ id, color, x, z, onBoard: true });
// A Light piece lined up behind a Dark one on the far edge: a hard push sends Dark off.
const knockout = { pieceId: 0, vx: 0, vz: -10 };
// The middle of the random range: the shot goes exactly where it was aimed.
const exact = { random: () => 0.5 };

function position(pieces, extra = {}) {
  return { ...newMatch(), pieces, ...extra };
}

describe('newMatch', () => {
  it('lines up eight pieces per side on the two back rows', () => {
    const { pieces, turn } = newMatch();
    expect(countPieces(pieces, LIGHT)).toBe(8);
    expect(countPieces(pieces, DARK)).toBe(8);
    expect(new Set(pieces.filter((p) => p.color === LIGHT).map((p) => p.z))).toEqual(
      new Set([3.5]),
    );
    expect(new Set(pieces.filter((p) => p.color === DARK).map((p) => p.z))).toEqual(
      new Set([-3.5]),
    );
    expect(turn).toBe(LIGHT);
  });

  it('places advanced rows further forward', () => {
    const pieces = setupPieces({ [LIGHT]: 2, [DARK]: 1 });
    expect(pieces.find((p) => p.color === LIGHT).z).toBe(1.5);
    expect(pieces.find((p) => p.color === DARK).z).toBe(-2.5);
  });
});

describe('playShot', () => {
  it('passes the turn after a shot that knocks nothing off', () => {
    const { state } = playShot(newMatch(), { pieceId: 3, vx: 0, vz: -1 }, exact);
    expect(state.turn).toBe(DARK);
    expect(state.lastShot.extraShot).toBe(false);
  });

  it('gives another shot after a clean knock-off', () => {
    const start = position([
      piece(0, LIGHT, 0, 0),
      piece(1, DARK, 0, -3.5),
      piece(2, DARK, 3.5, 3.5),
      piece(3, LIGHT, -3.5, 3.5),
    ]);
    const { state } = playShot(start, knockout, exact);
    expect(state.lastShot).toMatchObject({ knockedOff: 1, ownLost: 0, extraShot: true });
    expect(state.turn).toBe(LIGHT);
    expect(state.pieces.map((p) => p.id)).not.toContain(1);
  });

  it('passes the turn when the shooter loses a piece of their own', () => {
    const start = position([piece(0, LIGHT, 0, -2), piece(1, LIGHT, 3, 3), piece(2, DARK, 3, -3)]);
    const { state } = playShot(start, knockout, exact);
    expect(state.lastShot.ownLost).toBe(1);
    expect(state.turn).toBe(DARK);
  });

  it('ends the round when one side has no pieces left, and the winner starts the next one', () => {
    const start = position([piece(0, LIGHT, 0, 0), piece(1, DARK, 0, -3.5)]);
    const { state } = playShot(start, knockout, exact);
    expect(state.roundWinner).toBe(LIGHT);
    expect(state.nextRows).toEqual({ [LIGHT]: 1, [DARK]: 0 });
    const round2 = nextRound(state);
    expect(round2.round).toBe(2);
    expect(round2.turn).toBe(LIGHT);
    expect(countPieces(round2.pieces, LIGHT)).toBe(8);
    expect(round2.pieces.find((p) => p.color === LIGHT).z).toBe(2.5);
  });

  it('calls the round a draw when both sides go off in the same shot', () => {
    // A glancing hit near the edge sends both pieces over it.
    const start = position([piece(0, LIGHT, 0, -1), piece(1, DARK, 0.4, -3.5)]);
    const { state } = playShot(start, { pieceId: 0, vx: 0, vz: -11 }, exact);
    expect(state.roundWinner).toBe(DRAW);
    expect(state.nextRows).toEqual(start.rows);
    expect(state.turn).toBe(DARK);
  });

  it('rejects shots out of turn, with a missing piece, or with no direction', () => {
    const state = newMatch();
    expect(() => playShot(state, { pieceId: 8, vx: 0, vz: 1 }, exact)).toThrow(/turn/);
    expect(() => playShot(state, { pieceId: 99, vx: 0, vz: -1 }, exact)).toThrow(
      /not on the board/,
    );
    expect(() => playShot(state, { pieceId: 0, vx: 0, vz: 0 }, exact)).toThrow(/direction/);
  });
});

describe('rowsAfterRound', () => {
  it('moves the winner forward while there is room', () => {
    expect(rowsAfterRound({ [LIGHT]: 2, [DARK]: 3 }, DARK)).toEqual({ [LIGHT]: 2, [DARK]: 4 });
  });

  it('pushes the loser back once the rows meet', () => {
    expect(rowsAfterRound({ [LIGHT]: 4, [DARK]: 2 }, DARK)).toEqual({ [LIGHT]: 3, [DARK]: 3 });
  });

  it('wins the match when the loser has no row left to fall back to', () => {
    const start = position([piece(0, LIGHT, 0, 0), piece(1, DARK, 0, -3.5)], {
      rows: { [LIGHT]: 6, [DARK]: 0 },
    });
    const { state } = playShot(start, knockout, exact);
    expect(state.matchWinner).toBe(LIGHT);
    expect(() => nextRound(state)).toThrow(/over/);
  });
});

describe('scatterShot', () => {
  const degreesOff = (shot) => (Math.abs(Math.atan2(shot.vx, -shot.vz)) * 180) / Math.PI;

  it('turns a weak flick by at most 3 degrees and a full-power one by at most 10', () => {
    for (const random of [() => 0, () => 1]) {
      expect(degreesOff(scatterShot({ pieceId: 0, vx: 0, vz: -0.001 }, random))).toBeCloseTo(3);
      expect(degreesOff(scatterShot({ pieceId: 0, vx: 0, vz: -11 }, random))).toBeCloseTo(10);
    }
  });

  it('keeps the speed, capped at the maximum, and stays within the spread', () => {
    for (let i = 0; i < 50; i++) {
      const shot = scatterShot({ pieceId: 0, vx: 0, vz: -50 });
      expect(Math.hypot(shot.vx, shot.vz)).toBeCloseTo(11);
      expect(degreesOff(shot)).toBeLessThanOrEqual(10.0001);
    }
  });

  it('varies from shot to shot', () => {
    const angles = new Set(
      Array.from({ length: 10 }, () => scatterShot({ pieceId: 0, vx: 0, vz: -5 }).vx),
    );
    expect(angles.size).toBeGreaterThan(1);
  });
});
