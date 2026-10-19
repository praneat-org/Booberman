import { describe, expect, it } from 'vitest';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX, loadingBarFill } from './layout';

describe('layout', () => {
  it('board is 13x11 tiles of 16px = 208x176', () => {
    expect(BOARD_WIDTH_PX).toBe(208);
    expect(BOARD_HEIGHT_PX).toBe(176);
  });

  it('loadingBarFill clamps and rounds', () => {
    expect(loadingBarFill(0, 100)).toBe(0);
    expect(loadingBarFill(0.456, 100)).toBe(46);
    expect(loadingBarFill(1, 100)).toBe(100);
    expect(loadingBarFill(2, 100)).toBe(100);
    expect(loadingBarFill(-1, 100)).toBe(0);
    expect(loadingBarFill(Number.NaN, 100)).toBe(0);
  });
});
