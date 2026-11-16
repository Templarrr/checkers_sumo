import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, PLAY_HALF, PIECE_RADIUS } from '../src/game/constants.js';
import { countPieces, newMatch, playShot, shotError } from '../src/game/rules.js';
import { overhangs, tossOdds, traitorCheck } from '../src/game/traitors.js';
import { scoreOutcome } from '../src/players/bot.js';

const piece = (id, color, x, z, flipped = false) => ({ id, color, x, z, onBoard: true, flipped });
// Hangs over Light's edge by 0.2 squares, centre still on the board.
const EDGE = PLAY_HALF - PIECE_RADIUS + 0.2;
// Feeds the toss its random numbers in order: half-flips, drift angle, drift distance.
const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
// 0.3 picks 2 + floor(0.3 * 9) = 4 half-flips, 0.4 picks 5; 0.5 drifts straight in.
const EVEN = 0.3;
const ODD = 0.4;
const STRAIGHT_IN = 0.5;
// Straight out, the far edge of the drift range.
const STRAIGHT_OUT = 0.999;

describe('overhangs', () => {
  it('counts a checker sticking out past the edge but not one inside it', () => {
    expect(overhangs(piece(0, LIGHT, 0, EDGE))).toBe(true);
    expect(overhangs(piece(0, LIGHT, -EDGE, 0))).toBe(true);
    expect(overhangs(piece(0, LIGHT, 0, PLAY_HALF - PIECE_RADIUS))).toBe(false);
    expect(overhangs(piece(0, LIGHT, 3, -3))).toBe(false);
  });
});

describe('traitorCheck', () => {
  it('leaves a checker as it was when it lands the same way up', () => {
    const { pieces, tosses } = traitorCheck(
      [piece(0, LIGHT, 0, EDGE)],
      sequence(EVEN, STRAIGHT_IN, 0.5),
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0].flipped).toBe(false);
    expect(pieces[0].z).toBeLessThan(EDGE);
    expect(tosses[0]).toMatchObject({ halfFlips: 4, result: 'board' });
  });

  it('turns a checker that lands flipped into a traitor for the other side', () => {
    const { pieces } = traitorCheck([piece(0, LIGHT, 0, EDGE)], sequence(ODD, STRAIGHT_IN, 0.5));
    expect(pieces[0].flipped).toBe(true);
    expect(countPieces(pieces, DARK)).toBe(1);
    expect(countPieces(pieces, LIGHT)).toBe(0);
  });

  it('brings a traitor back home when it flips again', () => {
    const { pieces } = traitorCheck(
      [piece(0, LIGHT, 0, EDGE, true)],
      sequence(ODD, STRAIGHT_IN, 0.5),
    );
    expect(countPieces(pieces, LIGHT)).toBe(1);
  });

  it('loses a checker that comes down off the board', () => {
    const { pieces, tosses } = traitorCheck(
      [piece(0, LIGHT, 0, EDGE), piece(1, DARK, 0, 0)],
      sequence(EVEN, STRAIGHT_OUT, 0.9),
    );
    expect(pieces.map((p) => p.id)).toEqual([1]);
    expect(tosses[0].result).toBe('off');
  });

  it('tosses again a checker that lands on the edge', () => {
    // A tiny straight-in drift leaves it overhanging; the second toss goes well in.
    const { pieces, tosses } = traitorCheck(
      [piece(0, LIGHT, 0, EDGE)],
      sequence(0, STRAIGHT_IN, 0, EVEN, STRAIGHT_IN, 0.9),
    );
    expect(tosses.map((t) => t.result)).toEqual(['edge', 'board']);
    expect(overhangs(pieces[0])).toBe(false);
  });

  it('removes checkers it lands on', () => {
    // Four half-flips at mid strength drift 0.48 squares straight in.
    const target = piece(1, DARK, 0, EDGE - 0.48);
    const { pieces, tosses } = traitorCheck(
      [piece(0, LIGHT, 0, EDGE), target, piece(2, DARK, 2, 0)],
      sequence(EVEN, STRAIGHT_IN, 0.5),
    );
    expect(tosses[0].killed).toEqual([1]);
    expect(pieces.map((p) => p.id)).toEqual([0, 2]);
  });

  it('gives every outcome a fair chance', () => {
    const { out, turned } = tossOdds(0.2, { samples: 2000 });
    expect(out).toBeGreaterThan(0.1);
    expect(turned).toBeGreaterThan(0.2);
    expect(1 - out - turned).toBeGreaterThan(0.2);
  });
});

describe('playShot with the traitor check', () => {
  // Light 0 nudges Light 1 so it ends up hanging over Dark's far edge.
  const nudge = () => ({
    ...newMatch(),
    pieces: [piece(0, LIGHT, 0, -2.5), piece(1, LIGHT, 0, -3.6), piece(8, DARK, 3, 0)],
  });
  const shot = { pieceId: 0, vx: 0, vz: -2.8 };

  it('checks a checker the shot left overhanging', () => {
    const { state } = playShot(nudge(), shot, { random: sequence(0.5, EVEN, STRAIGHT_IN, 0.5) });
    expect(state.lastShot.check.tosses[0].id).toBe(1);
    expect(state.pieces.some(overhangs)).toBe(false);
  });

  it('skips the check when it is switched off', () => {
    const { state } = playShot({ ...nudge(), traitorCheck: false }, shot, { random: () => 0.5 });
    expect(state.lastShot.check).toBeNull();
    expect(state.pieces.some(overhangs)).toBe(true);
  });

  it('lets a player shoot a traitor of the other colour', () => {
    const state = { ...newMatch(), pieces: [piece(8, DARK, 0, 0, true), piece(1, DARK, 0, -3)] };
    expect(shotError(state, { pieceId: 8, vx: 0, vz: -1 })).toBeNull();
    expect(shotError(state, { pieceId: 1, vx: 0, vz: 1 })).toMatch(/turn/);
  });

  it('passes the turn after a clean hit if one of your own checkers turns traitor', () => {
    // A glancing hit: Dark 8 goes off the far edge and Light 0 skids aside onto it.
    const start = {
      ...newMatch(),
      pieces: [
        piece(0, LIGHT, 3.6, -2),
        piece(8, DARK, 4.2, -3.6),
        piece(9, DARK, -3, 0),
        piece(1, LIGHT, -3, 3),
      ],
    };
    const hit = { pieceId: 0, vx: 0, vz: -5 };
    const clean = playShot({ ...start, traitorCheck: false }, hit, { random: () => 0.5 }).state;
    expect(clean.lastShot).toMatchObject({ knockedOff: 1, extraShot: true });
    expect(overhangs(clean.pieces.find((p) => p.id === 0))).toBe(true);

    const { state } = playShot(start, hit, { random: sequence(0.5, ODD, STRAIGHT_IN, 0.5) });
    expect(state.lastShot).toMatchObject({ knockedOff: 1, ownTurned: 1, extraShot: false });
    expect(state.turn).toBe(DARK);
  });

  it('gives another shot when the check throws an enemy checker out', () => {
    // Dark 8 is nudged over the edge but stays on the board until the check tosses it off.
    const start = {
      ...newMatch(),
      pieces: [piece(0, LIGHT, 0, -2.5), piece(8, DARK, 0, -3.6), piece(9, DARK, 3, 0)],
    };
    const { state } = playShot(start, shot, { random: sequence(0.5, EVEN, STRAIGHT_OUT, 0.9) });
    expect(state.lastShot.check.tosses.map((t) => t.result)).toEqual(['off']);
    expect(state.lastShot).toMatchObject({ knockedOff: 1, ownLost: 0, extraShot: true });
    expect(state.turn).toBe(LIGHT);
  });

  it('ends the round when the check turns the last checker of a side', () => {
    // Dark's only checker is nudged over the edge and comes down as a Light traitor.
    const start = { ...newMatch(), pieces: [piece(0, LIGHT, 0, -2.5), piece(8, DARK, 0, -3.6)] };
    const { state } = playShot(start, shot, { random: sequence(0.5, ODD, STRAIGHT_IN, 0.5) });
    expect(countPieces(state.pieces, LIGHT)).toBe(2);
    expect(state.roundWinner).toBe(LIGHT);
  });
});

describe('bots and the traitor check', () => {
  it('count an enemy checker left overhanging as nearly won and their own as nearly lost', () => {
    const before = [piece(0, LIGHT, 0, 0), piece(8, DARK, 0, -2)];
    const after = [piece(0, LIGHT, 0, 0), piece(8, DARK, 0, -EDGE)];
    const on = scoreOutcome(before, after, LIGHT, { traitorCheck: true });
    const off = scoreOutcome(before, after, LIGHT, { traitorCheck: false });
    expect(on).toBeGreaterThan(0.5);
    expect(off).toBeLessThan(0.1);
    expect(scoreOutcome(before, after, DARK, { traitorCheck: true })).toBeLessThan(-0.5);
  });

  it('play for the traitors on their side', () => {
    const before = [piece(0, LIGHT, 0, 0, true), piece(8, DARK, 0, -2)];
    const after = [{ ...before[0], onBoard: false }, before[1]];
    // A Light-coloured traitor plays for Dark, so knocking it off is good for Light.
    expect(scoreOutcome(before, after, LIGHT)).toBeGreaterThan(0.5);
  });
});
