---
description: รัน graph ของ Booberman 1 รอบ — /tick be | /tick fe | /tick (ทั้งคู่)
argument-hint: "[be|fe]"
---

รัน 1 tick ของ graph ตาม doc "Graph spec: Booberman" ใน Linear

ทีมที่เลือก: `$ARGUMENTS` (ว่าง = ทั้งสองทีม)

| argument | ลำดับ |
| -- | -- |
| `be` | `be-dev` → `qa` (scope: Backend) → `jira-sync` |
| `fe` | `fe-dev` → `qa` (scope: Frontend) → `jira-sync` |
| ว่าง | `be-dev` → `fe-dev` → `qa` (scope: ทั้งสองทีม) → `jira-sync` |

argument อื่นนอกจาก `be` / `fe` / ว่าง → หยุดแล้วบอกวิธีใช้ ไม่ต้องรันอะไร

ตอนเรียก `qa` ให้บอก scope ในคำสั่งชัด ๆ เช่น "scope: Backend" — QA จะแตะเฉพาะ sub-issue ของทีมนั้น

เรียกทีละตัวตามลำดับ (ห้ามขนาน — QA ต้องเห็นงานที่ Dev เพิ่งส่ง และ Jira Sync ต้องเห็นผลของ QA)

จบแล้วสรุปเป็นตารางสั้น ๆ: node · ใบที่แตะ · status เดิม → ใหม่ · ลิงก์ PR · สิ่งที่ติดอยู่ (เช่น รอ human-task, รอใบของอีกทีม, รอตัดสิน Q ใน Decision log)

ต่อท้ายด้วย **"รอคน"** — สิ่งที่คนต้องทำก่อน tick หน้าจะไปต่อได้:
- PR ที่ติด `ready-to-merge` (ลิงก์ PR) → อ่านสรุปท้าย PR แล้ว approve + merge เอง
- ใบที่ติด `needs-human` → ตัดสินแล้วเอา label ออก
- ใบ `human-task` ที่กำลัง block งานใน scope นี้
