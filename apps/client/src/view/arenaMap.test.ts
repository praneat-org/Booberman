import { readFileSync } from 'node:fs';
import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';

const arena = JSON.parse(
  readFileSync(new URL('../../public/maps/arena.json', import.meta.url), 'utf8'),
);

describe('public/maps/arena.json', () => {
  it('is a 13x11 grid of 16px tiles with a ground layer', () => {
    expect(arena.width).toBe(GRID_WIDTH);
    expect(arena.height).toBe(GRID_HEIGHT);
    expect(arena.tilewidth).toBe(16);
    expect(arena.tileheight).toBe(16);
    const ground = arena.layers.find((l: { name: string }) => l.name === 'ground');
    expect(ground.data).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
  });

  it('has wall border and (even, even) pillars matching the server board rule (D23)', () => {
    const { data } = arena.layers[0] as { data: number[] };
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const border = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
        const wall = border || (x % 2 === 0 && y % 2 === 0);
        expect(data[y * GRID_WIDTH + x]).toBe(wall ? 2 : 1);
      }
    }
  });
});
