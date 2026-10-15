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
export const Direction = z.enum(['up', 'down', 'left', 'right', 'none']);
export const ItemKind = z.enum(['curse', 'kick']);
export type ItemKind = z.infer<typeof ItemKind>;

export const ErrorCode = z.enum([
  'BAD_MESSAGE',
  'VERSION_MISMATCH',
  'ROOM_FULL',
  'INVALID_NICKNAME',
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
});

export const PlayerState = z.object({
  id: PlayerId,
  x: PosX,
  y: PosY,
  alive: z.boolean(),
  /** Ticks of "reverse controls" curse left; 0 = not cursed. */
  curse: z.number().int().min(0),
  /** Place immediately instead of interpolating (e.g. became a ghost). */
  teleport: z.boolean(),
});

export const BombState = z.object({ x: TileX, y: TileY, fuse: z.number().int().min(0) });
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
/** BE-39: the round is over. `winner` is `null` for a draw (always present, never omitted). */
export const RoundEndEvent = z.object({
  ...event,
  kind: z.literal('roundEnd'),
  winner: PlayerId.nullable(),
  reason: RoundEndReason,
});
/** D9: who is ready for a rematch and when the round starts anyway (epoch ms). */
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
/** Add new kinds here (kill, …) in the issues that need them. */
export const EventMessage = z.discriminatedUnion('kind', [
  PlayerJoinedEvent,
  PlayerLeftEvent,
  BoxDestroyedEvent,
  RoundStartEvent,
  RoundEndEvent,
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
