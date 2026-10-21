import { readFileSync } from 'node:fs';
import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { SheetFrame } from '../assets/sheetFrames';

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

  it('uses the 16px NES sprite sheet with no spacing', () => {
    expect(arena.tilesets).toHaveLength(1);
    expect(arena.tilesets[0]).toMatchObject({
      name: 'tileset',
      image: 'tileset.png',
      imagewidth: 224,
      imageheight: 368,
      tilewidth: 16,
      tileheight: 16,
      tilecount: 322,
      columns: 14,
      spacing: 0,
    });
  });

  it('ships the tileset and credits its source', () => {
    const image = readFileSync(new URL('../../public/tiles/tileset.png', import.meta.url));
    expect(image.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
    expect(image.readUInt32BE(16)).toBe(224);
    expect(image.readUInt32BE(20)).toBe(368);
    expect(readFileSync(new URL('../../assets/CREDITS.md', import.meta.url), 'utf8')).toContain(
      'spriters-resource.com/nes/bomberman/asset/7884',
    );
  });

  it('has the wall border and pillars matching the server board rule (D23)', () => {
    const { data } = arena.layers[0] as { data: number[] };
    const floorGid = SheetFrame.floor + 1;
    const wallGid = SheetFrame.wall + 1;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const border = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
        const wall = border || (x % 2 === 0 && y % 2 === 0);
        expect(data[y * GRID_WIDTH + x]).toBe(wall ? wallGid : floorGid);
      }
    }
  });
});
