import { type GameEvent, GRID_WIDTH, PROTOCOL_VERSION, Tile, tileAt } from '@booberman/protocol';
import type { GameConfig } from './config';
import { FLAME_DIRS, VECTORS } from './dirs';
import { nextRandom } from './prng';
import type { Bomb, Flame, Item, PlayerId } from './types';

const tileKey = (x: number, y: number) => y * GRID_WIDTH + x;

export interface BlastInput {
  readonly grid: string;
  /** Bombs after this tick's countdown (fuse <= 0 = due). */
  readonly bombs: readonly Bomb[];
  /** Flames still burning from earlier ticks (already aged). */
  readonly flames: readonly Flame[];
  readonly items: readonly Item[];
  readonly rngSeed: number;
}

export interface BlastResult {
  readonly grid: string;
  readonly bombs: Bomb[];
  /** Old flames first, then the new ones in explosion order. */
  readonly flames: Flame[];
  readonly items: Item[];
  readonly rngSeed: number;
  readonly events: GameEvent[];
}

/** Tiles one bomb reaches: its own tile, then up to `bombRadius` per direction. */
function reach(
  grid: string,
  bomb: Bomb,
  cfg: GameConfig,
): { cells: [number, number][]; boxes: number[] } {
  const cells: [number, number][] = [[bomb.x, bomb.y]];
  const boxes: number[] = [];
  for (const dir of FLAME_DIRS) {
    const [dx, dy] = VECTORS[dir];
    for (let r = 1; r <= cfg.bombRadius; r++) {
      const x = bomb.x + dx * r;
      const y = bomb.y + dy * r;
      const tile = tileAt(grid, x, y);
      if (tile === undefined || tile === Tile.Wall) break;
      cells.push([x, y]);
      if (tile === Tile.Box) {
        boxes.push(tileKey(x, y));
        break; // the flame covers the box tile but does not pass it
      }
    }
  }
  return { cells, boxes };
}

/**
 * Explodes every due bomb plus the whole chain behind it, in one tick.
 *
 * Geometry is decided against the grid as it was at the start of the tick, so which tiles
 * burn never depends on the order bombs are processed in. Only the credit (owner of the
 * flame) depends on order: bombs go off in array order, a chained bomb inherits the credit
 * of whoever set it off, and the first flame to reach a tile or a box keeps it.
 */
export function resolveExplosions(input: BlastInput, cfg: GameConfig): BlastResult {
  const { grid, bombs, flames } = input;
  const credit = new Map<number, PlayerId>(); // bomb index -> who gets the kill
  const queue: number[] = [];
  const enqueue = (i: number, owner: PlayerId) => {
    if (credit.has(i)) return;
    credit.set(i, owner);
    queue.push(i);
  };

  const burning = new Map<number, PlayerId>();
  for (const f of flames) {
    if (!burning.has(tileKey(f.x, f.y))) burning.set(tileKey(f.x, f.y), f.ownerId);
  }
  bombs.forEach((b, i) => {
    if (b.fuse <= 0) {
      enqueue(i, b.ownerId);
      return;
    }
    const fire = burning.get(tileKey(b.x, b.y));
    if (fire !== undefined) enqueue(i, fire);
  });

  const newFlames: Flame[] = [];
  const broken = new Map<number, PlayerId>(); // box tile -> who gets the drop
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const bomb = bombs[i] as Bomb;
    const owner = credit.get(i) as PlayerId;
    const { cells, boxes } = reach(grid, bomb, cfg);
    for (const k of boxes) if (!broken.has(k)) broken.set(k, owner);
    for (const [x, y] of cells) {
      newFlames.push({ x, y, ownerId: owner, ttl: cfg.flameTicks });
      bombs.forEach((other, j) => {
        if (other.x === x && other.y === y) enqueue(j, owner);
      });
    }
  }

  // Boxes break in tile order (not chain order) so the PRNG draws are stable.
  let rngSeed = input.rngSeed;
  const events: GameEvent[] = [];
  const dropped: Item[] = [];
  const tiles = grid.split('');
  for (const k of [...broken.keys()].sort((a, b) => a - b)) {
    tiles[k] = Tile.Floor;
    const x = k % GRID_WIDTH;
    const y = Math.floor(k / GRID_WIDTH);
    events.push({ v: PROTOCOL_VERSION, t: 'event', kind: 'boxDestroyed', x, y });
    const [roll, next] = nextRandom(rngSeed);
    rngSeed = next;
    if (roll < cfg.itemDropChance) {
      dropped.push({ x, y, kind: cfg.dropItemKind, droppedBy: broken.get(k) as PlayerId });
    }
  }

  return {
    grid: tiles.join(''),
    bombs: bombs.filter((_, i) => !credit.has(i)),
    flames: [...flames, ...newFlames],
    items: [...input.items, ...dropped],
    rngSeed,
    events,
  };
}
