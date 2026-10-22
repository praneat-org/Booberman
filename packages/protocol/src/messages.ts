import { z } from 'zod';
import { Grid, PosX, PosY, Seed, TileX, TileY } from './board';
import { validateNickname } from './nickname';
import { MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION } from './version';

const v = z.literal(PROTOCOL_VERSION);

export const PlayerId = z.string().regex(/^p[1-4]$/, 'playerId is p1..p4');
export const RoomId = z.string().regex(/^[a-z0-9]{4,12}$/, 'room id is 4-12 chars a-z 0-9');
/**
 * BE-35: validates with `validateNickname` and outputs the trimmed value.
 * A rule failure is a `custom` issue whose `params.nicknameReason` is the reason,
 * which `parse.ts` turns into the `INVALID_NICKNAME` error code (a wrong type stays BAD_MESSAGE).
 */
export const Nickname = z.string().transform((raw, ctx) => {
  const r = validateNickname(raw);
  if (r.ok) return r.value;
  ctx.issues.push({
    code: 'custom',
    message: r.reason,
    input: raw,
    params: { nicknameReason: r.reason },
  });
  return z.NEVER;
});
/**
 * BE-44: secret the server hands out in `welcome` and the client sends back in `join` to take its slot
 * back after a dropped connection. Opaque to the client; the server decides whether it is valid, so
 * the schema only bounds the size (a wrong token must answer INVALID_TOKEN, not BAD_MESSAGE).
 */
export const ReconnectToken = z.string().min(1).max(64);
export const Direction = z.enum(['up', 'down', 'left', 'right', 'none']);
export const ItemKind = z.enum(['curse', 'kick']);
export type ItemKind = z.infer<typeof ItemKind>;

export const ErrorCode = z.enum([
  'BAD_MESSAGE',
  'VERSION_MISMATCH',
  'ROOM_FULL',
  'INVALID_NICKNAME',
  'INVALID_TOKEN',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

// ── Client → Server ─────────────────────────────────────────────────────────
// Clients only say what they *want* to do. `.strict()` rejects any extra field,
// so a client can never send a position, life or game result.

export const JoinMessage = z.strictObject({
  v,
  t: z.literal('join'),
  room: RoomId,
  nickname: Nickname,
  /**
   * BE-44: the `welcome.token` of the connection that dropped. With it the server gives back that
   * player's slot (same playerId, same state) if it is still held (15 s); a wrong or expired token
   * is answered with `INVALID_TOKEN` and the socket is closed. Without it this is a normal join.
   */
  token: ReconnectToken.optional(),
});
export const InputMessage = z.strictObject({
  v,
  t: z.literal('input'),
  /** Increases per input; the server drops anything not newer than the last seq. */
  seq: z.number().int().min(0),
  dir: Direction,
  bomb: z.boolean(),
});
export const PingMessage = z.strictObject({ v, t: z.literal('ping'), ts: z.number() });
/** D9: "play again" — ready up; the round restarts when everyone is ready or 15 s pass. */
export const RematchMessage = z.strictObject({ v, t: z.literal('rematch') });

export const ClientMessage = z.discriminatedUnion('t', [
  JoinMessage,
  InputMessage,
  PingMessage,
  RematchMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ── Server → Client ─────────────────────────────────────────────────────────

export const WelcomeMessage = z.object({
  v,
  t: z.literal('welcome'),
  playerId: PlayerId,
  seed: Seed,
  grid: Grid,
  /**
   * BE-44: reconnect token, random and bound to `playerId` in this room. A new one is issued by every
   * `welcome` (a successful reconnect rotates it), so keep the latest. Never sent to other players.
   */
  token: ReconnectToken,
});

export const PlayerState = z.object({
  id: PlayerId,
  x: PosX,
  y: PosY,
  alive: z.boolean(),
  /**
   * Ticks of "reverse controls" curse left (BE-40); 0 = not cursed (always 0 for a dead player).
   * The server reverses the directions; the client only shows it. Counts down 1 per tick from 160
   * (8 s); a transfer by contact keeps what was left or at least 80. Shape unchanged: no version bump.
   */
  curse: z.number().int().min(0),
  /** Place immediately instead of interpolating (e.g. became a ghost). */
  teleport: z.boolean(),
  /** Dead players play on as ghosts on the rim (CAR-3802); only sent when true. */
  ghost: z.boolean().optional(),
  /** Ghosts only: ticks until they can throw a bomb (0 = ready). 20 ticks = 1 s. */
  throwCooldown: z.number().int().min(0).optional(),
  /** BE-45: holds the kick item (until death). Sent only when true; absent = false. */
  kick: z.boolean().optional(),
});

export const BombState = z.object({
  x: TileX,
  y: TileY,
  fuse: z.number().int().min(0),
  /** Lobbed by a ghost: draw it small (CAR-3802); only sent when true. */
  ghost: z.boolean().optional(),
  /**
   * BE-45: the bomb is sliding after a kick, in this direction. Sent only while it slides. `x` / `y`
   * stay whole tiles (D16): a sliding bomb hops one tile every 2 ticks, so the client tweens
   * between the hops. Not sent once it stops.
   */
  slide: z.enum(['up', 'down', 'left', 'right']).optional(),
});
export const FlameTile = z.tuple([TileX, TileY]);
export const ItemState = z.object({ x: TileX, y: TileY, kind: ItemKind });

/** Full room state every tick (no deltas in v1). Boxes come from `grid` + `boxDestroyed`. */
export const SnapshotMessage = z.object({
  v,
  t: z.literal('snapshot'),
  tick: z.number().int().min(0),
  /** Highest input seq of *this* client the server has applied. */
  ackSeq: z.number().int().min(0),
  players: z.array(PlayerState).max(MAX_PLAYERS_PER_ROOM),
  bombs: z.array(BombState),
  flames: z.array(FlameTile),
  items: z.array(ItemState),
});

const event = { v, t: z.literal('event') };
export const BoxDestroyedEvent = z.object({
  ...event,
  kind: z.literal('boxDestroyed'),
  x: TileX,
  y: TileY,
});
/** D8: new round — client clears the board and redraws from `grid`. */
export const RoundStartEvent = z.object({
  ...event,
  kind: z.literal('roundStart'),
  seed: Seed,
  grid: Grid,
});
/**
 * Why a round ended. `lastAlive` = one survivor (winner), `allDead` = everyone died on the same
 * tick (draw), `timeout` = the round clock ran out (draw).
 */
export const RoundEndReason = z.enum(['lastAlive', 'allDead', 'timeout']);
export type RoundEndReason = z.infer<typeof RoundEndReason>;

/**
 * Why a player died, decided on the server by the credit table of CAR-3798 (first match wins):
 * `curse` = they carried a curse someone else gave them (credit to that someone), `ghost` / `kick`
 * = the flame came from a ghost's bomb (BE-46) / a kicked bomb (BE-45, credit to the kicker), `bomb` = a normal bomb, `self` = the credit fell on the victim themselves (killer = victim).
 */
export const KillCause = z.enum(['curse', 'ghost', 'kick', 'bomb', 'self']);
export type KillCause = z.infer<typeof KillCause>;

/**
 * Round titles (ฉายา), in the order the end screen lists them. The Thai names are in `TITLE_LABELS`.
 * `backstabber` (kick kills) and `haunter` (ghost kills) can only be earned once BE-45 / BE-46 land.
 */
export const TitleId = z.enum(['spreader', 'backstabber', 'haunter', 'selfKiller', 'troll']);
export type TitleId = z.infer<typeof TitleId>;
export const TITLE_LABELS: Readonly<Record<TitleId, string>> = {
  spreader: 'ผู้แพร่เชื้อ',
  backstabber: 'จอมแทงข้างหลัง',
  haunter: 'ผีดุ',
  selfKiller: 'ฆ่าตัวเองเก่ง',
  troll: 'ตัวตึงสายเกรียน',
};

const Count = z.number().int().min(0);
/**
 * One player's round in the end screen table (BE-41). Names are the D1 columns of CAR-3799 in
 * camelCase. `kills` counts other players only (a self-kill is in `deaths` and `selfKills`, not here).
 */
export const PlayerRoundStats = z.object({
  id: PlayerId,
  kills: Count,
  deaths: Count,
  selfKills: Count,
  curseKills: Count,
  /** Curses this player passed on by contact. */
  transfers: Count,
  /** แต้มเกรียน, summed by the server from the credit table (the values live in the worker's `GameConfig.trollPoints`). */
  trollPoints: Count,
});
/**
 * A title and everyone who holds it. Ties share the title (every player on the highest value);
 * a title nobody earned (value 0) is not sent at all. `value` is the score they tied on.
 */
export const RoundTitle = z.object({
  title: TitleId,
  players: z.array(PlayerId).min(1).max(MAX_PLAYERS_PER_ROOM),
  value: z.number().int().min(1),
});

export type PlayerRoundStats = z.infer<typeof PlayerRoundStats>;
export type RoundTitle = z.infer<typeof RoundTitle>;

/**
 * BE-39 / BE-41: the round is over. `winner` is `null` for a draw (always present, never omitted).
 * `stats` = one row per player still in the room, already sorted for the end screen (แต้มเกรียน high
 * to low, then kills high to low, deaths low to high, then id); `titles` in the `TitleId` order.
 */
export const RoundEndEvent = z.object({
  ...event,
  kind: z.literal('roundEnd'),
  winner: PlayerId.nullable(),
  reason: RoundEndReason,
  stats: z.array(PlayerRoundStats).max(MAX_PLAYERS_PER_ROOM),
  titles: z.array(RoundTitle).max(TitleId.options.length),
});
/**
 * BE-41: a player died. `killer` is the player who gets the credit (own id for `self`), or `null`
 * when the credit belongs to someone who has left the room (D33: counts for nobody, still a death).
 * The field is called `cause`, not `kind`: `kind` is what tells events apart.
 */
export const KillEvent = z.object({
  ...event,
  kind: z.literal('kill'),
  killer: PlayerId.nullable(),
  victim: PlayerId,
  cause: KillCause,
});
/**
 * D9: who is ready for a rematch and when the round starts anyway (epoch ms). `deadline` is 0 while
 * nobody is ready (no countdown running). Sent when someone presses, and when someone who pressed
 * leaves; the start itself is announced by `roundStart`.
 */
export const RematchStatusEvent = z.object({
  ...event,
  kind: z.literal('rematchStatus'),
  ready: z.array(PlayerId).max(MAX_PLAYERS_PER_ROOM),
  deadline: z.number().int().min(0),
});
/** BE-28: someone joined the room (also replayed to a newcomer for everyone already there). */
export const PlayerJoinedEvent = z.object({
  ...event,
  kind: z.literal('playerJoined'),
  playerId: PlayerId,
  nickname: Nickname,
});
export const PlayerLeftEvent = z.object({
  ...event,
  kind: z.literal('playerLeft'),
  playerId: PlayerId,
});
/** Add new kinds here in the issues that need them. */
export const EventMessage = z.discriminatedUnion('kind', [
  PlayerJoinedEvent,
  PlayerLeftEvent,
  BoxDestroyedEvent,
  RoundStartEvent,
  RoundEndEvent,
  KillEvent,
  RematchStatusEvent,
]);

export const ErrorMessage = z.object({
  v,
  t: z.literal('error'),
  code: ErrorCode,
  /** Human-readable detail for logs; never a stack trace. */
  message: z.string().max(200).optional(),
});

/** D7: echo of `ping.ts`, sent immediately (not on the tick). */
export const PongMessage = z.object({ v, t: z.literal('pong'), ts: z.number() });

export const ServerMessage = z.discriminatedUnion('t', [
  WelcomeMessage,
  SnapshotMessage,
  EventMessage,
  ErrorMessage,
  PongMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type PlayerState = z.infer<typeof PlayerState>;
export type PlayerId = z.infer<typeof PlayerId>;
export type GameEvent = z.infer<typeof EventMessage>;
