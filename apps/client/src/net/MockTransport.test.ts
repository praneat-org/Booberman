import { PROTOCOL_VERSION, parseServerMessage } from '@booberman/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockTransport } from './MockTransport';
import type { SnapshotMessage } from './Transport';

function collect(t: MockTransport) {
  const raw: unknown[] = [];
  const snaps: SnapshotMessage[] = [];
  const welcome: unknown[] = [];
  const events: unknown[] = [];
  const pongs: number[] = [];
  t.onWelcome((m) => {
    welcome.push(m);
    raw.push(m);
  });
  t.onSnapshot((m) => {
    snaps.push(m);
    raw.push(m);
  });
  t.onEvent((m) => {
    events.push(m);
    raw.push(m);
  });
  t.onPong((m) => {
    pongs.push(m.ts);
    raw.push(m);
  });
  return { raw, snaps, welcome, events, pongs };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MockTransport', () => {
  it('emits welcome, playerJoined for everyone, then snapshots; all pass parseServerMessage', () => {
    const t = new MockTransport({ bots: 3 });
    const got = collect(t);
    t.connect();
    for (let i = 0; i < 40; i++) t.step();
    t.disconnect();

    expect(got.welcome).toHaveLength(1);
    expect(got.events).toHaveLength(4);
    expect(got.snaps).toHaveLength(40);
    for (const msg of got.raw) {
      const r = parseServerMessage(JSON.parse(JSON.stringify(msg)));
      expect(r.ok).toBe(true);
    }
    expect(got.snaps[0]?.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('clamps bot count to 1..3', () => {
    for (const [asked, players] of [
      [0, 2],
      [9, 4],
    ] as const) {
      const t = new MockTransport({ bots: asked });
      const got = collect(t);
      t.step();
      expect(got.snaps[0]?.players).toHaveLength(players);
    }
  });

  it('emits snapshots at 20 Hz while connected and stops after disconnect', () => {
    vi.useFakeTimers();
    const t = new MockTransport();
    const got = collect(t);
    t.connect();
    vi.advanceTimersByTime(1000);
    expect(got.snaps.length).toBe(20);
    t.disconnect();
    vi.advanceTimersByTime(1000);
    expect(got.snaps.length).toBe(20);
  });

  it('moves our player along the held direction until `none` (D27) and acks the seq', () => {
    const t = new MockTransport({ bots: 1 });
    const got = collect(t);
    t.send({ seq: 1, dir: 'right', bomb: false });
    for (let i = 0; i < 4; i++) t.step();
    const afterOne = got.snaps.at(-1);
    expect(afterOne?.players[0]).toMatchObject({ id: 'p1', x: 2, y: 1 });
    expect(afterOne?.ackSeq).toBe(1);

    // a box at (3,1) stops the held direction
    for (let i = 0; i < 4; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]?.x).toBe(2);

    t.send({ seq: 2, dir: 'down', bomb: false });
    for (let i = 0; i < 4; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ x: 2, y: 1 }); // (2,2) is a wall

    t.send({ seq: 3, dir: 'left', bomb: false });
    for (let i = 0; i < 4; i++) t.step();
    t.send({ seq: 4, dir: 'none', bomb: false });
    for (let i = 0; i < 8; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]?.x).toBe(1);
  });

  it('keeps stepping to the end of the tile after release, and walks between tiles', () => {
    const t = new MockTransport({ bots: 1 });
    const got = collect(t);
    t.send({ seq: 1, dir: 'down', bomb: false });
    t.step();
    t.send({ seq: 2, dir: 'none', bomb: false });
    t.step();
    expect(got.snaps.at(-1)?.players[0]?.y).toBe(1.5);
    for (let i = 0; i < 4; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('does not walk into walls and ignores stale seq', () => {
    const t = new MockTransport({ bots: 1 });
    const got = collect(t);
    t.send({ seq: 5, dir: 'up', bomb: false }); // wall above (1,1)
    for (let i = 0; i < 4; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ x: 1, y: 1 });
    t.send({ seq: 3, dir: 'down', bomb: false }); // older than 5 → dropped
    for (let i = 0; i < 4; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ x: 1, y: 1 });
    expect(got.snaps.at(-1)?.ackSeq).toBe(5);
  });

  it('is reproducible for the same seed', () => {
    const run = (seed: number) => {
      const t = new MockTransport({ seed, bots: 3 });
      const got = collect(t);
      for (let i = 0; i < 200; i++) t.step();
      return got.snaps.at(-1);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('bots actually move', () => {
    const t = new MockTransport({ seed: 3, bots: 3 });
    const got = collect(t);
    for (let i = 0; i < 200; i++) t.step();
    const last = got.snaps.at(-1);
    const moved = last?.players.filter((p) => p.id !== 'p1' && (p.x !== 0 || p.y !== 0)) ?? [];
    expect(moved.length).toBeGreaterThan(0);
    const first = got.snaps[0]?.players ?? [];
    expect(last?.players.some((p, i) => p.x !== first[i]?.x || p.y !== first[i]?.y)).toBe(true);
  });

  it('delays server messages by latency and answers ping with pong after a round trip', () => {
    vi.useFakeTimers();
    const t = new MockTransport({ latencyMs: 100 });
    const got = collect(t);
    t.connect();
    t.ping(123);
    vi.advanceTimersByTime(99);
    expect(got.welcome).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(got.welcome).toHaveLength(1);
    expect(got.pongs).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(got.pongs).toEqual([123]);
    t.disconnect();
  });

  it('keeps message order with jitter', () => {
    vi.useFakeTimers();
    const t = new MockTransport({ latencyMs: 20, jitterMs: 200, seed: 11 });
    const got = collect(t);
    for (let i = 0; i < 30; i++) t.step();
    vi.advanceTimersByTime(1000);
    const ticks = got.snaps.map((s) => s.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(ticks).toHaveLength(30);
    t.disconnect();
  });

  it('unsubscribe stops callbacks', () => {
    const t = new MockTransport();
    const cb = vi.fn();
    const off = t.onSnapshot(cb);
    t.step();
    off();
    t.step();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('welcome carries our id and the v1 protocol version', () => {
    const t = new MockTransport();
    const got = collect(t);
    t.connect();
    t.disconnect();
    expect(got.welcome[0]).toMatchObject({ v: PROTOCOL_VERSION, t: 'welcome', playerId: 'p1' });
  });
});
