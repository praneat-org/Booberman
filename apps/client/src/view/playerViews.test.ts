import { exampleSnapshot } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from './layout';
import { PLAYER_TINTS, toPlayerViews } from './playerViews';

describe('toPlayerViews', () => {
  const views = toPlayerViews(exampleSnapshot.players, 'p2');

  it('converts tile positions (fractions included) to board pixels', () => {
    expect(views[1]).toMatchObject({ id: 'p2', px: 3.4 * TILE_SIZE, py: 5 * TILE_SIZE });
    expect(views[3]?.py).toBe(2.75 * TILE_SIZE);
  });

  it('copies alive / cursed from the server and marks only our own player', () => {
    expect(views.map((v) => v.alive)).toEqual([true, true, false, true]);
    expect(views.map((v) => v.cursed)).toEqual([false, true, false, false]);
    expect(views.map((v) => v.isSelf)).toEqual([false, true, false, false]);
  });

  it('uses a distinct tint per player and handles an unknown self id', () => {
    expect(new Set(Object.values(PLAYER_TINTS)).size).toBe(4);
    expect(views[0]?.tint).toBe(PLAYER_TINTS.p1);
    expect(toPlayerViews(exampleSnapshot.players, undefined).some((v) => v.isSelf)).toBe(false);
  });
});
