import { NICKNAME_REASONS, validateNickname } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { nicknameMessage } from './nicknameMessage';

describe('nicknameMessage', () => {
  it('has a distinct Thai message for every reason', () => {
    const messages = NICKNAME_REASONS.map(nicknameMessage);
    expect(new Set(messages).size).toBe(NICKNAME_REASONS.length);
    for (const m of messages) expect(m).toMatch(/[ก-๙]/u);
  });

  it.each([
    ['', 'EMPTY', 'ใส่ชื่อก่อนนะ'],
    ['   ', 'EMPTY', 'ใส่ชื่อก่อนนะ'],
    ['abcdefghijklm', 'TOO_LONG', 'ชื่อยาวเกินไป ใช้ได้ไม่เกิน 12 ตัวอักษร'],
    ['a b', 'CONTAINS_SPACE', 'ชื่อห้ามมีช่องว่างตรงกลาง'],
    ['a-b', 'INVALID_CHARS', 'ใช้ได้เฉพาะภาษาไทย อังกฤษ ตัวเลข และขีดล่าง (_)'],
    ['😀', 'INVALID_CHARS', 'ใช้ได้เฉพาะภาษาไทย อังกฤษ ตัวเลข และขีดล่าง (_)'],
  ])('%j is rejected as %s and shown as the expected Thai text', (raw, reason, message) => {
    const result = validateNickname(raw);
    expect(result).toEqual({ ok: false, reason });
    if (!result.ok) expect(nicknameMessage(result.reason)).toBe(message);
  });

  it('says what is wrong, not just that something is', () => {
    expect(nicknameMessage('TOO_LONG')).toContain('12');
    expect(nicknameMessage('CONTAINS_SPACE')).toContain('ช่องว่าง');
  });
});
