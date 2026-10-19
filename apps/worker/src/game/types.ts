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

/** `killedBy` value for a kill credited to a player who has since left the room (D33): counts for nobody. */
export const DEPARTED = 'departed';

export interface PlayerSim {
  readonly id: PlayerId;
  /**
   * D33: id of this player's join, never reused (a new player in the same slot gets a new one).
   * Bombs are owned by session, so a leaver's bombs never count against whoever takes the slot.
   */
  readonly session: number;
  /** Tile units; fractional while walking between tiles. */
  readonly x: number;
  readonly y: number;
  readonly alive: boolean;
  /**
   * Ticks of reverse-controls curse left (0 = none); ages once per tick. A dead player keeps the
   * value (and the fields below) as it was at death, frozen, so kill attribution (BE-41) can read
   * who the curse came from; snapshots report 0 for the dead.
   */
  readonly curse: number;
  /**
   * Who the current curse came from, for kill attribution: the player who broke the box (item
   * pickup) or who passed it on (contact). `null` = no one to credit: not cursed, or picked up from
   * a box this player broke themselves. `DEPARTED` = that player has left the room (D33: counts for
   * nobody). Use `curseSourceOf` at the moment of death, not this field alone: the slot may have
   * been taken over by someone else since.
   */
  readonly cursedBy: PlayerId | typeof DEPARTED | null;
  /** `PlayerSim.session` of `cursedBy` (D33), `null` when `cursedBy` is `null`. */
  readonly cursedBySession: number | null;
  /** Ticks left in which this player cannot hand the curse back to `cursedBy` (0 = free). */
  readonly curseCooldown: number;
  /** Times this player passed a curse on by contact this round (stats / nicknames, BE-41). */
  readonly curseTransfers: number;
  /** Highest input seq applied so far. */
  readonly ackSeq: number;
  /** Direction of the tile step in progress (absent / `none` while standing on a tile). */
  readonly walkDir?: Dir;
  /** D27: last direction the client asked for; the player keeps walking that way until `none`. */
  readonly heldDir: Dir;
  /**
   * Set when the player dies: owner of the bomb that started the flame (own id = suicide), or
   * `DEPARTED` when that owner has left the room (D33: nobody gets the kill).
   */
  readonly killedBy?: PlayerId | typeof DEPARTED;
}

/** A bomb on the board. `fuse` counts down to 0, then it explodes. */
export interface Bomb {
  readonly x: number;
  readonly y: number;
  readonly ownerId: PlayerId;
  /** `PlayerSim.session` of the owner (D33); `ownerId` alone is a slot and can be reused. */
  readonly ownerSession: number;
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
  /** Session of the credited owner (D33); resolved to a living player only when someone dies. */
  readonly ownerSession: number;
  /** Ticks left; the tile is removed when it reaches 0. */
  readonly ttl: number;
}

/** An item lying on the floor. `droppedBy` = whose flame broke the box (not sent to clients). */
export interface Item {
  readonly x: number;
  readonly y: number;
  readonly kind: ItemKind;
  readonly droppedBy: PlayerId;
  /** `PlayerSim.session` of `droppedBy` (D33): the curse credit must survive the slot being reused. */
  readonly droppedBySession: number;
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
  /**
   * True once two or more players were in this round at the same time (sticky). Elimination
   * ends the round only when contested, so a player who left mid-round still leaves the other
   * as `lastAlive`, while someone playing alone from the start is not declared the winner.
   * Lives in the state (not RoomDO) so replays stay deterministic.
   */
  readonly contested: boolean;
  /** Set once the round is over; `simulate` then stops changing anything but `tick`. */
  readonly result?: RoundResult;
}

export interface StepResult {
  readonly state: GameState;
  readonly events: GameEvent[];
}
