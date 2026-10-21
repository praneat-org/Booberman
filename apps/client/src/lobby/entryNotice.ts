import { MAX_PLAYERS_PER_ROOM, NICKNAME_MAX_LENGTH } from '@booberman/protocol';
import type { JoinFailureKind } from '../net/joinWatcher';

/** Screens that are a dead end for this room, as opposed to the name form (which can be fixed in place). */
export type NoticeKind = 'NOT_FOUND' | Exclude<JoinFailureKind, 'INVALID_NICKNAME'>;

/** What each button does; the overlay maps these to behaviour. `create` makes a new room and enters it. */
export type NoticeActionId = 'create' | 'retry' | 'reload' | 'home';

export interface NoticeAction {
  id: NoticeActionId;
  label: string;
  primary: boolean;
}

export interface Notice {
  title: string;
  message: string;
  /** First entry is the primary button. Always ends with a way back to the home page. */
  actions: NoticeAction[];
}

const HOME: NoticeAction = { id: 'home', label: 'กลับหน้าแรก', primary: false };
const CREATE: NoticeAction = { id: 'create', label: 'สร้างห้องใหม่', primary: false };

function actions(...list: NoticeAction[]): NoticeAction[] {
  return list.map((a, i) => ({ ...a, primary: i === 0 }));
}

/**
 * Copy for every way a room link can fail (CAR-3792 AC 5: say what happened *and* where to go next).
 * `canCreate` is whether we hold a valid nickname: "create room" needs one, and a `/room/<junk>`
 * visitor who never typed a name has none, so they are sent to the home page where the name box is.
 */
export function noticeFor(
  kind: NoticeKind,
  roomId: string | undefined,
  canCreate: boolean,
): Notice {
  const room = roomId === undefined ? 'ห้องนี้' : `ห้อง ${roomId}`;
  switch (kind) {
    case 'NOT_FOUND':
      return {
        title: 'ไม่พบห้องนี้',
        message: canCreate
          ? 'ลิงก์อาจไม่ถูกต้อง ลองขอลิงก์จากเพื่อนอีกครั้ง หรือสร้างห้องใหม่แล้วส่งลิงก์ให้เพื่อนได้เลย'
          : 'ลิงก์อาจไม่ถูกต้อง ลองขอลิงก์จากเพื่อนอีกครั้ง หรือกลับหน้าแรก ใส่ชื่อ แล้วสร้างห้องใหม่ได้เลย',
        actions: canCreate ? actions(CREATE, HOME) : actions(HOME),
      };
    case 'ROOM_FULL':
      return {
        title: 'ห้องเต็มแล้ว',
        message: `${room} มีผู้เล่นครบ ${MAX_PLAYERS_PER_ROOM} คนแล้ว สร้างห้องใหม่ได้เลย หรือรอให้มีคนออกแล้วลองเข้าห้องนี้อีกครั้ง`,
        actions: canCreate
          ? actions(CREATE, { id: 'retry', label: 'ลองเข้าห้องนี้อีกครั้ง', primary: false }, HOME)
          : actions({ id: 'retry', label: 'ลองเข้าห้องนี้อีกครั้ง', primary: false }, HOME),
      };
    case 'CONNECT_FAILED':
      return {
        title: 'เชื่อมต่อไม่สำเร็จ',
        message: `เข้า${room} ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง`,
        actions: actions({ id: 'retry', label: 'ลองอีกครั้ง', primary: false }, HOME),
      };
    case 'VERSION_MISMATCH':
      return {
        title: 'เกมมีเวอร์ชันใหม่',
        message: 'โหลดหน้านี้ใหม่เพื่ออัปเดต แล้วเข้าห้องอีกครั้ง',
        actions: actions({ id: 'reload', label: 'โหลดหน้านี้ใหม่', primary: false }, HOME),
      };
    case 'CONNECTION_LOST':
      return {
        title: 'หลุดจากห้องแล้ว',
        message: `การเชื่อมต่อกับ${room} ขาดไปและต่อกลับไม่ได้ เข้าห้องอีกครั้งได้เลย`,
        actions: actions({ id: 'retry', label: 'เข้าห้องอีกครั้ง', primary: false }, HOME),
      };
  }
}

/**
 * Shown above the name box when the *server* refused a name our own check let through (the rules
 * drifted between client and server). The player fixes it in place, so this is not a dead end.
 */
export const SERVER_REJECTED_NICKNAME_MESSAGE = `เซิร์ฟเวอร์ไม่รับชื่อนี้ ลองใช้ชื่ออื่น (ภาษาไทย อังกฤษ ตัวเลข หรือ _ ไม่เกิน ${NICKNAME_MAX_LENGTH} ตัวอักษร)`;
