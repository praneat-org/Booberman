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
/** Snapshots over which the clock offset is estimated (about 5 s). */
const OFFSET_WINDOW = 100;

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
 * local clock is `recvAt - tickTime`, taking the minimum over a window so network jitter (which
 * only ever makes a packet later) does not wobble the render time. We draw at
 * `now - offset - delay`, lerp between the two snapshots around it, and never extrapolate: with no
 * newer snapshot everything stays on the newest one.
 *
 * Pure (the clock is passed in) so it can be unit tested. Per-round state: `reset()`.
 */
export class SnapshotBuffer {
  private entries: Entry[] = [];
  private offsets: number[] = [];
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
    this.offsets.push(recvAt - msg.tick * this.tickMs);
    if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
    return true;
  }

  /** Also drops snapshots older than the one at the render time (so the buffer stays small). */
  sample(now: number): Sample | undefined {
    const first = this.entries[0];
    const last = this.entries[this.entries.length - 1];
    if (!first || !last) return undefined;

    const offset = Math.min(...this.offsets);
    const wanted = (now - offset - this.delayMs) / this.tickMs;
    const renderTick = Math.min(last.msg.tick, Math.max(first.msg.tick, wanted));

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

  /** New round / new connection: nothing from the old one may leak into the next. */
  reset(): void {
    this.entries = [];
    this.offsets = [];
    this.lastBaseTick = -1;
  }
}
