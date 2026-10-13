import { GRID_HEIGHT, GRID_WIDTH, Grid, tileAt } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { createBoard, SPAWNS } from './board';
import { GAME_CONFIG } from './config';
import { createInitialState } from './state';

const SEEDS = [0, 1, 7, 42, 1234, 99999, 0xffffffff];
const tiles = (grid: string) =>
  [...grid].map((t, i) => ({ t, x: i % GRID_WIDTH, y: Math.floor(i / GRID_WIDTH) }));

describe('createBoard', () => {
  it('same seed → same board and same rngSeed', () => {
    for (const seed of SEEDS) expect(createBoard(seed)).toEqual(createBoard(seed));
  });

  it('different seeds give different boards', () => {
    const grids = new Set(SEEDS.map((s) => createBoard(s).grid));
    expect(grids.size).toBeGreaterThan(1);
  });

  it('is a valid protocol grid (13×11 of # x .)', () => {
    for (const seed of SEEDS) expect(Grid.safeParse(createBoard(seed).grid).success).toBe(true);
  });

  it('walls sit on the border and on every (even, even) tile — and nowhere else', () => {
    for (const seed of SEEDS) {
      for (const { t, x, y } of tiles(createBoard(seed).grid)) {
        const border = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
        expect(t === '#', `seed ${seed} (${x},${y})`).toBe(border || (x % 2 === 0 && y % 2 === 0));
      }
    }
  });

  it('spawn corners and the tiles next to them have no box', () => {
    const W = GRID_WIDTH - 2;
    const H = GRID_HEIGHT - 2;
    const clear = [
      [1, 1],
      [2, 1],
      [1, 2],
      [W, 1],
      [W - 1, 1],
      [W, 2],
      [1, H],
      [2, H],
      [1, H - 1],
      [W, H],
      [W - 1, H],
      [W, H - 1],
    ] as const;
    for (const seed of SEEDS) {
      const { grid } = createBoard(seed);
      for (const [x, y] of clear) expect(tileAt(grid, x, y), `seed ${seed} (${x},${y})`).toBe('.');
      for (const [x, y] of Object.values(SPAWNS)) expect(tileAt(grid, x, y)).toBe('.');
    }
  });

  it('box density is close to boxChance on free tiles (config drives it)', () => {
    let boxes = 0;
    let free = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const { t, x, y } of tiles(createBoard(seed).grid)) {
        const fixed =
          x === 0 ||
          y === 0 ||
          x === GRID_WIDTH - 1 ||
          y === GRID_HEIGHT - 1 ||
          (x % 2 === 0 && y % 2 === 0);
        if (fixed || t === '#') continue;
        free++;
        if (t === 'x') boxes++;
      }
    }
    expect(boxes / free).toBeGreaterThan(0.6);
    expect(boxes / free).toBeLessThan(GAME_CONFIG.boxChance + 0.05);
    expect(createBoard(5, { ...GAME_CONFIG, boxChance: 0 }).grid).not.toContain('x');
    expect(createBoard(5, { ...GAME_CONFIG, boxChance: 1 }).grid.split('x').length).toBeGreaterThan(
      50,
    );
  });

  it('advances the PRNG so later draws do not repeat the board draws', () => {
    expect(createBoard(3).rngSeed).not.toBe(3);
    expect(createInitialState(3, ['p1']).rngSeed).toBe(createBoard(3).rngSeed);
  });
});

describe('createInitialState board', () => {
  it('uses the board built from the seed and keeps the match seed', () => {
    const s = createInitialState(42, ['p1', 'p2']);
    expect(s.grid).toBe(createBoard(42).grid);
    expect(s.seed).toBe(42);
  });
});
