import { exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { SnapshotMessage } from '../net/Transport';
import { MAX_BUFFERED_SNAPSHOTS, SnapshotBuffer } from './snapshotBuffer';

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

  it('snaps (no lerp) for a jump over 1.5 tiles even without the flag', () => {
    const b = new SnapshotBuffer();
    b.push(snap(10, [pl('p1', 1)]), at(10));
    b.push(snap(11, [pl('p1', 5)]), at(11));
    b.push(snap(12, [pl('p1', 5)]), at(12));
    b.push(snap(13, [pl('p1', 5)]), at(13));
    expect(xOf(b, at(12) + 0)).toBe(1); // tick 10 + 0 → hold
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
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
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
});
