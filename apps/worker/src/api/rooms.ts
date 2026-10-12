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

/** POST /api/rooms → 201 { roomId } · 429 RATE_LIMITED when one IP exceeds the create limit. */
export async function createRoom(
  request: Request,
  env: Pick<Cloudflare.Env, 'ROOMS' | 'ROOM_CREATE_LIMITER'>,
): Promise<Response> {
  const { success } = await env.ROOM_CREATE_LIMITER.limit({ key: clientIp(request) });
  if (!success) return jsonError(429, 'RATE_LIMITED', { 'Retry-After': '60' });

  const roomId = generateRoomId();
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

/**
 * GET /api/rooms → { rooms } with full rooms removed.
 * One KV.list call, metadata only (no per-key get). Display only: RoomDO decides on join.
 */
export async function listRooms(env: Pick<Cloudflare.Env, 'ROOMS'>): Promise<Response> {
  const { keys } = await env.ROOMS.list<unknown>({ prefix: ROOM_KEY_PREFIX });
  const rooms: RoomSummary[] = [];
  for (const key of keys) {
    const meta = RoomKvMetadata.safeParse(key.metadata);
    if (!meta.success || meta.data.players >= meta.data.max) continue;
    rooms.push({ roomId: key.name.slice(ROOM_KEY_PREFIX.length), ...meta.data });
  }
  rooms.sort((a, b) => b.createdAt - a.createdAt || a.roomId.localeCompare(b.roomId));
  return Response.json({ rooms } satisfies ListRoomsResponse, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
