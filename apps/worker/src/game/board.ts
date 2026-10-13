import { GRID_HEIGHT, GRID_WIDTH, Tile, tileAt } from '@booberman/protocol';
import { GAME_CONFIG, type GameConfig } from './config';
import { nextRandom } from './prng';
import type { PlayerId } from './types';

/** Spawn tiles, one per corner (inside the border wall). */
export const SPAWNS: Readonly<Record<PlayerId, readonly [x: number, y: number]>> = {
  p1: [1, 1],
  p2: [GRID_WIDTH - 2, 1],
  p3: [1, GRID_HEIGHT - 2],
  p4: [GRID_WIDTH - 2, GRID_HEIGHT - 2],
};

/** Spawn tile plus its two neighbours along the walls stay free of boxes. */
function spawnClearSet(): Set<number> {
  const clear = new Set<number>();
  for (const [x, y] of Object.values(SPAWNS)) {
    const sx = x === 1 ? 1 : -1;
    const sy = y === 1 ? 1 : -1;
    for (const [dx, dy] of [
      [0, 0],
      [sx, 0],
      [0, sy],
    ] as const) {
      clear.add((y + dy) * GRID_WIDTH + (x + dx));
    }
  }
  return clear;
}

const isFixedWall = (x: number, y: number) =>
  x === 0 ||
  y === 0 ||
  x === GRID_WIDTH - 1 ||
  y === GRID_HEIGHT - 1 ||
  (x % 2 === 0 && y % 2 === 0);

/**
 * Board for one round. Border and (even, even) tiles are walls, spawn corners
 * stay clear, every other tile is a box with probability `cfg.boxChance`.
 * Returns the PRNG seed to keep in `GameState.rngSeed`.
 */
export function createBoard(
  seed: number,
  cfg: GameConfig = GAME_CONFIG,
): { grid: string; rngSeed: number } {
  const clear = spawnClearSet();
  let rngSeed = seed >>> 0;
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (isFixedWall(x, y)) {
        grid += Tile.Wall;
      } else if (clear.has(y * GRID_WIDTH + x)) {
        grid += Tile.Floor;
      } else {
        const [r, next] = nextRandom(rngSeed);
        rngSeed = next;
        grid += r < cfg.boxChance ? Tile.Box : Tile.Floor;
      }
    }
  }
  return { grid, rngSeed };
}

/** Only floor can be walked on (walls and boxes block; bombs join in Rules 2/3). */
export const isWalkable = (grid: string, x: number, y: number): boolean =>
  tileAt(grid, x, y) === Tile.Floor;
