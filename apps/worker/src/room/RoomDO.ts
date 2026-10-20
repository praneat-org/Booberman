import { DurableObject } from 'cloudflare:workers';
import {
  type ErrorCode,
  type GameEvent,
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
  | {
      joined: true;
      room: string;
      playerId: PlayerId;
      nickname: string;
      session: number;
      /** Pressed "play again" (D9). Lives here so it survives hibernation and leaves with the player. */
      ready?: boolean;
    };

export type Player = {
  ws: WebSocket;
  playerId: PlayerId;
  nickname: string;
  session: number;
  ready: boolean;
};

type RoundEndEvent = Extract<GameEvent, { kind: 'roundEnd' }>;

/** Close code sent with ROOM_FULL (4000-4999 is free for applications). */
export const CLOSE_ROOM_FULL = 4001;
/** Close code sent with INVALID_NICKNAME (BE-35). */
export const CLOSE_INVALID_NICKNAME = 4002;

/** 20Hz game loop (CAR-3793). */
export const TICK_MS = 50;
/** One `tick-stats` log line every this many ticks (5 s). */
export const STATS_LOG_EVERY_TICKS = 100;
/** D9: the next round starts this long after the first "play again" press, ready or not. */
export const REMATCH_WINDOW_MS = 15_000;

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
  /** D33: next join id. Persisted, so a session number is never handed out twice, even after an eviction. */
  private nextSession = 1;
  /**
   * The `roundEnd` of the round that just finished, while its end screen is up: replayed to anyone
   * who joins meanwhile. Also stored under `roundEnd`, so the end screen survives an eviction.
   */
  private roundEnd: RoundEndEvent | undefined;
  /**
   * D9: epoch ms at which the next round starts whether everyone is ready or not; 0 = nobody has
   * pressed yet, no countdown. The DO alarm is set to this very time (it is what outlives an
   * eviction); the value itself is rebuilt from the alarm.
   */
  private rematchDeadline = 0;
  /** True while a rematch is being set up (an await in the middle): a second trigger does nothing. */
  private restarting = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.nextSession = (await ctx.storage.get<number>('nextSession')) ?? 1;
      const first = this.players()[0];
      if (!first) return;
      this.room = attachmentOf(first.ws).room;
      this.seedCache = await this.seed();
      await this.recoverRound();
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
        return this.rematch(ws);
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const left = this.leave(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // already closed
    }
    if (left) await this.rematchAfterLeave();
  }

  /** Treated like a close: the player leaves and the others are told. */
  override async webSocketError(ws: WebSocket, _error?: unknown): Promise<void> {
    const left = this.leave(ws);
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed
    }
    if (left) await this.rematchAfterLeave();
  }

  /** D9 / BE-41: the DO alarm is the rematch deadline. Safe to deliver twice or after the round restarted. */
  override async alarm(): Promise<void> {
    if (!this.state?.result || this.players().length === 0) return;
    await this.startRematch();
  }

  /** Everyone who has joined (sorted by playerId), rebuilt from the sockets Cloudflare holds for us. */
  players(): Player[] {
    const players: Player[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (a.joined)
        players.push({
          ws,
          playerId: a.playerId,
          nickname: a.nickname,
          session: a.session,
          ready: a.ready === true,
        });
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

    // decided now, before the first await: a tick in between would already count the newcomer
    const startOver = this.unplayed();
    // one id per join (D33), taken synchronously so two joins can never share it
    const session = this.nextSession++;
    void this.ctx.storage.put('nextSession', this.nextSession);
    ws.serializeAttachment({
      joined: true,
      room: attachmentOf(ws).room,
      playerId,
      nickname,
      session,
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
    if (startOver) await this.startRound(randomSeed());
    else this.replayEndScreen(ws);
    this.startLoop();
  }

  /**
   * True when the round on the board was never a contest and is over for its only player: they
   * timed out alone, or died alone (D32). A second player then gets a fresh round together with
   * them, instead of a frozen room, or a win handed to the newcomer on the first tick.
   */
  private unplayed(): boolean {
    const s = this.state;
    if (!s || s.contested || s.players.length === 0) return false;
    return s.result !== undefined || s.players.every((p) => !p.alive);
  }

  /** Someone joins while the end screen is up: they get the same `roundEnd` (and countdown) the others saw. */
  private replayEndScreen(ws: WebSocket): void {
    if (!this.roundEnd) return;
    send(ws, this.roundEnd);
    if (this.rematchDeadline !== 0) send(ws, this.rematchStatus());
  }

  /** Returns true when a player left (a socket that never joined has nothing to remove). */
  private leave(ws: WebSocket): boolean {
    const a = attachmentOf(ws);
    if (!a.joined) return false;
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
    return true;
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
   * (the rematch calls this; `game/` may not use `Math.random`).
   * Does nothing in an empty room — nobody to play, and no loop must be armed for it.
   *
   * Order matters for crash recovery: the new seed is stored and the old end screen deleted in ONE
   * transaction, before anything is announced; the swap + broadcast after it is one synchronous
   * step, so no tick can send a snapshot of the new round before `roundStart`. If the DO dies in
   * between, `recoverRound` starts the stored seed and announces it when it wakes up.
   */
  async startRound(seed: number): Promise<void> {
    if (this.players().length === 0) return;
    seed >>>= 0; // same uint32 as `GameState.seed` / `welcome.seed`
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put('seed', seed);
      await txn.delete('roundEnd');
    });
    await this.ctx.storage.deleteAlarm();
    const players = this.players();
    if (players.length === 0) return;
    const { state, events } = newRound(
      seed,
      players.map((p) => p.playerId),
      sessionsOf(players),
    );
    this.seedCache = state.seed;
    this.state = state;
    this.queue.clear();
    this.roundEnd = undefined;
    this.clearReady(players);
    for (const e of events) this.broadcast(e);
  }

  // ── rematch (D9) ──────────────────────────────────────────────────────────
  // Who can start a round: nobody directly. A client can only say `rematch` (ready), and only
  // while the end screen is up; the round starts when every player in the room is ready, or when
  // the alarm fires REMATCH_WINDOW_MS after the first press. The seed is always picked here.

  private async rematch(ws: WebSocket): Promise<void> {
    const a = attachmentOf(ws);
    if (!a.joined || !this.state?.result) return; // no end screen: a stale or early press, ignore
    if (a.ready) return send(ws, this.rematchStatus()); // pressed already: repeat the status, change nothing
    ws.serializeAttachment({ ...a, ready: true } satisfies Attachment);
    if (this.everyoneReady()) return this.startRematch();
    if (this.rematchDeadline === 0) {
      this.rematchDeadline = Date.now() + REMATCH_WINDOW_MS;
      await this.ctx.storage.setAlarm(this.rematchDeadline);
    }
    this.broadcast(this.rematchStatus());
  }

  /** Starts the next round of a finished one. Idempotent: a second call while one runs, or after it ran, does nothing. */
  private async startRematch(): Promise<void> {
    if (this.restarting || !this.state?.result) return;
    this.restarting = true;
    try {
      await this.startRound(randomSeed());
    } finally {
      this.restarting = false;
    }
  }

  /** Someone left during the end screen: their press is gone, so re-check who is ready. */
  private async rematchAfterLeave(): Promise<void> {
    if (this.rematchDeadline === 0 || !this.state?.result) return; // nobody had pressed
    const players = this.players();
    if (players.length === 0) return; // empty room: `stopLoop` already dropped the countdown
    const ready = players.filter((p) => p.ready).length;
    if (ready === players.length) return this.startRematch();
    if (ready === 0) {
      // the only ones who wanted a rematch are gone: no countdown until somebody presses again
      this.rematchDeadline = 0;
      await this.ctx.storage.deleteAlarm();
    }
    this.broadcast(this.rematchStatus());
  }

  private rematchStatus(): ServerMessage {
    return {
      v,
      t: 'event',
      kind: 'rematchStatus',
      ready: this.players()
        .filter((p) => p.ready)
        .map((p) => p.playerId),
      deadline: this.rematchDeadline,
    };
  }

  private everyoneReady(): boolean {
    const players = this.players();
    return players.length > 0 && players.every((p) => p.ready);
  }

  private clearReady(players: readonly Player[]): void {
    this.rematchDeadline = 0;
    for (const p of players) {
      const a = attachmentOf(p.ws);
      if (a.joined && a.ready)
        p.ws.serializeAttachment({ ...a, ready: false } satisfies Attachment);
    }
  }

  /**
   * The DO woke up with people still connected (deploy / crash): the game state lived in memory
   * only, so it is rebuilt here. Two cases:
   * - the end screen was up (`roundEnd` stored): bring it back frozen, with the rematch countdown
   *   still running (the alarm and the sockets' ready flags survived), no announcement needed;
   * - mid-round, or a rematch cut short between saving the seed and announcing it: start a round
   *   from the stored seed and tell everyone with `roundStart`, or clients would keep drawing the old board.
   */
  private async recoverRound(): Promise<void> {
    const players = this.players();
    const seed = this.seedCache ?? 0;
    const { state, events } = newRound(
      seed,
      players.map((p) => p.playerId),
      sessionsOf(players),
    );
    const ended = await this.ctx.storage.get<RoundEndEvent>('roundEnd');
    if (ended) {
      this.state = { ...state, result: { winner: ended.winner, reason: ended.reason } };
      this.roundEnd = ended;
      this.rematchDeadline = (await this.ctx.storage.getAlarm()) ?? 0;
      return;
    }
    this.state = state;
    this.clearReady(players);
    await this.ctx.storage.deleteAlarm();
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
    this.forgetEndScreen();
    if (this.stats.total > 0) this.logStats('tick-stats-final');
    this.stats.reset();
  }

  /** Keeps the `roundEnd` for people who join during the end screen, and across an eviction. */
  private rememberEndScreen(end: RoundEndEvent): void {
    this.roundEnd = end;
    void this.ctx.storage.put('roundEnd', end).catch(logFailure('round-end-save'));
  }

  /** An empty room keeps no end screen and no rematch countdown (no alarm may outlive the last player). */
  private forgetEndScreen(): void {
    if (this.roundEnd === undefined && this.rematchDeadline === 0) return;
    this.roundEnd = undefined;
    this.rematchDeadline = 0;
    void this.ctx.storage.deleteAlarm().catch(logFailure('rematch-alarm-delete'));
    void this.ctx.storage.delete('roundEnd').catch(logFailure('round-end-delete'));
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
      const end = events.find((e): e is RoundEndEvent => e.kind === 'roundEnd');
      if (end) this.rememberEndScreen(end);
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
    const sessions = sessionsOf(players);
    const seed = this.seedCache ?? 0;
    const state = this.state;
    if (!state) return createInitialState(seed, ids, sessions);
    // a slot only counts as "the same player" while the join is the same (D33)
    const known = new Set(state.players.map((p) => `${p.id}:${p.session}`));
    const wanted = players.map((p) => `${p.playerId}:${p.session}`);
    if (wanted.length === known.size && wanted.every((k) => known.has(k))) return state;
    const kept = state.players.filter((p) => sessions.get(p.id) === p.session);
    const keptIds = new Set(kept.map((p) => p.id));
    const added = ids
      .filter((id) => !keptIds.has(id))
      .flatMap((id) => createInitialState(seed, [id], sessions).players);
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
      seed = randomSeed();
      await this.ctx.storage.put('seed', seed);
    }
    return seed;
  }
}

/** A new round's seed, picked here and never by a client (`game/` may not use randomness). */
const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const logFailure = (msg: string) => (error: unknown) =>
  console.error(JSON.stringify({ msg, error: String(error) }));

const sessionsOf = (players: readonly Player[]) =>
  new Map(players.map((p) => [p.playerId, p.session] as const));

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
