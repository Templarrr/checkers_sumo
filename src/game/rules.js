import {
  DARK,
  HALF,
  LAST_FREE_ROWS,
  LIGHT,
  PIECES_PER_SIDE,
  PIECE_RADIUS,
  opponent,
} from './constants.js';
import { MAX_SPEED, simulateShot } from './physics.js';

export const DRAW = 'draw';

// Light faces Dark from the +z side, so Light's rows count towards -z.
export function rowZ(color, row) {
  const back = HALF - 0.5;
  return color === LIGHT ? back - row : -back + row;
}

export function setupPieces(rows) {
  const pieces = [];
  for (const color of [LIGHT, DARK]) {
    for (let file = 0; file < PIECES_PER_SIDE; file++) {
      pieces.push({
        id: pieces.length,
        color,
        x: file - HALF + 0.5,
        z: rowZ(color, rows[color]),
        onBoard: true,
      });
    }
  }
  return pieces;
}

function startRound(round, rows, starter) {
  return {
    round,
    rows,
    turn: starter,
    pieces: setupPieces(rows),
    lastShot: null,
    roundWinner: null,
    nextRows: null,
    matchWinner: null,
  };
}

export const newMatch = () => startRound(1, { [LIGHT]: 0, [DARK]: 0 }, LIGHT);

export const countPieces = (pieces, color) =>
  pieces.filter((p) => p.onBoard && p.color === color).length;

/**
 * Where both sides line up after `winner` takes a round. The winner moves one row forward;
 * once that would collide with the loser's row, the loser is pushed one row back. A loser with
 * no row left to fall back to has lost the match.
 */
export function rowsAfterRound(rows, winner) {
  const loser = opponent(winner);
  const next = { ...rows, [winner]: rows[winner] + 1 };
  if (next[winner] + next[loser] > LAST_FREE_ROWS) next[loser] -= 1;
  return next;
}

export function shotError(state, { pieceId, vx, vz }) {
  if (state.roundWinner) return 'The round is over';
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece || !piece.onBoard) return 'That piece is not on the board';
  if (piece.color !== state.turn) return `It is ${state.turn}'s turn`;
  if (!Number.isFinite(vx) || !Number.isFinite(vz) || (vx === 0 && vz === 0))
    return 'A shot needs a direction';
  return null;
}

const clampSpeed = ({ pieceId, vx, vz }) => {
  const speed = Math.hypot(vx, vz);
  const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
  return { pieceId, vx: vx * scale, vz: vz * scale };
};

/**
 * Plays `shot` for the side to move and applies the Chapaev rules to the result.
 * Returns the new state and the simulation, which the renderer replays.
 */
export function playShot(state, shot) {
  const error = shotError(state, shot);
  if (error) throw new Error(error);
  const shooter = state.turn;
  const simulation = simulateShot(state.pieces, clampSpeed(shot));
  const pieces = simulation.pieces.filter((p) => p.onBoard);

  const lost = (color) => countPieces(state.pieces, color) - countPieces(pieces, color);
  const knockedOff = lost(opponent(shooter));
  const ownLost = lost(shooter);
  // A clean hit (at least one enemy off, none of your own) earns another shot.
  const extraShot = knockedOff > 0 && ownLost === 0;

  const next = {
    ...state,
    pieces,
    turn: extraShot ? shooter : opponent(shooter),
    lastShot: { shooter, knockedOff, ownLost, extraShot },
  };

  const lightLeft = countPieces(pieces, LIGHT);
  const darkLeft = countPieces(pieces, DARK);
  if (lightLeft === 0 || darkLeft === 0) {
    if (lightLeft === darkLeft) {
      // Both sides wiped out in one shot: replay the round, the other side starts.
      next.roundWinner = DRAW;
      next.nextRows = state.rows;
      next.turn = opponent(shooter);
    } else {
      const winner = lightLeft > 0 ? LIGHT : DARK;
      next.roundWinner = winner;
      next.nextRows = rowsAfterRound(state.rows, winner);
      next.turn = winner;
      if (next.nextRows[opponent(winner)] < 0) next.matchWinner = winner;
    }
  }
  return { state: next, simulation };
}

export function nextRound(state) {
  if (!state.roundWinner) throw new Error('The round is still being played');
  if (state.matchWinner) throw new Error('The match is over');
  return startRound(state.round + 1, state.nextRows, state.turn);
}

// Lets the input layer find a piece under the pointer generously, for fingers on small screens.
export function pieceNear(state, x, z, color, reach = PIECE_RADIUS * 1.4) {
  let best = null;
  let bestDistance = reach;
  for (const p of state.pieces) {
    if (!p.onBoard || p.color !== color) continue;
    const distance = Math.hypot(p.x - x, p.z - z);
    if (distance <= bestDistance) {
      best = p;
      bestDistance = distance;
    }
  }
  return best;
}
