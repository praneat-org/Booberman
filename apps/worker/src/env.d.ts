declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import('./room/RoomDO').RoomDO>;
    /** KV: lobby room list only (never decides whether a room is full). */
    ROOMS: KVNamespace;
    /** Rate limit for POST /api/rooms, keyed by client IP. */
    ROOM_CREATE_LIMITER: RateLimit;
  }
  interface GlobalProps {
    mainModule: typeof import('./index');
    durableNamespaces: 'RoomDO';
  }
}
