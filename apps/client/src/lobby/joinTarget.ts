import { RoomId, validateNickname } from '@booberman/protocol';
import { loadNickname } from './nicknameStore';

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

export function roomPath(roomId: string): string {
  return `/room/${roomId}`;
}

/** Must satisfy `RoomId` (4-12 chars a-z0-9, D16). */
const DEFAULT_ROOM = 'devroom';

/**
 * Where GameScene connects. Order: `/room/:id` path, then `?room=` (dev override), then a dev default.
 * Nickname: `?nick=`, then the remembered one, then a random `PlayerNN`. FE-19 replaces the stopgap
 * with a real join form on `/room/:id`.
 */
export function joinFromLocation(
  loc: { pathname: string; search: string },
  storedNickname: string = loadNickname(),
  random: () => number = Math.random,
): { roomId: string; nickname: string } {
  const params = new URLSearchParams(loc.search);
  const fromQuery = params.get('room')?.toLowerCase() ?? '';
  const roomId =
    roomIdFromPath(loc.pathname) ??
    (RoomId.safeParse(fromQuery).success ? fromQuery : DEFAULT_ROOM);
  const nick = validateNickname(params.get('nick') ?? '');
  const nickname = nick.ok
    ? nick.value
    : storedNickname || `Player${Math.floor(random() * 90) + 10}`;
  return { roomId, nickname };
}
