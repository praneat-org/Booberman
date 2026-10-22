# Booberman

Bomberman ฉบับแกล้งเพื่อน เล่นหลายคนบนเว็บ บน Cloudflare (Workers, Durable Objects, KV, R2, D1)

- Jira: epic CAR-3782 · Linear: project "Booberman Sprint 1" (workspace Praneat)
- Agent: `.claude/agents/` (be-dev, fe-dev = Sonnet · qa = Opus · jira-sync) · skill: `.claude/skills/`
- รัน graph: `/tick be`, `/tick fe` หรือ `/tick`

## Setup

ต้องมี Node 22 (`.nvmrc`) และ corepack

```sh
corepack enable
pnpm install
pnpm dev        # client http://localhost:5173 · worker http://localhost:8787
```

## คำสั่งจาก root

| คำสั่ง | ทำอะไร |
| -- | -- |
| `pnpm dev` | รัน client (Vite) และ worker (wrangler dev) พร้อมกัน |
| `pnpm build` | build client → `apps/client/dist` · worker dry-run → `apps/worker/dist` |
| `pnpm typecheck` | `tsc --noEmit` ทุก package |
| `pnpm test` | vitest ทุก package |
| `pnpm lint` | Biome (lint + format check) · แก้อัตโนมัติด้วย `pnpm format` |

## ผลแมตช์ใน D1 (ดู balance หลัง playtest)

ทุกรอบที่จบ RoomDO เขียน 1 แถวใน `matches` + 1 แถวต่อผู้เล่นใน `match_players` (migration `apps/worker/migrations/0002_matches.sql`) · เขียนแบบไม่รอ (D12): ถ้า D1 ล่ม เกมเล่นต่อได้ แต่รอบนั้นไม่มีแถว (ดู log `match-save`) · ชื่อซ้ำในห้อง → ตัวหลังเก็บเป็น `ชื่อ#2`, `ชื่อ#3`

```sh
cd apps/worker
# ลองกับ D1 ในเครื่อง (หลังรัน pnpm dev สักรอบ หรือ apply เอง)
pnpm exec wrangler d1 migrations apply DB --local
# บน env จริง: --env dev --remote  (หรือ --env production --remote)
```

**สัดส่วนการตายจากคำสาป** (ทุกแมตช์รวมกัน) — `deaths` คือการตายทุกแบบ, `curse_kills` คือการตายที่เครดิตให้คนส่งคำสาป, `self_kills` คือเครดิตตกกับผู้ตายเอง:

```sh
pnpm exec wrangler d1 execute DB --local --command "SELECT SUM(deaths) AS deaths, SUM(curse_kills) AS curse_deaths, SUM(self_kills) AS self_deaths, SUM(deaths) - SUM(curse_kills) - SUM(self_kills) AS bomb_deaths, ROUND(100.0 * SUM(curse_kills) / NULLIF(SUM(deaths), 0), 1) AS curse_pct FROM match_players"
```

- `bomb_deaths` = ระเบิดของคนอื่นที่ไม่ผ่านคำสาป (รวมการตายที่เครดิตเป็นของคนที่ออกจากห้องไปแล้ว, D33 — ไม่มีใครได้ `kills` แต่ผู้ตายยังได้ `deaths`)
- นับรวมรอบที่เล่นคนเดียว (ไม่มีคู่แข่ง, D32) ถ้าอยากตัดออก ให้ join `matches` แล้วเอาเฉพาะ `match_id` ที่มีผู้เล่น ≥ 2 แถว

## โครงสร้าง

```
apps/client      @booberman/client    Phaser 3 + Vite (static files)
apps/worker      @booberman/worker    Cloudflare Worker + RoomDO
packages/protocol @booberman/protocol shared types / schema — ห้าม import Phaser หรือ Workers API
```

## Setup สำหรับรัน graph

1. ติดตั้ง [Claude Code](https://claude.com/claude-code), `gh` (login แล้ว) และทำ Setup ด้านบน
2. เปิด `claude` ใน repo นี้ → อนุมัติ MCP จาก `.mcp.json` → `/mcp` แล้ว login Linear (workspace Praneat) กับ Atlassian
3. `/tick be` หรือ `/tick fe`
