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

/** `/room/<id>`; with a nickname it also carries `?nick=` so the choice survives blocked storage. */
export function roomPath(roomId: string, nickname?: string): string {
  const base = `/room/${roomId}`;
  return nickname === undefined ? base : `${base}?nick=${encodeURIComponent(nickname)}`;
}

/** The room's shareable URL drops only the nickname while keeping other query options intact. */
export function roomUrlWithoutNickname(loc: {
  pathname: string;
  search: string;
  hash?: string;
}): string {
  const params = new URLSearchParams(loc.search);
  params.delete('nick');
  const search = params.toString();
  return `${loc.pathname}${search ? `?${search}` : ''}${loc.hash ?? ''}`;
}

/** Must satisfy `RoomId` (4-12 chars a-z0-9, D16). */
const DEFAULT_ROOM = 'devroom';

/**
 * Where GameScene connects. Nickname falls back to the remembered name before a generated name,
 * including in mock mode where the lobby is skipped.
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

/**
 * The link a player sends to friends: origin + `/room/<id>` and nothing else. Never `?nick=`, so a
 * link copied from the address bar or the share button cannot hand our name to someone else.
 */
export function roomShareUrl(origin: string, roomId: string): string {
  return `${origin}${roomPath(roomId)}`;
}
