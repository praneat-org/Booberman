import { validateNickname } from '@booberman/protocol';

export const NICKNAME_STORAGE_KEY = 'booberman:nickname';

/** Only the bits of `Storage` we use, so tests can pass a fake. */
export type NicknameStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Browsers can throw on the `localStorage` accessor itself (blocked site data), so even the lookup is guarded. */
function defaultStorage(): NicknameStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Last nickname the player used, or '' when none / unreadable / no longer valid (rules may change). */
export function loadNickname(storage: NicknameStorage | undefined = defaultStorage()): string {
  try {
    const raw = storage?.getItem(NICKNAME_STORAGE_KEY);
    if (typeof raw !== 'string') return '';
    const result = validateNickname(raw);
    return result.ok ? result.value : '';
  } catch {
    return '';
  }
}

/** Remembers a valid nickname; never throws (quota, private mode...). */
export function saveNickname(
  nickname: string,
  storage: NicknameStorage | undefined = defaultStorage(),
): void {
  try {
    const result = validateNickname(nickname);
    if (result.ok) storage?.setItem(NICKNAME_STORAGE_KEY, result.value);
  } catch {
    // remembering the name is a convenience only
  }
}
