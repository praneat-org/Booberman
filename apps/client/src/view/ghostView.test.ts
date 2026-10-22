import type { PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { toBombViews } from './entityViews';
import { type HudCard, Roster, statusLabel, toHudView } from './hudView';
import { PlayerAnimTracker } from './playerAnim';
import { toPlayerViews } from './playerViews';

const player = (over: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  x: 3,
  y: 0,
  alive: false,
  curse: 0,
  teleport: false,
  ghost: true,
  throwCooldown: 45,
  ...over,
});

describe('ghost drawing (BE-46)', () => {
  it('a ghost is drawn at once: no death animation, never gone', () => {
    const t = new PlayerAnimTracker();
    t.update([player({ alive: true, ghost: undefined, x: 3, y: 3 })], 1);
    const a = t.update([player({ teleport: true })], 2).get('p1');
    expect(a).toMatchObject({ phase: 'alive', ghost: true, moving: false });
    expect(t.update([player()], 40).get('p1')?.phase).toBe('alive');
  });

  it('a ghost seen for the first time (late join) is drawn too', () => {
    expect(new PlayerAnimTracker().update([player()], 500).get('p1')?.phase).toBe('alive');
  });

  it('a plain corpse still plays the death animation and goes away', () => {
    const t = new PlayerAnimTracker();
    t.update([player({ alive: true, ghost: undefined })], 1);
    expect(t.update([player({ ghost: undefined })], 2).get('p1')?.phase).toBe('dying');
    expect(t.update([player({ ghost: undefined })], 20).get('p1')?.phase).toBe('gone');
  });

  it('a ghost walking along the rim animates like a walker', () => {
    const t = new PlayerAnimTracker();
    t.update([player()], 1);
    expect(t.update([player({ x: 4 })], 2).get('p1')).toMatchObject({
      moving: true,
      facing: 'right',
    });
  });

  it('player and bomb views carry the ghost flag', () => {
    expect(toPlayerViews([player()], 'p1')[0]?.ghost).toBe(true);
    expect(toPlayerViews([player({ ghost: undefined })], 'p1')[0]?.ghost).toBe(false);
    const [ghostBomb, bomb] = toBombViews([
      { x: 1, y: 1, fuse: 10, ghost: true },
      { x: 2, y: 1, fuse: 10 },
    ]);
    expect([ghostBomb?.ghost, bomb?.ghost]).toEqual([true, false]);
  });
});

describe('ghost HUD (BE-46)', () => {
  const snapshot = (throwCooldown: number) => ({
    v: 1 as const,
    t: 'snapshot' as const,
    tick: 10,
    ackSeq: 0,
    players: [player({ throwCooldown }), player({ id: 'p2', alive: true, ghost: undefined })],
    bombs: [],
    flames: [],
    items: [],
  });
  const card = (cooldown: number, self: 'p1' | 'p2' = 'p1'): HudCard =>
    toHudView(snapshot(cooldown), new Roster(), self).cards[0] as HudCard;

  it('own ghost card counts the seconds to the next throw, rounded up (20 ticks = 1 s)', () => {
    expect(card(200)).toMatchObject({ status: 'ghost', throwSeconds: 10 });
    expect(statusLabel(card(200))).toBe('GHOST 10s');
    expect(statusLabel(card(21))).toBe('GHOST 2s');
    expect(statusLabel(card(1))).toBe('GHOST 1s');
  });

  it('says THROW! when ready, and other players only show GHOST', () => {
    expect(statusLabel(card(0))).toBe('THROW!');
    expect(statusLabel(card(100, 'p2'))).toBe('GHOST');
  });

  it('keeps the other labels', () => {
    const cards = toHudView(snapshot(0), new Roster(), 'p1').cards;
    expect(statusLabel(cards[1] as HudCard)).toBe('ALIVE');
    expect(statusLabel({ ...(cards[1] as HudCard), status: 'dead' })).toBe('DEAD');
    expect(statusLabel({ ...(cards[1] as HudCard), status: 'cursed', curseSeconds: 4 })).toBe(
      'CURSE 4s',
    );
  });
});
