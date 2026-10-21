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
import { buildMatchRecord } from './matchRecord';
import { saveMatch } from './matchStore';
import { type HeldSlot, HeldSlots, newToken, RECONNECT_HOLD_MS, sameToken } from './reconnect';
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
      /**
       * BE-44: reconnect token from this socket's `welcome`. Stays on the server: it moves to the held slot
       * when the socket drops. Missing only on sockets that joined before BE-44 was deployed (those just leave).
       */
      token?: string;
    };

export type Player = {
  ws: WebSocket;
  playerId: PlayerId;
  nickname: string;
  session: number;
  ready: boolean;
  token?: string;
};

/** Someone who holds a slot in the room: connected, or dropped and still inside the 15 s hold (BE-44). */
export type Seat = Pick<Player, 'playerId' | 'nickname' | 'session'>;

type RoundEndEvent = Extract<GameEvent, { kind: 'roundEnd' }>;

/** Close code sent with ROOM_FULL (4000-4999 is free for applications). */
export const CLOSE_ROOM_FULL = 4001;
/** Close code sent with INVALID_NICKNAME (BE-35). */
export const CLOSE_INVALID_NICKNAME = 4002;
/** Close code sent with INVALID_TOKEN (BE-44): wrong, expired or already used reconnect token. */
export const CLOSE_INVALID_TOKEN = 4003;
/** An old socket is closed with this when the same player reconnects before the server noticed the drop (BE-44). */
export const CLOSE_REPLACED = 4004;

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
  /**
   * BE-44: players whose socket dropped less than 15 s ago. Persisted under `held` (the sockets are gone, so
   * unlike everything else here this cannot be rebuilt from `getWebSockets()`); the DO alarm expires them.
   */
  private held = new HeldSlots();
  /** True while a rematch is being set up (an await in the middle): a second trigger does nothing. */
  private restarting = false;
  /**
   * BE-42: epoch ms at which the round on the board began (`matches.started_at`); 0 = not known yet.
   * In memory only, on purpose: after an eviction the round is rebuilt from scratch (`recoverRound`),
   * so it starts counting again. Never read by `src/game/` (no clock in there).
   */
  private roundStartedAt = 0;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.nextSession = (await ctx.storage.get<number>('nextSession')) ?? 1;
      this.held = new HeldSlots((await ctx.storage.get<HeldSlot[]>('held')) ?? []);
      this.rematchDeadline = (await ctx.storage.get<number>('rematchDeadline')) ?? 0;
      const first = this.players()[0];
      // a room whose only players are dropped ones has no socket to read the room id from
      const room = first ? attachmentOf(first.ws).room : this.held.list()[0]?.room;
      if (!room) return;
      this.room = room;
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
        return this.join(ws, msg.nickname, msg.token);
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

  override async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    // The socket is already closing; re-closing it from here races the cleanup path and can
    // leave the room in a stale joined state during a fast leave->join sequence.
    // BE-44: only a connection that was lost (1006, 1001 ...) keeps its slot; the client's own
    // `close(1000)` (leaving on purpose) gives it up at once, as before.
    const left = leftOnPurpose(code) ? this.leave(ws) : this.hold(ws) || this.leave(ws);
    if (left) {
      await this.rearmAlarm();
      await this.rematchAfterLeave();
    }
  }

  /** Treated like a close: the player leaves and the others are told. */
  override async webSocketError(ws: WebSocket, _error?: unknown): Promise<void> {
    // Same here: the runtime has already signalled the socket is broken; closing it again is not needed.
    const left = this.leave(ws);
    if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'error');
    if (left) await this.rematchAfterLeave();
  }

  /**
   * One DO alarm, two jobs, armed for whichever is first (`rearmAlarm`): the end of a dropped player's
   * 15 s hold (BE-44) and the rematch deadline (D9 / BE-41). Safe to deliver twice or after the round restarted.
   */
  override async alarm(): Promise<void> {
    const expired = await this.expireHeld(Date.now());
    // woken for a hold that ran out, the rematch only starts if its own deadline has come too
    if (expired > 0 && (this.rematchDeadline === 0 || Date.now() < this.rematchDeadline)) return;
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
          token: a.token,
        });
    }
    return players.sort((x, y) => x.playerId.localeCompare(y.playerId));
  }

  /**
   * Everyone who holds a slot, sorted by playerId: the connected players plus the dropped ones still inside
   * their 15 s (BE-44). This is who is *in the game* and who counts towards the 4 slots; `players()` is who
   * is connected, i.e. who gets messages and can send input.
   */
  seats(): Seat[] {
    const seats: Seat[] = [...this.players(), ...this.held.list()];
    return seats.sort((x, y) => x.playerId.localeCompare(y.playerId));
  }

  private async join(ws: WebSocket, nickname: string, token?: string): Promise<void> {
    if (attachmentOf(ws).joined) return this.sendError(ws, 'BAD_MESSAGE', 'already joined');
    if (token !== undefined) return this.resume(ws, token);
    // a dropped player still holds their slot (BE-44): it is neither free nor counted out of the 4
    const others = this.seats();
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
    const reconnectToken = newToken();
    ws.serializeAttachment({
      joined: true,
      room: attachmentOf(ws).room,
      playerId,
      nickname,
      session,
      token: reconnectToken,
    } satisfies Attachment);
    const seed = await this.seed();
    this.seedCache = seed;
    this.room = attachmentOf(ws).room;
    this.kvSync()?.update(others.length + 1);
    // the board comes from the game state (seeded board once BE-36 lands), never a fixed sample
    const grid = this.state?.grid ?? createInitialState(seed, [playerId]).grid;
    send(ws, { v, t: 'welcome', playerId, seed, grid, token: reconnectToken });
    for (const p of others) {
      send(ws, { v, t: 'event', kind: 'playerJoined', playerId: p.playerId, nickname: p.nickname });
    }
    this.broadcast({ v, t: 'event', kind: 'playerJoined', playerId, nickname }, ws);
    if (startOver) await this.startRound(randomSeed());
    else this.replayEndScreen(ws);
    this.startLoop();
  }

  /**
   * BE-44: `join` with a reconnect token. The token must belong to a player whose slot is held (the socket
   * dropped less than 15 s ago), or to a socket that is still connected (the client noticed the drop before
   * the server did: the old socket is closed and the new one takes over). Then the new socket gets that
   * player's slot, id and game state back, a new token, and the same `welcome` / roster / end screen a joiner
   * gets. Nobody else is told anything: to them the player never left. Anything else is INVALID_TOKEN and the
   * socket is closed, so a client falls back to a normal join.
   */
  private async resume(ws: WebSocket, token: string): Promise<void> {
    const room = attachmentOf(ws).room;
    // first retire the holds that ran out, even if their alarm is late: a token is never honoured past 15 s
    await this.expireHeld(Date.now());
    let seat: Seat | undefined = this.held.claim(token, Date.now());
    if (!seat) {
      const old = this.players().find((p) => sameToken(p.token, token));
      if (old) {
        old.ws.serializeAttachment({ joined: false, room } satisfies Attachment);
        this.queue.remove(old.playerId);
        old.ws.close(CLOSE_REPLACED, 'REPLACED');
        seat = old;
      }
    }
    if (!seat) {
      this.sendError(ws, 'INVALID_TOKEN');
      ws.close(CLOSE_INVALID_TOKEN, 'INVALID_TOKEN');
      return;
    }
    const { playerId, nickname, session } = seat;
    const reconnectToken = newToken();
    ws.serializeAttachment({
      joined: true,
      room,
      playerId,
      nickname,
      session,
      token: reconnectToken,
    } satisfies Attachment);
    this.saveHeld();
    await this.rearmAlarm();
    const seed = await this.seed();
    this.seedCache = seed;
    this.room = room;
    const grid = this.state?.grid ?? createInitialState(seed, [playerId]).grid;
    send(ws, { v, t: 'welcome', playerId, seed, grid, token: reconnectToken });
    for (const p of this.seats()) {
      if (p.playerId === playerId) continue;
      send(ws, { v, t: 'event', kind: 'playerJoined', playerId: p.playerId, nickname: p.nickname });
    }
    this.replayEndScreen(ws);
    this.startLoop();
  }

  /**
   * The socket of a joined player dropped: their character stays in the game with no input and the slot is
   * held for 15 s (stored, with the alarm re-armed by the caller). Returns false when there is nothing to
   * hold (never joined, or no token), and the caller treats it as a normal leave.
   */
  private hold(ws: WebSocket): boolean {
    const a = attachmentOf(ws);
    if (!a.joined || a.token === undefined) return false;
    ws.serializeAttachment({ joined: false, room: a.room } satisfies Attachment);
    this.queue.remove(a.playerId);
    this.held.add({
      playerId: a.playerId,
      nickname: a.nickname,
      session: a.session,
      token: a.token,
      room: a.room,
      expiresAt: Date.now() + RECONNECT_HOLD_MS,
    });
    this.saveHeld();
    this.room = a.room;
    // the room is not empty: the tick keeps running so the dropped character stays part of the game
    return true;
  }

  /** Retires every hold whose 15 s are up: the player is out for good. Returns how many. */
  private async expireHeld(now: number): Promise<number> {
    const gone = this.held.expire(now);
    if (gone.length === 0) return 0;
    this.saveHeld();
    for (const slot of gone) this.vacate(slot.playerId, slot.room);
    await this.rearmAlarm();
    await this.rematchAfterLeave();
    return gone.length;
  }

  private saveHeld(): void {
    void this.ctx.storage.put('held', this.held.list()).catch(logFailure('held-save'));
  }

  /**
   * One DO alarm for everything that has a deadline: the earliest hold expiry and the rematch countdown.
   * No deadline at all = no alarm, so an empty room never has one.
   */
  private async rearmAlarm(): Promise<void> {
    const due = [this.rematchDeadline, this.held.nextExpiry() ?? 0].filter((t) => t > 0);
    if (due.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...due));
  }

  /** Sets (or with 0 clears) the rematch countdown. Stored: the alarm alone can no longer tell it from a hold. */
  private setRematchDeadline(deadline: number): void {
    this.rematchDeadline = deadline;
    const write =
      deadline === 0
        ? this.ctx.storage.delete('rematchDeadline')
        : this.ctx.storage.put('rematchDeadline', deadline);
    void write.catch(logFailure('rematch-deadline-save'));
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
    this.vacate(a.playerId, a.room);
    return true;
  }

  /**
   * A slot is given up for good (the player left, or their hold ran out): out of the game, the others are
   * told, and the room closes down when nobody is left, connected or held.
   */
  private vacate(playerId: PlayerId, room: string): void {
    this.queue.remove(playerId);
    // drop the leaver from the game state now, not on the next tick: someone who joins into the
    // same slot within one tick must start fresh (spawn, ackSeq 0), not inherit the old PlayerSim
    if (this.state) {
      this.state = {
        ...this.state,
        players: this.state.players.filter((p) => p.id !== playerId),
      };
    }
    this.broadcast({ v, t: 'event', kind: 'playerLeft', playerId });
    this.room = room;
    const remaining = this.seats().length;
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
    this.setRematchDeadline(0);
    await this.rearmAlarm();
    const players = this.players();
    if (players.length === 0) return;
    // dropped players (BE-44) are still in the game: the new round has their characters too
    const seats = this.seats();
    const { state, events } = newRound(
      seed,
      seats.map((p) => p.playerId),
      sessionsOf(seats),
    );
    this.seedCache = state.seed;
    this.state = state;
    this.roundStartedAt = Date.now();
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
      this.setRematchDeadline(Date.now() + REMATCH_WINDOW_MS);
      await this.rearmAlarm();
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
      this.setRematchDeadline(0);
      await this.rearmAlarm();
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
    this.setRematchDeadline(0);
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
    const seats = this.seats();
    const seed = this.seedCache ?? 0;
    const { state, events } = newRound(
      seed,
      seats.map((p) => p.playerId),
      sessionsOf(seats),
    );
    const ended = await this.ctx.storage.get<RoundEndEvent>('roundEnd');
    if (ended) {
      this.state = { ...state, result: { winner: ended.winner, reason: ended.reason } };
      this.roundEnd = ended;
      // `rematchDeadline` was read from storage in the constructor; the alarm may be a hold's now
      return;
    }
    this.state = state;
    this.roundStartedAt = Date.now();
    this.clearReady(players);
    await this.rearmAlarm();
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
    this.roundStartedAt = 0;
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
    this.setRematchDeadline(0);
    void this.rearmAlarm().catch(logFailure('rematch-alarm-delete'));
    void this.ctx.storage.delete('roundEnd').catch(logFailure('round-end-delete'));
  }

  private tick(): void {
    const players = this.players();
    const seats = this.seats();
    // dropped players (BE-44) keep the room, and so the loop, alive until their 15 s are up
    if (seats.length === 0 || this.seedCache === undefined) {
      this.stopLoop();
      return;
    }
    this.kvSync()?.heartbeat(seats.length);
    const started = performance.now();
    try {
      // the round on the board starts being played now (first tick of a room / of a round nobody announced)
      if (this.roundStartedAt === 0 && !this.state?.result) this.roundStartedAt = Date.now();
      const { state, events } = simulate(this.syncPlayers(seats), this.drainInputs());
      this.state = state;
      for (const e of events) this.broadcast(e);
      const end = events.find((e): e is RoundEndEvent => e.kind === 'roundEnd');
      if (end) {
        this.rememberEndScreen(end);
        this.recordMatch(end, state, seats);
      }
      for (const p of players) send(p.ws, toSnapshot(state, p.playerId));
    } catch (error) {
      console.error(JSON.stringify({ msg: 'tick-failed', error: String(error) }));
    }
    // note: workerd's clock only advances on I/O, so on a pure CPU tick this can read 0
    this.stats.record(performance.now() - started);
    if (this.stats.total % STATS_LOG_EVERY_TICKS === 0) this.logStats('tick-stats');
  }

  /**
   * BE-42 / D12: stores the finished round in D1 without making anybody wait for it. The write is
   * handed to `ctx.waitUntil` (in a Durable Object a pending waitUntil promise keeps the object from
   * being evicted until it settles, so a deploy or idle moment does not drop the write) and is never
   * awaited: the end screen, the next tick and the rematch do not depend on D1. A failure (D1 down,
   * slow, batch rejected) is logged and the game goes on; the result is simply lost, as D12 accepts.
   * Never throws: a bug in building the record must not cost the room its tick.
   */
  private recordMatch(end: RoundEndEvent, state: GameState, players: readonly Seat[]): void {
    const startedAt = this.roundStartedAt;
    this.roundStartedAt = 0; // the next round (startRound) sets it again
    try {
      const record = buildMatchRecord(end, {
        id: crypto.randomUUID(),
        roomId: this.room,
        seed: state.seed,
        startedAt: startedAt === 0 ? Date.now() : startedAt,
        endedAt: Date.now(),
        nicknames: new Map(players.map((p) => [p.playerId, p.nickname] as const)),
      });
      this.ctx.waitUntil(
        saveMatch(this.env.DB, record).catch(logFailure('match-save', { match: record.id })),
      );
    } catch (error) {
      logFailure('match-save', { room: this.room })(error);
    }
  }

  /** Game state follows the sockets: new first tick, a late joiner or a leaver all land here. */
  private syncPlayers(players: readonly Seat[]): GameState {
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

  /**
   * This tick's inputs. A dropped player (BE-44) gets "stand still, no bomb": without it `simulate` would
   * keep walking them in their last direction (D27: no input keeps the old direction).
   */
  private drainInputs() {
    const inputs = this.queue.drain();
    for (const slot of this.held.list())
      inputs.set(slot.playerId, { dir: 'none', bomb: false, seq: 0 });
    return inputs;
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

const logFailure =
  (msg: string, extra: Record<string, string> = {}) =>
  (error: unknown) =>
    console.error(JSON.stringify({ msg, ...extra, error: String(error) }));

/** The client's own `close(1000)` (WsTransport) or a close with no code (1005): leaving on purpose, nothing to hold. */
const leftOnPurpose = (code: number): boolean => code === 1000 || code === 1005;

const sessionsOf = (players: readonly Seat[]) =>
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
