import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/game';
import type { RoomDO } from '../src/room/RoomDO';
import { connect, isEvent, join, v } from './helpers';

describe('GET /ws/room/:id', () => {
  it('upgrades to a WebSocket (101)', async () => {
    const c = await connect('room1');
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.close();
  });

  it('without Upgrade header → 426', async () => {
    const res = await exports.default.fetch('http://localhost/ws/room/room1');
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({ error: 'UPGRADE_REQUIRED' });
  });

  it('bad room id → 400', async () => {
    const res = await exports.default.fetch('http://localhost/ws/room/NOT%20OK', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });
});

describe('join / leave', () => {
  it('join → welcome with playerId, seed and a 13×11 grid', async () => {
    const a = await join('joinroom', 'มิ้นท์');
    const welcome = await a.next((m) => m.t === 'welcome');
    expect(welcome).toMatchObject({ v, t: 'welcome', playerId: 'p1' });
    if (welcome.t !== 'welcome') throw new Error('unreachable');
    expect(welcome.grid).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(welcome.grid).toBe(createInitialState(welcome.seed, ['p1']).grid);
    expect(Number.isInteger(welcome.seed)).toBe(true);
    a.close();
  });

  it('2 players in the same room: each gets welcome, the first is told about the second', async () => {
    const a = await join('pair', 'A');
    const b = await join('pair', 'B');
    expect([a.playerId, b.playerId]).toEqual(['p1', 'p2']);

    expect(await a.next(isEvent('playerJoined'))).toEqual({
      v,
      t: 'event',
      kind: 'playerJoined',
      playerId: 'p2',
      nickname: 'B',
    });
    // the newcomer learns who was already there
    expect(await b.next(isEvent('playerJoined'))).toMatchObject({ playerId: 'p1', nickname: 'A' });
    a.close();
    b.close();
  });

  it('closing a socket → the others get playerLeft, and the slot is reused', async () => {
    const a = await join('leave', 'A');
    const b = await join('leave', 'B');
    b.close();
    expect(await a.next(isEvent('playerLeft'))).toEqual({
      v,
      t: 'event',
      kind: 'playerLeft',
      playerId: 'p2',
    });

    const c = await join('leave', 'C');
    expect(c.playerId).toBe('p2');
    a.close();
    c.close();
  });

  it('different rooms do not see each other', async () => {
    const a = await join('roomx', 'A');
    const b = await join('roomy', 'B');
    expect(b.playerId).toBe('p1');
    await new Promise((r) => setTimeout(r, 100));
    expect(a.received.filter(isEvent('playerJoined'))).toEqual([]);
    a.close();
    b.close();
  });
});

describe('one room = one Durable Object', () => {
  it('the same roomId always maps to the same DO, which holds every socket', async () => {
    expect(env.ROOM.idFromName('same').equals(env.ROOM.idFromName('same'))).toBe(true);
    expect(env.ROOM.idFromName('same').equals(env.ROOM.idFromName('other'))).toBe(false);

    const a = await join('same', 'A');
    const b = await join('same', 'B');
    const stub = env.ROOM.get(env.ROOM.idFromName('same'));
    const players = await runInDurableObject(stub, (room: RoomDO) =>
      room.players().map((p) => [p.playerId, p.nickname]),
    );
    expect(players).toEqual([
      ['p1', 'A'],
      ['p2', 'B'],
    ]);
    a.close();
    b.close();
  });
});

describe('ping / pong (D7)', () => {
  it('pong echoes ts, even before join', async () => {
    const c = await connect('pingroom');
    c.send({ v, t: 'ping', ts: 1739000000123 });
    expect(await c.next((m) => m.t === 'pong')).toEqual({ v, t: 'pong', ts: 1739000000123 });
    c.close();
  });
});

describe('before join', () => {
  it('input before join → BAD_MESSAGE, socket stays usable', async () => {
    const c = await connect('early');
    c.send({ v, t: 'input', seq: 1, dir: 'left', bomb: false });
    expect(await c.next((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    c.send({ v, t: 'ping', ts: 1 });
    expect(await c.next((m) => m.t === 'pong')).toMatchObject({ ts: 1 });
    c.close();
  });
});
