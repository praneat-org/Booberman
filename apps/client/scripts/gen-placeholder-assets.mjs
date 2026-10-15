// Generates original placeholder pixel art (own work, CC0) until the Kenney pack
// is dropped in (D11). Run: node apps/client/scripts/gen-placeholder-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const T = 16;

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// tileset: [floor, wall]
const FLOOR = [
  [58, 74, 58, 255],
  [52, 68, 52, 255],
];
const WALL = { fill: [96, 100, 120, 255], hi: [140, 146, 170, 255], lo: [64, 68, 86, 255] };
const tileset = png(T * 2, T, (x, y) => {
  const tile = Math.floor(x / T);
  const lx = x % T;
  if (tile === 0) return FLOOR[((lx >> 3) + (y >> 3)) % 2];
  if (lx === 0 || y === 0) return WALL.hi;
  if (lx === T - 1 || y === T - 1) return WALL.lo;
  return WALL.fill;
});

// player sheet: 4 frames (down, up, left, right) 16x16, simple round bomber
const BODY = [230, 230, 240, 255];
const OUTLINE = [30, 30, 50, 255];
const VISOR = [60, 160, 220, 255];
const player = png(T * 4, T, (x, y) => {
  const f = Math.floor(x / T);
  const lx = (x % T) - 7.5;
  const ly = y - 8.5;
  const d = Math.hypot(lx, ly);
  if (d > 6.5) return [0, 0, 0, 0];
  if (d > 5.5) return OUTLINE;
  const faceX = f === 2 ? -3 : f === 3 ? 3 : 0;
  const faceY = f === 1 ? -3 : 2;
  const inVisor = Math.abs(lx - faceX) < 3.5 && Math.abs(ly - faceY) < 2;
  return f === 1 && inVisor ? BODY : inVisor ? VISOR : BODY;
});

// arena: 13x11, border + (even,even) pillars are walls (Tiled ids are 1-based: 1 floor, 2 wall)
const W = 13;
const H = 11;
const data = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const wall = x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0);
    data.push(wall ? 2 : 1);
  }
}
const arena = {
  compressionlevel: -1,
  height: H,
  width: W,
  infinite: false,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  tileheight: T,
  tilewidth: T,
  type: 'map',
  version: '1.10',
  tiledversion: '1.10.2',
  nextlayerid: 2,
  nextobjectid: 1,
  tilesets: [
    {
      firstgid: 1,
      name: 'tileset',
      image: 'tileset.png',
      imagewidth: T * 2,
      imageheight: T,
      tilewidth: T,
      tileheight: T,
      tilecount: 2,
      columns: 2,
      margin: 0,
      spacing: 0,
    },
  ],
  layers: [
    {
      id: 1,
      name: 'ground',
      type: 'tilelayer',
      width: W,
      height: H,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      data,
    },
  ],
};

for (const d of ['tiles', 'sprites', 'maps']) mkdirSync(join(root, d), { recursive: true });
writeFileSync(join(root, 'tiles/tileset.png'), tileset);
writeFileSync(join(root, 'sprites/player.png'), player);
// pretty-printed; run `pnpm format` afterwards so biome wraps the tile data array
writeFileSync(join(root, 'maps/arena.json'), `${JSON.stringify(arena, null, 2)}\n`);
console.log('placeholder assets written to', root);
