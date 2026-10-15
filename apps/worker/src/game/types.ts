import type { GameEvent, ItemKind, PlayerId, RoundEndReason } from '@booberman/protocol';

export type { GameConfig } from './config';
export type { PlayerId };

export type Dir = 'up' | 'down' | 'left' | 'right' | 'none';

/** What a client asked for this tick (already validated by `parseClientMessage`). */
export interface PlayerInput {
  readonly dir: Dir;
  readonly bomb: boolean;
  readonly seq: number;
}

export interface PlayerSim {
  readonly id: PlayerId;
  /** Tile units; fractional while walking between tiles. */
  readonly x: number;
  readonly y: number;
  readonly alive: boolean;
  /** Ticks of reverse-controls curse left (0 = none). Used by the real rules (CAR-3795). */
  readonly curse: number;
  /** Highest input seq applied so far. */
  readonly ackSeq: number;
  /** Direction of the tile step in progress (absent / `none` while standing on a tile). */
  readonly walkDir?: Dir;
  /** D27: last direction the client asked for; the player keeps walking that way until `none`. */
  readonly heldDir: Dir;
  /** Set when the player dies: owner of the bomb that started the flame (own id = suicide). */
  readonly killedBy?: PlayerId;
}

/** A bomb on the board. `fuse` counts down to 0, then it explodes. */
export interface Bomb {
  readonly x: number;
  readonly y: number;
  readonly ownerId: PlayerId;
  readonly fuse: number;
}

/**
 * One burning tile. `ownerId` is who gets the credit: the owner of the first bomb of the
 * chain (a chained bomb's flames carry the owner of the bomb that set it off).
 */
export interface Flame {
  readonly x: number;
  readonly y: number;
  readonly ownerId: PlayerId;
  /** Ticks left; the tile is removed when it reaches 0. */
  readonly ttl: number;
}

/** An item lying on the floor. `droppedBy` = whose flame broke the box (not sent to clients). */
export interface Item {
  readonly x: number;
  readonly y: number;
  readonly kind: ItemKind;
  readonly droppedBy: PlayerId;
}

/** How a finished round ended; `winner` is `null` for a draw. Mirrors the `roundEnd` event. */
export interface RoundResult {
  readonly winner: PlayerId | null;
  readonly reason: RoundEndReason;
}

export interface GameState {
  readonly tick: number;
  /** Match seed, as handed to `createInitialState` (also sent to clients). */
  readonly seed: number;
  /** Current PRNG state — advanced on every random draw so replays are exact. */
  readonly rngSeed: number;
  /** 13×11 tiles, `#` wall · `x` box · `.` floor. */
  readonly grid: string;
  /** Sorted by player id. */
  readonly players: readonly PlayerSim[];
  readonly bombs: readonly Bomb[];
  readonly flames: readonly Flame[];
  readonly items: readonly Item[];
  /** Set once the round is over; `simulate` then stops changing anything but `tick`. */
  readonly result?: RoundResult;
}

export interface StepResult {
  readonly state: GameState;
  readonly events: GameEvent[];
}
