import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { attachmentOf, CLOSE_ROOM_FULL, type RoomDO } from '../src/room/RoomDO';
import { type Client, connect, isEvent, join, v } from './helpers';

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
const isError = (code: string) => (m: { t: string; code?: string }) =>
  m.t === 'error' && m.code === code;
const waitClosed = async (c: Client, ms = 2000) => {
  const end = Date.now() + ms;
  while (!c.closed && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return c.closed;
};

describe('room full (AC 4)', () => {
  it('5th player gets ROOM_FULL and the socket is closed; the 4 inside are unaffected', async () => {
    const four = await Promise.all(['A', 'B', 'C', 'D'].map((n) => join('full', n)));
    expect(four.map((c) => c.playerId).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);

    const fifth = await connect('full');
    fifth.send({ v, t: 'join', room: 'full', nickname: 'E' });
    expect(await fifth.next(isError('ROOM_FULL'))).toEqual({ v, t: 'error', code: 'ROOM_FULL' });
    expect((await waitClosed(fifth))?.code).toBe(CLOSE_ROOM_FULL);
    expect(fifth.received.some((m) => m.t === 'welcome')).toBe(false);

    // nobody inside heard about E, and the room still works
    await new Promise((r) => setTimeout(r, 50));
    for (const c of four) {
      expect(
        c.received
          .filter(isEvent('playerJoined'))
          .map((m) => m.t === 'event' && m.kind === 'playerJoined' && m.nickname),
      ).not.toContain('E');
    }
    four[0]?.send({ v, t: 'ping', ts: 5 });
    expect(await four[0]?.next((m) => m.t === 'pong')).toMatchObject({ ts: 5 });
    const players = await runInDurableObject(
      stubFor('full'),
      (room: RoomDO) => room.players().length,
    );
    expect(players).toBe(4);
    for (const c of four) c.close();
  });

  it('a slot freed by leaving can be taken again', async () => {
    const four = await Promise.all(['A', 'B', 'C', 'D'].map((n) => join('refill', n)));
    const leaver = four.find((c) => c.playerId === 'p3');
    leaver?.close();
    await four[0]?.next(isEvent('playerLeft'));
    const e = await join('refill', 'E');
    expect(e.playerId).toBe('p3');
    for (const c of [...four, e]) c.close();
  });
});

describe('bad messages (AC 5)', () => {
  const cases: [string, string | ArrayBuffer | Record<string, unknown>, string][] = [
    ['broken JSON', '{"v":1,"t":"join"', 'BAD_MESSAGE'],
    ['not an object', '[1,2,3]', 'BAD_MESSAGE'],
    ['unknown t', { v, t: 'teleport', x: 3 }, 'BAD_MESSAGE'],
    ['missing field', { v, t: 'input', dir: 'left', bomb: false }, 'BAD_MESSAGE'],
    ['wrong type', { v, t: 'input', seq: 'one', dir: 'left', bomb: false }, 'BAD_MESSAGE'],
    [
      'smuggled position',
      { v, t: 'input', seq: 1, dir: 'left', bomb: false, x: 1, y: 1 },
      'BAD_MESSAGE',
    ],
    ['too long', `{"v":1,"t":"ping","ts":1,"pad":"${'x'.repeat(2000)}"}`, 'BAD_MESSAGE'],
    [
      'binary frame',
      new TextEncoder().encode('{"v":1,"t":"ping","ts":1}').buffer as ArrayBuffer,
      'BAD_MESSAGE',
    ],
    ['old version', { v: 0, t: 'ping', ts: 1 }, 'VERSION_MISMATCH'],
    ['newer version', { v: 2, t: 'ping', ts: 1 }, 'VERSION_MISMATCH'],
    ['no version', { t: 'ping', ts: 1 }, 'VERSION_MISMATCH'],
  ];

  it.each(cases)('%s → %s, socket and room keep working', async (_name, raw, code) => {
    const room = `bad${Math.random().toString(36).slice(2, 8)}`;
    const a = await join(room, 'A');
    const b = await join(room, 'B');
    if (raw instanceof ArrayBuffer) a.ws.send(raw);
    else a.send(typeof raw === 'string' ? raw : raw);
    const err = await a.next((m) => m.t === 'error');
    expect(err).toMatchObject({ v, t: 'error', code });
    if (err.t === 'error') expect(err.message ?? '').not.toMatch(/at \w+ \(|\.ts:\d+/); // no stack

    // same socket still usable, other player still gets events
    a.send({ v, t: 'ping', ts: 7 });
    expect(await a.next((m) => m.t === 'pong')).toMatchObject({ ts: 7 });
    a.close();
    expect(await b.next(isEvent('playerLeft'))).toMatchObject({ playerId: a.playerId });
    b.close();
  });

  it('join for a different room than the URL → BAD_MESSAGE, not joined', async () => {
    const c = await connect('urlroom');
    c.send({ v, t: 'join', room: 'otherroom', nickname: 'X' });
    expect(await c.next((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    const players = await runInDurableObject(
      stubFor('urlroom'),
      (room: RoomDO) => room.players().length,
    );
    expect(players).toBe(0);
    // can still join correctly afterwards
    c.send({ v, t: 'join', room: 'urlroom', nickname: 'X' });
    expect(await c.next((m) => m.t === 'welcome')).toMatchObject({ playerId: 'p1' });
    c.close();
  });

  it('second join on the same socket → BAD_MESSAGE', async () => {
    const a = await join('twice', 'A');
    a.send({ v, t: 'join', room: 'twice', nickname: 'A2' });
    expect(await a.next((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    a.close();
  });
});

describe('webSocketError', () => {
  it('is handled like a close: the others get playerLeft', async () => {
    const a = await join('errroom', 'A');
    const b = await join('errroom', 'B');
    await runInDurableObject(stubFor('errroom'), async (room: RoomDO, state) => {
      const ws = state.getWebSockets().find((s) => {
        const at = attachmentOf(s);
        return at.joined && at.playerId === b.playerId;
      });
      if (!ws) throw new Error('socket not found');
      await room.webSocketError(ws, new Error('boom'));
    });
    expect(await a.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    const players = await runInDurableObject(stubFor('errroom'), (room: RoomDO) =>
      room.players().map((p) => p.playerId),
    );
    expect(players).toEqual(['p1']);
    a.close();
  });
});

describe('hibernation (AC 6)', () => {
  it('after the DO is evicted, players come back from attachments and the room keeps working', async () => {
    const a = await join('sleepy', 'มิ้นท์');
    const b = await join('sleepy', 'บอส');
    const seedBefore = (await a.next((m) => m.t === 'welcome')) as { seed: number };
    const stub = stubFor('sleepy');

    // mark the in-memory instance, then evict it (sockets are hibernated, not closed)
    await runInDurableObject(stub, (room: RoomDO) => {
      (room as unknown as { marker?: string }).marker = 'old instance';
    });
    await evictDurableObject(stub);

    const after = await runInDurableObject(stub, (room: RoomDO) => ({
      fresh: (room as unknown as { marker?: string }).marker === undefined,
      players: room.players().map((p) => [p.playerId, p.nickname]),
    }));
    expect(after.fresh).toBe(true);
    expect(after.players).toEqual([
      ['p1', 'มิ้นท์'],
      ['p2', 'บอส'],
    ]);

    // the woken DO still answers and broadcasts on the old sockets
    a.send({ v, t: 'ping', ts: 99 });
    expect(await a.next((m) => m.t === 'pong' && m.ts === 99)).toBeTruthy();
    const c = await join('sleepy', 'C');
    expect(c.playerId).toBe('p3');
    expect(
      await a.next((m) => m.t === 'event' && m.kind === 'playerJoined' && m.playerId === 'p3'),
    ).toBeTruthy();
    const cWelcome = (await c.next((m) => m.t === 'welcome')) as { seed: number };
    expect(cWelcome.seed).toBe(seedBefore.seed);

    b.close();
    expect(await a.next(isEvent('playerLeft'))).toMatchObject({ playerId: 'p2' });
    a.close();
    c.close();
  });
});
