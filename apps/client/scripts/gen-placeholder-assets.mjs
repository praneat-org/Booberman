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

// player sheet: 12 frames of 16x16.
// 0-3 idle (down, up, left, right) · 4-11 walk, two frames per direction in the same order
// (down 4-5, up 6-7, left 8-9, right 10-11).
const BODY = [230, 230, 240, 255];
const OUTLINE = [30, 30, 50, 255];
const VISOR = [60, 160, 220, 255];
const player = png(T * 12, T, (x, y) => {
  const f = Math.floor(x / T);
  const dir = f < 4 ? f : Math.floor((f - 4) / 2);
  const step = f < 4 ? -1 : (f - 4) % 2;
  const bob = step === 0 ? -1 : 0;
  const lx = (x % T) - 7.5;
  const ly = y - 8.5 - bob;
  // feet: alternate left / right foot forward while walking
  if (step >= 0 && y >= 13 && y <= 14) {
    const fx = (x % T) - 7.5;
    const left = step === 0 ? Math.abs(fx + 3) < 1.6 : Math.abs(fx + 3) < 1.6 && y === 13;
    const right = step === 1 ? Math.abs(fx - 3) < 1.6 : Math.abs(fx - 3) < 1.6 && y === 13;
    if (left || right) return OUTLINE;
  }
  const d = Math.hypot(lx, ly);
  if (d > 6.5) return [0, 0, 0, 0];
  if (d > 5.5) return OUTLINE;
  const faceX = dir === 2 ? -3 : dir === 3 ? 3 : 0;
  const faceY = dir === 1 ? -3 : 2;
  const inVisor = Math.abs(lx - faceX) < 3.5 && Math.abs(ly - faceY) < 2;
  return dir === 1 && inVisor ? BODY : inVisor ? VISOR : BODY;
});

// box: wooden crate
const crate = png(T, T, (x, y) => {
  if (x === 0 || y === 0 || x === T - 1 || y === T - 1) return [74, 46, 24, 255];
  if (x === y || x === T - 1 - y) return [140, 96, 52, 255];
  if (x === 1 || y === 1) return [196, 148, 88, 255];
  return [170, 122, 68, 255];
});

// bomb: 2 frames (normal, bright flash)
const bomb = png(T * 2, T, (x, y) => {
  const f = Math.floor(x / T);
  const lx = (x % T) - 7.5;
  const ly = y - 9;
  const d = Math.hypot(lx, ly);
  // fuse spark
  if (Math.abs(lx - 3) < 1.2 && y >= 1 && y <= 4)
    return f ? [255, 255, 255, 255] : [255, 200, 60, 255];
  if (d > 6) return [0, 0, 0, 0];
  if (d > 5) return [10, 10, 20, 255];
  if (lx < -1.5 && ly < -1.5 && d < 3.5) return [200, 210, 230, 255]; // highlight
  return f ? [200, 70, 70, 255] : [40, 40, 56, 255];
});

// flame: 2 frames
const flame = png(T * 2, T, (x, y) => {
  const f = Math.floor(x / T);
  const lx = (x % T) - 7.5;
  const ly = y - 7.5;
  const d = Math.max(Math.abs(lx), Math.abs(ly));
  const wob = f ? 1 : 0;
  if (d > 7) return [0, 0, 0, 0];
  if (d > 5.5 - wob) return [220, 70, 30, 255];
  if (d > 3 + wob) return [255, 160, 40, 255];
  return [255, 240, 140, 255];
});

// items: 2 frames (0 curse = purple skull-ish orb, 1 kick = green boot block)
const items = png(T * 2, T, (x, y) => {
  const f = Math.floor(x / T);
  const lx = (x % T) - 7.5;
  const ly = y - 7.5;
  const d = Math.hypot(lx, ly);
  if (d > 6.5) return [0, 0, 0, 0];
  if (d > 5.5) return [20, 20, 30, 255];
  const base = f ? [70, 200, 90, 255] : [160, 70, 210, 255];
  const mark = f
    ? Math.abs(ly - 2) < 1.5 && lx > -3 && lx < 3
    : Math.abs(lx) < 1 && Math.abs(ly) < 3;
  return mark ? [255, 255, 255, 255] : base;
});

// marker: 8x8 downward arrow over our own head
const marker = png(8, 8, (x, y) => {
  const half = 3.5 - y * 0.6;
  if (y < 6 && Math.abs(x - 3.5) <= half + 0.5)
    return y === 0 || Math.abs(Math.abs(x - 3.5) - half) < 0.9
      ? [20, 20, 30, 255]
      : [255, 220, 60, 255];
  return [0, 0, 0, 0];
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
writeFileSync(join(root, 'sprites/box.png'), crate);
writeFileSync(join(root, 'sprites/bomb.png'), bomb);
writeFileSync(join(root, 'sprites/flame.png'), flame);
writeFileSync(join(root, 'sprites/items.png'), items);
writeFileSync(join(root, 'sprites/marker.png'), marker);
// pretty-printed; run `pnpm format` afterwards so biome wraps the tile data array
writeFileSync(join(root, 'maps/arena.json'), `${JSON.stringify(arena, null, 2)}\n`);
console.log('placeholder assets written to', root);
