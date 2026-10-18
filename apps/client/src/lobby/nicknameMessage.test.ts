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
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['abcdefghijklm', 'TOO_LONG'],
    ['a b', 'CONTAINS_SPACE'],
    ['a-b', 'INVALID_CHARS'],
    ['😀', 'INVALID_CHARS'],
  ])('%j maps to %s', (raw, reason) => {
    const result = validateNickname(raw);
    expect(result).toEqual({ ok: false, reason });
  });

  it('says what is wrong, not just that something is', () => {
    expect(nicknameMessage('TOO_LONG')).toContain('12');
    expect(nicknameMessage('CONTAINS_SPACE')).toContain('ช่องว่าง');
  });
});
