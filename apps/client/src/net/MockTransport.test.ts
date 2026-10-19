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
  it('emits welcome, playerJoined for the bots, then snapshots; all pass parseServerMessage', () => {
    const t = new MockTransport({ bots: 3 });
    const got = collect(t);
    t.connect();
    for (let i = 0; i < 40; i++) t.step();
    t.disconnect();

    expect(got.welcome).toHaveLength(1);
    expect(got.events).toHaveLength(3);
    expect(got.snaps).toHaveLength(40);
    for (const msg of got.raw) {
      const r = parseServerMessage(JSON.parse(JSON.stringify(msg)));
      expect(r.ok).toBe(true);
    }
    expect(got.snaps[0]?.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('does not announce our own join back to us, like the real server (D17)', () => {
    const t = new MockTransport({ bots: 3 });
    const got = collect(t);
    t.connect();
    t.disconnect();
    expect(got.welcome[0]).toMatchObject({ playerId: 'p1' });
    expect(
      got.events.map((e) => e as { kind?: string; playerId?: string; nickname?: string }),
    ).toEqual([
      { v: PROTOCOL_VERSION, t: 'event', kind: 'playerJoined', playerId: 'p2', nickname: 'bot1' },
      { v: PROTOCOL_VERSION, t: 'event', kind: 'playerJoined', playerId: 'p3', nickname: 'bot2' },
      { v: PROTOCOL_VERSION, t: 'event', kind: 'playerJoined', playerId: 'p4', nickname: 'bot3' },
    ]);
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
    const first = got.snaps[0]?.players ?? [];
    const moved =
      last?.players.filter(
        (p, i) => p.id !== 'p1' && (p.x !== first[i]?.x || p.y !== first[i]?.y),
      ) ?? [];
    expect(moved.length).toBeGreaterThan(0);
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

  describe('session start order (FE-29)', () => {
    /** What `collect` saw, as short labels in arrival order. */
    const labels = (raw: unknown[]) =>
      raw.map((m) => {
        const msg = m as { t: string; kind?: string; playerId?: string; tick?: number };
        if (msg.t === 'welcome') return 'welcome';
        if (msg.t === 'event') return `${msg.kind}:${msg.playerId}`;
        return `${msg.t}:${msg.tick}`;
      });

    it('delivers welcome before every playerJoined and snapshot, with latency 150 / jitter 50', () => {
      // `setTimeout` truncates to whole ms and the clock is whole ms, so two messages scheduled in
      // neighbouring milliseconds can fire in swapped order. A clock that runs ahead of the timers
      // makes that happen every time instead of 4 runs in 30.
      for (let seed = 1; seed <= 30; seed++) {
        vi.useFakeTimers();
        let skew = 0;
        const t = new MockTransport({
          bots: 3,
          seed,
          latencyMs: 150,
          jitterMs: 50,
          clock: () => Date.now() + skew++,
        });
        const got = collect(t);
        t.connect();
        vi.advanceTimersByTime(400); // the first 4 ticks run on the real interval
        t.disconnect();
        vi.useRealTimers();

        const order = labels(got.raw);
        const firstSnapshot = order.findIndex((l) => l.startsWith('snapshot:'));
        expect(firstSnapshot, `seed ${seed}: got snapshots`).toBeGreaterThan(0);
        expect(order[0], `seed ${seed}`).toBe('welcome');
        const joins = order.slice(1, firstSnapshot);
        expect(
          joins.every((l) => l.startsWith('playerJoined:')),
          `seed ${seed}`,
        ).toBe(true);
        expect(joins, `seed ${seed}`).toEqual(
          expect.arrayContaining(['playerJoined:p2', 'playerJoined:p3', 'playerJoined:p4']),
        );
        expect(
          order.slice(firstSnapshot).every((l) => l.startsWith('snapshot:')),
          `seed ${seed}`,
        ).toBe(true);
      }
    });

    it('keeps the order of everything else too: snapshots by tick, events where they were sent', () => {
      vi.useFakeTimers();
      let skew = 0;
      const t = new MockTransport({
        bots: 3,
        seed: 4,
        latencyMs: 150,
        jitterMs: 50,
        clock: () => Date.now() + skew++,
      });
      const got = collect(t);
      t.connect();
      for (let i = 0; i < 60; i++) t.step();
      vi.advanceTimersByTime(1000);
      const ticks = got.snaps.map((s) => s.tick);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
      expect(labels(got.raw)[0]).toBe('welcome');
      t.disconnect();
    });

    it('drops what is still in flight on disconnect and starts the next session with welcome again', () => {
      vi.useFakeTimers();
      const t = new MockTransport({ bots: 1, latencyMs: 100, jitterMs: 40 });
      const got = collect(t);
      t.connect();
      t.disconnect();
      vi.advanceTimersByTime(1000);
      expect(got.raw).toEqual([]);
      t.connect();
      vi.advanceTimersByTime(1000);
      expect(labels(got.raw)[0]).toBe('welcome');
      t.disconnect();
    });

    it('a reconnect on the same instance times welcome from now, not from the dropped session', () => {
      // The due time of the last message of a dropped session used to survive `disconnect()`, so
      // the next welcome waited for the slowest message of the old session (up to `jitterMs` late).
      // Reference = an instance whose `out` line has no history. `ping` draws one jitter value, as
      // does each of the two messages `connect()` queues here (welcome + the one bot's join), so
      // both instances sit at the same point of the jitter stream and the welcome has to land at
      // the same instant. If the draws ever stop lining up this fails too, it cannot pass by luck.
      const opts = { bots: 1, latencyMs: 150, jitterMs: 50, clock: () => Date.now() };
      /** Connects, lets the fake clock run past the largest possible delay, returns when welcome landed. */
      const welcomeLag = (t: MockTransport): number | undefined => {
        const start = Date.now();
        let lag: number | undefined;
        t.onWelcome(() => {
          lag ??= Date.now() - start;
        });
        t.connect();
        vi.advanceTimersByTime(opts.latencyMs + opts.jitterMs + 50);
        t.disconnect();
        return lag;
      };

      for (let seed = 1; seed <= 30; seed++) {
        vi.useFakeTimers();

        const reused = new MockTransport({ ...opts, seed });
        reused.connect(); // session 1: welcome + playerJoined queued ...
        reused.disconnect(); // ... and dropped, at the same instant we reconnect
        const reusedLag = welcomeLag(reused);

        const fresh = new MockTransport({ ...opts, seed });
        fresh.ping(0);
        fresh.ping(0);
        fresh.disconnect(); // drops the two pings; the `out` line was never used
        const freshLag = welcomeLag(fresh);

        vi.useRealTimers();
        expect(freshLag, `seed ${seed}: fresh welcome arrives`).toBeDefined();
        expect(freshLag, `seed ${seed}: within latency + jitter`).toBeGreaterThanOrEqual(150);
        expect(freshLag, `seed ${seed}: within latency + jitter`).toBeLessThanOrEqual(200);
        expect(reusedLag, `seed ${seed}: same instant as a fresh line`).toBe(freshLag);
      }
    });
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

describe('MockTransport bombs (FE-15)', () => {
  function drive(t: MockTransport, ticks: number) {
    const got = collect(t);
    t.connect();
    return {
      got,
      run: () => {
        for (let i = 0; i < ticks; i++) t.step();
      },
    };
  }

  it('our bomb counts down, explodes into flames, breaks a box and kills us if we stay', () => {
    const t = new MockTransport({ bots: 1, seed: 7 });
    const { got } = drive(t, 0);
    t.send({ seq: 1, dir: 'none', bomb: true });
    t.step();
    expect(got.snaps.at(-1)?.bombs).toEqual([{ x: 1, y: 1, fuse: 39 }]);
    for (let i = 0; i < 39; i++) t.step();
    const last = got.snaps.at(-1);
    expect(last?.bombs).toEqual([]);
    expect(last?.flames.length).toBeGreaterThan(0);
    expect(last?.flames).toContainEqual([1, 1]);
    expect(last?.players[0]?.alive).toBe(false);
    expect(got.events.some((e) => (e as { kind?: string }).kind === 'boxDestroyed')).toBe(true);
    t.disconnect();
  });

  it('caps at 2 bombs per player, on different tiles, and never stacks two on one tile', () => {
    const t = new MockTransport({ bots: 0 });
    const { got } = drive(t, 0);
    let seq = 0;
    // free tiles around the spawn corner: (1,1), (2,1), (1,2); everything else is a wall or a box
    const walkTo = (dir: 'left' | 'right' | 'down', tx: number, ty: number) => {
      t.send({ seq: ++seq, dir, bomb: false });
      for (let i = 0; i < 30; i++) {
        t.step();
        const me = got.snaps.at(-1)?.players[0];
        if (me && Math.abs(me.x - tx) < 0.01 && Math.abs(me.y - ty) < 0.01) break;
      }
      t.send({ seq: ++seq, dir: 'none', bomb: false });
      t.step();
    };
    const bombHere = () => {
      t.send({ seq: ++seq, dir: 'none', bomb: true });
      t.step();
    };
    bombHere();
    bombHere(); // same tile again: rejected as stacked
    expect(got.snaps.at(-1)?.bombs).toHaveLength(1);
    walkTo('right', 2, 1);
    bombHere();
    expect(got.snaps.at(-1)?.bombs).toHaveLength(2);
    walkTo('left', 1, 1);
    walkTo('down', 1, 2);
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ x: 1, y: 2 });
    bombHere(); // third distinct tile: only MAX_BOMBS rejects this
    const bombs = got.snaps.at(-1)?.bombs ?? [];
    expect(bombs).toHaveLength(2);
    expect(new Set(bombs.map((b) => `${b.x},${b.y}`)).size).toBe(2);
    t.disconnect();
  });

  it('drops a bomb command sent while dead instead of firing it after respawn', () => {
    const t = new MockTransport({ bots: 0 });
    const { got } = drive(t, 0);
    t.send({ seq: 1, dir: 'none', bomb: true });
    for (let i = 0; i < 41; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]?.alive).toBe(false);
    t.send({ seq: 2, dir: 'none', bomb: true });
    for (let i = 0; i < 70; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]?.alive).toBe(true);
    expect(got.snaps.at(-1)?.bombs).toEqual([]);
    t.disconnect();
  });

  it('drops a bomb command that was sent in an earlier round but arrives after the restart (latency)', () => {
    vi.useFakeTimers();
    // tickMs huge: the interval never fires, we step by hand and only move fake time to flush the latency
    const t = new MockTransport({ bots: 0, latencyMs: 100, tickMs: 1_000_000 });
    const { got } = drive(t, 0);
    const flush = () => vi.advanceTimersByTime(100);
    const me = () => got.snaps.at(-1)?.players[0];
    const roundStarts = () =>
      got.events.filter((e) => (e as { kind?: string }).kind === 'roundStart').length;
    t.send({ seq: 1, dir: 'none', bomb: true });
    flush();
    for (let i = 0; i < 60 && me()?.alive !== false; i++) {
      t.step();
      flush();
    }
    expect(me()?.alive).toBe(false);
    t.send({ seq: 2, dir: 'none', bomb: true }); // sent while dead, still in flight
    for (let i = 0; i < 80 && roundStarts() === 0; i++) t.step(); // no flush: seq 2 stays in flight
    t.step();
    vi.advanceTimersByTime(100); // stale message lands now (snapshots too)
    t.step();
    flush();
    expect(roundStarts()).toBe(1);
    expect(me()?.alive).toBe(true);
    expect(got.snaps.at(-1)?.bombs).toEqual([]);
    t.disconnect();
  });

  it('drops a whole stale-round message (dir and seq too), not only its bomb (latency)', () => {
    vi.useFakeTimers();
    const t = new MockTransport({ bots: 0, latencyMs: 100, tickMs: 1_000_000 });
    const { got } = drive(t, 0);
    const flush = () => vi.advanceTimersByTime(100);
    const me = () => got.snaps.at(-1)?.players[0];
    const roundStarts = () =>
      got.events.filter((e) => (e as { kind?: string }).kind === 'roundStart').length;
    t.send({ seq: 1, dir: 'none', bomb: true });
    flush();
    for (let i = 0; i < 60 && me()?.alive !== false; i++) {
      t.step();
      flush();
    }
    expect(me()?.alive).toBe(false);
    t.send({ seq: 2, dir: 'right', bomb: false }); // sent in the old round, still in flight
    for (let i = 0; i < 80 && roundStarts() === 0; i++) t.step();
    t.step();
    vi.advanceTimersByTime(100); // stale message lands after the restart
    for (let i = 0; i < 8; i++) {
      t.step();
      flush();
    }
    expect(roundStarts()).toBe(1);
    expect(me()).toMatchObject({ alive: true, x: 1, y: 1 }); // heldDir 'right' not applied
    expect(got.snaps.at(-1)?.ackSeq).toBe(1); // seq 2 not acked
    // a message from the new round is still accepted, even with the same seq number
    t.send({ seq: 2, dir: 'right', bomb: false });
    flush();
    t.step();
    flush();
    expect(got.snaps.at(-1)?.ackSeq).toBe(2);
    t.disconnect();
  });

  it('starts a new round with roundStart some ticks after we died', () => {
    const t = new MockTransport({ bots: 1 });
    const { got } = drive(t, 0);
    t.send({ seq: 1, dir: 'none', bomb: true });
    for (let i = 0; i < 40 + 61; i++) t.step();
    const kinds = got.events.map((e) => (e as { kind?: string }).kind);
    expect(kinds).toContain('roundStart');
    expect(got.snaps.at(-1)?.players[0]).toMatchObject({ alive: true, x: 1, y: 1 });
    expect(got.snaps.at(-1)?.bombs).toEqual([]);
    t.disconnect();
  });

  it('everything it emits still passes parseServerMessage', () => {
    const t = new MockTransport({ bots: 3, seed: 3 });
    const { got, run } = drive(t, 400);
    run();
    for (const msg of got.raw) {
      expect(parseServerMessage(JSON.parse(JSON.stringify(msg))).ok).toBe(true);
    }
    t.disconnect();
  });
});
