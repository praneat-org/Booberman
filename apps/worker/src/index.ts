import { HEALTH_PATH, type HealthResponse, PROTOCOL_VERSION, RoomId } from '@booberman/protocol';
import { createRouter, jsonError } from './http/router';

export { RoomDO } from './room/RoomDO';

export type Env = Cloudflare.Env;

const ROOM_PATH = /^\/ws\/room\/([^/]+)$/;

const api = createRouter<Env>({
  [HEALTH_PATH]: {
    GET: () => Response.json({ ok: true, protocol: PROTOCOL_VERSION } satisfies HealthResponse),
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
    return api(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
