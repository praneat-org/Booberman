---
description: รัน graph ของ Booberman 1 รอบ — /tick be | /tick fe | /tick (ทั้งคู่)
argument-hint: "[be|fe]"
---

รัน 1 tick ของ graph ตาม doc "Graph spec: Booberman" ใน Linear

ทีมที่เลือก: `$ARGUMENTS` (ว่าง = ทั้งสองทีม)

| argument | ลำดับ |
| -- | -- |
| `be` | `be-dev` → `qa` (scope: Backend) → `jira-sync` → Project Update |
| `fe` | `fe-dev` → `qa` (scope: Frontend) → `jira-sync` → Project Update |
| ว่าง | `be-dev` → `fe-dev` → `qa` (scope: ทั้งสองทีม) → `jira-sync` → Project Update |

argument อื่นนอกจาก `be` / `fe` / ว่าง → หยุดแล้วบอกวิธีใช้ ไม่ต้องรันอะไร

ตอนเรียก `qa` ให้บอก scope ในคำสั่งชัด ๆ เช่น "scope: Backend" — QA จะแตะเฉพาะ sub-issue ของทีมนั้น

เรียกทีละตัวตามลำดับ (ห้ามขนาน — QA ต้องเห็นงานที่ Dev เพิ่งส่ง และ Jira Sync ต้องเห็นผลของ QA)

จบแล้วสรุปเป็นตารางสั้น ๆ: node · ใบที่แตะ · status เดิม → ใหม่ · ลิงก์ PR · สิ่งที่ติดอยู่ (เช่น รอ human-task, รอใบของอีกทีม, รอตัดสิน Q ใน Decision log)

ต่อท้ายด้วย **"รอคน"** — สิ่งที่คนต้องทำก่อน tick หน้าจะไปต่อได้:
- PR ที่ติด `ready-to-merge` (ลิงก์ PR) → อ่านสรุปท้าย PR แล้ว approve + merge เอง
- ใบที่ติด `needs-human` → ตัดสินแล้วเอา label ออก
- ใบ `human-task` ที่กำลัง block งานใน scope นี้

## Project Update (ทุกรอบ ทำหลัง jira-sync)
โพสต์ Project Update ใน Linear project "Booberman Sprint 1" (`save_status_update`, type `project`) เพื่อให้คนที่ subscribe project เห็น progress ใน Inbox

- รอบนี้ไม่มีอะไรเปลี่ยนเลย (ไม่มีใบเปลี่ยน status, ไม่มี PR ใหม่) → **ไม่ต้องโพสต์**
- health: `onTrack` ปกติ · `atRisk` ถ้ามีใบ `needs-human`, ใบ critical-path ค้างรอคนเกิน 1 วัน หรือ milestone ถัดไปเหลือเวลาน้อยกว่างานที่เหลือ · `offTrack` ถ้า sprint goal (M4) ไปไม่ทันแน่
- เนื้อหา (ภาษาไทย สั้น อ่านจบใน 30 วินาที):
  ```
  **Tick <be|fe|ทั้งคู่> · <วันที่ เวลา>**

  ✅ เสร็จ: <ใบที่เป็น Done รอบนี้ + PR ที่ merge>
  🔍 รอ merge: <ใบที่ติด ready-to-merge + ลิงก์ PR>
  🛠 กำลังทำ: <ใบ In Progress / In Review / CodeRabbit>
  ⛔ ติด: <needs-human, human-task ที่ block, Q ที่รอตัดสิน>

  Milestone: M1 x/y · M2 x/y · M3 x/y   (นับ sub-issue Done / ทั้งหมด ไม่นับ Canceled)
  ```
- ห้ามใส่ secret / token / log ยาว ๆ
