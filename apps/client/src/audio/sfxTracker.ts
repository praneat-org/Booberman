import type { PlayerId } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';
import type { SfxName } from './sfx';

/**
 * More ticks than this between two drawn snapshots (2 s at 20 Hz) means the tab was in the
 * background or the render stalled: what changed meanwhile is old news, so it is not played.
 */
export const MAX_OBSERVE_GAP_TICKS = 40;

export type ObservedSnapshot = Pick<
  SnapshotMessage,
  'tick' | 'players' | 'bombs' | 'flames' | 'items'
>;

interface Seen {
  tick: number;
  bombs: ReadonlySet<string>;
  items: ReadonlySet<string>;
  alive: ReadonlySet<string>;
}

export interface SfxTrackerOptions {
  /**
   * Derive `die` from a player flipping alive -> dead in the snapshot (default). Set to false once
   * the server's `kill` event (D35, BE-41) is wired up: that event, one per death, becomes the
   * trigger and the two must not both fire. The switch is the only change needed here.
   */
  deriveDeaths?: boolean;
}

const tile = (x: number, y: number) => `${x},${y}`;

function seenFrom(s: ObservedSnapshot): Seen {
  return {
    tick: s.tick,
    bombs: new Set(s.bombs.map((b) => tile(b.x, b.y))),
    items: new Set(s.items.map((i) => tile(i.x, i.y))),
    alive: new Set(s.players.filter((p) => p.alive).map((p) => p.id)),
  };
}

/**
 * Turns what the server says into sounds. It never decides anything: every sound is a change
 * between two snapshots the server sent (or the `roundEnd` event), so a key press that the server
 * ignores makes no sound, and a bomb another player placed does.
 *
 * - `bombPlace`: a bomb on a tile that had none in the previous drawn snapshot
 *   (limit: a kicked bomb, CAR-3801, would look like a new one; revisit when the server can say so)
 * - `explode`: a bomb is gone and a flame burns on its tile (flames start on the bomb's own tile).
 *   A chain reaction is one sound, not one per bomb
 * - `die`: a player was alive and now is not (leaving the room is not a death)
 * - `pickup`: an item left the floor (fire never destroys items, D29)
 * - `win`: `roundEnd` with a winner, played when the snapshot holding the end of the round is
 *   drawn, so it comes after the last explosion / death sound and not 100 ms before it
 *
 * Fed with the snapshot that is being *drawn* (not the newest received), so sound and picture
 * line up. Per-round state: `reset()` on every welcome / roundStart, otherwise the old round's
 * bombs vanishing would explode.
 */
export class SfxTracker {
  private seen: Seen | undefined;
  /** The snapshot tick from which `win` may play; undefined = no win waiting. */
  private winFromTick: number | undefined;
  private readonly deriveDeaths: boolean;

  constructor(options: SfxTrackerOptions = {}) {
    this.deriveDeaths = options.deriveDeaths ?? true;
  }

  reset(): void {
    this.seen = undefined;
    this.winFromTick = undefined;
  }

  /**
   * `roundEnd` arrived. `newestTickReceived` is the newest snapshot tick we have so far: the
   * server sends the event before the snapshot of the tick it happened in, so the end of the
   * round is the first snapshot *after* that one. A draw (`winner === null`) has no jingle.
   */
  roundEnded(winner: PlayerId | null, newestTickReceived: number | undefined): void {
    if (winner === null) return;
    this.winFromTick = (newestTickReceived ?? -1) + 1;
  }

  /** The snapshot being drawn this frame. Returns each sound that should play now, at most once. */
  observe(s: ObservedSnapshot): SfxName[] {
    const prev = this.seen;
    if (prev && s.tick <= prev.tick && prev.tick - s.tick <= MAX_OBSERVE_GAP_TICKS) {
      return []; // the same tick drawn again on the next frame (60 fps vs 20 Hz)
    }
    const cur = seenFrom(s);
    this.seen = cur;

    // first snapshot of a round, a long stall, or the tick counter restarted: just remember it
    if (!prev || Math.abs(s.tick - prev.tick) > MAX_OBSERVE_GAP_TICKS) {
      this.winFromTick = undefined;
      return [];
    }

    const out = new Set<SfxName>();
    for (const key of cur.bombs) if (!prev.bombs.has(key)) out.add('bombPlace');
    const burning = new Set(s.flames.map(([x, y]) => tile(x, y)));
    for (const key of prev.bombs) if (!cur.bombs.has(key) && burning.has(key)) out.add('explode');
    if (this.deriveDeaths) {
      for (const id of prev.alive) {
        const now = s.players.find((p) => p.id === id);
        if (now && !now.alive) out.add('die');
      }
    }
    for (const key of prev.items) if (!cur.items.has(key)) out.add('pickup');
    if (this.winFromTick !== undefined && s.tick >= this.winFromTick) {
      this.winFromTick = undefined;
      out.add('win');
    }
    return [...out];
  }
}
