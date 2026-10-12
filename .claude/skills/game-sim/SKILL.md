---
name: game-sim
description: วิธีเขียน game logic แบบ deterministic ของ Booberman ใน apps/worker/src/game — simulate() pure function, seeded PRNG, กติกากระดาน/ระเบิด/ไฟ/กล่อง/item/ชนะ, คำสาป, kill attribution และวิธี test ใช้เมื่อทำใบ any-dev หรือแตะ src/game ไม่ว่าจะเป็น BE Dev หรือ FE Dev
---

# Game simulation — Booberman

`apps/worker/src/game/` คือหัวใจของเกม server รันมันทุก tick (20Hz = 50ms) ส่วน client แค่วาดผล ต้อง **deterministic**: state + inputs + seed เดิม → ผลเดิมทุกครั้ง

## สัญญาหลัก
```ts
export function simulate(state: GameState, inputs: ReadonlyMap<PlayerId, PlayerInput>, cfg: GameConfig): StepResult
// StepResult = { state: GameState; events: GameEvent[] }   // events: bombPlaced, exploded, boxBroken, itemPicked, died, kill, roundEnd …
```
- **pure:** ไม่แก้ object ที่รับเข้ามา (คืน state ใหม่ หรือ clone ก่อนแก้) · ไม่มี I/O
- **ห้าม** `Math.random`, `Date.now`, `performance.now`, `crypto`, Workers API, `console` ใน loop หลัก — เวลาคือ `state.tick` ความสุ่มมาจาก PRNG ใน state
- ทุกค่าที่ปรับได้ (ขนาดกระดาน, เวลาระเบิด, ระยะไฟ, โอกาสดรอป item, cooldown คำสาป) อยู่ใน `GameConfig` ไม่ hardcode

## Seeded PRNG
ใช้ mulberry32 (หรือเทียบเท่า) เก็บ seed ปัจจุบันไว้ใน state ทุกครั้งที่สุ่ม → อัปเดต seed ใน state ใหม่
```ts
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}
```
รอบใหม่ = seed ใหม่ที่ server สุ่มนอก `src/game` แล้วส่งเข้ามา

## ลำดับในหนึ่ง tick (ตายตัว — เปลี่ยนต้องลง Decision log)
1. apply input (เรียงตาม playerId เพื่อให้ผลไม่ขึ้นกับลำดับ Map) → การเดิน (ชนกำแพง/กล่อง/ระเบิด) → วางระเบิด
2. นับถอยหลังระเบิด → ระเบิดที่ถึงเวลา + chain reaction (ระเบิดโดนไฟแตกใน tick เดียวกัน)
3. ไฟ: กระจาย 4 ทิศตามระยะ หยุดที่กำแพง · กล่องโดนไฟ → แตก (ไฟหยุดที่กล่อง) → สุ่มดรอป item
4. ผู้เล่นโดนไฟ → ตาย + บันทึก **killer = ownerId ของระเบิดต้นทาง** (chain → นับให้เจ้าของระเบิดลูกแรกที่จุด chain; ตายเอง = suicide)
5. เก็บ item / คำสาป (ส่งต่อเมื่อชนกัน + cooldown) → เช็กจบรอบ (เหลือ ≤1 คน หรือหมดเวลา → ชนะ / เสมอ)

## Test (vitest)
- test ทุกกติกาด้วยกระดานเล็กที่สร้างจาก string อ่านง่าย:
  ```ts
  const s = board(`
    #####
    #A.B#
    #.x.#
    #####`); // # กำแพง, x กล่อง, A/B ผู้เล่น
  ```
- **determinism test:** รัน 500 tick ด้วย input สุ่ม (จาก PRNG ของ test เอง) สองรอบด้วย seed เดียวกัน → state สุดท้าย `toEqual` กัน
- edge case ที่ต้องมี: chain 3 ลูก, ไฟสองลูกทับช่องเดียว, ผู้เล่นสองคนเดินเข้าช่องเดียวพร้อมกัน, ตายพร้อมกันทุกคน (เสมอ), วางระเบิดตอนยืนบนระเบิด
- coverage ของ `src/game` ควร ≥ 90%

## เมื่อเป็นใบ any-dev (D13)
- FE Dev ทำได้ — แตะได้เฉพาะ `apps/worker/src/game/` + test (+ `packages/protocol` เฉพาะที่ใบระบุ)
- comment ขึ้นต้นด้วยชื่อ Dev ที่ทำ เพื่อไม่ให้อีกคนหยิบซ้ำ
- เปลี่ยน shape ของ state ที่ส่งเป็น snapshot → แจ้งในใบ FE ที่วาดด้วย
