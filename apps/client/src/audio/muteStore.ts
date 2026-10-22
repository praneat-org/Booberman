export const MUTE_STORAGE_KEY = 'booberman:muted';

/** Only the bits of `Storage` we use, so tests can pass a fake. */
export type MuteStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Browsers can throw on the `localStorage` accessor itself (blocked site data), so even the lookup is guarded. */
function defaultStorage(): MuteStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Whether the player muted the game last time. Sound is on when nothing was saved or storage is unreadable. */
export function loadMuted(storage: MuteStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers the choice; never throws (quota, private mode...). Remembering it is a convenience only. */
export function saveMuted(
  muted: boolean,
  storage: MuteStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // the choice still holds for this page; it is just not remembered
  }
}
