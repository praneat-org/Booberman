import { NICKNAME_MAX_LENGTH, type NicknameReason } from '@booberman/protocol';

/** Thai text for each `validateNickname` failure, saying what is wrong and what is allowed (CAR-3792 AC 1). */
export function nicknameMessage(reason: NicknameReason): string {
  switch (reason) {
    case 'EMPTY':
      return 'ใส่ชื่อก่อนนะ';
    case 'TOO_LONG':
      return `ชื่อยาวเกินไป ใช้ได้ไม่เกิน ${NICKNAME_MAX_LENGTH} ตัวอักษร`;
    case 'CONTAINS_SPACE':
      return 'ชื่อห้ามมีช่องว่างตรงกลาง';
    case 'INVALID_CHARS':
      return 'ใช้ได้เฉพาะภาษาไทย อังกฤษ ตัวเลข และขีดล่าง (_)';
  }
}
