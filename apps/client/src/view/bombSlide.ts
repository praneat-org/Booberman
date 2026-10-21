import type { SnapshotMessage } from '../net/Transport';

type BombState = SnapshotMessage['bombs'][number];

/** The server moves a kicked bomb one tile every 2 ticks (`bombSlideTicksPerTile`). */
export const SLIDE_TICKS_PER_TILE = 2;

type SlideDir = NonNullable<BombState['slide']>;
const VEC: Record<SlideDir, readonly [number, number] | undefined> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

interface Track {
  x: number;
  y: number;
  slide: SlideDir;
  /** Tile it hopped from, and the (render-clock) tick the hop was first seen on. */
  fromX: number;
  fromY: number;
  hopTick: number;
}

/**
 * Smooths kicked bombs (FE-23). Snapshots carry whole tiles (D16): a sliding bomb jumps one tile
 * every 2 ticks and says which way it goes in `slide`. Each time a sliding bomb is seen on a new
 * tile, it is drawn gliding there from the previous one over `SLIDE_TICKS_PER_TILE` ticks, so
 * consecutive hops join into one steady glide. A bomb first seen already sliding (the kick tick)
 * came from one tile behind. Bombs that do not slide are drawn on their tile. Pure state, the
 * clock (`renderTick`, fractional server ticks from the SnapshotBuffer) is passed in.
 */
export class BombSlideTween {
  private tracks: Track[] = [];

  /** Drawn tile position for each bomb, same order as `bombs`. `tick` = the snapshot's tick. */
  update(
    bombs: readonly BombState[],
    tick: number,
    renderTick: number,
  ): { x: number; y: number }[] {
    const old = this.tracks;
    const used = new Set<Track>();
    const next: Track[] = [];
    const out = bombs.map((b) => {
      if (!b.slide) return { x: b.x, y: b.y };
      const [dx, dy] = VEC[b.slide] as readonly [number, number];
      const free = (t: Track) => !used.has(t) && t.slide === b.slide;
      // a bomb that did not move keeps its own track first: only then is it the one behind hopping in
      const prev =
        old.find((t) => free(t) && t.x === b.x && t.y === b.y) ??
        old.find((t) => free(t) && t.x + dx === b.x && t.y + dy === b.y);
      let track: Track;
      if (prev && prev.x === b.x && prev.y === b.y) track = prev;
      else
        track = {
          x: b.x,
          y: b.y,
          slide: b.slide,
          fromX: prev ? prev.x : b.x - dx,
          fromY: prev ? prev.y : b.y - dy,
          // a hop is drawn from the tick it is first seen on (never later than the render time)
          hopTick: Math.min(tick, renderTick),
        };
      if (prev) used.add(prev);
      next.push(track);
      const p = Math.min(1, Math.max(0, (renderTick - track.hopTick) / SLIDE_TICKS_PER_TILE));
      return { x: track.fromX + (b.x - track.fromX) * p, y: track.fromY + (b.y - track.fromY) * p };
    });
    this.tracks = next;
    return out;
  }

  reset(): void {
    this.tracks = [];
  }
}
