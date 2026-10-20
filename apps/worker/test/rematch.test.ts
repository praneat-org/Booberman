import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ServerMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/game';
import { REMATCH_WINDOW_MS, type RoomDO } from '../src/room/RoomDO';
import { type Client, connect, isEvent, join, v } from './helpers';

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
type Event<K extends string> = Extract<ServerMessage, { t: 'event'; kind: K }>;
const roundEnd = (m: ServerMessage): m is Event<'roundEnd'> =>
  m.t === 'event' && m.kind === 'roundEnd';
const roundStart = (m: ServerMessage): m is Event<'roundStart'> =>
  m.t === 'event' && m.kind === 'roundStart';
const status = (m: ServerMessage): m is Event<'rematchStatus'> =>
  m.t === 'event' && m.kind === 'rematchStatus';
const kill = (m: ServerMessage): m is Event<'kill'> => m.t === 'event' && m.kind === 'kill';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (c: Client, pred: (m: ServerMessage) => boolean) => c.received.filter(pred).length;
/** Waits for the next status that is not one this client has already seen. */
const nextStatus = async (c: Client, seen: number) => {
  const all = () => c.received.filter(status);
  for (let i = 0; i < 100 && all().length <= seen; i++) await sleep(20);
  return all()[seen];
};

/** Waits for the next roundEnd that is not one this client has already seen. */
const nextEnd = async (c: Client, seen: number) => {
  const all = () => c.received.filter(roundEnd);
  for (let i = 0; i < 150 && all().length <= seen; i++) await sleep(20);
  return all()[seen];
};

const press = (c: Client) => c.send({ v, t: 'rematch' });
const alarmOf = (room: string) =>
  runInDurableObject(stubFor(room), (_r: RoomDO, s) => s.storage.getAlarm());

const editState = (room: string, edit: (s: GameState) => Partial<GameState>) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => {
    const holder = r as unknown as { state?: GameState };
    if (!holder.state) throw new Error('no game state yet');
    holder.state = { ...holder.state, ...edit(holder.state) };
  });

/** Plays a room to its end by running the clock out (a draw by timeout) and waits for everyone to see it. */
async function room(id: string, names: string[]) {
  const clients: (Client & { playerId: string })[] = [];
  for (const n of names) clients.push(await join(id, n));
  const last = clients.at(-1);
  await last?.next((m) => m.t === 'snapshot' && m.players.length === names.length);
  return clients;
}
async function runOut(id: string, clients: Client[]) {
  await editState(id, () => ({ tick: 2999 }));
  await Promise.all(clients.map((c) => c.next(roundEnd)));
}

/** Stops the DO's tick timer by hand and evicts it, like a deploy does (see guards.test.ts). */
async function restart(id: string) {
  const stub = stubFor(id);
  await runInDurableObject(stub, (r: RoomDO) => {
    const h = r as unknown as { loop: ReturnType<typeof setInterval> | null };
    if (h.loop !== null) clearInterval(h.loop);
    h.loop = null;
  });
  await evictDurableObject(stub);
}

describe('kill and roundEnd reach clients from a real room (BE-41)', () => {
  it('a bomb kill: `kill` first, then `roundEnd` with the table, same for both', async () => {
    const [a, b] = await room('kill1', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await editState('kill1', () => ({
      bombs: [{ x: 10, y: 1, ownerId: 'p1', ownerSession: 1, fuse: 1 }], // burns x8..x12: p2 at x11
    }));
    const end = await a.next(roundEnd);
    expect(await b.next(roundEnd)).toEqual(end);
    const k = await a.next(kill);
    expect(k).toEqual({ v, t: 'event', kind: 'kill', killer: 'p1', victim: 'p2', cause: 'bomb' });
    expect(a.received.indexOf(k)).toBeLessThan(a.received.indexOf(end));
    expect(end.stats).toEqual([
      { id: 'p1', kills: 1, deaths: 0, selfKills: 0, curseKills: 0, transfers: 0, trollPoints: 1 },
      { id: 'p2', kills: 0, deaths: 1, selfKills: 0, curseKills: 0, transfers: 0, trollPoints: 0 },
    ]);
    expect(end.titles).toEqual([{ title: 'troll', players: ['p1'], value: 1 }]);
    a.close();
    b.close();
  });
});

describe('rematch (D9)', () => {
  it('a press while the round is still on is ignored', async () => {
    const [a, b] = await room('rematch1', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    press(a);
    await sleep(200);
    expect(count(a, status) + count(b, status)).toBe(0);
    expect(await alarmOf('rematch1')).toBeNull();
    expect(count(a, roundStart)).toBe(0);
    a.close();
    b.close();
  });

  it('everyone presses: the next round starts at once, with a new seed and a clean slate', async () => {
    const [a, b] = await room('rematch2', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch2', [a, b]);
    const before = Date.now();
    press(a);
    const first = await a.next(status);
    expect(first).toMatchObject({ ready: ['p1'] });
    expect(await b.next(status)).toEqual(first);
    // the countdown is 15 s from the first press, and it is the DO alarm that holds it
    expect(first.deadline).toBeGreaterThanOrEqual(before + REMATCH_WINDOW_MS);
    expect(first.deadline).toBeLessThanOrEqual(Date.now() + REMATCH_WINDOW_MS);
    expect(await alarmOf('rematch2')).toBe(first.deadline);
    expect(count(a, roundStart)).toBe(0);

    press(b);
    const startA = await a.next(roundStart);
    expect(await b.next(roundStart)).toEqual(startA);
    expect(await alarmOf('rematch2')).toBeNull(); // nothing left waiting
    const fresh = await a.next(
      (m) => m.t === 'snapshot' && m.tick <= 3 && m.players.every((p) => p.alive),
    );
    expect(fresh.t === 'snapshot' && fresh.players).toHaveLength(2);

    // a stale press from the old end screen does nothing to the new round
    press(a);
    await sleep(150);
    expect(count(a, roundStart)).toBe(1);
    expect(count(a, status)).toBe(1);
    expect(await alarmOf('rematch2')).toBeNull();
    a.close();
    b.close();
  });

  it('the next end screen starts from scratch: nobody is still "ready" from the last one', async () => {
    const [a, b] = await room('rematch13', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch13', [a, b]);
    press(a);
    press(b);
    await a.next(roundStart);
    await a.next((m) => m.t === 'snapshot' && m.tick <= 3);

    await editState('rematch13', () => ({ tick: 2999 }));
    await nextEnd(a, 1);
    press(a);
    const again = await nextStatus(a, 1);
    expect(again).toMatchObject({ ready: ['p1'] }); // B has to press again
    expect(count(a, roundStart)).toBe(1);
    expect(again?.deadline).toBeGreaterThan(Date.now());
    a.close();
    b.close();
  });

  it('one press: nothing happens until the alarm, then the round starts', async () => {
    const [a, b] = await room('rematch3', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch3', [a, b]);
    press(a);
    await a.next(status);
    await sleep(300);
    expect(count(a, roundStart) + count(b, roundStart)).toBe(0);

    expect(await runDurableObjectAlarm(stubFor('rematch3'))).toBe(true); // the 15 s are up
    const start = await a.next(roundStart);
    expect(await b.next(roundStart)).toEqual(start);
    expect(await alarmOf('rematch3')).toBeNull();
    a.close();
    b.close();
  });

  it('the countdown is 15 s after the FIRST press: more presses do not move it', async () => {
    const [a, b, c] = await room('rematch4', ['A', 'B', 'C']);
    if (!a || !b || !c) throw new Error('unreachable');
    await runOut('rematch4', [a, b, c]);
    press(a);
    const first = await a.next(status);
    await sleep(120);
    press(b);
    const second = await nextStatus(a, 1);
    expect(second).toMatchObject({ ready: ['p1', 'p2'], deadline: first.deadline });
    expect(await alarmOf('rematch4')).toBe(first.deadline);
    expect(count(a, roundStart)).toBe(0); // C has not pressed
    for (const x of [a, b, c]) x.close();
  });

  it('pressing twice changes nothing: the others hear nothing, the sender gets the status again', async () => {
    const [a, b] = await room('rematch5', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch5', [a, b]);
    press(a);
    const first = await a.next(status);
    press(a);
    const again = await nextStatus(a, 1);
    expect(again).toEqual(first);
    await sleep(150);
    expect(count(b, status)).toBe(1);
    expect(await alarmOf('rematch5')).toBe(first.deadline);
    a.close();
    b.close();
  });

  it('a press before joining is an error, not a ready flag', async () => {
    const c = await connect('rematch6');
    press(c);
    expect(await c.next((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    c.close();
  });

  it('the only player who pressed leaves: the countdown is cancelled and nothing starts', async () => {
    const [a, b] = await room('rematch7', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch7', [a, b]);
    press(a);
    await b.next(status);
    a.close();
    const cancelled = await nextStatus(b, 1);
    expect(cancelled).toMatchObject({ ready: [], deadline: 0 });
    expect(await alarmOf('rematch7')).toBeNull();
    expect(await runDurableObjectAlarm(stubFor('rematch7'))).toBe(false);
    await sleep(150);
    expect(count(b, roundStart)).toBe(0);

    // B is alone now and everyone in the room is ready the moment B presses
    press(b);
    await b.next(roundStart);
    b.close();
  });

  it('someone who pressed leaves while others are ready: the rest are told, the countdown stays', async () => {
    const [a, b, c] = await room('rematch8', ['A', 'B', 'C']);
    if (!a || !b || !c) throw new Error('unreachable');
    await runOut('rematch8', [a, b, c]);
    press(a);
    const first = await a.next(status);
    press(b);
    await nextStatus(c, 1);
    a.close();
    const after = await nextStatus(c, 2);
    expect(after).toMatchObject({ ready: ['p2'], deadline: first.deadline });
    expect(await alarmOf('rematch8')).toBe(first.deadline);
    b.close();
    c.close();
  });

  it('the last player who had not pressed leaves: everyone left is ready, so it starts', async () => {
    const [a, b, c] = await room('rematch9', ['A', 'B', 'C']);
    if (!a || !b || !c) throw new Error('unreachable');
    await runOut('rematch9', [a, b, c]);
    press(a);
    press(b);
    await nextStatus(a, 1);
    c.close();
    const start = await a.next(roundStart);
    expect(await b.next(roundStart)).toEqual(start);
    expect(await alarmOf('rematch9')).toBeNull();
    a.close();
    b.close();
  });

  it('everyone leaves during the countdown: no alarm, no timer left behind', async () => {
    const [a, b] = await room('rematch10', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch10', [a, b]);
    press(a);
    await b.next(status);
    expect(await alarmOf('rematch10')).not.toBeNull();
    a.close();
    b.close();
    await sleep(250);
    expect(await alarmOf('rematch10')).toBeNull();
    expect(await runInDurableObject(stubFor('rematch10'), (r: RoomDO) => r.isTicking())).toBe(
      false,
    );
    expect(await runDurableObjectAlarm(stubFor('rematch10'))).toBe(false);
  });

  it('the alarm firing in an empty room, or after the round already restarted, does nothing', async () => {
    const [a, b] = await room('rematch11', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch11', [a, b]);
    press(a);
    press(b);
    await a.next(roundStart);
    // a late second delivery of the alarm
    await runInDurableObject(stubFor('rematch11'), (r: RoomDO) => r.alarm());
    await sleep(100);
    expect(count(a, roundStart)).toBe(1);
    a.close();
    b.close();
  });

  it('two triggers at the same moment start ONE round', async () => {
    const [a, b] = await room('rematch12', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('rematch12', [a, b]);
    press(a);
    await a.next(status);
    await runInDurableObject(stubFor('rematch12'), async (r: RoomDO) => {
      // the alarm and a "last player pressed" arriving together
      await Promise.all([
        r.alarm(),
        r.alarm(),
        (r as unknown as { startRematch(): Promise<void> }).startRematch(),
      ]);
    });
    await sleep(150);
    expect(count(a, roundStart)).toBe(1);
    expect(count(b, roundStart)).toBe(1);
    a.close();
    b.close();
  });
});

describe('who is in the room when the round ends or restarts (BE-41, D32, D33)', () => {
  it('a newcomer during the end screen sees the same roundEnd and the countdown, and counts as not ready', async () => {
    const [a, b] = await room('late1', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('late1', [a, b]);
    press(a);
    const first = await a.next(status);

    const c = await join('late1', 'C');
    expect(c.playerId).toBe('p3');
    const replayed = await c.next(roundEnd);
    expect(replayed).toEqual(await a.next(roundEnd));
    expect(await c.next(status)).toEqual(first);

    // B presses: C has not, so the round waits for C or the alarm
    press(b);
    const both = await nextStatus(c, 1);
    expect(both).toMatchObject({ ready: ['p1', 'p2'], deadline: first.deadline });
    expect(count(a, roundStart)).toBe(0);
    press(c);
    await a.next(roundStart);
    await c.next(roundStart);
    for (const x of [a, b, c]) x.close();
  });

  it('a round nobody played against that ran out: a friend joining starts a fresh round for both', async () => {
    const a = await join('late2', 'A');
    await a.next((m) => m.t === 'snapshot');
    await editState('late2', () => ({ tick: 2999 }));
    await a.next(roundEnd); // alone, so a draw by timeout

    const b = await join('late2', 'B');
    const start = await b.next(roundStart);
    expect(await a.next(roundStart)).toEqual(start);
    const fresh = await b.next(
      (m) =>
        m.t === 'snapshot' &&
        m.tick <= 3 &&
        m.players.length === 2 &&
        m.players.every((p) => p.alive),
    );
    expect(fresh.t).toBe('snapshot');
    expect(count(b, roundEnd)).toBe(0); // the newcomer is not shown a frozen end screen
    await sleep(250);
    expect(count(a, roundEnd)).toBe(1); // only the timeout from before
    a.close();
    b.close();
  });

  it('the host dies alone, a friend joins: a new round, not an instant win for the newcomer', async () => {
    const a = await join('late3', 'A');
    await a.next((m) => m.t === 'snapshot');
    await editState('late3', (s) => ({
      players: s.players.map((p) => ({ ...p, alive: false })),
    }));
    await sleep(120);
    expect(count(a, roundEnd)).toBe(0); // alone: no round end from dying

    const b = await join('late3', 'B');
    await b.next(roundStart);
    await b.next((m) => m.t === 'snapshot' && m.tick <= 3 && m.players.every((p) => p.alive));
    await sleep(250);
    expect(count(a, roundEnd) + count(b, roundEnd)).toBe(0);
    a.close();
    b.close();
  });

  it('a contested round in progress is NOT restarted by a late joiner', async () => {
    const a = await join('late4', 'A');
    const b = await join('late4', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    const c = await join('late4', 'C');
    await c.next((m) => m.t === 'snapshot' && m.players.length === 3);
    expect(count(a, roundStart) + count(c, roundStart)).toBe(0);
    for (const x of [a, b, c]) x.close();
  });

  it('stats of someone who left before the end are not in the table (D33)', async () => {
    const [a, b, c] = await room('late5', ['A', 'B', 'C']);
    if (!a || !b || !c) throw new Error('unreachable');
    c.close();
    await a.next(isEvent('playerLeft'));
    await runOut('late5', [a, b]);
    const end = await a.next(roundEnd);
    expect(end.stats.map((r) => r.id).sort()).toEqual(['p1', 'p2']);
    a.close();
    b.close();
  });
});

describe('a restart of the DO in the middle of all this (hibernation, deploy)', () => {
  it('the end screen and the countdown survive: the alarm still starts the round', async () => {
    const [a, b] = await room('wake1', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('wake1', [a, b]);
    press(a);
    const first = await a.next(status);

    await restart('wake1');
    const woke = await runInDurableObject(stubFor('wake1'), (r: RoomDO) => {
      const h = r as unknown as { state?: GameState; rematchDeadline: number };
      return {
        over: h.state?.result !== undefined,
        deadline: h.rematchDeadline,
        ticking: r.isTicking(),
      };
    });
    expect(woke).toEqual({ over: true, deadline: first.deadline, ticking: true });
    expect(count(a, roundStart)).toBe(0); // no new round was forced on the end screen

    // someone arriving now still gets the end screen
    const c = await join('wake1', 'C');
    expect(await c.next(roundEnd)).toMatchObject({ winner: null, reason: 'timeout' });
    expect(await c.next(status)).toMatchObject({ ready: ['p1'], deadline: first.deadline });

    expect(await runDurableObjectAlarm(stubFor('wake1'))).toBe(true);
    await a.next(roundStart);
    await b.next(roundStart);
    for (const x of [a, b, c]) x.close();
  });

  it('mid-round: the rebuilt round is announced with roundStart so clients redraw', async () => {
    const [a, b] = await room('wake2', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    const welcome = await a.next((m) => m.t === 'welcome');
    await restart('wake2');
    await runInDurableObject(stubFor('wake2'), (r: RoomDO) => r.isTicking());
    const start = await a.next(roundStart);
    expect(await b.next(roundStart)).toEqual(start);
    expect(start.seed).toBe(welcome.t === 'welcome' ? welcome.seed : -1); // same stored seed
    const fresh = await a.next((m) => m.t === 'snapshot' && m.tick <= 3);
    expect(fresh.t).toBe('snapshot');
    a.close();
    b.close();
  });

  it('a rematch cut short after the seed was saved but before roundStart goes out is announced on wake-up', async () => {
    const [a, b] = await room('wake3', ['A', 'B']);
    if (!a || !b) throw new Error('unreachable');
    await runOut('wake3', [a, b]);
    press(a);
    await a.next(status);
    // what startRound has written when the DO dies right after its transaction: new seed in,
    // end screen out; the ready flag, the alarm and the old in-memory round are still as they were
    await runInDurableObject(stubFor('wake3'), async (_r: RoomDO, s) => {
      await s.storage.transaction(async (txn) => {
        await txn.put('seed', 31337);
        await txn.delete('roundEnd');
      });
    });
    await restart('wake3');
    await runInDurableObject(stubFor('wake3'), (r: RoomDO) => r.isTicking());
    const start = await a.next(roundStart);
    expect(start.seed).toBe(31337);
    expect(await b.next(roundStart)).toEqual(start);
    expect(await alarmOf('wake3')).toBeNull(); // the leftover countdown is void
    // and nobody is stuck "ready" from before
    press(a);
    await sleep(100);
    expect(count(a, status)).toBe(1); // only the one from before: the press was ignored (round is on)
    a.close();
    b.close();
  });
});
