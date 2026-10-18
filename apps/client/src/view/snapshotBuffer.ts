import type { PlayerState } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';

/** The server ticks at 20 Hz. */
export const TICK_MS = 50;
/** How far behind the newest data we draw, so two snapshots always straddle the render time. */
export const DEFAULT_INTERPOLATION_DELAY_MS = 100;
/** A jump longer than this (in tiles) is never walked, it is a teleport. */
export const SNAP_DISTANCE_TILES = 1.5;
/** Hard cap so a tab that stops rendering (hidden) cannot grow the buffer without bound. */
export const MAX_BUFFERED_SNAPSHOTS = 64;
/**
 * Clock-offset estimator gains. Offset = latency + clock base, so a rising offset means the data
 * is getting later: follow it quickly (otherwise the render time overtakes the newest snapshot
 * and we starve). A falling offset only means we are further behind than needed: follow slowly.
 * The first samples use a plain running mean (gain 1/n) so one early packet cannot set the clock.
 */
export const OFFSET_GAIN_UP = 0.15;
export const OFFSET_GAIN_DOWN = 0.05;
/** The render clock advances between these multiples of real time, so it never goes backward. */
export const MIN_CLOCK_RATE = 0.5;
export const MAX_CLOCK_RATE = 1.5;
/** Further than this behind the target (tab was hidden, long stall): jump forward instead. */
const RESYNC_TICKS = 10;

export interface SnapshotBufferOptions {
  delayMs?: number;
  tickMs?: number;
}

/** What to draw right now: the snapshot at / before the render time, with players interpolated. */
export interface Sample {
  /** The snapshot the discrete state (bombs, flames, items, alive) is taken from. */
  base: SnapshotMessage;
  /** Fractional server tick being drawn; always within [oldest, newest] buffered tick. */
  renderTick: number;
  /**
   * `base.players` with x / y interpolated. `teleport` is true for a player who snapped since
   * the previous `sample` call (server flag on any skipped snapshot, or a jump over the snap
   * distance), not the raw flag, so it holds for exactly one sample.
   */
  players: PlayerState[];
}

interface Entry {
  msg: SnapshotMessage;
  recvAt: number;
}

/**
 * Snapshot buffer for entity interpolation. Server time is `tick * tickMs`; the mapping to the
 * local clock is `recvAt - tickTime` smoothed by an asymmetric EMA (fast up, slow down), and the
 * render clock follows it forward-only at a bounded rate, so jitter does not wobble the render
 * time and a packet up to `delay` later than average still arrives before it is needed. We draw at
 * `now - offset - delay`, lerp between the two snapshots around it, and never extrapolate: with no
 * newer snapshot everything stays on the newest one.
 *
 * Pure (the clock is passed in) so it can be unit tested. Per-round state: `reset()`.
 */
export class SnapshotBuffer {
  private entries: Entry[] = [];
  private offset = 0;
  private offsetCount = 0;
  private clockTick: number | undefined;
  private clockNow = 0;
  private lastBaseTick = -1;
  private readonly delayMs: number;
  private readonly tickMs: number;

  constructor(options: SnapshotBufferOptions = {}) {
    this.delayMs = Math.max(0, options.delayMs ?? DEFAULT_INTERPOLATION_DELAY_MS);
    this.tickMs = options.tickMs ?? TICK_MS;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Newest buffered tick, or undefined while empty. */
  get latestTick(): number | undefined {
    return this.entries[this.entries.length - 1]?.msg.tick;
  }

  /** False when dropped as a duplicate / out-of-order (tick not newer than the newest). */
  push(msg: SnapshotMessage, recvAt: number): boolean {
    const latest = this.latestTick;
    if (latest !== undefined && msg.tick <= latest) return false;
    this.entries.push({ msg, recvAt });
    if (this.entries.length > MAX_BUFFERED_SNAPSHOTS) this.entries.shift();
    const sample = recvAt - msg.tick * this.tickMs;
    this.offsetCount++;
    const gain = Math.max(
      sample > this.offset ? OFFSET_GAIN_UP : OFFSET_GAIN_DOWN,
      1 / this.offsetCount,
    );
    this.offset += (sample - this.offset) * gain;
    return true;
  }

  /** Also drops snapshots older than the one at the render time (so the buffer stays small). */
  sample(now: number): Sample | undefined {
    const first = this.entries[0];
    const last = this.entries[this.entries.length - 1];
    if (!first || !last) return undefined;

    const renderTick = this.advanceClock(now, first.msg.tick, last.msg.tick);

    let i = 0;
    while (i + 1 < this.entries.length && (this.entries[i + 1] as Entry).msg.tick <= renderTick)
      i++;
    const a = (this.entries[i] as Entry).msg;
    const b = this.entries[i + 1]?.msg;

    const teleported = new Set<string>();
    for (const e of this.entries) {
      if (e.msg.tick <= this.lastBaseTick) continue;
      if (e.msg.tick > a.tick) break;
      for (const p of e.msg.players) if (p.teleport) teleported.add(p.id);
    }
    this.lastBaseTick = Math.max(this.lastBaseTick, a.tick);
    if (i > 0) this.entries.splice(0, i);

    const f = b ? (renderTick - a.tick) / (b.tick - a.tick) : 0;
    const players = a.players.map((p): PlayerState => {
      const next = b?.players.find((q) => q.id === p.id);
      let { x, y } = p;
      if (
        next &&
        f > 0 &&
        !next.teleport &&
        Math.hypot(next.x - p.x, next.y - p.y) <= SNAP_DISTANCE_TILES
      ) {
        x = p.x + (next.x - p.x) * f;
        y = p.y + (next.y - p.y) * f;
      }
      return { ...p, x, y, teleport: teleported.has(p.id) };
    });
    return { base: a, renderTick, players };
  }

  /**
   * The render clock: aims at `(now - offset - delay) / tickMs` but only ever moves forward, at
   * between MIN_CLOCK_RATE and MAX_CLOCK_RATE of real time. A rising offset therefore slows the
   * clock down (and holds on the newest snapshot if it must) instead of stepping it back.
   */
  private advanceClock(now: number, oldest: number, newest: number): number {
    const target = (now - this.offset - this.delayMs) / this.tickMs;
    let tick = target;
    if (this.clockTick !== undefined) {
      const dt = Math.max(0, now - this.clockNow) / this.tickMs;
      const gap = target - this.clockTick;
      const step =
        gap > RESYNC_TICKS
          ? gap
          : Math.min(dt * MAX_CLOCK_RATE, Math.max(dt * MIN_CLOCK_RATE, gap));
      tick = this.clockTick + step;
    }
    this.clockNow = Math.max(now, this.clockNow);
    this.clockTick = Math.min(newest, Math.max(oldest, tick));
    return this.clockTick;
  }

  /** New round / new connection: nothing from the old one may leak into the next. */
  reset(): void {
    this.entries = [];
    this.offset = 0;
    this.offsetCount = 0;
    this.clockTick = undefined;
    this.clockNow = 0;
    this.lastBaseTick = -1;
  }
}
