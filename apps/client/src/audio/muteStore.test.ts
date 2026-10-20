import { describe, expect, it } from 'vitest';
import { loadMuted, MUTE_STORAGE_KEY, type MuteStorage, saveMuted } from './muteStore';

function memoryStorage(initial: Record<string, string> = {}): MuteStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const throwing: MuteStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('muteStore', () => {
  it('sound is on when nothing was saved', () => {
    expect(loadMuted(memoryStorage())).toBe(false);
  });

  it('remembers mute and unmute', () => {
    const storage = memoryStorage();
    saveMuted(true, storage);
    expect(storage.data.get(MUTE_STORAGE_KEY)).toBe('1');
    expect(loadMuted(storage)).toBe(true);
    saveMuted(false, storage);
    expect(loadMuted(storage)).toBe(false);
  });

  it('anything but the saved "1" counts as sound on', () => {
    for (const junk of ['', '0', 'true', 'yes', ' 1']) {
      expect(loadMuted(memoryStorage({ [MUTE_STORAGE_KEY]: junk }))).toBe(false);
    }
  });

  it('never throws when storage is blocked, full or missing', () => {
    expect(loadMuted(throwing)).toBe(false);
    expect(() => saveMuted(true, throwing)).not.toThrow();
    expect(loadMuted(undefined)).toBe(false);
    expect(() => saveMuted(true, undefined)).not.toThrow();
  });
});
