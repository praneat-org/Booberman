import { exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { SnapshotMessage } from '../net/Transport';
import {
  MAX_BUFFERED_SNAPSHOTS,
  MAX_CLOCK_RATE,
  MIN_CLOCK_RATE,
  SnapshotBuffer,
  TICK_MS,
} from './snapshotBuffer';

const pl = (id: string, x: number, y = 1, teleport = false, alive = true): PlayerState => ({
  id,
  x,
  y,
  alive,
  curse: 0,
  teleport,
});
const snap = (tick: number, players: PlayerState[]): SnapshotMessage => ({
  ...exampleServerMessages.snapshot,
  tick,
  players,
});
/** Tick n arrives at exactly n * 50 ms (no network delay), default 100 ms render delay. */
const at = (tick: number) => tick * 50;
const xOf = (b: SnapshotBuffer, now: number, id = 'p1') =>
  b.sample(now)?.players.find((p) => p.id === id)?.x;

function filled(ticks: number[], x: (t: number) => number = (t) => t / 10): SnapshotBuffer {
  const b = new SnapshotBuffer();
  for (const t of ticks) b.push(snap(t, [pl('p1', x(t))]), at(t));
  return b;
}

describe('SnapshotBuffer', () => {
  it('has nothing to draw until the first snapshot', () => {
    expect(new SnapshotBuffer().sample(0)).toBeUndefined();
  });

  it('draws 100 ms behind: lerps midway between the two snapshots around the render time', () => {
    const b = filled([10, 11, 12, 13]); // x = 1.0 .. 1.3
    // newest arrived at 650 ms; render time 650 - 100 = 550 ms = tick 11 → x 1.1
    expect(xOf(b, at(13))).toBeCloseTo(1.1);
    // 25 ms later: halfway between tick 11 and 12
    expect(xOf(b, at(13) + 25)).toBeCloseTo(1.15);
  });

  it('smooths 20 Hz data across 60 fps frames (no 3-frame plateaus)', () => {
    const b = filled([10, 11, 12, 13, 14, 15, 16]);
    const xs: number[] = [];
    for (let now = at(13); now < at(16); now += 1000 / 60) xs.push(xOf(b, now) as number);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i] as number).toBeGreaterThan(xs[i - 1] as number);
  });

  it('uses the delay from config', () => {
    const b = new SnapshotBuffer({ delayMs: 0 });
    for (const t of [10, 11]) b.push(snap(t, [pl('p1', t / 10)]), at(t));
    expect(xOf(b, at(11))).toBeCloseTo(1.1);
  });

  it('places a teleporting player at the new position without sliding through the gap', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 11, 9, true)]), at(11));
    b.push(snap(12, [pl('p1', 11, 9)]), at(12));
    b.push(snap(13, [pl('p1', 11, 9)]), at(13));
    // render tick 10.5, between the two: still at the old spot, never in the middle of the map
    const mid = b.sample(at(12) + 0) as NonNullable<ReturnType<SnapshotBuffer['sample']>>;
    expect(mid.players[0]).toMatchObject({ x: 1, y: 1, teleport: false });
    // once tick 11 is reached: new spot at once, flagged as a teleport for exactly this sample
    const landed = b.sample(at(13));
    expect(landed?.players[0]).toMatchObject({ x: 11, y: 9, teleport: true });
    expect(b.sample(at(13) + 10)?.players[0]?.teleport).toBe(false);
  });

  it('the teleport flag alone stops the lerp: a 1-tile move is not walked (distance guard idle)', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 2, 1, true)]), at(11)); // 1 tile, well under SNAP_DISTANCE_TILES
    b.push(snap(12, [pl('p1', 2)]), at(12));
    b.push(snap(13, [pl('p1', 2)]), at(13));
    const s = b.sample(at(12) + 25) as NonNullable<ReturnType<SnapshotBuffer['sample']>>;
    expect(s.renderTick).toBeCloseTo(10.5); // strictly between 10 and 11, so f = 0.5
    expect(s.players[0]?.x).toBe(1); // flag set: held at the old spot, not 1.5
    // control: the same move without the flag is lerped
    const c = new SnapshotBuffer();
    c.push(snap(10, [pl('p1', 1)]), at(10));
    c.push(snap(11, [pl('p1', 2)]), at(11));
    c.push(snap(12, [pl('p1', 2)]), at(12));
    expect(c.sample(at(12) + 25)?.players[0]?.x).toBeCloseTo(1.5);
  });

  it('does not lose a teleport when frames skip over the snapshot that carried it', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 2, 1, true)]), at(11));
    b.push(snap(12, [pl('p1', 2.1)]), at(12));
    b.push(snap(13, [pl('p1', 2.2)]), at(13));
    b.push(snap(14, [pl('p1', 2.3)]), at(14));
    expect(b.sample(at(10) + 100)?.players[0]?.x).toBeCloseTo(1);
    expect(b.sample(at(14))?.players[0]?.teleport).toBe(true); // render tick 12, skipped tick 11
  });

  it('the distance guard alone stops the lerp: a 4-tile jump with no flag is not walked', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 5)]), at(11)); // no teleport flag
    b.push(snap(12, [pl('p1', 5)]), at(12));
    b.push(snap(13, [pl('p1', 5)]), at(13));
    const s = b.sample(at(12) + 25) as NonNullable<ReturnType<SnapshotBuffer['sample']>>;
    expect(s.renderTick).toBeCloseTo(10.5);
    expect(s.players[0]?.x).toBe(1);
    expect(xOf(b, at(13) - 1)).toBe(1);
  });

  it('holds on the newest snapshot when none arrive (no extrapolation), then resumes', () => {
    const b = filled([10, 11, 12]);
    expect(xOf(b, at(12))).toBeCloseTo(1.0);
    expect(xOf(b, at(12) + 10_000)).toBeCloseTo(1.2);
    expect(xOf(b, at(12) + 10_050)).toBeCloseTo(1.2);
    b.push(snap(13, [pl('p1', 1.3)]), at(12) + 10_050);
    expect(b.sample(at(12) + 10_050)?.players[0]?.x).toBeGreaterThanOrEqual(1.2);
    expect(b.sample(at(12) + 10_050)?.players[0]?.x).toBeLessThanOrEqual(1.3);
  });

  it('is not thrown by jitter: late packets do not move the render time back', () => {
    const b = new SnapshotBuffer();
    // tick 10, 11 on time, 12 arrives 40 ms late, 13 on time
    b.push(snap(10, [pl('p1', 1.0)]), at(10));
    b.push(snap(11, [pl('p1', 1.1)]), at(11));
    b.push(snap(12, [pl('p1', 1.2)]), at(12) + 40);
    b.push(snap(13, [pl('p1', 1.3)]), at(13));
    expect(xOf(b, at(13))).toBeCloseTo(1.1, 1); // within a twentieth of a tile of the no-jitter x
  });

  it('copes with jitter as wide as the delay (150 ms +/- 50 ms): never starved, never backwards', () => {
    const b = new SnapshotBuffer();
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const arrivals = Array.from({ length: 80 }, (_, i) => ({
      t: i,
      at: at(i) + 100 + rnd() * 100,
    }));
    arrivals.sort((p, q) => p.at - q.at);
    let prev = -Infinity;
    let held = 0;
    let frames = 0;
    for (let now = 0, k = 0; now < at(70); now += 1000 / 60) {
      while (k < arrivals.length && (arrivals[k] as { at: number }).at <= now) {
        const a = arrivals[k++] as { t: number; at: number };
        b.push(snap(a.t, [pl('p1', a.t / 10)]), a.at);
      }
      const s = b.sample(now);
      if (!s || now < at(20)) continue;
      frames++;
      expect(s.players[0]?.x as number).toBeGreaterThanOrEqual(prev);
      if (s.renderTick === b.latestTick) held++;
      prev = s.players[0]?.x as number;
    }
    expect(held / frames).toBeLessThan(0.05);
  });

  it('ignores duplicate, out-of-order and stale ticks', () => {
    const b = filled([10, 11, 12]);
    expect(b.push(snap(12, [pl('p1', 9)]), at(12))).toBe(false);
    expect(b.push(snap(11, [pl('p1', 9)]), at(12))).toBe(false);
    expect(b.push(snap(3, [pl('p1', 9)]), at(12))).toBe(false);
    expect(b.size).toBe(3);
    expect(b.latestTick).toBe(12);
  });

  it('a player who joins mid-buffer appears only once their snapshot is the base', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 1), pl('p2', 5)]), at(11));
    b.push(snap(12, [pl('p1', 1), pl('p2', 5)]), at(12));
    b.push(snap(13, [pl('p1', 1), pl('p2', 5)]), at(13));
    expect(b.sample(at(12))?.players.map((p) => p.id)).toEqual(['p1']);
    expect(b.sample(at(13))?.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('a player who leaves mid-buffer stays put until the snapshot without them is reached', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1), pl('p2', 5)]), at(10));
    b.push(snap(11, [pl('p1', 1)]), at(11));
    b.push(snap(12, [pl('p1', 1)]), at(12));
    b.push(snap(13, [pl('p1', 1)]), at(13));
    const early = b.sample(at(12) - 10);
    expect(early?.players.find((p) => p.id === 'p2')).toMatchObject({ x: 5 });
    expect(b.sample(at(13))?.players.map((p) => p.id)).toEqual(['p1']);
  });

  it('keeps discrete state (alive) from the base snapshot, not the newer one', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 1, 1, false, false)]), at(11));
    b.push(snap(12, [pl('p1', 1, 1, false, false)]), at(12));
    expect(b.sample(at(12) + 25)?.players[0]?.alive).toBe(true);
    expect(b.sample(at(13))?.players[0]?.alive).toBe(false);
  });

  it('drops snapshots behind the render time and never grows past the cap', () => {
    const b = filled([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    b.sample(at(20));
    expect(b.size).toBeLessThanOrEqual(4);
    const hidden = new SnapshotBuffer(); // tab hidden: pushes but never samples
    for (let t = 0; t < MAX_BUFFERED_SNAPSHOTS * 3; t++) hidden.push(snap(t, [pl('p1', 1)]), at(t));
    expect(hidden.size).toBe(MAX_BUFFERED_SNAPSHOTS);
  });

  it('reset empties it: a new round with lower ticks is accepted and starts clean', () => {
    const b = filled([100, 101, 102, 103]);
    b.sample(at(103));
    b.reset();
    expect(b.size).toBe(0);
    expect(b.latestTick).toBeUndefined();
    expect(b.sample(at(103))).toBeUndefined();
    expect(b.push(snap(1, [pl('p1', 7)]), 10_000)).toBe(true);
    const s = b.sample(10_000);
    expect(s?.players[0]).toMatchObject({ x: 7, teleport: false });
    expect(s?.renderTick).toBe(1);
  });

  describe('render clock', () => {
    interface Run {
      ticks: number[];
      held: number;
      backward: number;
      maxRate: number;
      minRate: number;
    }
    /**
     * Feeds ticks at 20 Hz through `latency(tick)` (ms, may be non-monotonic = reordering is
     * dropped like a real transport would) and samples at 60 fps. `drift` = server clock runs
     * this many ms/tick slower than local (offset grows linearly).
     */
    function run(
      latency: (tick: number) => number,
      opts: { seconds?: number; drift?: number; buffer?: SnapshotBuffer; from?: number } = {},
    ): Run & { buffer: SnapshotBuffer } {
      const b = opts.buffer ?? new SnapshotBuffer();
      const total = Math.floor(((opts.seconds ?? 20) * 1000) / TICK_MS);
      const first = opts.from ?? 0;
      const arrivals = Array.from({ length: total }, (_, i) => ({
        t: first + i,
        at: i * (TICK_MS + (opts.drift ?? 0)) + latency(i),
      })).sort((p, q) => p.at - q.at);
      const out: Run = { ticks: [], held: 0, backward: 0, maxRate: 0, minRate: Infinity };
      let prev: number | undefined;
      let prevNow = 0;
      let k = 0;
      const end = (total - 4) * TICK_MS;
      for (let now = 0; now < end; now += 1000 / 60) {
        while (k < arrivals.length && (arrivals[k] as { at: number }).at <= now) {
          const a = arrivals[k++] as { t: number; at: number };
          b.push(snap(a.t, [pl('p1', a.t / 10)]), a.at);
        }
        const s = b.sample(now);
        if (!s) continue;
        if (prev !== undefined) {
          if (s.renderTick < prev) out.backward++;
          const rate = ((s.renderTick - prev) * TICK_MS) / (now - prevNow);
          out.maxRate = Math.max(out.maxRate, rate);
          out.minRate = Math.min(out.minRate, rate);
        }
        if (s.renderTick === b.latestTick) out.held++;
        out.ticks.push(s.renderTick);
        prev = s.renderTick;
        prevNow = now;
      }
      return { ...out, buffer: b };
    }
    const MAX = MAX_CLOCK_RATE + 1e-9;
    it('never goes backward and stays within the rate bounds at a steady 100 ms', () => {
      const r = run(() => 100);
      expect(r.backward).toBe(0);
      expect(r.maxRate).toBeLessThanOrEqual(MAX);
      expect(r.minRate).toBeGreaterThanOrEqual(0);
      expect(r.held / r.ticks.length).toBeLessThan(0.02);
    });

    it('a latency step UP: the clock slows (never reverses) and recovers without lasting starvation', () => {
      // 100 ms until 10 s, then 250 ms
      const r = run((i) => (i < 200 ? 100 : 250), { seconds: 25 });
      expect(r.backward).toBe(0);
      expect(r.maxRate).toBeLessThanOrEqual(MAX);
      // starved frames after the estimator has had 3 s to follow the step
      const frameAt = (sec: number) => Math.floor(sec * 60);
      const tail = r.ticks.slice(frameAt(13), frameAt(24));
      const stuck = tail.filter((t, i) => i > 0 && t === tail[i - 1]).length;
      expect(stuck / tail.length).toBeLessThan(0.03);
    });

    it('a latency step DOWN: the clock never reverses or jumps, and the extra lag drains', () => {
      const r = run((i) => (i < 200 ? 250 : 60), { seconds: 25 });
      expect(r.backward).toBe(0);
      expect(r.maxRate).toBeLessThanOrEqual(MAX);
      expect(r.minRate).toBeGreaterThanOrEqual(0);
      // lag (newest arrived tick minus drawn tick) shrinks after the step
      const lagAt = (sec: number) => {
        const f = Math.floor(sec * 60);
        return (sec * 1000 - 60) / TICK_MS - (r.ticks[f] as number);
      };
      expect(lagAt(24)).toBeLessThan(lagAt(10.5));
    });

    it('follows gradual drift in both directions (1 percent) without starving or reversing', () => {
      for (const drift of [0.5, -0.5]) {
        const r = run(() => 100, { seconds: 40, drift });
        expect(r.backward).toBe(0);
        expect(r.maxRate).toBeLessThanOrEqual(MAX);
        expect(r.held / r.ticks.length).toBeLessThan(0.03);
      }
    });

    it('stays monotonic and bounded under jitter as wide as the delay (150 +/- 50 ms)', () => {
      let seed = 11;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const r = run(() => 100 + rnd() * 100, { seconds: 30 });
      expect(r.backward).toBe(0);
      expect(r.maxRate).toBeLessThanOrEqual(MAX);
      expect(r.held / r.ticks.length).toBeLessThan(0.05);
    });

    it('reset then refill: render tick restarts in the new timeline and is monotonic from there', () => {
      const b = new SnapshotBuffer();
      run(() => 100, { buffer: b, seconds: 5, from: 500 });
      b.reset();
      expect(b.sample(0)).toBeUndefined();
      // new round: ticks restart at 1, and the very first packets are late (offset rises)
      const r = run((i) => (i < 1 ? 100 : 300), { buffer: b, seconds: 10, from: 1 });
      expect(r.backward).toBe(0);
      expect(r.ticks[0]).toBeGreaterThanOrEqual(1);
      expect(r.ticks[0]).toBeLessThan(5);
      expect(r.maxRate).toBeLessThanOrEqual(MAX);
    });

    it('rate bounds are the documented constants', () => {
      expect(MIN_CLOCK_RATE).toBeGreaterThan(0);
      expect(MAX_CLOCK_RATE).toBeLessThanOrEqual(2);
    });
  });
});
