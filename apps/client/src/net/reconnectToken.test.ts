import { describe, expect, it } from 'vitest';
import { RECONNECT_STORAGE_KEY, sessionTokenStore, type TokenStorage } from './reconnectToken';

function memory(
  initial: Record<string, string> = {},
): TokenStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: TokenStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('sessionTokenStore', () => {
  it('gives back what was saved for the same room', () => {
    const store = sessionTokenStore(memory());
    expect(store.load('abc123')).toBeUndefined();
    store.save('abc123', 'tok-1');
    expect(store.load('abc123')).toBe('tok-1');
  });

  it('keeps only the latest token (a reconnect rotates it)', () => {
    const store = sessionTokenStore(memory());
    store.save('abc123', 'tok-1');
    store.save('abc123', 'tok-2');
    expect(store.load('abc123')).toBe('tok-2');
  });

  it('a token of another room is not ours', () => {
    const store = sessionTokenStore(memory());
    store.save('abc123', 'tok-1');
    expect(store.load('zzzz99')).toBeUndefined();
  });

  it('clear forgets it', () => {
    const store = sessionTokenStore(memory());
    store.save('abc123', 'tok-1');
    store.clear();
    expect(store.load('abc123')).toBeUndefined();
  });

  it('ignores junk: not JSON, wrong shape, empty or oversized token', () => {
    const tooLong = 'x'.repeat(65);
    for (const raw of [
      'nope',
      'null',
      '"str"',
      JSON.stringify({ room: 'abc123' }),
      JSON.stringify({ room: 'abc123', token: '' }),
      JSON.stringify({ room: 'abc123', token: 7 }),
      JSON.stringify({ room: 'abc123', token: tooLong }),
    ]) {
      const store = sessionTokenStore(memory({ [RECONNECT_STORAGE_KEY]: raw }));
      expect(store.load('abc123')).toBeUndefined();
    }
  });

  it('never throws: blocked storage, or none at all, is a fresh join', () => {
    for (const storage of [throwing, undefined]) {
      const store = sessionTokenStore(storage);
      expect(() => store.save('abc123', 'tok')).not.toThrow();
      expect(() => store.clear()).not.toThrow();
      expect(store.load('abc123')).toBeUndefined();
    }
  });
});
