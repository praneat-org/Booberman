import {
  type CreateRoomResponse,
  GENERATED_ROOM_ID_LENGTH,
  type ListRoomsResponse,
  MAX_PLAYERS_PER_ROOM,
  ROOM_KV_TTL_SECONDS,
  RoomKvMetadata,
  type RoomSummary,
} from '@booberman/protocol';
import { jsonError } from '../http/router';

export const ROOM_KEY_PREFIX = 'room:';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// Largest multiple of 36 below 256: bytes at or above it are rejected so every char is equally likely.
const UNBIASED_LIMIT = 252;

/** Random id of `GENERATED_ROOM_ID_LENGTH` chars a-z0-9 (valid RoomId). */
export function generateRoomId(): string {
  let id = '';
  while (id.length < GENERATED_ROOM_ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_ROOM_ID_LENGTH));
    for (const b of bytes) {
      if (b < UNBIASED_LIMIT && id.length < GENERATED_ROOM_ID_LENGTH) {
        id += ALPHABET[b % ALPHABET.length];
      }
    }
  }
  return id;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** Attempts to find an unused room id before giving up with 503 (collisions are ~1 in 2 billion). */
export const CREATE_ROOM_ATTEMPTS = 5;

/**
 * POST /api/rooms → 201 { roomId } · 429 RATE_LIMITED when one IP exceeds the create limit ·
 * 503 ROOM_ID_UNAVAILABLE when every generated id is already taken.
 * `nextId` is injectable for tests only.
 */
export async function createRoom(
  request: Request,
  env: Pick<Cloudflare.Env, 'ROOMS' | 'ROOM_CREATE_LIMITER'>,
  nextId: () => string = generateRoomId,
): Promise<Response> {
  const { success } = await env.ROOM_CREATE_LIMITER.limit({ key: clientIp(request) });
  if (!success) return jsonError(429, 'RATE_LIMITED', { 'Retry-After': '60' });

  // Skip ids that already have a key, so an existing room's metadata is never overwritten.
  // KV is eventually consistent, so this is best effort; RoomDO stays the source of truth.
  let roomId: string | undefined;
  for (let i = 0; i < CREATE_ROOM_ATTEMPTS && roomId === undefined; i++) {
    const candidate = nextId();
    if ((await env.ROOMS.get(`${ROOM_KEY_PREFIX}${candidate}`)) === null) roomId = candidate;
  }
  if (roomId === undefined) return jsonError(503, 'ROOM_ID_UNAVAILABLE', { 'Retry-After': '1' });

  const metadata: RoomKvMetadata = {
    players: 0,
    max: MAX_PLAYERS_PER_ROOM,
    createdAt: Date.now(),
  };
  await env.ROOMS.put(`${ROOM_KEY_PREFIX}${roomId}`, '', {
    metadata,
    expirationTtl: ROOM_KV_TTL_SECONDS,
  });
  return Response.json({ roomId } satisfies CreateRoomResponse, { status: 201 });
}

/** Upper bound on KV.list pages read per request (1000 keys each), so a huge keyspace cannot stall GET. */
export const MAX_LIST_PAGES = 10;

/**
 * GET /api/rooms → { rooms } with full rooms removed.
 * Follows the KV.list cursor across pages (up to MAX_LIST_PAGES), metadata only (no per-key get).
 * Display only: RoomDO decides on join. `pageSize` is injectable for tests only.
 */
export async function listRooms(
  env: Pick<Cloudflare.Env, 'ROOMS'>,
  pageSize?: number,
): Promise<Response> {
  const rooms: RoomSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await env.ROOMS.list<unknown>({
      prefix: ROOM_KEY_PREFIX,
      ...(cursor !== undefined && { cursor }),
      ...(pageSize !== undefined && { limit: pageSize }),
    });
    for (const key of result.keys) {
      const meta = RoomKvMetadata.safeParse(key.metadata);
      if (!meta.success || meta.data.players >= meta.data.max) continue;
      rooms.push({ roomId: key.name.slice(ROOM_KEY_PREFIX.length), ...meta.data });
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  rooms.sort((a, b) => b.createdAt - a.createdAt || a.roomId.localeCompare(b.roomId));
  return Response.json({ rooms } satisfies ListRoomsResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
