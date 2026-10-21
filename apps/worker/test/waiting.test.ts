import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RoomDO } from '../src/room/RoomDO';
import { type Client, isEvent, join, v } from './helpers';

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ready = (c: Client) => c.send({ v, t: 'rematch' });
const started = (c: Client) => c.received.some(isEvent('roundStart'));
const snapshots = (c: Client) => c.received.filter((m) => m.t === 'snapshot').length;

describe('waiting room before the first round (BE-57)', () => {
  it('nothing runs while waiting: no snapshots, inputs dropped, alone + ready does not start', async () => {
    const a = await join('wait1', 'A');
    a.send({ v, t: 'input', seq: 1, dir: 'right', bomb: true });
    ready(a);
    expect(
      await a.next((m) => m.t === 'event' && m.kind === 'rematchStatus' && m.ready.length === 1),
    ).toMatchObject({ ready: ['p1'], deadline: 0 });
    await sleep(300);
    expect(snapshots(a)).toBe(0);
    expect(started(a)).toBe(false);
    expect(await runInDurableObject(stubFor('wait1'), (r: RoomDO) => r.isTicking())).toBe(true);
    a.close();
  });

  it('two players, both ready: the round starts, then play goes on', async () => {
    const a = await join('wait2', 'A');
    const b = await join('wait2', 'B');
    ready(a);
    await b.next((m) => m.t === 'event' && m.kind === 'rematchStatus' && m.ready.length === 1);
    expect(started(a)).toBe(false);
    ready(b);
    await Promise.all([a.next(isEvent('roundStart')), b.next(isEvent('roundStart'))]);
    const snap = await a.next((m) => m.t === 'snapshot' && m.players.length === 2);
    expect(snap.t).toBe('snapshot');
    a.close();
    b.close();
  });

  it('a newcomer gets the ready list and makes the room not ready any more', async () => {
    const a = await join('wait3', 'A');
    const b = await join('wait3', 'B');
    ready(a);
    await b.next((m) => m.t === 'event' && m.kind === 'rematchStatus' && m.ready.length === 1);
    const c = await join('wait3', 'C');
    expect(await c.next(isEvent('rematchStatus'))).toMatchObject({ ready: ['p1'] });
    ready(b);
    await sleep(200);
    expect(started(a)).toBe(false);
    for (const x of [a, b, c]) x.close();
  });

  it('the one who was not ready leaves: everyone left is ready, so it starts', async () => {
    const a = await join('wait4', 'A');
    const b = await join('wait4', 'B');
    const c = await join('wait4', 'C');
    ready(a);
    ready(b);
    await a.next((m) => m.t === 'event' && m.kind === 'rematchStatus' && m.ready.length === 2);
    c.close();
    await a.next(isEvent('roundStart'));
    a.close();
    b.close();
  });

  it('down to one ready player after a leave: still waiting', async () => {
    const a = await join('wait5', 'A');
    const b = await join('wait5', 'B');
    ready(a);
    await a.next(isEvent('rematchStatus'));
    b.close();
    await a.next(isEvent('playerLeft'));
    await sleep(200);
    expect(started(a)).toBe(false);
    a.close();
  });

  it('the waiting room survives an eviction: the woken DO does not start a round on its own', async () => {
    const a = await join('wait6', 'A');
    const b = await join('wait6', 'B');
    const stub = stubFor('wait6');
    await runInDurableObject(stub, (r: RoomDO) => {
      const h = r as unknown as { loop: ReturnType<typeof setInterval> | null };
      if (h.loop !== null) clearInterval(h.loop);
      h.loop = null;
    });
    await evictDurableObject(stub);
    a.send({ v, t: 'ping', ts: 1 });
    await a.next((m) => m.t === 'pong');
    await sleep(200);
    expect(started(a)).toBe(false);
    expect(snapshots(a)).toBe(0);
    ready(a);
    ready(b);
    await a.next(isEvent('roundStart'));
    a.close();
    b.close();
  });

  it('the room empties and fills again: waiting again', async () => {
    const a = await join('wait7', 'A');
    const b = await join('wait7', 'B');
    ready(a);
    ready(b);
    await a.next(isEvent('roundStart'));
    a.close();
    b.close();
    await sleep(150);
    const c = await join('wait7', 'C');
    await sleep(200);
    expect(started(c)).toBe(false);
    expect(snapshots(c)).toBe(0);
    c.close();
  });
});
