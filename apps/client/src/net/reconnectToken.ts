import { ReconnectToken } from '@booberman/protocol';

export const RECONNECT_STORAGE_KEY = 'booberman:reconnect';

/** Only the bits of `Storage` we use, so tests can pass a fake. */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where the reconnect token of the room we are in is kept (FE-22). */
export interface TokenStore {
  /** The token saved for this room, or `undefined` (none, another room, unreadable). */
  load(roomId: string): string | undefined;
  save(roomId: string, token: string): void;
  clear(): void;
}

/** Browsers can throw on the `sessionStorage` accessor itself (blocked site data), so even the lookup is guarded. */
function defaultStorage(): TokenStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * One slot in `sessionStorage`: a token and the room it belongs to. It outlives a page reload (the server
 * holds the slot for 15 s) but not the tab. A *copy* of a tab (Duplicate tab) gets a copy of this storage,
 * so the owner must keep it empty while playing: `WsTransport` writes it only on `pagehide` and clears it
 * when the next page has read it. Nothing here throws: without storage, a reload is just a fresh join.
 */
export function sessionTokenStore(
  storage: TokenStorage | undefined = defaultStorage(),
): TokenStore {
  return {
    load(roomId) {
      try {
        const raw = storage?.getItem(RECONNECT_STORAGE_KEY);
        if (typeof raw !== 'string') return undefined;
        const saved: unknown = JSON.parse(raw);
        if (typeof saved !== 'object' || saved === null) return undefined;
        const { room, token } = saved as { room?: unknown; token?: unknown };
        if (room !== roomId) return undefined;
        const parsed = ReconnectToken.safeParse(token);
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save(roomId, token) {
      try {
        storage?.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({ room: roomId, token }));
      } catch {
        // quota, private mode: reconnecting after a reload is a convenience only
      }
    },
    clear() {
      try {
        storage?.removeItem(RECONNECT_STORAGE_KEY);
      } catch {
        // nothing to undo
      }
    },
  };
}
