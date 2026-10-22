import { describe, expect, it } from 'vitest';
import { type HeldSlot, HeldSlots, newToken, RECONNECT_HOLD_MS, sameToken } from './reconnect';

const slot = (
  playerId: HeldSlot['playerId'],
  expiresAt: number,
  token = `tok-${playerId}`,
): HeldSlot => ({
  playerId,
  nickname: `name-${playerId}`,
  session: 1,
  token,
  room: 'abc123',
  expiresAt,
});

describe('tokens', () => {
  it('are 128 random bits as hex, never the same twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, newToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sameToken: equal only when every character is', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
    expect(sameToken(undefined, 'abc')).toBe(false);
  });
});

describe('HeldSlots', () => {
  it('the hold is 15 seconds (CAR-3800)', () => {
    expect(RECONNECT_HOLD_MS).toBe(15_000);
  });

  it('claim: the right token inside the window gives the slot back, once', () => {
    const held = new HeldSlots([slot('p2', 15_000)]);
    expect(held.claim('tok-p2', 5_000)?.playerId).toBe('p2'); // dropped 5 s ago, back at 5 s
    expect(held.has('p2')).toBe(false);
    expect(held.claim('tok-p2', 5_001)).toBeUndefined(); // the token is spent
  });

  it('claim: the last millisecond before the deadline still works, the deadline itself does not', () => {
    expect(new HeldSlots([slot('p1', 15_000)]).claim('tok-p1', 14_999)).toBeDefined();
    expect(new HeldSlots([slot('p1', 15_000)]).claim('tok-p1', 15_000)).toBeUndefined();
    expect(new HeldSlots([slot('p1', 15_000)]).claim('tok-p1', 16_000)).toBeUndefined();
  });

  it('claim: a wrong token, or another player’s, gets nothing and changes nothing', () => {
    const held = new HeldSlots([slot('p1', 15_000), slot('p3', 15_000)]);
    expect(held.claim('nope', 1)).toBeUndefined();
    expect(held.claim('', 1)).toBeUndefined();
    expect(held.size).toBe(2);
  });

  it('claim: an expired slot is left for expire() to remove', () => {
    const held = new HeldSlots([slot('p1', 15_000)]);
    expect(held.claim('tok-p1', 16_000)).toBeUndefined();
    expect(held.size).toBe(1);
    expect(held.expire(16_000).map((s) => s.playerId)).toEqual(['p1']);
    expect(held.size).toBe(0);
  });

  it('expire: removes exactly the slots whose time is up', () => {
    const held = new HeldSlots([slot('p1', 10_000), slot('p2', 20_000), slot('p3', 10_000)]);
    expect(held.expire(9_999)).toEqual([]);
    expect(held.expire(10_000).map((s) => s.playerId)).toEqual(['p1', 'p3']);
    expect(held.list().map((s) => s.playerId)).toEqual(['p2']);
  });

  it('nextExpiry: the earliest deadline, undefined when empty', () => {
    const held = new HeldSlots();
    expect(held.nextExpiry()).toBeUndefined();
    held.add(slot('p2', 30_000));
    held.add(slot('p4', 20_000));
    expect(held.nextExpiry()).toBe(20_000);
    held.claim('tok-p4', 1);
    expect(held.nextExpiry()).toBe(30_000);
  });

  it('list: sorted by playerId, and a copy (round-trips through storage)', () => {
    const held = new HeldSlots([slot('p3', 1), slot('p1', 1)]);
    const saved = held.list();
    expect(saved.map((s) => s.playerId)).toEqual(['p1', 'p3']);
    expect(new HeldSlots(JSON.parse(JSON.stringify(saved))).list()).toEqual(saved);
  });
});
