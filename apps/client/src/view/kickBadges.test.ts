import { describe, expect, it } from 'vitest';
import { toKickBadges } from './kickBadges';
import { TILE_SIZE } from './layout';
import { toPlayerViews } from './playerViews';
import type { Drawable } from './roundView';

const p = (id: 'p1' | 'p2' | 'p3', extra: { kick?: boolean; alive?: boolean } = {}) => ({
  id,
  x: 2,
  y: 3,
  alive: extra.alive ?? true,
  curse: 0,
  teleport: false,
  ...(extra.kick !== undefined && { kick: extra.kick }),
});
const drawable = (
  players: ReturnType<typeof p>[],
  phase: 'alive' | 'dying' = 'alive',
): Drawable['players'] =>
  toPlayerViews(players, undefined).map((view) => ({
    view,
    anim: {
      phase,
      facing: 'down',
      moving: false,
      progress: 0,
    } as Drawable['players'][number]['anim'],
  }));

describe('toPlayerViews kick', () => {
  it('kick is true only when the server says so', () => {
    const [a, b, c] = toPlayerViews(
      [p('p1', { kick: true }), p('p2'), p('p3', { kick: false })],
      undefined,
    );
    expect([a?.kick, b?.kick, c?.kick]).toEqual([true, false, false]);
  });
});

describe('toKickBadges', () => {
  it('one badge per living player who has the kick item', () => {
    const badges = toKickBadges(
      drawable([p('p1', { kick: true }), p('p2'), p('p3', { kick: true })]),
    );
    expect(badges.map((b) => b.key)).toEqual(['p1', 'p3']);
    expect(badges[0]).toEqual({
      key: 'p1',
      cx: 2 * TILE_SIZE + TILE_SIZE * 0.8,
      cy: 3 * TILE_SIZE + TILE_SIZE * 0.8,
    });
  });

  it('none for a dead player or during the death animation', () => {
    expect(toKickBadges(drawable([p('p1', { kick: true, alive: false })]))).toEqual([]);
    expect(toKickBadges(drawable([p('p1', { kick: true })], 'dying'))).toEqual([]);
  });
});
