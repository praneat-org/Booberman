import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ServerMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { InputQueue } from '../src/room/inputQueue';
import type { RoomDO } from '../src/room/RoomDO';
import { TickStats } from '../src/room/tickStats';
import { type Client, connect, join, v } from './helpers';

const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;
const snapshots = (c: Client) => c.received.filter((m): m is Snapshot => m.t === 'snapshot');
const roomState = (room: string) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => ({ ticking: r.isTicking(), ...r.tickStats() }));
const input = (c: Client, seq: number, dir = 'right', bomb = false) =>
  c.send({ v, t: 'input', seq, dir, bomb });

describe('leave clears the slot in the game state', () => {
  it('a leaver is removed from the state at once, so a rejoin into the slot starts fresh', async () => {
    const a = await join('leave1', 'A');
    const b = await join('leave1', 'B');
    input(b, 7, 'down');
    await b.next((m) => m.t === 'snapshot' && m.ackSeq === 7);
    // freeze the loop so no tick can resync the players between the leave and the check
    await runInDurableObject(stubFor('leave1'), (room: RoomDO) => {
      const r = room as unknown as { loop: ReturnType<typeof setInterval> | null };
      if (r.loop !== null) clearInterval(r.loop);
      r.loop = null;
    });
    b.close();
    await sleep(100);
    const ids = await runInDurableObject(stubFor('leave1'), (room: RoomDO) =>
      (room as unknown as { state?: { players: { id: string }[] } }).state?.players.map(
        (p) => p.id,
      ),
    );
    expect(ids).toEqual(['p1']);
    a.close();
  });
});

describe('tick loop 20Hz (AC 1, 2)', () => {
  it('one player gets about 20 snapshots in one second, then nothing once the room is empty', async () => {
    const a = await join('tick1', 'A');
    expect((await roomState('tick1')).ticking).toBe(true);
    const start = snapshots(a).length;
    await sleep(1000);
    const got = snapshots(a).length - start;
    expect(got).toBeGreaterThanOrEqual(15);
    expect(got).toBeLessThanOrEqual(25);
    // tick numbers have no gaps
    const ticks = snapshots(a).map((s) => s.tick);
    expect(ticks).toEqual(ticks.map((_, i) => (ticks[0] ?? 0) + i));

    a.close();
    await sleep(100);
    expect((await roomState('tick1')).ticking).toBe(false);
    await sleep(300);
    // stopLoop reset the stats; a loop still running would have counted ticks again
    expect((await roomState('tick1')).ticks).toBe(0);
  });

  it('keeps ticking while someone is left and stops with the last one', async () => {
    const a = await join('tick2', 'A');
    const b = await join('tick2', 'B');
    a.close();
    await sleep(150);
    expect((await roomState('tick2')).ticking).toBe(true);
    const before = snapshots(b).length;
    await sleep(300);
    expect(snapshots(b).length).toBeGreaterThan(before);
    expect(
      snapshots(b)
        .at(-1)
        ?.players.map((p) => p.id),
    ).toEqual(['p2']);
    b.close();
    await sleep(100);
    expect((await roomState('tick2')).ticking).toBe(false);
  });

  it('a socket that errors out also stops the loop', async () => {
    const a = await join('tick3', 'A');
    await runInDurableObject(stubFor('tick3'), async (r: RoomDO) => {
      for (const p of r.players()) await r.webSocketError(p.ws);
    });
    expect((await roomState('tick3')).ticking).toBe(false);
    a.close();
  });

  it('a room restarts cleanly after it emptied', async () => {
    const a = await join('tick4', 'A');
    a.close();
    await sleep(100);
    const b = await join('tick4', 'B');
    const first = await b.next((m) => m.t === 'snapshot');
    expect(first.t === 'snapshot' && first.tick).toBe(1);
    b.close();
  });

  it('late joiner appears in the next snapshots at its spawn point', async () => {
    const a = await join('tick5', 'A');
    const b = await join('tick5', 'B');
    await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
    const last = snapshots(a).at(-1);
    expect(last?.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(last?.players.find((p) => p.id === 'p2')).toMatchObject({ x: 11, y: 1 });
    a.close();
    b.close();
  });
});

describe('input queue (AC 5)', () => {
  it('applies input on the tick and acks per player', async () => {
    const a = await join('inp1', 'A');
    const b = await join('inp1', 'B');
    input(a, 1, 'down');
    input(a, 2, 'down');
    await b.next((m) => m.t === 'snapshot');
    await a.next((m) => m.t === 'snapshot' && m.ackSeq === 2);
    const mine = snapshots(a)
      .at(-1)
      ?.players.find((p) => p.id === 'p1');
    expect(mine?.y).toBeGreaterThan(1);
    // b sent nothing: its ack stays 0 and it did not move
    const bLast = snapshots(b).at(-1);
    expect(bLast?.ackSeq).toBe(0);
    expect(bLast?.players.find((p) => p.id === 'p2')).toMatchObject({ x: 11, y: 1 });
    a.close();
    b.close();
  });

  it('drops duplicate and old seq', async () => {
    const a = await join('inp2', 'A');
    input(a, 5, 'right');
    await a.next((m) => m.t === 'snapshot' && m.ackSeq === 5);
    // D27: the server keeps the held direction, so release (`none`) and wait until the step
    // that input started has settled; only a stale input could move x1 after that
    input(a, 6, 'none');
    await a.next((m) => m.t === 'snapshot' && m.ackSeq === 6);
    await sleep(400);
    const x1 = snapshots(a).at(-1)?.players[0]?.x ?? 0;
    input(a, 5, 'right'); // duplicate
    input(a, 3, 'right'); // older
    await sleep(300);
    for (const s of snapshots(a).slice(-3)) expect(s.ackSeq).toBe(6);
    expect(snapshots(a).at(-1)?.players[0]?.x).toBe(x1);
    expect((await roomState('inp2')).inputs).toMatchObject({ accepted: 2, stale: 2 });
    a.close();
  });

  it('keeps walking the held direction with no further input, stops on none (D27)', async () => {
    const a = await join('inp6', 'A');
    await a.next((m) => m.t === 'snapshot'); // the first tick creates the game state
    // open floor so the walk is not tied to the random board
    await runInDurableObject(stubFor('inp6'), (room: RoomDO) => {
      const r = room as unknown as { state?: { grid: string } };
      if (!r.state) throw new Error('no state');
      let grid = '';
      for (let y = 0; y < 11; y++)
        for (let x = 0; x < 13; x++) grid += x === 0 || y === 0 || x === 12 || y === 10 ? '#' : '.';
      r.state.grid = grid;
    });
    input(a, 1, 'right'); // sent once
    const far = await a.next((m) => m.t === 'snapshot' && (m.players[0]?.x ?? 0) >= 4);
    expect(far.t === 'snapshot' && far.ackSeq).toBe(1);
    input(a, 2, 'none');
    await a.next((m) => m.t === 'snapshot' && m.ackSeq === 2);
    await sleep(400);
    const stopped = snapshots(a).at(-1)?.players[0]?.x ?? 0;
    expect(Number.isInteger(stopped)).toBe(true);
    await sleep(300);
    expect(snapshots(a).at(-1)?.players[0]?.x).toBe(stopped);
    a.close();
  });

  it('drops inputs beyond 30 per second from one player', async () => {
    const a = await join('inp3', 'A');
    for (let seq = 0; seq < 50; seq++) input(a, seq, 'none');
    await sleep(300);
    const { inputs } = await roomState('inp3');
    expect(inputs.accepted + inputs.rateLimited).toBe(50);
    // all 50 arrive well inside one second: exactly 30 get in, 20 are dropped
    expect(inputs).toMatchObject({ accepted: 30, rateLimited: 20 });
    // the game never saw seq 30..49
    expect(snapshots(a).at(-1)?.ackSeq).toBe(29);
    a.close();
  });

  it('one spammer does not eat another player’s budget', async () => {
    const a = await join('inp4', 'A');
    const b = await join('inp4', 'B');
    for (let seq = 0; seq < 100; seq++) input(a, seq, 'none');
    input(b, 0, 'left');
    await b.next((m) => m.t === 'snapshot' && m.players.some((p) => p.id === 'p2' && p.x < 11));
    a.close();
    b.close();
  });

  it('input before join is rejected, not queued', async () => {
    const c = await connect('inp5');
    input(c, 1);
    expect(await c.next((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    c.close();
  });
});

describe('InputQueue (unit)', () => {
  it('merges inputs between two ticks: newest direction, any bomb, newest seq', () => {
    const q = new InputQueue();
    q.offer('p1', { dir: 'up', bomb: true, seq: 1 }, 0);
    q.offer('p1', { dir: 'left', bomb: false, seq: 2 }, 1);
    expect(q.drain().get('p1')).toEqual({ dir: 'left', bomb: true, seq: 2 });
    expect(q.drain().size).toBe(0);
    // seq memory outlives the drain
    expect(q.offer('p1', { dir: 'up', bomb: false, seq: 2 }, 2)).toBe('stale');
    q.remove('p1');
    expect(q.offer('p1', { dir: 'up', bomb: false, seq: 0 }, 3)).toBe('accepted');
  });

  it('sliding window: 30 inputs in any 1000 ms, then room again as old ones age out', () => {
    const q = new InputQueue();
    const offer = (seq: number, at: number) => q.offer('p1', { dir: 'none', bomb: false, seq }, at);
    const first = Array.from({ length: 31 }, (_, i) => offer(i, i)); // 31 inputs within 31 ms
    expect(first.filter((r) => r === 'accepted')).toHaveLength(30);
    expect(first[30]).toBe('rate-limited');
    expect(offer(31, 999)).toBe('rate-limited'); // input 0 (t=0) is still inside the window
    expect(offer(32, 1000)).toBe('accepted'); // t=0 aged out
    expect(offer(33, 1000)).toBe('rate-limited'); // t=1..29 + the one above = 30 again
    expect(offer(34, 1001)).toBe('accepted'); // t=1 aged out
    // another player has its own window
    expect(q.offer('p2', { dir: 'none', bomb: false, seq: 0 }, 1001)).toBe('accepted');
  });
});

describe('tick stats (AC 6)', () => {
  it('computes percentiles over a rolling window', () => {
    const s = new TickStats();
    for (let i = 1; i <= 100; i++) s.record(i);
    expect(s.summary()).toMatchObject({ ticks: 100, p50: 50, p99: 99, max: 100 });
    for (let i = 0; i < 200; i++) s.record(1); // old samples roll out
    expect(s.summary()).toMatchObject({ ticks: 300, window: 200, p99: 1 });
  });

  it('a 4-player room records ticks', async () => {
    const four = await Promise.all(['A', 'B', 'C', 'D'].map((n) => join('stat1', n)));
    await sleep(500);
    const st = await roomState('stat1');
    expect(st.ticks).toBeGreaterThan(5);
    expect(st.p99).toBeGreaterThanOrEqual(0);
    for (const x of four) x.close();
  });
});
