import { DurableObject } from 'cloudflare:workers';
import {
  type ErrorCode,
  exampleGrid,
  MAX_PLAYERS_PER_ROOM,
  type PlayerId,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from '@booberman/protocol';

const v = PROTOCOL_VERSION;
const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'] as const satisfies readonly PlayerId[];

/** Stored on each socket with serializeAttachment so it survives hibernation. */
export type Attachment = { joined: false } | { joined: true; playerId: PlayerId; nickname: string };

export type Player = { ws: WebSocket; playerId: PlayerId; nickname: string };

/** Close code sent with ROOM_FULL (4000-4999 is free for applications). */
export const CLOSE_ROOM_FULL = 4001;

/**
 * One Durable Object = one room (`idFromName(roomId)`).
 * Uses the WebSocket Hibernation API: nothing about players lives only in memory —
 * the player list is always rebuilt from `ctx.getWebSockets()` + attachments.
 */
export class RoomDO extends DurableObject<Cloudflare.Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string')
      return this.sendError(ws, 'BAD_MESSAGE', 'binary frames are not supported');
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return this.sendError(ws, parsed.error.code, parsed.error.message);
    const msg = parsed.data;

    switch (msg.t) {
      case 'ping':
        // D7: answer immediately, not on the tick
        return send(ws, { v, t: 'pong', ts: msg.ts });
      case 'join':
        return this.join(ws, msg.nickname);
      case 'input':
      case 'rematch':
        if (!attachmentOf(ws).joined) return this.sendError(ws, 'BAD_MESSAGE', 'join first');
        // handled by the tick loop (BE-33) and rematch (BE-41)
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.leave(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  /** Everyone who has joined (sorted by playerId), rebuilt from the sockets Cloudflare holds for us. */
  players(): Player[] {
    const players: Player[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (a.joined) players.push({ ws, playerId: a.playerId, nickname: a.nickname });
    }
    return players.sort((x, y) => x.playerId.localeCompare(y.playerId));
  }

  private async join(ws: WebSocket, nickname: string): Promise<void> {
    if (attachmentOf(ws).joined) return this.sendError(ws, 'BAD_MESSAGE', 'already joined');
    const others = this.players();
    const taken = new Set(others.map((p) => p.playerId));
    const playerId = PLAYER_IDS.find((id) => !taken.has(id));
    if (!playerId || others.length >= MAX_PLAYERS_PER_ROOM) {
      // full guard + tests live in BE-32
      this.sendError(ws, 'ROOM_FULL');
      ws.close(CLOSE_ROOM_FULL, 'ROOM_FULL');
      return;
    }

    ws.serializeAttachment({ joined: true, playerId, nickname } satisfies Attachment);
    send(ws, { v, t: 'welcome', playerId, seed: await this.seed(), grid: exampleGrid() });
    for (const p of others) {
      send(ws, { v, t: 'event', kind: 'playerJoined', playerId: p.playerId, nickname: p.nickname });
    }
    this.broadcast({ v, t: 'event', kind: 'playerJoined', playerId, nickname }, ws);
  }

  private leave(ws: WebSocket): void {
    const a = attachmentOf(ws);
    if (!a.joined) return;
    ws.serializeAttachment({ joined: false } satisfies Attachment);
    this.broadcast({ v, t: 'event', kind: 'playerLeft', playerId: a.playerId }, ws);
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    for (const p of this.players()) if (p.ws !== except) send(p.ws, msg);
  }

  private sendError(ws: WebSocket, code: ErrorCode, message?: string): void {
    send(ws, message ? { v, t: 'error', code, message } : { v, t: 'error', code });
  }

  /** Round seed, persisted so it survives hibernation. Board generation from the seed: BE-36. */
  private async seed(): Promise<number> {
    let seed = await this.ctx.storage.get<number>('seed');
    if (seed === undefined) {
      seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
      await this.ctx.storage.put('seed', seed);
    }
    return seed;
  }
}

export function attachmentOf(ws: WebSocket): Attachment {
  return (ws.deserializeAttachment() as Attachment | null) ?? { joined: false };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket closing; webSocketClose cleans up
  }
}
