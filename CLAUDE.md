# Booberman — สำหรับ Claude

- pnpm monorepo: `apps/client` (Phaser 3 + Vite), `apps/worker` (Cloudflare Worker + DO), `packages/protocol` (shared types)
- ก่อนส่งงานทุกครั้ง: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` จาก root ต้องผ่าน
- แก้ format อัตโนมัติ: `pnpm format`
- เพิ่ม dependency: `pnpm --filter @booberman/<pkg> add <dep>` (ห้าม `npm install`) · pin เวอร์ชันตรง ไม่ใช้ `^`
- `packages/protocol` ห้าม import Phaser / DOM / Workers API · breaking change ต้อง bump `PROTOCOL_VERSION`
- skill: `phaser-client` (apps/client), `cloudflare-worker` (apps/worker), `game-sim` (apps/worker/src/game)
- Git Flow: branch `feature/<CAR-key>-<Linear ID>-<slug>` จาก `develop` · PR เข้า `develop` · คน merge เท่านั้น
