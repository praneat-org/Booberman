import {
  HEALTH_PATH,
  type HealthResponse,
  PROTOCOL_VERSION,
  ROOMS_PATH,
  RoomId,
} from '@booberman/protocol';
import { createRoom, listRooms } from './api/rooms';
import { createRouter, jsonError } from './http/router';

export { RoomDO } from './room/RoomDO';

export type Env = Cloudflare.Env;

const ROOM_PATH = /^\/ws\/room\/([^/]+)$/;

const api = createRouter<Env>({
  [HEALTH_PATH]: {
    GET: () => Response.json({ ok: true, protocol: PROTOCOL_VERSION } satisfies HealthResponse),
  },
  [ROOMS_PATH]: {
    GET: (_request, env) => listRooms(env),
    POST: (request, env) => createRoom(request, env),
  },
});

/** GET /ws/room/:id (Upgrade: websocket) → the room's Durable Object. */
function roomSocket(request: Request, env: Env, roomId: string): Response | Promise<Response> {
  if (request.method !== 'GET') return jsonError(405, 'METHOD_NOT_ALLOWED', { Allow: 'GET' });
  if (!RoomId.safeParse(roomId).success) return jsonError(400, 'BAD_ROOM_ID');
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonError(426, 'UPGRADE_REQUIRED');
  }
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  return stub.fetch(request);
}

export default {
  fetch(request, env, ctx) {
    const room = ROOM_PATH.exec(new URL(request.url).pathname);
    if (room?.[1]) return roomSocket(request, env, decodeURIComponent(room[1]));
    const { pathname } = new URL(request.url);
    // `run_worker_first` (wrangler.jsonc) sends only /api/* and /ws/* here; anything else that reaches the
    // Worker (e.g. a direct call) is a static asset / SPA fallback, never a JSON 404.
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/ws/')) {
      return env.ASSETS.fetch(request);
    }
    return api(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
