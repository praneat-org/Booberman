import { describe, expect, it } from 'vitest';
import { loadNickname, NICKNAME_STORAGE_KEY, saveNickname } from './nicknameStore';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('nickname store', () => {
  it('round-trips a trimmed valid nickname', () => {
    const s = fakeStorage();
    saveNickname('  มิ้นท์ ', s);
    expect(s.data.get(NICKNAME_STORAGE_KEY)).toBe('มิ้นท์');
    expect(loadNickname(s)).toBe('มิ้นท์');
  });

  it('does not store an invalid nickname', () => {
    const s = fakeStorage();
    saveNickname('a b', s);
    saveNickname('', s);
    expect(s.data.size).toBe(0);
  });

  it('ignores a stored value that no longer passes the rules', () => {
    expect(loadNickname(fakeStorage({ [NICKNAME_STORAGE_KEY]: 'bad name!' }))).toBe('');
  });

  it('returns empty when nothing is stored or storage is missing', () => {
    expect(loadNickname(fakeStorage())).toBe('');
    expect(loadNickname(undefined)).toBe('');
  });

  it('never throws when storage throws', () => {
    expect(loadNickname(throwing)).toBe('');
    expect(() => saveNickname('Mint', throwing)).not.toThrow();
  });
});
