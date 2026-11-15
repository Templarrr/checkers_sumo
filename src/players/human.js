/**
 * A player driven by the pointer. One instance serves both sides for hot-seat play: it answers
 * for whoever's turn it is asked about.
 *
 * Every player has this shape: `chooseShot(state)` returns a promise of
 * `{ pieceId, vx, vz }` (speed in squares per second, capped at MAX_SPEED), and `cancel()`
 * stops it choosing. A computer player can try shots with `simulateShot` before picking one.
 */
export function createHumanPlayer(aim) {
  return {
    name: 'Human',
    chooseShot(state) {
      return new Promise((resolve) => aim.enable(state, resolve));
    },
    cancel() {
      aim.disable();
    },
  };
}
