/** Vite `?raw` import (tests read wrangler.jsonc as text; workerd has no fs). */
declare module '*?raw' {
  const content: string;
  export default content;
}

declare namespace Cloudflare {
  interface Env {
    /** Workers Static Assets: the client build (wrangler.jsonc `assets`). */
    ASSETS: Fetcher;
    ROOM: DurableObjectNamespace<import('./room/RoomDO').RoomDO>;
    /** KV: lobby room list only (never decides whether a room is full). */
    ROOMS: KVNamespace;
    /** D1: round results (BE-42). Fire-and-forget writes only, never awaited in the game loop (D12). */
    DB: D1Database;
    /** Rate limit for POST /api/rooms, keyed by client IP. */
    ROOM_CREATE_LIMITER: RateLimit;
  }
  interface GlobalProps {
    mainModule: typeof import('./index');
    durableNamespaces: 'RoomDO';
  }
}
