import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ServerMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/game';
import type { RoomDO } from '../src/room/RoomDO';
import { type Client, join, v } from './helpers';

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
type Event<K extends string> = Extract<ServerMessage, { t: 'event'; kind: K }>;
const roundEnd = (m: ServerMessage): m is Event<'roundEnd'> =>
  m.t === 'event' && m.kind === 'roundEnd';
const roundStart = (m: ServerMessage): m is Event<'roundStart'> =>
  m.t === 'event' && m.kind === 'roundStart';
const snapshots = (c: Client) =>
  c.received.filter((m): m is Extract<ServerMessage, { t: 'snapshot' }> => m.t === 'snapshot');

/** Edit the live game state of a room (the loop keeps running; edits land between two ticks). */
const editState = (room: string, edit: (s: GameState) => Partial<GameState>) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => {
    const holder = r as unknown as { state?: GameState };
    if (!holder.state) throw new Error('no game state yet');
    holder.state = { ...holder.state, ...edit(holder.state) };
  });

/** p1 at (1,1), p2 at (11,1): a bomb of p1 at (10,1) burns x8..x12 → only p2 is in the fire. */
const bombNextToP2: Partial<GameState> = {
  bombs: [{ x: 10, y: 1, ownerId: 'p1', ownerSession: 1, fuse: 1 }],
};

describe('a 2-player room plays a round to the end (BE-39)', () => {
  it('last survivor: both clients get roundEnd { winner, lastAlive }', async () => {
    const a = await join('end1', 'A');
    const b = await join('end1', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('end1', () => bombNextToP2);

    const endA = await a.next(roundEnd);
    const endB = await b.next(roundEnd);
    expect(endA).toMatchObject({
      v,
      t: 'event',
      kind: 'roundEnd',
      winner: 'p1',
      reason: 'lastAlive',
    });
    expect(endB).toEqual(endA);
    // sent once, and the snapshots show who died
    await new Promise((r) => setTimeout(r, 200));
    expect(a.received.filter(roundEnd)).toHaveLength(1);
    expect(
      snapshots(a)
        .at(-1)
        ?.players.map((p) => [p.id, p.alive]),
    ).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
    a.close();
    b.close();
  });

  it('time limit: draw with reason timeout', async () => {
    const a = await join('end2', 'A');
    const b = await join('end2', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('end2', () => ({ tick: 2990 })); // 3000 - 10
    expect(await a.next(roundEnd, 3000)).toMatchObject({ winner: null, reason: 'timeout' });
    a.close();
    b.close();
  });

  it('the room keeps sending snapshots after the end, but the game stays frozen', async () => {
    const a = await join('end3', 'A');
    const b = await join('end3', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('end3', () => bombNextToP2);
    await a.next(roundEnd);
    const before = snapshots(a).length;
    a.send({ v, t: 'input', seq: 50, dir: 'down', bomb: true });
    await new Promise((r) => setTimeout(r, 300));
    const after = snapshots(a).slice(before);
    expect(after.length).toBeGreaterThan(3);
    for (const s of after) {
      expect(s.bombs).toEqual([]);
      expect(s.players.find((p) => p.id === 'p1')).toMatchObject({ x: 1, y: 1 });
    }
    a.close();
    b.close();
  });
});

describe('a player leaving mid-round through the real RoomDO (BE-39, D32 item 1)', () => {
  it('1v1, both alive, p2 closes the socket: p1 gets roundEnd { p1, lastAlive } on the next tick', async () => {
    const a = await join('leave1', 'A');
    const b = await join('leave1', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    b.close();
    const end = await a.next(roundEnd);
    expect(end).toMatchObject({
      v,
      t: 'event',
      kind: 'roundEnd',
      winner: 'p1',
      reason: 'lastAlive',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(a.received.filter(roundEnd)).toHaveLength(1);
    a.close();
  });

  it('3 players, p3 already dead, p2 closes: p1 wins (same result as 1v1)', async () => {
    const a = await join('leave3', 'A');
    const b = await join('leave3', 'B');
    const c = await join('leave3', 'C');
    await c.next((m) => m.t === 'snapshot' && m.players.length === 3);
    await editState('leave3', (s) => ({
      players: s.players.map((p) => (p.id === 'p3' ? { ...p, alive: false } : p)),
    }));
    await new Promise((r) => setTimeout(r, 150));
    expect(a.received.filter(roundEnd)).toHaveLength(0);
    b.close();
    expect(await a.next(roundEnd)).toMatchObject({ winner: 'p1', reason: 'lastAlive' });
    a.close();
    c.close();
  });

  it('playing alone from the start: no roundEnd by elimination (and a second player leaving later does end it)', async () => {
    const a = await join('leave4', 'A');
    await new Promise((r) => setTimeout(r, 300));
    expect(a.received.filter(roundEnd)).toHaveLength(0);
    const b = await join('leave4', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    b.close();
    expect(await a.next(roundEnd)).toMatchObject({ winner: 'p1', reason: 'lastAlive' });
    a.close();
  });
});

describe('RoomDO.startRound(seed) (D8)', () => {
  it('broadcasts roundStart { seed, grid } and the next round is playable', async () => {
    const a = await join('round1x', 'A');
    const b = await join('round1x', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('round1x', () => bombNextToP2);
    await a.next(roundEnd);

    await runInDurableObject(stubFor('round1x'), (r: RoomDO) => r.startRound(4242));
    const start = await a.next(roundStart);
    expect(start.seed).toBe(4242);
    expect(await b.next(roundStart)).toEqual(start);

    // fresh round: everyone alive again, tick restarted, no old bombs / flames
    const fresh = await a.next(
      (m) => m.t === 'snapshot' && m.tick <= 3 && m.players.every((p) => p.alive),
    );
    expect(fresh.t === 'snapshot' && fresh.players).toHaveLength(2);

    // and it can end again
    await editState('round1x', () => ({
      bombs: [{ x: 2, y: 1, ownerId: 'p2', ownerSession: 2, fuse: 1 }],
    }));
    // bomb at (2,1) burns x1..x4: p1 only (p2 stands at 11)
    const first = a.received.find(roundEnd);
    const second = await a.next((m) => roundEnd(m) && m !== first);
    expect(second).toMatchObject({ winner: 'p2', reason: 'lastAlive' });
    a.close();
    b.close();
  });

  it('the grid of the new round is the one generated from the seed, same as for a newcomer', async () => {
    const a = await join('round2x', 'A');
    await a.next((m) => m.t === 'snapshot');
    await runInDurableObject(stubFor('round2x'), (r: RoomDO) => r.startRound(777));
    const start = await a.next(roundStart);
    const late = await join('round2x', 'B');
    const welcome = await late.next((m) => m.t === 'welcome');
    expect(welcome).toMatchObject({ seed: 777, grid: start.grid });
    a.close();
    late.close();
  });

  it('is a no-op in an empty room', async () => {
    const a = await join('round3x', 'A');
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    await runInDurableObject(stubFor('round3x'), async (r: RoomDO) => {
      await r.startRound(1);
      expect(r.isTicking()).toBe(false); // must not arm a loop for nobody
    });
  });

  it('does not leave a tick timer behind when the room empties after a round', async () => {
    const a = await join('round4x', 'A');
    const b = await join('round4x', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('round4x', () => bombNextToP2);
    await a.next(roundEnd);
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(await runInDurableObject(stubFor('round4x'), (r: RoomDO) => r.isTicking())).toBe(false);
  });
});

describe('a bomb outlives its owner (BE-51 / D33)', () => {
  const readState = (room: string) =>
    runInDurableObject(stubFor(room), (r: RoomDO) => (r as unknown as { state?: GameState }).state);

  it('a newcomer in the freed slot gets a new session and the old bomb is not theirs', async () => {
    const a = await join('own1', 'A');
    const b = await join('own1', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    const oldSession = (await readState('own1'))?.players.find((p) => p.id === 'p2')?.session;
    expect(oldSession).toBeDefined();
    await editState('own1', () => ({
      bombs: [{ x: 6, y: 1, ownerId: 'p2', ownerSession: oldSession as number, fuse: 1000 }],
    }));

    b.close();
    await a.next((m) => m.t === 'event' && m.kind === 'playerLeft');
    const c = await join('own1', 'C');
    expect(c.playerId).toBe('p2');
    await c.next((m) => m.t === 'snapshot' && m.players.length === 2);

    const state = await readState('own1');
    const fresh = state?.players.find((p) => p.id === 'p2');
    expect(fresh?.session).not.toBe(oldSession);
    // the leaver's bomb is still on the board, owned by the old join
    expect(state?.bombs).toEqual([
      { x: 6, y: 1, ownerId: 'p2', ownerSession: oldSession, fuse: expect.any(Number) },
    ]);
    a.close();
    c.close();
  });
});
