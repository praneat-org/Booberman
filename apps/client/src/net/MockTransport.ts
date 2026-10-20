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
  /** Whole-ms clock for the delay maths (tests drive it); defaults to `Date.now`. */
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
/** After we die, or after the round ended, the mock waits this long, then starts a new round (like a rematch). */
const RESTART_AFTER_TICKS = 60;
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
  /**
   * Announced to us with `playerJoined`. Only the bots have one: like the real server (D17), the
   * mock never echoes our own join back, so the client must already know the name it joined with.
   */
  nickname?: string;
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
  kills: number;
  deaths: number;
  selfKills: number;
}

interface MockBomb {
  x: number;
  y: number;
  fuse: number;
  owner: PlayerId;
}

interface MockFlame {
  ttl: number;
  owner: PlayerId;
}

/**
 * One direction of the fake network: a FIFO of messages with the time each is due. Only the head
 * has a timer, so delivery order is the order of `afterDelay` calls whatever the timers do (the
 * browser truncates delays to whole ms, so two timers set a millisecond apart can swap).
 */
interface DelayLine {
  items: { at: number; fn: () => void }[];
  timer: ReturnType<typeof setTimeout> | undefined;
  /** True while `deliverDue` runs, so a message queued from a callback cannot start a second timer. */
  delivering: boolean;
  /** Due time of the last message queued; the next one is never earlier. */
  lastAt: number;
}

const newDelayLine = (): DelayLine => ({
  items: [],
  timer: undefined,
  delivering: false,
  lastAt: 0,
});

/**
 * Forgets everything the line holds for the session that ends: the queued messages, their timer and
 * the due time of the last one (else the next session's first message would wait for the old
 * session's slowest). `delivering` is left alone, `deliverDue` owns it.
 */
const clearDelayLine = (line: DelayLine): void => {
  if (line.timer !== undefined) clearTimeout(line.timer);
  line.timer = undefined;
  line.items = [];
  line.lastAt = 0;
};

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
 * drops, picking items up, deaths and the end of the round (`roundEnd` once one player or none is
 * left) are faked here so the client can be drawn and heard without the real rules.
 * Everything it emits is run through `parseServerMessage` like a real socket would be.
 */
export class MockTransport implements Transport {
  private grid = exampleGrid();
  private round = 0;
  private bombs: MockBomb[] = [];
  private flames = new Map<string, MockFlame>();
  private items: { x: number; y: number; kind: 'curse' }[] = [];
  private deadTicks = 0;
  /** `roundEnd` was sent: like the server, the state stands still until the next round starts. */
  private ended = false;
  private endedTicks = 0;
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
  /** `in` = client→server, `out` = server→client. */
  private readonly lines = { in: newDelayLine(), out: newDelayLine() };
  private readonly opts: Required<Omit<MockTransportOptions, 'clock'>>;
  private readonly clock: () => number;
  private readonly jitterRng: () => number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private tick = 0;
  private ackSeq = 0;

  constructor(options: MockTransportOptions = {}) {
    this.opts = {
      bots: Math.min(3, Math.max(1, Math.trunc(options.bots ?? 2))),
      seed: options.seed ?? 1,
      latencyMs: Math.max(0, options.latencyMs ?? 0),
      jitterMs: Math.max(0, options.jitterMs ?? 0),
      tickMs: options.tickMs ?? 50,
    };
    this.clock = options.clock ?? Date.now;
    this.jitterRng = createRng(this.opts.seed ^ 0x9e3779b9);
    this.ruleRng = createRng(this.opts.seed ^ 0xb0b);
    this.players = [
      this.makePlayer(SELF_ID),
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
      if (p.nickname === undefined) continue;
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
    for (const line of Object.values(this.lines)) clearDelayLine(line);
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
    // a finished round stands still, only the tick moves (D32)
    if (!this.ended) {
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
      this.pickUpItems();
      this.checkRoundEnd();
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
    for (const [key, flame] of this.flames) {
      if (flame.ttl <= 1) this.flames.delete(key);
      else this.flames.set(key, { ...flame, ttl: flame.ttl - 1 });
    }
    for (const b of this.bombs) b.fuse--;
    for (;;) {
      const next = this.bombs.find((b) => b.fuse <= 0);
      if (!next) break;
      this.bombs = this.bombs.filter((b) => b !== next);
      this.explode(next);
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const flame = this.flames.get(`${Math.round(p.x)},${Math.round(p.y)}`);
      if (!flame) continue;
      p.alive = false;
      p.deaths++;
      if (flame.owner === p.id) p.selfKills++;
      else {
        const owner = this.players.find((candidate) => candidate.id === flame.owner);
        if (owner) owner.kills++;
      }
    }
  }

  /** Whoever stands on an item takes it (nearest tile, like the bombs and flames). The mock gives no curse. */
  private pickUpItems(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      this.items = this.items.filter((i) => i.x !== x || i.y !== y);
    }
  }

  /** One player left = winner, nobody left = draw. Sent before the snapshot of that tick, like the server. */
  private checkRoundEnd(): void {
    const alive = this.players.filter((p) => p.alive);
    if (alive.length > 1) return;
    this.ended = true;
    this.toClient({
      v: PROTOCOL_VERSION,
      t: 'event',
      kind: 'roundEnd',
      winner: alive[0]?.id ?? null,
      reason: alive.length === 1 ? 'lastAlive' : 'allDead',
      stats: this.players.map((p) => ({
        id: p.id,
        kills: p.kills,
        deaths: p.deaths,
        selfKills: p.selfKills,
        curseKills: 0,
        transfers: 0,
        trollPoints: 0,
      })),
      titles: [],
    });
  }

  private explode(bomb: MockBomb): void {
    this.ignite(`${bomb.x},${bomb.y}`, bomb.owner);
    for (const [dx, dy] of Object.values(DELTA)) {
      for (let i = 1; i <= FLAME_RANGE; i++) {
        const x = bomb.x + dx * i;
        const y = bomb.y + dy * i;
        const tile = tileAt(this.grid, x, y);
        if (tile === undefined || tile === '#') break;
        this.ignite(`${x},${y}`, bomb.owner);
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

  private ignite(key: string, owner: PlayerId): void {
    const existing = this.flames.get(key);
    this.flames.set(key, { ttl: FLAME_TICKS, owner: existing?.owner ?? owner });
  }

  private breakBox(x: number, y: number): void {
    const i = y * GRID_WIDTH + x;
    this.grid = `${this.grid.slice(0, i)}.${this.grid.slice(i + 1)}`;
    this.toClient({ v: PROTOCOL_VERSION, t: 'event', kind: 'boxDestroyed', x, y });
    if (this.ruleRng() < ITEM_DROP_CHANCE) this.items.push({ x, y, kind: 'curse' });
  }

  /** We are dead for a while, or the round has ended for a while → new round, like a rematch. */
  private maybeRestart(): void {
    const me = this.players[0];
    this.deadTicks = me && !me.alive ? this.deadTicks + 1 : 0;
    this.endedTicks = this.ended ? this.endedTicks + 1 : 0;
    if (this.deadTicks < RESTART_AFTER_TICKS && this.endedTicks < RESTART_AFTER_TICKS) return;
    this.deadTicks = 0;
    this.endedTicks = 0;
    this.ended = false;
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
        kills: 0,
        deaths: 0,
        selfKills: 0,
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

  private makePlayer(id: PlayerId, nickname?: string, bot?: () => number): MockPlayer {
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
      kills: 0,
      deaths: 0,
      selfKills: 0,
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

  /**
   * Runs `fn` after the simulated latency + jitter. Each direction is a FIFO (`DelayLine`), like one
   * WebSocket: a message is never delivered before an earlier one, so `welcome` always comes first.
   */
  private afterDelay(dir: 'in' | 'out', fn: () => void): void {
    const { latencyMs, jitterMs } = this.opts;
    if (latencyMs === 0 && jitterMs === 0) {
      fn();
      return;
    }
    const line = this.lines[dir];
    const at = Math.max(this.clock() + latencyMs + this.jitterRng() * jitterMs, line.lastAt);
    line.lastAt = at;
    line.items.push({ at, fn });
    this.arm(line);
  }

  /** Timer for the head of the line only; it fires, delivers, and arms the next one. */
  private arm(line: DelayLine): void {
    const head = line.items[0];
    if (line.delivering || line.timer !== undefined || !head) return;
    line.timer = setTimeout(
      () => {
        line.timer = undefined;
        this.deliverDue(line);
      },
      Math.max(0, head.at - this.clock()),
    );
  }

  /** The head (its timer fired) and whatever else is already due go out now, in order. */
  private deliverDue(line: DelayLine): void {
    line.delivering = true;
    try {
      let item = line.items.shift();
      while (item) {
        item.fn();
        const next = line.items[0];
        item = next && next.at <= this.clock() ? line.items.shift() : undefined;
      }
    } finally {
      line.delivering = false;
      this.arm(line);
    }
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
