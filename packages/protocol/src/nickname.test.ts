import { describe, expect, it } from 'vitest';
import { exampleClientMessages } from './fixtures';
import { NICKNAME_MAX_LENGTH, type NicknameReason, validateNickname } from './nickname';
import { parseClientMessage } from './parse';

const reasonOf = (raw: string): NicknameReason | 'ok' => {
  const r = validateNickname(raw);
  return r.ok ? 'ok' : r.reason;
};

describe('validateNickname', () => {
  it.each(['มิ้นท์', 'a_1', 'Hi', 'บอส', 'ABC_xyz_099', '๑๒๓', 'เด็กดี'])('accepts %s', (name) => {
    expect(validateNickname(name)).toEqual({ ok: true, value: name });
  });

  it('trims leading and trailing whitespace and returns the trimmed value', () => {
    expect(validateNickname('  มิ้นท์ \t')).toEqual({ ok: true, value: 'มิ้นท์' });
    expect(validateNickname('\u00a0a_1\u3000')).toEqual({ ok: true, value: 'a_1' });
  });

  it('accepts exactly 12 characters and rejects 13', () => {
    expect(NICKNAME_MAX_LENGTH).toBe(12);
    expect(reasonOf('a'.repeat(12))).toBe('ok');
    expect(reasonOf('a'.repeat(13))).toBe('TOO_LONG');
    expect(reasonOf('ก'.repeat(12))).toBe('ok');
    expect(reasonOf('ก'.repeat(13))).toBe('TOO_LONG');
  });

  it('does not count Thai vowels / tone marks above and below a letter', () => {
    // 12 base letters, but 24 code points
    expect(reasonOf('มิ้'.repeat(12))).toBe('ok');
    // 13 base letters
    expect(reasonOf('มิ้'.repeat(13))).toBe('TOO_LONG');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(reasonOf('')).toBe('EMPTY');
    expect(reasonOf('    ')).toBe('EMPTY');
    expect(reasonOf('\n\t')).toBe('EMPTY');
  });

  it('rejects whitespace in the middle', () => {
    expect(reasonOf('a b')).toBe('CONTAINS_SPACE');
    expect(reasonOf('มิ้นท์ ดี')).toBe('CONTAINS_SPACE');
    expect(reasonOf('a\u00a0b')).toBe('CONTAINS_SPACE');
  });

  it('rejects emoji and symbols', () => {
    for (const bad of [
      '😀',
      'a😀',
      '👨\u200d👩\u200d👧',
      'a-b',
      'a.b',
      'a@b',
      '<b>',
      'a!',
      '฿100',
      'ๆ๏',
      'é',
      'ñ',
      '中文',
    ]) {
      expect(reasonOf(bad), bad).toBe('INVALID_CHARS');
    }
  });

  it('rejects control and zero-width characters', () => {
    for (const bad of ['a\u0000b', 'a\u200bb', '\u202ea', 'a\u200d']) {
      expect(['INVALID_CHARS', 'CONTAINS_SPACE']).toContain(reasonOf(bad));
      expect(reasonOf(bad)).not.toBe('ok');
    }
  });

  it('rejects a Thai mark with no base letter or stacked without limit', () => {
    expect(reasonOf('ิก')).toBe('INVALID_CHARS');
    expect(reasonOf(`ก${'้'.repeat(3)}`)).toBe('INVALID_CHARS');
    expect(reasonOf('กิ้')).toBe('ok');
  });
});

describe('join message uses the nickname rules', () => {
  const join = exampleClientMessages.join;
  const parse = (nickname: unknown) => {
    const r = parseClientMessage({ ...join, nickname });
    return r.ok
      ? ({ ok: true, nickname: r.data.t === 'join' && r.data.nickname } as const)
      : r.error;
  };

  it('accepts a valid nickname and passes on the trimmed value', () => {
    expect(parse('  a_1 ')).toEqual({ ok: true, nickname: 'a_1' });
  });

  it('bad nickname → INVALID_NICKNAME with the reason in the message', () => {
    expect(parse('')).toMatchObject({ code: 'INVALID_NICKNAME', message: 'nickname: EMPTY' });
    expect(parse('a'.repeat(13))).toMatchObject({
      code: 'INVALID_NICKNAME',
      message: 'nickname: TOO_LONG',
    });
    expect(parse('a b')).toMatchObject({
      code: 'INVALID_NICKNAME',
      message: 'nickname: CONTAINS_SPACE',
    });
    expect(parse('😀')).toMatchObject({
      code: 'INVALID_NICKNAME',
      message: 'nickname: INVALID_CHARS',
    });
  });

  it('wrong type or missing nickname stays BAD_MESSAGE', () => {
    expect(parse(42)).toMatchObject({ code: 'BAD_MESSAGE' });
    expect(parse(null)).toMatchObject({ code: 'BAD_MESSAGE' });
    expect(parse(undefined)).toMatchObject({ code: 'BAD_MESSAGE' });
  });
});
