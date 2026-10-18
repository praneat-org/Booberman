import { GRID_HEIGHT, GRID_WIDTH, Tile, tileAt } from '@booberman/protocol';

export interface TilePos {
  x: number;
  y: number;
}

export const tileKey = (x: number, y: number): string => `${x},${y}`;

/**
 * Boxes on the board as the server told us: the `grid` in `welcome` / `roundStart`, minus every
 * `boxDestroyed` event since. The client never decides a box breaks.
 */
export class BoxField {
  private readonly boxes = new Map<string, TilePos>();

  constructor(grid?: string) {
    if (grid !== undefined) this.reset(grid);
  }

  /** New round (D8): forget everything and read the boxes from the new grid. */
  reset(grid: string): void {
    this.boxes.clear();
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (tileAt(grid, x, y) === Tile.Box) this.boxes.set(tileKey(x, y), { x, y });
      }
    }
  }

  /** `boxDestroyed`; returns false when there was no box there (duplicate event). */
  destroy(x: number, y: number): boolean {
    return this.boxes.delete(tileKey(x, y));
  }

  has(x: number, y: number): boolean {
    return this.boxes.has(tileKey(x, y));
  }

  list(): TilePos[] {
    return [...this.boxes.values()];
  }
}
