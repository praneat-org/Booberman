/**
 * Nickname rules (BE-35, CAR-3792). One implementation shared by the client
 * (instant feedback) and the server (RoomDO never trusts the client).
 *
 * - leading/trailing whitespace is trimmed first
 * - 1..NICKNAME_MAX_LENGTH characters, where Thai combining marks (upper/lower
 *   vowels, tone marks, thanthakhat...) do not count, so "มิ้นท์" is 3 characters
 * - only Thai letters/vowels/marks/digits, ASCII letters, 0-9 and "_"
 *
 * Pure string code: no Intl, DOM or Workers APIs, so the result is the same everywhere.
 */
export const NICKNAME_MAX_LENGTH = 12;
/** A Thai base character may carry at most this many stacked marks (vowel + tone + ...). */
export const NICKNAME_MAX_STACKED_MARKS = 2;

export const NICKNAME_REASONS = ['EMPTY', 'TOO_LONG', 'CONTAINS_SPACE', 'INVALID_CHARS'] as const;
export type NicknameReason = (typeof NICKNAME_REASONS)[number];

export type NicknameResult = { ok: true; value: string } | { ok: false; reason: NicknameReason };

/** Thai letters, vowels and marks (U+0E01-0E3A, U+0E40-0E4E), Thai digits, ASCII letters/digits, "_". */
const ALLOWED = /^[ก-ฺเ-๎๐-๙A-Za-z0-9_]+$/u;
/** Thai combining marks: ั ิ-ฺ ็-๎ (they sit on/under the previous letter). */
const THAI_MARK = /[ัิ-ฺ็-๎]/u;

export function validateNickname(raw: string): NicknameResult {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: 'EMPTY' };
  if (/\s/u.test(value)) return { ok: false, reason: 'CONTAINS_SPACE' };
  if (!ALLOWED.test(value)) return { ok: false, reason: 'INVALID_CHARS' };

  let length = 0;
  let stacked = 0;
  for (const ch of value) {
    if (THAI_MARK.test(ch)) {
      // a mark must sit on a base character, and cannot be stacked without limit
      stacked += 1;
      if (length === 0 || stacked > NICKNAME_MAX_STACKED_MARKS) {
        return { ok: false, reason: 'INVALID_CHARS' };
      }
    } else {
      stacked = 0;
      length += 1;
    }
  }
  if (length > NICKNAME_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, value };
}
