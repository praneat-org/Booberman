# Booberman

Bomberman ฉบับแกล้งเพื่อน เล่นหลายคนบนเว็บ บน Cloudflare (Workers, Durable Objects, KV, R2, D1)

- Jira: epic CAR-3782 · Linear: project "Booberman Sprint 1" (workspace booberman)
- Agent: `.claude/agents/` (be-dev, fe-dev = Sonnet · qa = Opus · jira-sync)
- รัน graph: `/tick be`, `/tick fe` หรือ `/tick`

## Setup สำหรับรัน graph

1. ติดตั้ง [Claude Code](https://claude.com/claude-code), `gh` (login แล้ว), Node ตาม `.nvmrc`, pnpm
2. เปิด `claude` ใน repo นี้ → อนุมัติ MCP จาก `.mcp.json` → `/mcp` แล้ว login Linear (workspace booberman) กับ Atlassian
3. `/tick be` หรือ `/tick fe`
