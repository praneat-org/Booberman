---
name: cloudflare-worker
description: วิธีเขียน apps/worker ของ Booberman บน Cloudflare — Worker routing, Durable Object RoomDO แบบ WebSocket hibernation, tick loop ที่หยุดเมื่อห้องว่าง, KV lobby, D1, R2, Workers Static Assets, wrangler.jsonc env dev/production และวิธีทดสอบ ใช้ทุกครั้งที่แตะ apps/worker, wrangler.jsonc หรือ migration
---

# Cloudflare Worker — Booberman

เวอร์ชัน: wrangler 4 · `compatibility_date` ล่าสุดตอนสร้าง (ห้ามถอยหลัง) · TypeScript strict · type ของ binding gen ด้วย `wrangler types`

## โครงไฟล์
```
apps/worker/
  wrangler.jsonc
  src/index.ts        # fetch handler: route /api/*, /ws/room/:id → RoomDO, อย่างอื่น → static assets
  src/room/RoomDO.ts  # Durable Object 1 ตัว = 1 ห้อง
  src/game/           # pure simulate() — ดู skill game-sim (ห้ามใช้ Workers API ในนี้)
  src/lobby/          # KV room list
  migrations/         # D1 SQL (0001_xxx.sql)
```

## wrangler.jsonc (หลัก)
```jsonc
{
  "name": "booberman",
  "main": "src/index.ts",
  "compatibility_date": "<วันที่ล่าสุด>",
  "assets": {
    "directory": "../client/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ws/*"]
  },
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "RoomDO" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RoomDO"] }],
  "env": { "production": { /* binding ของ prod แยก id */ } }
}
```
- binding ทุกตัวต้องประกาศซ้ำในแต่ละ `env` (ไม่ inherit) · id ของ KV / D1 ห้ามเป็น secret แต่ token เป็น secret เสมอ
- เปลี่ยน class DO → เพิ่ม migration tag ใหม่ ห้ามแก้ tag เก่า

## RoomDO + WebSocket hibernation
```ts
export class RoomDO extends DurableObject<Env> {
  async fetch(req: Request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);                 // hibernation API (ห้ามใช้ server.accept())
    server.serializeAttachment({ playerId, nickname }); // state ต่อ socket รอด hibernation
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) { const msg = parseClientMessage(raw); … }
  async webSocketClose(ws: WebSocket, code: number) { … ถ้าห้องว่าง → หยุด tick }
  async webSocketError(ws: WebSocket) { … }
}
```
- รายชื่อคนในห้อง = `this.ctx.getWebSockets()` + `ws.deserializeAttachment()` · ห้ามเก็บไว้แค่ใน field ของ class เพราะหายตอน hibernate
- state ที่ต้องรอด (รอบที่เท่าไร, seed) → `this.ctx.storage` · field ใน memory ใช้เป็น cache ได้ และต้องสร้างใหม่ได้ใน constructor
- ping/pong ไม่ปลุก DO: `this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`
- broadcast: วน `getWebSockets()` แล้ว `send` ใน try/catch (socket ที่ปิดแล้วจะ throw)

## Tick loop 20Hz
- เริ่มเมื่อมีผู้เล่นคนแรก ใช้ `setInterval(…, 50)` ได้ (มี socket ที่ active อยู่ DO ไม่ hibernate) · **ล้าง interval ทันทีเมื่อห้องว่าง** — timer ค้าง = จ่ายเงินและ DO ไม่ยอมหลับ
- แต่ละ tick: ดึง input queue → `simulate(state, inputs)` → broadcast snapshot (เฉพาะที่เปลี่ยน) · วัดเวลาต่อ tick แล้ว log p99
- input: เก็บ seq ล่าสุดต่อผู้เล่น ทิ้ง seq เก่า · จำกัดจำนวน message ต่อวินาทีต่อ socket (กัน spam)

## KV / D1 / R2
- **KV (lobby):** eventual consistent ~60s ข้าม region → ใช้แสดงรายการห้องเท่านั้น ไม่ใช้ตัดสินว่าห้องเต็ม (DO เป็นคนตัดสิน) · เขียนไม่เกิน 1 ครั้ง/วินาที/key
- **D1:** เขียนผลจบรอบด้วย `env.DB.batch([...])` ใน `ctx.waitUntil` — ห้าม await ใน game loop (D12: D1 ล่ม เกมต้องเล่นต่อได้) · migration: `wrangler d1 migrations create/apply`
- **R2:** asset ที่ชื่อมี hash → `Cache-Control: public, max-age=31536000, immutable` · `manifest.json` → cache สั้น

## ทดสอบ
- **unit:** game logic (pure) ด้วย vitest ธรรมดา
- **integration:** `@cloudflare/vitest-plugin` (ชื่อใหม่ของ `vitest-pool-workers` · ตั้งใน `apps/worker/vitest.config.ts` ด้วย `cloudflareTest({ wrangler: { configPath } })`) รัน Worker + DO จริงใน workerd · เปิด socket ด้วย `exports.default.fetch('http://localhost/ws/room/abc', { headers: { Upgrade: 'websocket' } })` (`import { exports, env } from 'cloudflare:workers'`) แล้ว `res.webSocket.accept()` · helper `Client` / `join()` อยู่ใน `apps/worker/test/helpers.ts` · ดูข้างใน DO ด้วย `runInDurableObject`, จำลอง hibernation ด้วย `evictDurableObject` (จาก `cloudflare:test`)
- **มือ / QA:** `pnpm --filter @booberman/worker dev` (wrangler dev ที่ :8787) แล้วยิงด้วย `curl` / script `wscat`-like
- ทุก error ที่ส่งกลับ client ใช้ error code จาก protocol (เช่น `ROOM_FULL`) ไม่ส่ง stack

## กับดัก
- `server.accept()` แทน `ctx.acceptWebSocket` → hibernation ไม่ทำงาน
- ใช้ `Date.now()` / `Math.random()` ใน `src/game/` → simulation ไม่ deterministic (ส่ง time / seed เข้าไปแทน)
- ลืม `run_worker_first` → `/api/*` ตกไปที่ SPA fallback ได้ index.html
- เก็บ secret ใน `wrangler.jsonc` `vars` → ใช้ `wrangler secret put` / GitHub Secrets
