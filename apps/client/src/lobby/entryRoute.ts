import { RoomId, validateNickname } from '@booberman/protocol';

/**
 * What the page at this URL should show (FE-19). Pure, so every branch is unit-tested.
 *
 * - `home`: `/` and anything that is not a room link.
 * - `join`: `/room/<id>?nick=<valid>` (the lobby sends this): go straight into the room.
 * - `form`: `/room/<id>` (a link from a friend): name box prefilled with the remembered name. A
 *   `?nick=` that fails the rules lands here too, with what was typed so it can be corrected.
 * - `not-found`: `/room/<anything that is not a room id>`. The server has no "unknown room": any
 *   valid id opens a fresh room, so a malformed id is the only "not found" there is.
 */
export type EntryRoute =
  | { kind: 'home' }
  | { kind: 'join'; roomId: string; nickname: string }
  | { kind: 'form'; roomId: string; nickname: string }
  | { kind: 'not-found' };

/** `/room/<segment>[/]`, or `/room/<segment>/<more>` which can never be a room link. */
const ROOM_URL = /^\/room\/([^/]+)(\/.*)?$/;

export function resolveEntry(
  loc: { pathname: string; search: string },
  storedNickname: string,
): EntryRoute {
  const match = ROOM_URL.exec(loc.pathname);
  if (!match) return { kind: 'home' };
  const extra = match[2];
  if (extra !== undefined && extra !== '/') return { kind: 'not-found' };
  let id: string;
  try {
    id = decodeURIComponent(match[1] ?? '').toLowerCase();
  } catch {
    return { kind: 'not-found' };
  }
  if (!RoomId.safeParse(id).success) return { kind: 'not-found' };

  const fromQuery = new URLSearchParams(loc.search).get('nick');
  if (fromQuery === null) return { kind: 'form', roomId: id, nickname: storedNickname };
  const nick = validateNickname(fromQuery);
  if (nick.ok) return { kind: 'join', roomId: id, nickname: nick.value };
  // keep what they typed so the form can show *why* it failed instead of silently swapping the name
  return { kind: 'form', roomId: id, nickname: fromQuery };
}
