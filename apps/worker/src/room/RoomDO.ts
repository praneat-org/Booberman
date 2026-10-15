import { DurableObject } from 'cloudflare:workers';
import {
  type ErrorCode,
  MAX_PLAYERS_PER_ROOM,
  type PlayerId,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from '@booberman/protocol';
import {
  createInitialState,
  type GameState,
  startRound as newRound,
  simulate,
  toSnapshot,
} from '../game';
import { InputQueue } from './inputQueue';
import { RoomKvSync } from './roomKv';
import { TickStats } from './tickStats';

const v = PROTOCOL_VERSION;
const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'] as const satisfies readonly PlayerId[];

/** Stored on each socket with serializeAttachment so it survives hibernation. */
export type Attachment =
  | { joined: false; room: string }
  | { joined: true; room: string; playerId: PlayerId; nickname: string };

export type Player = { ws: WebSocket; playerId: PlayerId; nickname: string };

/** Close code sent with ROOM_FULL (4000-4999 is free for applications). */
export const CLOSE_ROOM_FULL = 4001;
/** Close code sent with INVALID_NICKNAME (BE-35). */
export const CLOSE_INVALID_NICKNAME = 4002;

/** 20Hz game loop (CAR-3793). */
export const TICK_MS = 50;
/** One `tick-stats` log line every this many ticks (5 s). */
export const STATS_LOG_EVERY_TICKS = 100;

/**
 * One Durable Object = one room (`idFromName(roomId)`).
 * Uses the WebSocket Hibernation API: nothing about players lives only in memory —
 * the player list is always rebuilt from `ctx.getWebSockets()` + attachments.
 */
export class RoomDO extends DurableObject<Cloudflare.Env> {
  // In-memory only, all rebuildable: the tick loop keeps the DO awake while anyone is in the room,
  // an empty room has nothing worth keeping, and after an eviction (deploy) the constructor
  // restarts the loop from the persisted seed and the sockets' attachments.
  private loop: ReturnType<typeof setInterval> | null = null;
  private state: GameState | undefined;
  private seedCache: number | undefined;
  private room = '';
  /** Lobby entry in KV (display only, never read to decide anything). Created once the room id is known. */
  private roomKv: RoomKvSync | undefined;
  private readonly queue = new InputQueue();
  private readonly stats = new TickStats();

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const first = this.players()[0];
      if (!first) return;
      this.room = attachmentOf(first.ws).room;
      this.seedCache = await this.seed();
      this.startLoop();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'UPGRADE_REQUIRED' }, { status: 426 });
    }
    // the Worker only forwards /ws/room/:id with a valid id, so the last segment is the room
    const room = decodeURIComponent(new URL(request.url).pathname.split('/').pop() ?? '');
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ joined: false, room } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string')
      return this.sendError(ws, 'BAD_MESSAGE', 'binary frames are not supported');
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.sendError(ws, parsed.error.code, parsed.error.message);
      // the client's own check should have caught this: a bad nickname ends the connection
      if (parsed.error.code === 'INVALID_NICKNAME')
        ws.close(CLOSE_INVALID_NICKNAME, 'INVALID_NICKNAME');
      return;
    }
    const msg = parsed.data;

    switch (msg.t) {
      case 'ping':
        // D7: answer immediately, not on the tick
        return send(ws, { v, t: 'pong', ts: msg.ts });
      case 'join':
        if (msg.room !== attachmentOf(ws).room) {
          return this.sendError(ws, 'BAD_MESSAGE', 'join.room does not match the room in the URL');
        }
        return this.join(ws, msg.nickname);
      case 'input': {
        const a = attachmentOf(ws);
        if (!a.joined) return this.sendError(ws, 'BAD_MESSAGE', 'join first');
        // dropped inputs (stale seq / over the rate limit) are silent: there is no error code for
        // them and a spammer should not get a reply per message
        this.queue.offer(a.playerId, { dir: msg.dir, bomb: msg.bomb, seq: msg.seq }, Date.now());
        return;
      }
      case 'rematch':
        if (!attachmentOf(ws).joined) return this.sendError(ws, 'BAD_MESSAGE', 'join first');
        // rematch: BE-41
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

  /** Treated like a close: the player leaves and the others are told. */
  override async webSocketError(ws: WebSocket, _error?: unknown): Promise<void> {
    this.leave(ws);
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed
    }
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
      this.sendError(ws, 'ROOM_FULL');
      ws.close(CLOSE_ROOM_FULL, 'ROOM_FULL');
      return;
    }

    ws.serializeAttachment({
      joined: true,
      room: attachmentOf(ws).room,
      playerId,
      nickname,
    } satisfies Attachment);
    const seed = await this.seed();
    this.seedCache = seed;
    this.room = attachmentOf(ws).room;
    this.kvSync()?.update(others.length + 1);
    // the board comes from the game state (seeded board once BE-36 lands), never a fixed sample
    const grid = this.state?.grid ?? createInitialState(seed, [playerId]).grid;
    send(ws, { v, t: 'welcome', playerId, seed, grid });
    for (const p of others) {
      send(ws, { v, t: 'event', kind: 'playerJoined', playerId: p.playerId, nickname: p.nickname });
    }
    this.broadcast({ v, t: 'event', kind: 'playerJoined', playerId, nickname }, ws);
    this.startLoop();
  }

  private leave(ws: WebSocket): void {
    const a = attachmentOf(ws);
    if (!a.joined) return;
    ws.serializeAttachment({ joined: false, room: a.room } satisfies Attachment);
    this.queue.remove(a.playerId);
    // drop the leaver from the game state now, not on the next tick: someone who joins into the
    // same slot within one tick must start fresh (spawn, ackSeq 0), not inherit the old PlayerSim
    if (this.state) {
      this.state = {
        ...this.state,
        players: this.state.players.filter((p) => p.id !== a.playerId),
      };
    }
    this.broadcast({ v, t: 'event', kind: 'playerLeft', playerId: a.playerId }, ws);
    this.room = a.room;
    const remaining = this.players().length;
    this.kvSync()?.update(remaining);
    if (remaining === 0) this.stopLoop();
  }

  /** KV lobby sync for this room (fire-and-forget: never awaited, so it cannot slow a join or a tick). */
  private kvSync(): RoomKvSync | undefined {
    if (!this.roomKv && this.room) this.roomKv = new RoomKvSync(this.env.ROOMS, this.room);
    return this.roomKv;
  }

  /** KV write counters for tests. */
  roomKvStats() {
    return { ...this.roomKv?.counters, pending: this.roomKv?.pending ?? false };
  }

  /** True while the 20Hz interval is armed (tests; an armed interval keeps the DO from hibernating). */
  isTicking(): boolean {
    return this.loop !== null;
  }

  /** Tick count and duration percentiles since the loop last started. */
  tickStats() {
    return { ...this.stats.summary(), inputs: { ...this.queue.counters } };
  }

  /**
   * Start a new round with `seed` for everyone in the room: new board, everyone alive at their
   * spawn, then `roundStart { seed, grid }` (D8) to all. The caller picks the seed
   * (BE-41 calls this when the rematch is on; `game/` may not use `Math.random`).
   * Does nothing in an empty room — nobody to play, and no loop must be armed for it.
   */
  async startRound(seed: number): Promise<void> {
    if (this.players().length === 0) return;
    seed >>>= 0; // same uint32 as `GameState.seed` / `welcome.seed`
    // persist first (a hibernation restart rebuilds from this seed); the swap + broadcast below
    // is one synchronous step, so no tick can send a snapshot of the new round before roundStart
    await this.ctx.storage.put('seed', seed);
    const players = this.players();
    if (players.length === 0) return;
    const { state, events } = newRound(
      seed,
      players.map((p) => p.playerId),
    );
    this.seedCache = state.seed;
    this.state = state;
    this.queue.clear();
    for (const e of events) this.broadcast(e);
  }

  private startLoop(): void {
    if (this.loop !== null) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  /** Clears the interval at once and forgets the round state (the next first player starts fresh). */
  private stopLoop(): void {
    if (this.loop !== null) clearInterval(this.loop);
    this.loop = null;
    this.state = undefined;
    this.queue.clear();
    if (this.stats.total > 0) this.logStats('tick-stats-final');
    this.stats.reset();
  }

  private tick(): void {
    const players = this.players();
    if (players.length === 0 || this.seedCache === undefined) {
      this.stopLoop();
      return;
    }
    this.kvSync()?.heartbeat(players.length);
    const started = performance.now();
    try {
      const { state, events } = simulate(this.syncPlayers(players), this.queue.drain());
      this.state = state;
      for (const e of events) this.broadcast(e);
      for (const p of players) send(p.ws, toSnapshot(state, p.playerId));
    } catch (error) {
      console.error(JSON.stringify({ msg: 'tick-failed', error: String(error) }));
    }
    // note: workerd's clock only advances on I/O, so on a pure CPU tick this can read 0
    this.stats.record(performance.now() - started);
    if (this.stats.total % STATS_LOG_EVERY_TICKS === 0) this.logStats('tick-stats');
  }

  /** Game state follows the sockets: new first tick, a late joiner or a leaver all land here. */
  private syncPlayers(players: Player[]): GameState {
    const ids = players.map((p) => p.playerId);
    const seed = this.seedCache ?? 0;
    const state = this.state;
    if (!state) return createInitialState(seed, ids);
    const known = new Set(state.players.map((p) => p.id));
    if (ids.length === known.size && ids.every((id) => known.has(id))) return state;
    const kept = state.players.filter((p) => ids.includes(p.id));
    const added = ids
      .filter((id) => !known.has(id))
      .flatMap((id) => createInitialState(seed, [id]).players);
    return { ...state, players: [...kept, ...added].sort((a, b) => a.id.localeCompare(b.id)) };
  }

  private logStats(msg: string): void {
    console.log(JSON.stringify({ msg, room: this.room, ...this.tickStats() }));
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
  return (ws.deserializeAttachment() as Attachment | null) ?? { joined: false, room: '' };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket closing; webSocketClose cleans up
  }
}
