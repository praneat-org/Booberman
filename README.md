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

<!-- CodeRabbit probe: ตรวจว่า CodeRabbit เห็น repo — PR นี้จะถูกปิดโดยไม่ merge -->
