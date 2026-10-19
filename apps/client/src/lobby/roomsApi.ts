import {
  CreateRoomResponse,
  ListRoomsResponse,
  ROOMS_PATH,
  type RoomSummary,
} from '@booberman/protocol';

export type CreateRoomResult =
  | { status: 'ok'; roomId: string }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'error' };

export type ListRoomsResult = { status: 'ok'; rooms: RoomSummary[] } | { status: 'error' };

/** Used when a 429 carries no usable `Retry-After` (the server sends 60). */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

function retryAfterSeconds(res: Response): number {
  const raw = Number(res.headers.get('Retry-After'));
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : DEFAULT_RETRY_AFTER_SECONDS;
}

/** `POST /api/rooms`. Never throws: network failures and malformed bodies become `error`. */
export async function createRoom(
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CreateRoomResult> {
  try {
    const res = await fetchFn(ROOMS_PATH, { method: 'POST', signal });
    if (res.status === 429) {
      return { status: 'rate-limited', retryAfterSeconds: retryAfterSeconds(res) };
    }
    if (!res.ok) return { status: 'error' };
    const body = CreateRoomResponse.safeParse(await res.json());
    return body.success ? { status: 'ok', roomId: body.data.roomId } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** `GET /api/rooms` (full rooms are already filtered out by the server). Never throws. */
export async function listRooms(
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ListRoomsResult> {
  try {
    const res = await fetchFn(ROOMS_PATH, { signal, cache: 'no-store' });
    if (!res.ok) return { status: 'error' };
    const body = ListRoomsResponse.safeParse(await res.json());
    return body.success ? { status: 'ok', rooms: body.data.rooms } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
