import { describe, expect, it } from 'vitest';
import {
  bombBlink,
  FAST_BLINK_FUSE,
  toBombViews,
  toFlameViews,
  toItemViews,
} from './entityViews';
import { TILE_SIZE } from './layout';

describe('bombBlink', () => {
  it('blinks fast only below 15 ticks (0.75 s)', () => {
    expect(FAST_BLINK_FUSE).toBe(15);
    expect(bombBlink(40).fast).toBe(false);
    expect(bombBlink(15).fast).toBe(false);
    expect(bombBlink(14).fast).toBe(true);
    expect(bombBlink(0).fast).toBe(true);
  });

  it('fast phase flips more often than slow phase', () => {
    const flips = (fuses: number[]) =>
      fuses.slice(1).filter((f, i) => bombBlink(f).bright !== bombBlink(fuses[i] as number).bright)
        .length;
    const fast = flips([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const slow = flips([40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26]);
    expect(fast).toBeGreaterThan(slow);
  });

  it('depends only on fuse (same server value → same frame)', () => {
    expect(bombBlink(9)).toEqual(bombBlink(9));
  });
});

describe('view models', () => {
  it('bombs / flames / items map tiles to board pixels', () => {
    const [bomb] = toBombViews([{ x: 2, y: 3, fuse: 10 }]);
    expect(bomb).toMatchObject({ key: '2,3', px: 2 * TILE_SIZE, py: 3 * TILE_SIZE, fast: true });
    const flames = toFlameViews(
      [
        [1, 1],
        [2, 1],
      ],
      4,
    );
    expect(flames.map((f) => f.px)).toEqual([TILE_SIZE, 2 * TILE_SIZE]);
    expect(toFlameViews([[1, 1]], 0)[0]?.frame).not.toBe(toFlameViews([[1, 1]], 2)[0]?.frame);
    const items = toItemViews([
      { x: 5, y: 5, kind: 'curse' },
      { x: 6, y: 5, kind: 'kick' },
    ]);
    expect(items.map((i) => i.frame)).toEqual([0, 1]);
  });
});
