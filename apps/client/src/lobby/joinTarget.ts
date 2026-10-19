import { RoomId } from '@booberman/protocol';

/** `/room/abc123` (optional trailing slash) → `abc123`; anything else, or an id that breaks `RoomId`, → undefined. */
export function roomIdFromPath(pathname: string): string | undefined {
  const match = /^\/room\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(match[1] ?? '').toLowerCase();
  } catch {
    return undefined;
  }
  return RoomId.safeParse(id).success ? id : undefined;
}

/** `/room/<id>`; with a nickname it also carries `?nick=` so the choice survives blocked storage. */
export function roomPath(roomId: string, nickname?: string): string {
  const base = `/room/${roomId}`;
  return nickname === undefined ? base : `${base}?nick=${encodeURIComponent(nickname)}`;
}

/**
 * The link a player sends to friends: origin + `/room/<id>` and nothing else. Never `?nick=`, so a
 * link copied from the address bar or the share button cannot hand our name to someone else.
 */
export function roomShareUrl(origin: string, roomId: string): string {
  return `${origin}${roomPath(roomId)}`;
}
