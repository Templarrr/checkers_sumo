export const LIGHT = 'light';
export const DARK = 'dark';
export const COLORS = [LIGHT, DARK];
export const opponent = (color) => (color === LIGHT ? DARK : LIGHT);

// Board units are squares; the board spans -HALF..HALF on both axes, Light sits at +z.
export const BOARD_SIZE = 8;
export const HALF = BOARD_SIZE / 2;
export const PIECES_PER_SIDE = 8;
export const PIECE_RADIUS = 0.4;

// Row 0 is a side's own back row. Once the two rows are adjacent there is no room to advance
// without pushing the loser back.
export const LAST_FREE_ROWS = BOARD_SIZE - 2;
