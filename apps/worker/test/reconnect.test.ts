import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { PlayerId, ServerMessage } from '@booberman/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/game';
import {
  CLOSE_INVALID_TOKEN,
  CLOSE_REPLACED,
  CLOSE_ROOM_FULL,
  REMATCH_WINDOW_MS,
  type RoomDO,
} from '../src/room/RoomDO';
import { RECONNECT_HOLD_MS } from '../src/room/reconnect';
import { begin, type Client, connect, isEvent, join, v } from './helpers';

// BE-44 / CAR-3800 AC 1-4: a dropped player keeps the slot and the state for 15 s, on a token.
// A real drop reaches RoomDO as webSocketClose(1006); the test calls it the same way. Time is the
// DO's `Date.now()`, which `vi.setSystemTime` moves (the DO runs in this isolate), so "16 s later"
// takes no real 16 s.

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;
type Event<K extends string> = Extract<ServerMessage, { t: 'event'; kind: K }>;
const isWelcome = (m: ServerMessage): m is Welcome => m.t === 'welcome';
const isError = (m: ServerMessage) => m.t === 'error';
const roundEnd = (m: ServerMessage): m is Event<'roundEnd'> =>
  m.t === 'event' && m.kind === 'roundEnd';
const roundStart = (m: ServerMessage): m is Event<'roundStart'> =>
  m.t === 'event' && m.kind === 'roundStart';
const events = (c: Client, kind: string) =>
  c.received.filter((m) => m.t === 'event' && m.kind === kind);

/** Joins and returns the client with the `welcome` it got. */
async function enter(room: string, nickname: string) {
  const c = await join(room, nickname);
  const welcome = await c.next(isWelcome);
  return { c, welcome };
}
type Entry = Awaited<ReturnType<typeof enter>>;

/**
 * Joins everybody, then starts the round (BE-57: a new room waits for everyone to be ready), so the
 * game is on when the test begins. Whoever joins later with `enter` is a late joiner.
 */
async function start<N extends string[]>(
  room: string,
  ...names: N
): Promise<{ [K in keyof N]: Entry }> {
  const entries: Entry[] = [];
  for (const n of names) entries.push(await enter(room, n));
  await begin(room, ...entries.map((e) => e.c));
  return entries as { [K in keyof N]: Entry };
}

/** The connection of `playerId` is lost: what Cloudflare tells RoomDO when the network goes (code 1006). */
const drop = (room: string, playerId: PlayerId) =>
  runInDurableObject(stubFor(room), async (r: RoomDO) => {
    const p = r.players().find((x) => x.playerId === playerId);
    if (!p) throw new Error(`${playerId} is not connected`);
    await r.webSocketClose(p.ws, 1006, 'Network connection lost');
  });

/** A new socket asks for its slot back. */
async function comeBack(room: string, token: string, nickname = 'back') {
  const c = await connect(room);
  c.send({ v, t: 'join', room, nickname, token });
  return c;
}

const heldIds = (room: string) =>
  runInDurableObject(stubFor(room), (r: RoomDO) =>
    (r as unknown as { held: { list(): { playerId: string }[] } }).held
      .list()
      .map((s) => s.playerId),
  );
const alarmOf = (room: string) =>
  runInDurableObject(stubFor(room), (_r: RoomDO, s) => s.storage.getAlarm());
const gameOf = (room: string) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => (r as unknown as { state?: GameState }).state);
const editState = (room: string, edit: (s: GameState) => Partial<GameState>) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => {
    const holder = r as unknown as { state?: GameState };
    if (!holder.state) throw new Error('no game state yet');
    holder.state = { ...holder.state, ...edit(holder.state) };
  });
const ticking = (room: string) => runInDurableObject(stubFor(room), (r: RoomDO) => r.isTicking());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('the token in welcome', () => {
  it('every welcome carries a random token, a different one per player', async () => {
    const [a, b] = await start('tok1', 'A', 'B');
    expect(a.welcome.token).toMatch(/^[0-9a-f]{32}$/);
    expect(b.welcome.token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.welcome.token).not.toBe(b.welcome.token);
    a.c.close();
    b.c.close();
  });

  it('the token never reaches another player', async () => {
    const [a, b] = await start('tok2', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    const seenByA = JSON.stringify(a.c.received.filter((m) => m.t !== 'welcome'));
    expect(seenByA).not.toContain(b.welcome.token);
    a.c.close();
    b.c.close();
  });
});

describe('AC: dropped for 5 s, back with the token -> the same slot and state', () => {
  it('same playerId, same character, a new token, and nobody else saw a thing', async () => {
    const [a, b] = await start('back1', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    expect(b.welcome.playerId).toBe('p2');
    const before = (await gameOf('back1'))?.players.find((p) => p.id === 'p2');
    const joinedBefore = events(a.c, 'playerJoined').length; // B's own join, seen once

    await drop('back1', 'p2');
    later(5_000);
    const b2 = await comeBack('back1', b.welcome.token);
    const welcome = await b2.next(isWelcome);

    expect(welcome.playerId).toBe('p2');
    expect(welcome.seed).toBe(b.welcome.seed);
    expect(welcome.token).toMatch(/^[0-9a-f]{32}$/);
    expect(welcome.token).not.toBe(b.welcome.token); // rotated
    // the game state is the one it was, not a respawn: same character, same join id
    const after = (await gameOf('back1'))?.players.find((p) => p.id === 'p2');
    expect(after?.session).toBe(before?.session);
    // the one who came back gets the roster and snapshots again
    expect(await b2.next((m) => m.t === 'event' && m.kind === 'playerJoined')).toMatchObject({
      playerId: 'p1',
      nickname: 'A',
    });
    const snap = await b2.next((m): m is Snapshot => m.t === 'snapshot');
    expect(snap.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    // to A the player never left and never joined again
    expect(events(a.c, 'playerLeft')).toEqual([]);
    expect(events(a.c, 'playerJoined')).toHaveLength(joinedBefore);
    expect(await heldIds('back1')).toEqual([]);
    a.c.close();
    b2.close();
  });

  it('a second drop works with the new token, and the old one is spent', async () => {
    const [a, b] = await start('back2', 'A', 'B');
    await drop('back2', 'p2');
    const b2 = await comeBack('back2', b.welcome.token);
    const second = await b2.next(isWelcome);
    await drop('back2', 'p2');

    const stale = await comeBack('back2', b.welcome.token);
    expect((await stale.next(isError)).t).toBe('error');
    expect(stale.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });

    const b3 = await comeBack('back2', second.token);
    expect((await b3.next(isWelcome)).playerId).toBe('p2');
    for (const c of [a.c, b3]) c.close();
  });

  it('input works after the reconnect even when the client counts from 1 again', async () => {
    const [a, b] = await start('seq1', 'A', 'B');
    b.c.send({ v, t: 'input', seq: 50, dir: 'none', bomb: false });
    await b.c.next((m) => m.t === 'snapshot' && m.ackSeq === 50);
    await drop('seq1', 'p2');
    const b2 = await comeBack('seq1', b.welcome.token);
    await b2.next(isWelcome);
    expect((await gameOf('seq1'))?.players.find((p) => p.id === 'p2')?.heldDir).toBe('none');
    // a new InputSender starts at 1, far below the 50 the server saw before the drop. 'left' is an input
    // with an effect that shows: if the queue dropped it as stale, heldDir would stay 'none'
    b2.send({ v, t: 'input', seq: 1, dir: 'left', bomb: false });
    const heldDir = async () => (await gameOf('seq1'))?.players.find((p) => p.id === 'p2')?.heldDir;
    for (let i = 0; i < 50 && (await heldDir()) !== 'left'; i++) await sleep(20);
    expect(await heldDir()).toBe('left');
    expect(
      await runInDurableObject(stubFor('seq1'), (r: RoomDO) => r.tickStats().inputs),
    ).toMatchObject({ stale: 0 });
    const p2 = (await gameOf('seq1'))?.players.find((p) => p.id === 'p2');
    expect(p2?.ackSeq).toBeGreaterThanOrEqual(50); // ackSeq never goes back (Math.max in simulate)
    a.c.close();
    b2.close();
  });

  it('a client that noticed the drop first takes over from the socket the server still thinks is alive', async () => {
    const [a, b] = await start('back3', 'A', 'B');
    const b2 = await comeBack('back3', b.welcome.token); // B's old socket was never reported closed
    expect((await b2.next(isWelcome)).playerId).toBe('p2');
    await b.c.next(() => b.c.closed !== undefined, 50).catch(() => undefined);
    await sleep(50);
    expect(b.c.closed?.code).toBe(CLOSE_REPLACED);
    expect(events(a.c, 'playerLeft')).toEqual([]);
    expect(await runInDurableObject(stubFor('back3'), (r: RoomDO) => r.players().length)).toBe(2);
    a.c.close();
    b2.close();
  });
});

describe('a takeover is not a drop', () => {
  it('a rematch press survives it: the player is still ready afterwards', async () => {
    const [a, b, c] = await start('take1', 'A', 'B', 'C');
    await editState('take1', () => ({ tick: 2999 }));
    await a.c.next(roundEnd);
    b.c.send({ v, t: 'rematch' });
    await b.c.next((m) => m.t === 'event' && m.kind === 'rematchStatus');

    const b2 = await comeBack('take1', b.welcome.token); // the server never saw B's socket go
    await b2.next(isWelcome);
    expect(
      await runInDurableObject(
        stubFor('take1'),
        (r: RoomDO) => r.players().find((p) => p.playerId === 'p2')?.ready,
      ),
    ).toBe(true);

    // B must not have to press again: A and C pressing is all the round needs
    a.c.send({ v, t: 'rematch' });
    c.c.send({ v, t: 'rematch' });
    await a.c.next(roundStart);
    for (const x of [a.c, b2, c.c]) x.close();
  });
});

describe('AC: while dropped the character stays but takes no input', () => {
  it('it stays in the game, stands still, and the room keeps ticking for it', async () => {
    const [a, b] = await start('away1', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    b.c.send({ v, t: 'input', seq: 3, dir: 'left', bomb: false });
    await b.c.next((m) => m.t === 'snapshot' && m.ackSeq === 3);

    await drop('away1', 'p2');
    // an input from the dead socket would be a stale connection talking: nothing reads it any more
    b.c.send({ v, t: 'input', seq: 4, dir: 'down', bomb: true });
    await sleep(200);

    const state = await gameOf('away1');
    const p2 = state?.players.find((p) => p.id === 'p2');
    expect(p2).toBeDefined();
    expect(p2?.alive).toBe(true);
    expect(p2?.heldDir).toBe('none'); // not walking on in the direction it last had
    expect(state?.bombs).toEqual([]); // the bomb of the dead socket was not placed
    // A still gets snapshots that include p2, and no playerLeft
    const snap = a.c.received.filter((m): m is Snapshot => m.t === 'snapshot').at(-1);
    expect(snap?.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(events(a.c, 'playerLeft')).toEqual([]);
    a.c.close();
  });

  it('when everybody has dropped the room keeps its state and its loop for the 15 s', async () => {
    const [a] = await start('away2', 'A');
    await a.c.next((m) => m.t === 'snapshot');
    await drop('away2', 'p1');
    expect(await ticking('away2')).toBe(true);
    expect(await heldIds('away2')).toEqual(['p1']);
    expect((await gameOf('away2'))?.players.map((p) => p.id)).toEqual(['p1']);
    later(5_000);
    const a2 = await comeBack('away2', a.welcome.token);
    expect((await a2.next(isWelcome)).playerId).toBe('p1');
    expect((await a2.next((m) => m.t === 'snapshot')).t).toBe('snapshot');
    a2.close();
  });

  it('the slot is taken: a newcomer gets the next one, and a full room says ROOM_FULL', async () => {
    const [a, b, c, d] = await start('full1', 'A', 'B', 'C', 'D');
    await drop('full1', 'p4');
    const e = await connect('full1');
    e.send({ v, t: 'join', room: 'full1', nickname: 'E' });
    await e.next(isError);
    expect(e.received.find(isError)).toMatchObject({ code: 'ROOM_FULL' });
    await sleep(50);
    expect(e.closed?.code).toBe(CLOSE_ROOM_FULL);
    for (const x of [a, b, c, d]) x.c.close();
  });

  it('a dropped player does not give their id to a newcomer while 3 are connected', async () => {
    const [a, b] = await start('slot1', 'A', 'B');
    await drop('slot1', 'p1');
    const c = await enter('slot1', 'C');
    expect(c.welcome.playerId).toBe('p3'); // p1 is held, p2 is B
    // the newcomer is told about the dropped one too: they are still in the room
    expect(
      (await c.c.next(isEvent('playerJoined'))).t === 'event' && c.c.received.some(isPlayer('p1')),
    ).toBe(true);
    for (const x of [a, b, c]) x.c.close();
  });
});

const isPlayer = (id: string) => (m: ServerMessage) =>
  m.t === 'event' && m.kind === 'playerJoined' && m.playerId === id;

describe('AC: past 15 s the player has left; a wrong token is refused', () => {
  it('dropped for 16 s: the slot is gone, the others are told, and the token is dead', async () => {
    const [a, b] = await start('late1', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await drop('late1', 'p2');
    expect(await alarmOf('late1')).not.toBeNull(); // the hold is on the alarm, not in memory

    later(RECONNECT_HOLD_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor('late1'))).toBe(true);
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    expect((await gameOf('late1'))?.players.map((p) => p.id)).toEqual(['p1']);
    expect(await heldIds('late1')).toEqual([]);

    const b2 = await comeBack('late1', b.welcome.token);
    await b2.next(isError);
    expect(b2.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
    await sleep(50);
    expect(b2.closed?.code).toBe(CLOSE_INVALID_TOKEN);
    expect(b2.received.some(isWelcome)).toBe(false);
    // and the slot is free for a normal join again
    expect((await enter('late1', 'C')).welcome.playerId).toBe('p2');
    a.c.close();
  });

  it('a token is not honoured past 15 s even if the alarm is late', async () => {
    const [a, b] = await start('late2', 'A', 'B');
    await drop('late2', 'p2');
    later(RECONNECT_HOLD_MS + 1_000); // the alarm has not run
    const b2 = await comeBack('late2', b.welcome.token);
    await b2.next(isError);
    expect(b2.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    a.c.close();
  });

  it('one millisecond before the deadline the slot is still there', async () => {
    const [a, b] = await start('edge1', 'A', 'B');
    await drop('edge1', 'p2');
    later(RECONNECT_HOLD_MS - 1);
    const ok = await comeBack('edge1', b.welcome.token);
    expect((await ok.next(isWelcome)).playerId).toBe('p2');
    for (const c of [a.c, ok]) c.close();
  });

  it('exactly at the deadline the slot is gone', async () => {
    const [a, b] = await start('edge2', 'A', 'B');
    await drop('edge2', 'p2');
    later(RECONNECT_HOLD_MS); // the clock is frozen, so this is expiresAt to the millisecond
    const late = await comeBack('edge2', b.welcome.token);
    await late.next(isError);
    expect(late.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
    expect(late.received.some(isWelcome)).toBe(false);
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    a.c.close();
  });

  it('a wrong token is refused with INVALID_TOKEN and the held slot is untouched', async () => {
    const [a, b] = await start('wrong1', 'A', 'B');
    await drop('wrong1', 'p2');
    for (const token of ['nope', '0'.repeat(32), a.welcome.token.slice(0, 31)]) {
      const bad = await comeBack('wrong1', token);
      await bad.next(isError);
      expect(bad.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
      expect(bad.received.some(isWelcome)).toBe(false);
    }
    expect(await heldIds('wrong1')).toEqual(['p2']);
    const good = await comeBack('wrong1', b.welcome.token);
    expect((await good.next(isWelcome)).playerId).toBe('p2');
    for (const c of [a.c, good]) c.close();
  });

  it('a token for another room is nothing', async () => {
    const a = await enter('roomx1', 'A');
    const other = await enter('roomy1', 'B');
    const c = await comeBack('roomx1', other.welcome.token);
    await c.next(isError);
    expect(c.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
    a.c.close();
    other.c.close();
  });

  it('leaving on purpose (close 1000) gives the slot up at once: no hold, the token is dead', async () => {
    const [a, b] = await start('bye1', 'A', 'B');
    b.c.close();
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    expect(await heldIds('bye1')).toEqual([]);
    const b2 = await comeBack('bye1', b.welcome.token);
    await b2.next(isError);
    expect(b2.received.find(isError)).toMatchObject({ code: 'INVALID_TOKEN' });
    a.c.close();
  });

  it('the last player gone for good: the loop stops and no alarm is left', async () => {
    const [a] = await start('empty1', 'A');
    await a.c.next((m) => m.t === 'snapshot');
    await drop('empty1', 'p1');
    later(RECONNECT_HOLD_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor('empty1'))).toBe(true);
    expect(await ticking('empty1')).toBe(false);
    expect(await alarmOf('empty1')).toBeNull();
    expect(await heldIds('empty1')).toEqual([]);
  });
});

describe('the one DO alarm serves the hold and the rematch countdown', () => {
  it('a hold that runs out does not start the rematch early; the countdown still does at its time', async () => {
    // C stays connected and never presses: the countdown has to run
    const [a, b, c] = await start('share1', 'A', 'B', 'C');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 3);
    await editState('share1', () => ({ tick: 2999 }));
    await a.c.next(roundEnd);

    await drop('share1', 'p2'); // hold ends at t0 + 15 s
    later(5_000);
    a.c.send({ v, t: 'rematch' }); // countdown ends at t0 + 20 s
    const status = await a.c.next((m) => m.t === 'event' && m.kind === 'rematchStatus');
    expect(status).toMatchObject({ deadline: Date.now() + REMATCH_WINDOW_MS });
    // the alarm is set for the earlier of the two: the end of the hold
    expect(await alarmOf('share1')).toBe(Date.now() - 5_000 + RECONNECT_HOLD_MS);

    later(10_000); // t0 + 15 s: the hold is up, the countdown is not
    expect(await runDurableObjectAlarm(stubFor('share1'))).toBe(true);
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    expect(a.c.received.filter(roundStart)).toHaveLength(0);
    // the alarm is now the countdown's
    expect(await alarmOf('share1')).toBe(
      status.t === 'event' && 'deadline' in status ? status.deadline : -1,
    );

    later(5_000); // t0 + 20 s
    expect(await runDurableObjectAlarm(stubFor('share1'))).toBe(true);
    await a.c.next(roundStart);
    a.c.close();
    b.c.close();
    c.c.close();
  });

  it('an alarm delivered twice never starts a rematch nobody asked for (at-least-once delivery)', async () => {
    const [a, b] = await start('share4', 'A', 'B');
    await editState('share4', () => ({ tick: 2999 }));
    await a.c.next(roundEnd); // the end screen is up and nobody has pressed: no countdown
    await drop('share4', 'p2');
    later(RECONNECT_HOLD_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor('share4'))).toBe(true); // the hold runs out
    expect(await a.c.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    // the runtime may deliver the same alarm again: the second one finds nothing to expire
    await runInDurableObject(stubFor('share4'), (r: RoomDO) => r.alarm());
    await sleep(100);
    expect(a.c.received.filter(roundStart)).toHaveLength(0);
    a.c.close();
    b.c.close();
  });

  it('an alarm that comes before the countdown is over does not start the rematch', async () => {
    const [a, b, c] = await start('share5', 'A', 'B', 'C');
    await editState('share5', () => ({ tick: 2999 }));
    await a.c.next(roundEnd);
    a.c.send({ v, t: 'rematch' }); // B and C have not pressed: a 15 s countdown starts
    await a.c.next((m) => m.t === 'event' && m.kind === 'rematchStatus');
    await runInDurableObject(stubFor('share5'), (r: RoomDO) => r.alarm()); // too early
    await sleep(100);
    expect(a.c.received.filter(roundStart)).toHaveLength(0);
    later(REMATCH_WINDOW_MS);
    await runInDurableObject(stubFor('share5'), (r: RoomDO) => r.alarm());
    await a.c.next(roundStart);
    for (const x of [a, b, c]) x.c.close();
  });

  it('every connected player ready starts the rematch without waiting for a dropped one', async () => {
    const [a, b] = await start('share3', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('share3', () => ({ tick: 2999 }));
    await a.c.next(roundEnd);
    await drop('share3', 'p2');
    a.c.send({ v, t: 'rematch' });
    await a.c.next(roundStart);
    // the new round still has the dropped player's character, and they can come back into it
    expect((await gameOf('share3'))?.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    const b2 = await comeBack('share3', b.welcome.token);
    expect((await b2.next(isWelcome)).playerId).toBe('p2');
    a.c.close();
    b2.close();
  });

  it('the rematch countdown survives on its own: stored, not read back from the alarm', async () => {
    const [a, b] = await start('share2', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await editState('share2', () => ({ tick: 2999 }));
    await a.c.next(roundEnd);
    a.c.send({ v, t: 'rematch' });
    const status = await a.c.next((m) => m.t === 'event' && m.kind === 'rematchStatus');
    const stored = await runInDurableObject(stubFor('share2'), (_r: RoomDO, s) =>
      s.storage.get<number>('rematchDeadline'),
    );
    expect(stored).toBe(status.t === 'event' && 'deadline' in status ? status.deadline : -1);
    a.c.close();
    b.c.close();
  });
});

describe('a dropped player survives a restart of the DO', () => {
  it('the hold is in storage: after an eviction the token still works inside the 15 s', async () => {
    const [a, b] = await start('wake1', 'A', 'B');
    await a.c.next((m) => m.t === 'snapshot' && m.players.length === 2);
    await drop('wake1', 'p2');
    // stop the tick timer by hand and evict, like a deploy (see guards.test.ts)
    await runInDurableObject(stubFor('wake1'), (r: RoomDO) => {
      const h = r as unknown as { loop: ReturnType<typeof setInterval> | null };
      if (h.loop !== null) clearInterval(h.loop);
      h.loop = null;
    });
    const { evictDurableObject } = await import('cloudflare:test');
    await evictDurableObject(stubFor('wake1'));
    expect(await heldIds('wake1')).toEqual(['p2']); // read back from storage by the new instance
    expect(await alarmOf('wake1')).not.toBeNull();
    later(5_000);
    const b2 = await comeBack('wake1', b.welcome.token);
    expect((await b2.next(isWelcome)).playerId).toBe('p2');
    a.c.close();
    b2.close();
  });

  it('a room whose only player is dropped is rebuilt from storage and still expires', async () => {
    const [a] = await start('wake2', 'A');
    await a.c.next((m) => m.t === 'snapshot');
    await drop('wake2', 'p1');
    await runInDurableObject(stubFor('wake2'), (r: RoomDO) => {
      const h = r as unknown as { loop: ReturnType<typeof setInterval> | null };
      if (h.loop !== null) clearInterval(h.loop);
      h.loop = null;
    });
    const { evictDurableObject } = await import('cloudflare:test');
    await evictDurableObject(stubFor('wake2'));
    expect(await ticking('wake2')).toBe(true); // the new instance rebuilt the room for the held player
    later(RECONNECT_HOLD_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor('wake2'))).toBe(true);
    expect(await ticking('wake2')).toBe(false);
    expect(await heldIds('wake2')).toEqual([]);
  });
});
