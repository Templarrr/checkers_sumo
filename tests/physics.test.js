import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../src/game/constants.js';
import { simulateShot } from '../src/game/physics.js';

const piece = (id, x, z, color = LIGHT) => ({ id, color, x, z, onBoard: true });

describe('simulateShot', () => {
  it('slides a lone piece in the flicked direction until friction stops it', () => {
    const { pieces, frames } = simulateShot([piece(0, 0, 3)], { pieceId: 0, vx: 0, vz: -4 });
    expect(pieces[0].onBoard).toBe(true);
    expect(pieces[0].x).toBeCloseTo(0);
    expect(pieces[0].z).toBeLessThan(1);
    expect(pieces[0].z).toBeGreaterThan(-4);
    expect(frames.length).toBeGreaterThan(10);
  });

  it('passes most of the motion on in a head-on hit', () => {
    const start = [piece(0, 0, 2), piece(1, 0, 0, DARK)];
    const { pieces, hits } = simulateShot(start, { pieceId: 0, vx: 0, vz: -6 });
    const [shooter, target] = pieces;
    expect(hits.length).toBeGreaterThan(0);
    expect(target.z).toBeLessThan(-2);
    expect(shooter.z).toBeGreaterThan(target.z + 2);
  });

  it('knocks a hard-hit piece off the board and reports the fall', () => {
    const start = [piece(0, 0, 0), piece(1, 0, -3.5, DARK)];
    const { pieces, falls } = simulateShot(start, { pieceId: 0, vx: 0, vz: -10 });
    expect(pieces[1].onBoard).toBe(false);
    expect(falls.map((f) => f.id)).toContain(1);
  });

  it('keeps a piece that stops on the frame beyond the cells in play', () => {
    const { pieces, falls } = simulateShot([piece(0, 0, 3.5)], { pieceId: 0, vx: 0, vz: 2.2 });
    expect(pieces[0].z).toBeGreaterThan(4);
    expect(pieces[0].onBoard).toBe(true);
    expect(falls).toEqual([]);
  });

  it('leaves pieces that were not touched where they were', () => {
    const start = [piece(0, -3, 0), piece(1, 3, 0, DARK)];
    const { pieces } = simulateShot(start, { pieceId: 0, vx: 0, vz: 2 });
    expect(pieces[1]).toEqual(start[1]);
  });
});
