import { z } from 'zod';

/** Arena size in tiles (CAR-3787: 13×11). */
export const GRID_WIDTH = 13;
export const GRID_HEIGHT = 11;

/**
 * One character per tile, row by row from the top-left:
 * `#` wall (never breaks) · `x` box (breaks, may drop an item) · `.` floor.
 */
export const Tile = { Wall: '#', Box: 'x', Floor: '.' } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const Grid = z
  .string()
  .regex(new RegExp(`^[#x.]{${GRID_WIDTH * GRID_HEIGHT}}$`), 'grid must be 13×11 tiles of # x .');

/** Tile coordinate on the board. */
export const TileX = z
  .number()
  .int()
  .min(0)
  .max(GRID_WIDTH - 1);
export const TileY = z
  .number()
  .int()
  .min(0)
  .max(GRID_HEIGHT - 1);

/** Player position may be between tiles while walking (server decides). */
export const PosX = z.number().min(0).max(GRID_WIDTH);
export const PosY = z.number().min(0).max(GRID_HEIGHT);

export const Seed = z.number().int().min(0).max(0xffffffff);

export function tileAt(grid: string, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) return undefined;
  return grid[y * GRID_WIDTH + x] as Tile | undefined;
}
