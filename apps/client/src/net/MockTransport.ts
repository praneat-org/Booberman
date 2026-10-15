import {
  type ErrorCode,
  exampleGrid,
  type GameEvent,
  type PlayerId,
  PROTOCOL_VERSION,
  parseServerMessage,
  tileAt,
} from '@booberman/protocol';
import type {
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
}

type Listeners = {
  welcome: Set<(m: WelcomeMessage) => void>;
  snapshot: Set<(m: SnapshotMessage) => void>;
  event: Set<(m: GameEvent) => void>;
  pong: Set<(m: PongMessage) => void>;
  error: Set<(c: ErrorCode, m?: string) => void>;
};

/**
 * Fake server for `?mock=1`: `welcome` + player events, then a `snapshot` every tick (20 Hz).
 * Our player follows the held direction (D27); bots wander. No bombs / flames yet (FE-15).
 * Everything it emits is run through `parseServerMessage` like a real socket would be.
 */
export class MockTransport implements Transport {
  private readonly grid = exampleGrid();
  private readonly players: MockPlayer[];
  private readonly listeners: Listeners = {
    welcome: new Set(),
    snapshot: new Set(),
    event: new Set(),
    pong: new Set(),
    error: new Set(),
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
    this.afterDelay('in', () => {
      const me = this.players[0];
      // like the server: ignore anything that is not newer than the last seq
      if (!me || msg.seq <= this.ackSeq) return;
      this.ackSeq = msg.seq;
      me.heldDir = msg.dir;
    });
  }

  ping(ts: number): void {
    this.afterDelay('in', () => this.toClient({ v: PROTOCOL_VERSION, t: 'pong', ts }));
  }

  /** One server tick: move everybody, then broadcast a full snapshot. Public so tests can drive it. */
  step(): void {
    this.tick++;
    for (const p of this.players) {
      if (p.bot && !p.walkDir)
        p.heldDir = BOT_DIRS[Math.floor(p.bot() * BOT_DIRS.length)] ?? 'none';
      this.move(p);
    }
    this.toClient({
      v: PROTOCOL_VERSION,
      t: 'snapshot',
      tick: this.tick,
      ackSeq: this.ackSeq,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        alive: true,
        curse: 0,
        teleport: false,
      })),
      bombs: [],
      flames: [],
      items: [],
    });
  }

  private makePlayer(id: PlayerId, nickname: string, bot?: () => number): MockPlayer {
    const spawn = SPAWNS[id] ?? { x: 1, y: 1 };
    return { id, nickname, x: spawn.x, y: spawn.y, heldDir: 'none', bot };
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
