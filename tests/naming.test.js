import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The game is Checkers Sumo only: it must never carry the name of the historical figure the
// classic flick-checkers game is named after, in any spelling or alphabet.
const forbidden = [/t?ch[ae]p[ae][iy]?[ey]?[vwf]/i, /ч[а]па[её]в/i];

describe('naming', () => {
  it('keeps the old name out of every tracked file', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    const offenders = files.filter((file) => {
      if (!file || /\.(png|jpe?g|webp|ico)$/i.test(file)) return false;
      const text = readFileSync(file, 'utf8');
      return forbidden.some((pattern) => pattern.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
