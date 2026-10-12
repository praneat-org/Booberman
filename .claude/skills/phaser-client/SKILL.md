---
name: phaser-client
description: วิธีเขียน apps/client ของ Booberman ด้วย Phaser 3 + Vite — scene flow, โหลด asset / tilemap Kenney, pixel art, input มือถือ + keyboard, วาดจาก snapshot ของ server, interpolation, HUD/SFX และวิธีทดสอบ ใช้ทุกครั้งที่แตะโค้ดใน apps/client
---

# Phaser client — Booberman

เวอร์ชันที่ใช้: **Phaser 3.90** (ห้ามขึ้น Phaser 4 เอง — API ต่างกัน ต้องผ่าน Decision log) · Vite · TypeScript strict

## หลักที่ห้ามพลาด
1. **Client ไม่ตัดสินผลเกม** — ไม่คำนวณการตาย, การเก็บ item, การชนะ, การชนของระเบิด · วาดจาก `snapshot` / event ของ server เท่านั้น · ส่งได้แค่ `input`
2. **ทุก message ขาเข้าผ่าน `parseServerMessage`** จาก `@booberman/protocol` ก่อนใช้งาน · message ที่ parse ไม่ผ่าน → log แล้วทิ้ง ไม่ throw
3. **Logic ที่ test ได้อยู่นอก Scene** — interpolation buffer, การแปลง snapshot → view model, การ map input → message เขียนเป็น pure function / class ใน `src/net/`, `src/view/` แล้ว unit test ด้วย vitest · Scene แค่เรียกใช้

## โครงไฟล์
```
apps/client/src/
  main.ts            # new Phaser.Game(config)
  config.ts          # game config (ดูด้านล่าง)
  scenes/            # BootScene → LobbyScene → GameScene (+ HudScene ซ้อนบน GameScene)
  net/               # Transport interface, MockTransport, WsTransport, SnapshotBuffer
  view/              # pure: snapshot → ตำแหน่ง/สถานะที่จะวาด
  assets/            # Kenney CC0 เท่านั้น (D11) + LICENSE ของ pack
```

## Game config
```ts
export const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  pixelArt: true,             // ไม่เบลอ (ห้ามลบ)
  roundPixels: true,
  backgroundColor: '#1b1b2f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 15 * 16, height: 13 * 16 },
  scene: [BootScene, LobbyScene, GameScene, HudScene],
};
```
- ขนาด logical = จำนวน tile × 16 px แล้วให้ `Scale.FIT` ขยาย · ต้องใช้ได้ที่ 360×740 (แนวตั้ง) และ 1280×800
- import: `import Phaser from 'phaser'`

## Scene
- lifecycle: `init(data)` → `preload()` → `create()` → `update(time, delta)` · ส่งข้อมูลข้าม scene ด้วย `this.scene.start('Game', { roomId, nickname })`
- โหลด asset ทั้งหมดใน `BootScene` ครั้งเดียว แสดง progress bar ด้วย `this.load.on('progress', …)`
- ตอน `shutdown` ต้องถอด listener ของ transport / `this.events` / timer ทั้งหมด (`this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)`) ไม่งั้นเข้าห้องรอบสองแล้ว event ซ้อน
- HUD แยกเป็น scene ซ้อน (`this.scene.launch('Hud')`) จะได้ไม่โดนกล้องของ GameScene ขยับ

## Tilemap + sprite (Kenney)
```ts
this.load.tilemapTiledJSON('arena', 'maps/arena.json');
this.load.image('tiles', 'tiles/tileset.png');
this.load.spritesheet('player', 'sprites/player.png', { frameWidth: 16, frameHeight: 16 });
// create()
const map = this.make.tilemap({ key: 'arena' });
const tiles = map.addTilesetImage('tileset', 'tiles')!;
map.createLayer('ground', tiles, 0, 0);
```
- กล่องที่แตกได้ / ระเบิด / ไฟ **ไม่อยู่ใน tilemap** — สร้างเป็น sprite จาก snapshot (server เป็นเจ้าของ state)
- animation สร้างครั้งเดียวใน BootScene: `this.anims.create({ key: 'walk-down', frames: this.anims.generateFrameNumbers('player', { start: 0, end: 2 }), frameRate: 8, repeat: -1 })`
- ตั้งแต่ M3: path asset มาจาก `manifest.json` (ไม่ hardcode ชื่อไฟล์ที่มี hash)

## Input
- keyboard: `this.input.keyboard!.createCursorKeys()` + Space วางระเบิด
- มือถือ: D-pad + ปุ่มระเบิดบนจอ (`setInteractive()` + `pointerdown/pointerup`) ใหญ่พอนิ้ว (≥ 44px จริงบนจอ) · เปิด `this.input.addPointer(2)` ให้กดพร้อมกันได้
- ส่ง input เป็น **สถานะทิศที่กดอยู่ + seq** ทุก tick ที่เปลี่ยน ไม่ส่งตำแหน่ง

## Netcode ฝั่ง client
- `Transport` interface เดียว → `MockTransport` (ใช้กับ `?mock=1`) และ `WsTransport` (`/ws/room/:id`, same origin)
- **SnapshotBuffer**: เก็บ snapshot ตาม server tick · render ย้อนหลัง ~100ms แล้ว lerp ระหว่างสอง snapshot ที่คร่อมเวลานั้น · ระยะเกิน 1.5 tile → snap (teleport) · ไม่มี snapshot ใหม่ → ค้างที่ตัวล่าสุด ไม่ extrapolate
- debug overlay (`?debug=1`): ping, ขนาด buffer, tick ล่าสุด

## เสียง
- เบราว์เซอร์มือถือต้องมี gesture ก่อน — เริ่มเล่นหลังกดปุ่มแรกใน Lobby · ปุ่ม mute จำค่าใน localStorage (ห่อ try/catch)

## ทดสอบ
- **unit (vitest, environment node):** SnapshotBuffer, view model, input mapping, nickname validation — ไม่ import Phaser ในไฟล์ที่ test (Phaser ต้องการ DOM/canvas)
- **รันจริง:** `pnpm dev` แล้วเปิด `http://localhost:5173/?mock=1` · QA ใช้ Playwright ที่ 360×740 และ 1280×800
- expose state ให้ test อ่านได้เฉพาะตอน dev: `if (import.meta.env.DEV) (window as any).__booberman = { scene, buffer }`

## กับดักที่เจอบ่อย
- ลืม `pixelArt: true` → sprite เบลอ
- `this.add.sprite` ทุก snapshot แทนการ reuse → memory รั่ว · เก็บ `Map<id, Sprite>` แล้ว create / update / destroy ตาม diff
- ใช้ `delta` ของ Phaser เป็นเวลาเกม → ผิด · เวลาเกมมาจาก server tick
- เรียก `scene.start` ซ้อนระหว่าง preload → scene ค้าง
