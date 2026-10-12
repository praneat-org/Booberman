# Contributing — Booberman

งานทุกชิ้นเริ่มจากใบใน Linear (project "Booberman Sprint 1", workspace Praneat) ที่ผูกกับ Story ใน Jira (epic CAR-3782)
กติกาที่ตกลงแล้วอยู่ใน **Decision log** ของ project ใน Linear (D ล่าสุดชนะ AC)

## Git Flow

| Branch | แตกจาก | merge กลับเข้า | deploy ไป |
| -- | -- | -- | -- |
| `main` | | | production (เมื่อมี merge) |
| `develop` (default) | `main` | | env dev (เมื่อมี merge) |
| `feature/<CAR-key>-<Linear ID>-<slug>` | `develop` | `develop` | |
| `release/<version>` | `develop` | `main` และ `develop` | |
| `hotfix/<CAR-key>-<slug>` | `main` | `main` และ `develop` | |

```
feature/CAR-3790-BE-28-roomdo-join ──PR──► develop ──► env dev
                                              │
                                   release/0.1.0 (แก้บั๊กก่อนปล่อยเท่านั้น)
                                              ├──PR──► main ──► tag v0.1.0 ──► production
                                              └──PR──► develop (back-merge)

hotfix/CAR-xxxx-... แตกจาก main ──PR──► main + develop
```

### ชื่อ branch
`feature/<Jira key ของ Story>-<Linear ID ของใบย่อย>-<slug>` เช่น `feature/CAR-3790-BE-28-roomdo-join`
- Jira key → Jira / CodeRabbit ผูก PR กับ Story และดึง AC
- Linear ID → Linear / CodeRabbit ผูก PR กับใบย่อย
- slug สั้น ๆ ภาษาอังกฤษตัวเล็ก คั่นด้วย `-`

### Commit
ขึ้นต้นด้วย Linear ID แล้วตามด้วย type แบบ conventional เช่น `BE-28 feat(worker): RoomDO join/leave` · `FE-12 fix(client): ...`

### Merge strategy
- feature → `develop`: **Squash and merge** (1 ใบงาน = 1 commit)
- release / hotfix → `main`: **Create a merge commit** แล้ว tag `vX.Y.Z`
- back-merge `release/*` / `hotfix/*` → `develop`: merge commit
- **คนเป็นคน merge เท่านั้น** — agent ห้าม merge (D14)

## Flow ของ PR (D14)

1. Dev เปิด PR เข้า `develop` เป็น **draft** → ใบใน Linear `In Review`
2. QA ตรวจเทียบ AC → ไม่ผ่าน: ใบกลับ `Todo` · ผ่าน: เปลี่ยน PR เป็น **ready for review** → ใบ `CodeRabbit`
3. CodeRabbit review อัตโนมัติ (ข้าม draft · review ใหม่ทุก push)
   - มี comment ค้าง → ใบกลับ `Todo` ให้ Dev ตอบทุก thread (`fixed <sha>` / `wont-fix: เหตุผล` / `deferred: <ID>`)
   - ไม่มีค้าง → QA สรุปท้าย PR + ลง CodeRabbit decision log → label `ready-to-merge`
4. คน approve + **Squash and merge** → ใบ `Done`
5. Story (parent) ลูกครบ → `In Review` → คนตรวจ AC ทั้ง Story แล้วปิด → Jira `Done`

สั่ง CodeRabbit เองได้ใน comment: `@coderabbitai review` (review commit ใหม่) · `@coderabbitai full review` (ทั้ง PR)

## ก่อนเปิด PR

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
- เพิ่ม dependency: `pnpm --filter @booberman/<pkg> add -E <dep>` (pin เวอร์ชันตรง)
- ห้ามใส่ secret ใน repo / PR / comment — ใช้ `wrangler secret put` หรือ GitHub Secrets

## ออก release

1. `git switch develop && git pull && git switch -c release/0.1.0`
2. แก้ได้เฉพาะบั๊กที่เจอระหว่างเตรียมปล่อย (ไม่เพิ่ม feature)
3. PR `release/0.1.0` → `main` (merge commit) → tag `v0.1.0` บน `main` → deploy production
4. PR `release/0.1.0` → `develop` (merge commit) เพื่อเอา bugfix กลับ
5. ลบ branch `release/0.1.0`

## Hotfix

1. `git switch main && git pull && git switch -c hotfix/CAR-xxxx-<slug>`
2. แก้ + test → PR เข้า `main` (merge commit) → tag patch ถัดไป (เช่น `v0.1.0` → `v0.1.1`) → deploy
3. PR `hotfix/...` เข้า `develop` (merge commit) ให้ develop มี fix ด้วย
