import { existsSync, readFileSync } from 'node:fs';
import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { KenneyFrame } from '../assets/kenneyTinyDungeon';

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

  it('uses Kenney Tiny Dungeon tilemap dimensions and spacing', () => {
    expect(arena.tilesets).toHaveLength(1);
    expect(arena.tilesets[0]).toMatchObject({
      name: 'tileset',
      image: 'tileset.png',
      imagewidth: 203,
      imageheight: 186,
      tilewidth: 16,
      tileheight: 16,
      tilecount: 132,
      columns: 12,
      spacing: 1,
    });
  });

  it('ships the CC0 source tilemap and license', () => {
    const image = readFileSync(new URL('../../public/tiles/tileset.png', import.meta.url));
    expect(image.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    expect(image.readUInt32BE(16)).toBe(203);
    expect(image.readUInt32BE(20)).toBe(186);
    expect(
      existsSync(new URL('../../assets/LICENSE-kenney-tiny-dungeon.txt', import.meta.url)),
    ).toBe(true);
  });

  it('has the wall border and pillars matching the server board rule (D23)', () => {
    const { data } = arena.layers[0] as { data: number[] };
    const floorGid = KenneyFrame.floor + 1;
    const wallGid = KenneyFrame.wall + 1;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const border = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
        const wall = border || (x % 2 === 0 && y % 2 === 0);
        expect(data[y * GRID_WIDTH + x]).toBe(wall ? wallGid : floorGid);
      }
    }
  });
});
