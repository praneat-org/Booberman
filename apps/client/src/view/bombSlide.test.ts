import { describe, expect, it } from 'vitest';
import type { SnapshotMessage } from '../net/Transport';
import { BombSlideTween } from './bombSlide';
import { toBombViews } from './entityViews';
import { TILE_SIZE } from './layout';

type BombState = SnapshotMessage['bombs'][number];

const bomb = (x: number, slide?: BombState['slide']): BombState => ({
  x,
  y: 1,
  fuse: 30,
  ...(slide && { slide }),
});

describe('BombSlideTween', () => {
  it('a bomb that does not slide is drawn on its tile', () => {
    const t = new BombSlideTween();
    expect(t.update([bomb(3)], 10, 10.5)).toEqual([{ x: 3, y: 1 }]);
  });

  it('a bomb first seen sliding glides in from one tile behind over 2 ticks', () => {
    const t = new BombSlideTween();
    expect(t.update([bomb(3, 'right')], 10, 10)).toEqual([{ x: 2, y: 1 }]);
    expect(t.update([bomb(3, 'right')], 10, 11)).toEqual([{ x: 2.5, y: 1 }]);
    expect(t.update([bomb(3, 'right')], 11, 12)).toEqual([{ x: 3, y: 1 }]);
    // waiting for the next hop it stays on its tile
    expect(t.update([bomb(3, 'right')], 11, 12.9)).toEqual([{ x: 3, y: 1 }]);
  });

  it('consecutive hops join into a steady glide', () => {
    const t = new BombSlideTween();
    t.update([bomb(3, 'right')], 10, 10);
    t.update([bomb(3, 'right')], 11, 12);
    // the next hop shows up on tick 12: starts from tile 3 again
    expect(t.update([bomb(4, 'right')], 12, 12)).toEqual([{ x: 3, y: 1 }]);
    expect(t.update([bomb(4, 'right')], 12, 13)).toEqual([{ x: 3.5, y: 1 }]);
    expect(t.update([bomb(4, 'right')], 13, 14)).toEqual([{ x: 4, y: 1 }]);
  });

  it('works vertically and leftwards', () => {
    const t = new BombSlideTween();
    const down: BombState = { x: 2, y: 5, fuse: 9, slide: 'down' };
    expect(t.update([down], 4, 5)).toEqual([{ x: 2, y: 4.5 }]);
    const left: BombState = { x: 6, y: 2, fuse: 9, slide: 'left' };
    expect(new BombSlideTween().update([left], 4, 5)).toEqual([{ x: 6.5, y: 2 }]);
  });

  it('a bomb that stopped (no slide) is back on its tile; reset forgets everything', () => {
    const t = new BombSlideTween();
    t.update([bomb(3, 'right')], 10, 10);
    expect(t.update([bomb(3)], 12, 12)).toEqual([{ x: 3, y: 1 }]);
    t.update([bomb(5, 'right')], 20, 20);
    t.reset();
    expect(t.update([bomb(5, 'right')], 30, 30)).toEqual([{ x: 4, y: 1 }]);
  });

  it('two sliding bombs are tracked separately', () => {
    const t = new BombSlideTween();
    const two = [bomb(3, 'right'), { x: 8, y: 3, fuse: 5, slide: 'left' as const }];
    t.update(two, 10, 10);
    expect(t.update(two, 10, 11)).toEqual([
      { x: 2.5, y: 1 },
      { x: 8.5, y: 3 },
    ]);
  });
});

describe('toBombViews with drawn positions', () => {
  it('uses the tween position for pixels and keeps the tile key', () => {
    const [v] = toBombViews([bomb(3, 'right')], [{ x: 2.5, y: 1 }]);
    expect(v?.px).toBe(2.5 * TILE_SIZE);
    expect(v?.key).toBe('3,1');
  });
});
