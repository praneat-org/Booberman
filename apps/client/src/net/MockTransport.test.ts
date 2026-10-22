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
    const t = new MockTransport({ bots: 0, autoRematch: true });
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
    const t = new MockTransport({ bots: 0, latencyMs: 100, tickMs: 1_000_000, autoRematch: true });
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
    // the bot may legitimately have placed its own bomb in the new round: only ours (at the spawn) must be missing
    expect(got.snaps.at(-1)?.bombs.filter((b) => b.x === 1 && b.y === 1)).toEqual([]);
    t.disconnect();
  });

  it('drops a whole stale-round message (dir and seq too), not only its bomb (latency)', () => {
    vi.useFakeTimers();
    const t = new MockTransport({ bots: 0, latencyMs: 100, tickMs: 1_000_000, autoRematch: true });
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

  it('autoRematch: starts a new round with roundStart some ticks after we died', () => {
    const t = new MockTransport({ bots: 1, autoRematch: true });
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

describe('MockTransport round end and item pickup (FE-18)', () => {
  type Msg = { t: string; kind?: string; [k: string]: unknown };
  type RoundStats = {
    id: string;
    kills: number;
    deaths: number;
    selfKills: number;
    curseKills: number;
    transfers: number;
    trollPoints: number;
  };
  type RoundEnd = Msg & { kind: 'roundEnd'; stats: RoundStats[] };
  const kindOf = (m: unknown) => (m as Msg).kind;

  /** We bomb our own spawn and stand still: we die at tick 40 and the only bot is left. */
  function suicide(seed = 7, autoRematch = false) {
    const t = new MockTransport({ bots: 1, seed, autoRematch });
    const got = collect(t);
    t.connect();
    t.send({ seq: 1, dir: 'none', bomb: true });
    return { t, got };
  }

  it('sends roundEnd once, before the snapshot in which the round ended, with the survivor as winner', () => {
    const { t, got } = suicide();
    for (let i = 0; i < 45; i++) t.step();
    const ends = got.raw.filter((m) => kindOf(m) === 'roundEnd');
    expect(ends).toHaveLength(1);
    const end = ends[0] as { winner: string | null; reason: string };
    const endIndex = got.raw.indexOf(ends[0]);
    const after = got.raw
      .slice(endIndex)
      .find((m) => (m as Msg).t === 'snapshot') as SnapshotMessage;
    const alive = after.players.filter((p) => p.alive).map((p) => p.id);
    expect(alive.length).toBeLessThanOrEqual(1);
    expect(end.winner).toBe(alive[0] ?? null);
    expect(end.reason).toBe(alive.length === 1 ? 'lastAlive' : 'allDead');
    // the snapshot before it still had two players alive
    const before = got.raw.slice(0, endIndex).filter((m) => (m as Msg).t === 'snapshot');
    expect((before.at(-1) as SnapshotMessage).players.filter((p) => p.alive)).toHaveLength(2);
    t.disconnect();
  });

  it('tracks bomb kills and resets round stats when a new round starts', () => {
    const t = new MockTransport({ bots: 1, seed: 7, autoRematch: true });
    const got = collect(t);
    t.connect();
    const players = (
      t as unknown as {
        players: { id: string; x: number; y: number; bot?: () => number }[];
      }
    ).players;
    const bot = players[1];
    if (!bot) throw new Error('expected one bot');
    Object.assign(bot, { x: 2, y: 1, bot: undefined });

    t.send({ seq: 1, dir: 'none', bomb: true });
    for (let i = 0; i < 40; i++) t.step();
    const roundEnds = () => got.raw.filter((m) => kindOf(m) === 'roundEnd') as RoundEnd[];
    expect(roundEnds()).toHaveLength(1);
    expect(roundEnds()[0]?.stats).toEqual([
      {
        id: 'p1',
        kills: 1,
        deaths: 1,
        selfKills: 1,
        curseKills: 0,
        transfers: 0,
        trollPoints: 1,
      },
      {
        id: 'p2',
        kills: 0,
        deaths: 1,
        selfKills: 0,
        curseKills: 0,
        transfers: 0,
        trollPoints: 0,
      },
    ]);

    for (let i = 0; i < 60; i++) t.step();
    t.send({ seq: 2, dir: 'none', bomb: true });
    for (let i = 0; i < 40; i++) t.step();
    expect(roundEnds()).toHaveLength(2);
    expect(roundEnds()[1]?.stats).toEqual([
      {
        id: 'p2',
        kills: 0,
        deaths: 0,
        selfKills: 0,
        curseKills: 0,
        transfers: 0,
        trollPoints: 0,
      },
      {
        id: 'p1',
        kills: 0,
        deaths: 1,
        selfKills: 1,
        curseKills: 0,
        transfers: 0,
        trollPoints: 0,
      },
    ]);
    t.disconnect();
  });

  it('after roundEnd the state stands still (only the tick moves) and input is ignored, like the server', () => {
    const { t, got } = suicide();
    for (let i = 0; i < 41; i++) t.step();
    const ended = got.snaps.at(-1) as SnapshotMessage;
    t.send({ seq: 2, dir: 'right', bomb: true });
    for (let i = 0; i < 20; i++) t.step();
    const later = got.snaps.at(-1) as SnapshotMessage;
    expect(later.tick).toBe(ended.tick + 20);
    expect(later.players).toEqual(ended.players);
    expect(later.bombs).toEqual(ended.bombs);
    expect(later.flames).toEqual(ended.flames);
    expect(got.raw.filter((m) => kindOf(m) === 'roundEnd')).toHaveLength(1);
    t.disconnect();
  });

  it('autoRematch: starts the next round 60 ticks after the one that sent roundEnd, and that round is not frozen', () => {
    const { t, got } = suicide(7, true);
    const kinds = () => got.raw.map(kindOf);
    for (let i = 0; i < 40 && !kinds().includes('roundEnd'); i++) t.step();
    expect(kinds()).toContain('roundEnd');
    // the tick that sent roundEnd is the first of the 60
    for (let i = 0; i < 58; i++) t.step();
    expect(kinds()).not.toContain('roundStart');
    t.step();
    expect(kinds()).toContain('roundStart');
    t.step(); // roundStart goes out after the snapshot of its tick, so the next snapshot is the new round's
    expect(got.snaps.at(-1)?.players.every((p) => p.alive)).toBe(true);
    // the new round is not frozen
    t.send({ seq: 2, dir: 'right', bomb: false });
    for (let i = 0; i < 8; i++) t.step();
    expect(got.snaps.at(-1)?.players[0]?.x).toBeGreaterThan(1);
    t.disconnect();
  });

  it('an item leaves the floor only when a living player stands on its tile', () => {
    const t = new MockTransport({ bots: 3, seed: 15, autoRematch: true });
    const got = collect(t);
    t.connect();
    for (let i = 0; i < 700; i++) t.step();
    let prev: SnapshotMessage | undefined;
    let pickups = 0;
    for (const m of got.raw) {
      if (kindOf(m) === 'roundStart') prev = undefined; // a new round clears the floor without a pickup
      if ((m as Msg).t !== 'snapshot') continue;
      const cur = m as SnapshotMessage;
      for (const item of prev?.items ?? []) {
        if (cur.items.some((i) => i.x === item.x && i.y === item.y)) continue;
        pickups++;
        const taker = cur.players.find(
          (p) => p.alive && Math.round(p.x) === item.x && Math.round(p.y) === item.y,
        );
        expect(taker, `item at ${item.x},${item.y} vanished at tick ${cur.tick}`).toBeDefined();
      }
      prev = cur;
    }
    expect(pickups).toBeGreaterThan(0);
    t.disconnect();
  });

  it('an item that nobody walks onto stays on the floor', () => {
    const t = new MockTransport({ bots: 3, seed: 15 });
    const got = collect(t);
    t.connect();
    for (let i = 0; i < 120; i++) t.step();
    // by tick 120 a box has broken and dropped something that is still lying there
    const seen = got.snaps.find((s) => s.items.length > 0);
    expect(seen).toBeDefined();
    t.disconnect();
  });
});

describe('MockTransport kill events and rematch (FE-21, D35)', () => {
  type Msg = { t: string; kind?: string; [k: string]: unknown };
  const kindOf = (m: unknown) => (m as Msg).kind;
  const ofKind = (raw: unknown[], kind: string) => raw.filter((m) => kindOf(m) === kind) as Msg[];

  /** One bot standing next to our spawn (no wandering), a clock we move by hand. */
  function duel(bots = 1) {
    let now = 1_000_000;
    const t = new MockTransport({ bots, seed: 7, clock: () => now });
    const got = collect(t);
    t.connect();
    return {
      t,
      got,
      setNow: (n: number) => {
        now = n;
      },
      now: () => now,
    };
  }

  /** We bomb our own spawn next to the bot: both die at tick 40. */
  function bothDie() {
    const d = duel();
    const bot = (d.t as unknown as { players: { x: number; y: number; bot?: () => number }[] })
      .players[1];
    if (!bot) throw new Error('expected a bot');
    Object.assign(bot, { x: 2, y: 1, bot: undefined });
    d.t.send({ seq: 1, dir: 'none', bomb: true });
    for (let i = 0; i < 40; i++) d.t.step();
    return d;
  }

  it('sends one `kill` per death before roundEnd: self for our own bomb, bomb for the bot next to us', () => {
    const { t, got } = bothDie();
    const kills = ofKind(got.raw, 'kill');
    expect(kills.map((k) => [k.killer, k.victim, k.cause])).toEqual([
      ['p1', 'p1', 'self'],
      ['p1', 'p2', 'bomb'],
    ]);
    const end = got.raw.findIndex((m) => kindOf(m) === 'roundEnd');
    expect(end).toBeGreaterThan(got.raw.lastIndexOf(kills[1] as Msg) - 1);
    expect(got.raw.indexOf(kills[0] as Msg)).toBeLessThan(end);
    t.disconnect();
  });

  it('roundEnd stats are sorted like the server sorts them and titles are shared on ties, none at 0', () => {
    const { t, got } = bothDie();
    const end = ofKind(got.raw, 'roundEnd')[0] as Msg & { stats: { id: string }[] };
    expect(end.stats.map((r) => r.id)).toEqual(['p1', 'p2']); // p1 has the แต้มเกรียน
    expect(end.titles).toEqual([
      { title: 'selfKiller', players: ['p1'], value: 1 },
      { title: 'troll', players: ['p1'], value: 1 },
    ]);
    t.disconnect();
  });

  it('a round nobody scored in sends no titles', () => {
    const d = duel(1);
    // the bot dies to a bomb of its own and we do nothing: nobody has a point and nobody killed themselves except the bot
    const players = (d.t as unknown as { players: { x: number; y: number; bot?: () => number }[] })
      .players;
    const bot = players[1];
    if (!bot) throw new Error('expected a bot');
    Object.assign(bot, { x: 11, y: 1, bot: undefined });
    (d.t as unknown as { placeBomb(p: unknown): void }).placeBomb(bot);
    for (let i = 0; i < 45; i++) d.t.step();
    const end = ofKind(d.got.raw, 'roundEnd')[0] as Msg;
    expect(end.winner).toBe('p1');
    expect(end.titles).toEqual([{ title: 'selfKiller', players: ['p2'], value: 1 }]);
    d.t.disconnect();
  });

  it('after roundEnd nothing restarts by itself: the round waits for the rematch', () => {
    const { t, got } = bothDie();
    for (let i = 0; i < 400; i++) t.step();
    expect(ofKind(got.raw, 'roundStart')).toEqual([]);
    expect(ofKind(got.raw, 'rematchStatus')).toEqual([]);
    t.disconnect();
  });

  it('first press: status with us ready and a deadline 15 s away; a repeat press says nothing new', () => {
    const { t, got, now } = bothDie();
    t.rematch();
    t.rematch();
    expect(ofKind(got.raw, 'rematchStatus')).toEqual([
      expect.objectContaining({ ready: ['p1'], deadline: now() + 15_000 }),
    ]);
    t.disconnect();
  });

  it('the bots follow one second apart, and everyone ready starts the round at once with a fresh table', () => {
    const { t, got, now } = bothDie();
    t.rematch();
    for (let i = 0; i < 19; i++) t.step();
    expect(ofKind(got.raw, 'roundStart')).toEqual([]);
    t.step(); // 20th tick after the press: the bot is ready too
    const statuses = ofKind(got.raw, 'rematchStatus');
    expect(statuses.map((s) => s.ready)).toEqual([['p1'], ['p1', 'p2']]);
    // the deadline did not move when the bot pressed later (D35)
    expect(statuses.map((s) => s.deadline)).toEqual([now() + 15_000, now() + 15_000]);
    const starts = ofKind(got.raw, 'roundStart');
    expect(starts).toHaveLength(1);
    t.step();
    expect(got.snaps.at(-1)?.players.every((p) => p.alive)).toBe(true);
    t.disconnect();
  });

  it('the deadline starts the round even when not everyone is ready (15 s after the first press)', () => {
    const { t, got, setNow, now } = bothDie();
    const t0 = now();
    // the bot is ready one second after us; the deadline comes first
    t.rematch();
    for (let i = 0; i < 5; i++) t.step();
    expect(ofKind(got.raw, 'roundStart')).toEqual([]);
    setNow(t0 + 15_001);
    t.step();
    expect(ofKind(got.raw, 'roundStart')).toHaveLength(1);
    t.disconnect();
  });

  it('a press while the round is still running is ignored', () => {
    const d = duel(1);
    d.t.rematch();
    for (let i = 0; i < 30; i++) d.t.step();
    expect(ofKind(d.got.raw, 'rematchStatus')).toEqual([]);
    d.t.disconnect();
  });

  it('the next round can be ended and rematched again (state is cleared on every start)', () => {
    const { t, got } = bothDie();
    t.rematch();
    for (let i = 0; i < 20; i++) t.step();
    expect(ofKind(got.raw, 'roundStart')).toHaveLength(1);
    // round 2 ends in a draw by timeout once we have watched our own death for a while
    t.send({ seq: 2, dir: 'none', bomb: true });
    for (let i = 0; i < 40 + 61; i++) t.step();
    expect(ofKind(got.raw, 'roundEnd').length).toBeGreaterThanOrEqual(2);
    t.rematch();
    expect(ofKind(got.raw, 'rematchStatus').at(-1)).toMatchObject({ ready: ['p1'] });
    t.disconnect();
  });

  it('when we die and the bots keep going, the round ends as a timeout draw after a while', () => {
    const t = new MockTransport({ bots: 3, seed: 3 });
    const got = collect(t);
    t.connect();
    t.send({ seq: 1, dir: 'none', bomb: true });
    for (let i = 0; i < 40 + 61; i++) t.step();
    const ends = ofKind(got.raw, 'roundEnd');
    expect(ends).toHaveLength(1);
    expect(ofKind(got.raw, 'roundStart')).toEqual([]);
    t.disconnect();
  });

  it('everything in the rematch flow passes parseServerMessage', () => {
    const { t, got } = bothDie();
    t.rematch();
    for (let i = 0; i < 25; i++) t.step();
    for (const msg of got.raw) {
      expect(parseServerMessage(JSON.parse(JSON.stringify(msg))).ok).toBe(true);
    }
    t.disconnect();
  });
});
