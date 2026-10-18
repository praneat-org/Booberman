import {
  type ErrorCode,
  exampleGrid,
  type GameEvent,
  GRID_WIDTH,
  type PlayerId,
  PROTOCOL_VERSION,
  parseServerMessage,
  tileAt,
} from '@booberman/protocol';
import type {
  CloseInfo,
  InputDir,
  PongMessage,
  SnapshotMessage,
  Transport,
  TransportInput,
  Unsubscribe,
  WelcomeMessage,
} from './Transport';

export interface MockTransportOptions {
  /** Bots walking randomly (1..3). */
  bots?: number;
  /** Seeds the bots, the jitter and the round seed in `welcome`. */
  seed?: number;
  /** One-way delay in ms, applied to client→server and server→client. */
  latencyMs?: number;
  /** Extra random one-way delay 0..jitterMs (order is kept, like a WebSocket). */
  jitterMs?: number;
  tickMs?: number;
  nickname?: string;
  clock?: () => number;
}

const SELF_ID: PlayerId = 'p1';
const BOT_IDS: readonly PlayerId[] = ['p2', 'p3', 'p4'];
/** Same spawn corners as the real server (D20). */
const SPAWNS: Record<string, { x: number; y: number }> = {
  p1: { x: 1, y: 1 },
  p2: { x: 11, y: 1 },
  p3: { x: 1, y: 9 },
  p4: { x: 11, y: 9 },
};
/** tile/tick, like the real server: a step runs to the end of the tile (4 ticks). */
const SPEED = 0.25;
const DELTA: Record<Exclude<InputDir, 'none'>, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const BOT_DIRS: readonly InputDir[] = ['up', 'down', 'left', 'right', 'none'];
/** Mock bomb rules, same numbers as the real server (D29) so the picture matches. */
const BOMB_FUSE_TICKS = 40;
const FLAME_TICKS = 10;
const FLAME_RANGE = 2;
const MAX_BOMBS = 2;
const ITEM_DROP_CHANCE = 0.35;
/** After we die the mock waits this long, then starts a new round (like a rematch). */
const RESTART_AFTER_DEAD_TICKS = 60;
const BOT_BOMB_CHANCE = 0.04;

/** mulberry32 — same family as the server's PRNG, so mock bots are reproducible. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), s | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface MockPlayer {
  id: PlayerId;
  nickname: string;
  x: number;
  y: number;
  /** Held direction (D27: remembered until `none`). */
  heldDir: InputDir;
  /** Direction of the step in progress. */
  walkDir?: Exclude<InputDir, 'none'>;
  bot?: () => number;
  alive: boolean;
  /** `bomb: true` is a one-shot (D27); consumed by the next tick. */
  wantsBomb: boolean;
}

interface MockBomb {
  x: number;
  y: number;
  fuse: number;
  owner: PlayerId;
}

type Listeners = {
  welcome: Set<(m: WelcomeMessage) => void>;
  snapshot: Set<(m: SnapshotMessage) => void>;
  event: Set<(m: GameEvent) => void>;
  pong: Set<(m: PongMessage) => void>;
  error: Set<(c: ErrorCode, m?: string) => void>;
  close: Set<(i: CloseInfo) => void>;
};

/**
 * Fake server for `?mock=1`: `welcome` + player events, then a `snapshot` every tick (20 Hz).
 * Our player follows the held direction (D27); bots wander. Bombs, flames, boxes breaking, item
 * drops and deaths are faked here so the client can be drawn without the real rules.
 * Everything it emits is run through `parseServerMessage` like a real socket would be.
 */
export class MockTransport implements Transport {
  private grid = exampleGrid();
  private round = 0;
  private bombs: MockBomb[] = [];
  private flames = new Map<string, number>();
  private items: { x: number; y: number; kind: 'curse' }[] = [];
  private deadTicks = 0;
  private readonly ruleRng: () => number;
  private readonly players: MockPlayer[];
  private readonly listeners: Listeners = {
    welcome: new Set(),
    snapshot: new Set(),
    event: new Set(),
    pong: new Set(),
    error: new Set(),
    close: new Set(),
  };
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly opts: Required<Omit<MockTransportOptions, 'clock'>>;
  private readonly clock: () => number;
  private readonly jitterRng: () => number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private tick = 0;
  private ackSeq = 0;
  private lastOutAt = 0;
  private lastInAt = 0;

  constructor(options: MockTransportOptions = {}) {
    this.opts = {
      bots: Math.min(3, Math.max(1, Math.trunc(options.bots ?? 2))),
      seed: options.seed ?? 1,
      latencyMs: Math.max(0, options.latencyMs ?? 0),
      jitterMs: Math.max(0, options.jitterMs ?? 0),
      tickMs: options.tickMs ?? 50,
      nickname: options.nickname ?? 'you',
    };
    this.clock = options.clock ?? Date.now;
    this.jitterRng = createRng(this.opts.seed ^ 0x9e3779b9);
    this.ruleRng = createRng(this.opts.seed ^ 0xb0b);
    this.players = [
      this.makePlayer(SELF_ID, this.opts.nickname),
      ...BOT_IDS.slice(0, this.opts.bots).map((id, i) =>
        this.makePlayer(id, `bot${i + 1}`, createRng(this.opts.seed + i + 1)),
      ),
    ];
  }

  onWelcome(cb: (msg: WelcomeMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.welcome, cb);
  }
  onSnapshot(cb: (msg: SnapshotMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.snapshot, cb);
  }
  onEvent(cb: (msg: GameEvent) => void): Unsubscribe {
    return this.subscribe(this.listeners.event, cb);
  }
  onPong(cb: (msg: PongMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.pong, cb);
  }
  onError(cb: (code: ErrorCode, message?: string) => void): Unsubscribe {
    return this.subscribe(this.listeners.error, cb);
  }

  /** The mock never loses its "connection"; kept so scenes can subscribe the same way. */
  onClose(cb: (info: CloseInfo) => void): Unsubscribe {
    return this.subscribe(this.listeners.close, cb);
  }

  connect(): void {
    if (this.interval !== undefined) return;
    this.toClient({
      v: PROTOCOL_VERSION,
      t: 'welcome',
      playerId: SELF_ID,
      seed: this.opts.seed,
      grid: this.grid,
    });
    for (const p of this.players) {
      this.toClient({
        v: PROTOCOL_VERSION,
        t: 'event',
        kind: 'playerJoined',
        playerId: p.id,
        nickname: p.nickname,
      });
    }
    this.interval = setInterval(() => this.step(), this.opts.tickMs);
  }

  disconnect(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  send(input: TransportInput): void {
    const msg = { v: PROTOCOL_VERSION, t: 'input' as const, ...input };
    // with latencyMs the message can land after a new round started. A message sent in an earlier
    // round is dropped whole (ackSeq, heldDir and bomb alike), so no field of it leaks into the new round.
    const sentInRound = this.round;
    this.afterDelay('in', () => {
      const me = this.players[0];
      if (!me || sentInRound !== this.round) return;
      // like the server: ignore anything that is not newer than the last seq
      if (msg.seq <= this.ackSeq) return;
      this.ackSeq = msg.seq;
      me.heldDir = msg.dir;
      // a dead player cannot queue a bomb (it would otherwise fire at the respawn)
      if (msg.bomb && me.alive) me.wantsBomb = true;
    });
  }

  ping(ts: number): void {
    this.afterDelay('in', () => this.toClient({ v: PROTOCOL_VERSION, t: 'pong', ts }));
  }

  /** One server tick: move everybody, then broadcast a full snapshot. Public so tests can drive it. */
  step(): void {
    this.tick++;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.bot && !p.walkDir) {
        p.heldDir = BOT_DIRS[Math.floor(p.bot() * BOT_DIRS.length)] ?? 'none';
        if (this.ruleRng() < BOT_BOMB_CHANCE) p.wantsBomb = true;
      }
      this.move(p);
      if (p.wantsBomb) this.placeBomb(p);
      p.wantsBomb = false;
    }
    this.burn();
    this.toClient({
      v: PROTOCOL_VERSION,
      t: 'snapshot',
      tick: this.tick,
      ackSeq: this.ackSeq,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        alive: p.alive,
        curse: 0,
        teleport: false,
      })),
      bombs: this.bombs.map((b) => ({ x: b.x, y: b.y, fuse: b.fuse })),
      flames: [...this.flames.keys()].map((k) => k.split(',').map(Number)),
      items: this.items.map((i) => ({ ...i })),
    });
    this.maybeRestart();
  }

  private placeBomb(p: MockPlayer): void {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (this.bombs.some((b) => b.x === x && b.y === y)) return;
    if (this.bombs.filter((b) => b.owner === p.id).length >= MAX_BOMBS) return;
    this.bombs.push({ x, y, fuse: BOMB_FUSE_TICKS, owner: p.id });
  }

  /** Count fuses down, explode (chain reaction), age flames, kill whoever stands in fire. */
  private burn(): void {
    for (const [key, ttl] of this.flames) {
      if (ttl <= 1) this.flames.delete(key);
      else this.flames.set(key, ttl - 1);
    }
    for (const b of this.bombs) b.fuse--;
    for (;;) {
      const next = this.bombs.find((b) => b.fuse <= 0);
      if (!next) break;
      this.bombs = this.bombs.filter((b) => b !== next);
      this.explode(next);
    }
    for (const p of this.players) {
      if (p.alive && this.flames.has(`${Math.round(p.x)},${Math.round(p.y)}`)) p.alive = false;
    }
  }

  private explode(bomb: MockBomb): void {
    this.flames.set(`${bomb.x},${bomb.y}`, FLAME_TICKS);
    for (const [dx, dy] of Object.values(DELTA)) {
      for (let i = 1; i <= FLAME_RANGE; i++) {
        const x = bomb.x + dx * i;
        const y = bomb.y + dy * i;
        const tile = tileAt(this.grid, x, y);
        if (tile === undefined || tile === '#') break;
        this.flames.set(`${x},${y}`, FLAME_TICKS);
        if (tile === 'x') {
          this.breakBox(x, y);
          break;
        }
        // other bombs in the fire go off in the same tick
        for (const other of this.bombs) if (other.x === x && other.y === y) other.fuse = 0;
      }
    }
    for (const other of this.bombs) {
      if (this.flames.has(`${other.x},${other.y}`)) other.fuse = 0;
    }
  }

  private breakBox(x: number, y: number): void {
    const i = y * GRID_WIDTH + x;
    this.grid = `${this.grid.slice(0, i)}.${this.grid.slice(i + 1)}`;
    this.toClient({ v: PROTOCOL_VERSION, t: 'event', kind: 'boxDestroyed', x, y });
    if (this.ruleRng() < ITEM_DROP_CHANCE) this.items.push({ x, y, kind: 'curse' });
  }

  /** Everybody (or just we) dead for a while → new round, like a rematch. */
  private maybeRestart(): void {
    const me = this.players[0];
    this.deadTicks = me && !me.alive ? this.deadTicks + 1 : 0;
    if (this.deadTicks < RESTART_AFTER_DEAD_TICKS) return;
    this.deadTicks = 0;
    this.round++;
    this.grid = exampleGrid();
    this.bombs = [];
    this.flames.clear();
    this.items = [];
    for (const p of this.players) {
      const spawn = SPAWNS[p.id] ?? { x: 1, y: 1 };
      Object.assign(p, {
        x: spawn.x,
        y: spawn.y,
        alive: true,
        walkDir: undefined,
        heldDir: 'none',
        wantsBomb: false,
      });
    }
    this.toClient({
      v: PROTOCOL_VERSION,
      t: 'event',
      kind: 'roundStart',
      seed: this.opts.seed + this.round,
      grid: this.grid,
    });
  }

  private makePlayer(id: PlayerId, nickname: string, bot?: () => number): MockPlayer {
    const spawn = SPAWNS[id] ?? { x: 1, y: 1 };
    return {
      id,
      nickname,
      x: spawn.x,
      y: spawn.y,
      heldDir: 'none',
      bot,
      alive: true,
      wantsBomb: false,
    };
  }

  private move(p: MockPlayer): void {
    if (!p.walkDir) {
      if (p.heldDir === 'none') return;
      const [dx, dy] = DELTA[p.heldDir];
      if (tileAt(this.grid, p.x + dx, p.y + dy) !== '.') return;
      p.walkDir = p.heldDir;
    }
    const [dx, dy] = DELTA[p.walkDir];
    p.x += dx * SPEED;
    p.y += dy * SPEED;
    if (Number.isInteger(p.x) && Number.isInteger(p.y)) p.walkDir = undefined;
  }

  /** `in` = client→server, `out` = server→client. Each direction keeps its order. */
  private afterDelay(dir: 'in' | 'out', fn: () => void): void {
    const { latencyMs, jitterMs } = this.opts;
    if (latencyMs === 0 && jitterMs === 0) {
      fn();
      return;
    }
    const now = this.clock();
    const at = Math.max(
      now + latencyMs + this.jitterRng() * jitterMs,
      dir === 'in' ? this.lastInAt : this.lastOutAt,
    );
    if (dir === 'in') this.lastInAt = at;
    else this.lastOutAt = at;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, at - now);
    this.timers.add(timer);
  }

  private toClient(raw: unknown): void {
    this.afterDelay('out', () => this.deliver(raw));
  }

  private deliver(raw: unknown): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      console.warn('[MockTransport] dropped invalid message:', parsed.error.message);
      return;
    }
    const msg = parsed.data;
    switch (msg.t) {
      case 'welcome':
        for (const cb of this.listeners.welcome) cb(msg);
        break;
      case 'snapshot':
        for (const cb of this.listeners.snapshot) cb(msg);
        break;
      case 'event':
        for (const cb of this.listeners.event) cb(msg);
        break;
      case 'pong':
        for (const cb of this.listeners.pong) cb(msg);
        break;
      case 'error':
        for (const cb of this.listeners.error) cb(msg.code, msg.message);
        break;
    }
  }

  private subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }
}
