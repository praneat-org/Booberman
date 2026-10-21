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

/**
 * What a player did this round (BE-41). Counts are for the end screen and for D1 (CAR-3799 columns,
 * camelCase); they start at 0 every round and are frozen when the player dies. Someone who leaves
 * takes their numbers with them (D33: no summary row for people who are gone).
 */
export interface PlayerStats {
  /** Other players killed, any cause (a self-kill is not a kill). */
  readonly kills: number;
  /** Times this player died, whoever got the credit (a self-kill counts too). */
  readonly deaths: number;
  /** Deaths whose credit fell on the victim themselves. */
  readonly selfKills: number;
  /** Kills made through a curse (`kills` includes these). */
  readonly curseKills: number;
  /** Kills made through a kicked bomb (`kills` includes these; BE-45). */
  readonly kickKills: number;
  /** Kills made as a ghost (`kills` includes these; BE-46). */
  readonly ghostKills: number;
  /** Curses this player passed on by contact. */
  readonly transfers: number;
  /** แต้มเกรียน: sum of `GameConfig.trollPoints` for every kill and every transfer. */
  readonly trollPoints: number;
}

/** What a dead player is doing as a ghost (CAR-3802); the counters tick down 1 per tick. */
export interface GhostState {
  /** Ticks until the ghost may step to the next rim tile. */
  readonly moveCd: number;
  /** Ticks until the ghost may throw a bomb (0 = ready). */
  readonly throwCd: number;
  /** True only on the tick the player became a ghost (snapshot `teleport`). */
  readonly teleport: boolean;
}

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
  /** Round counters for the end screen / D1 (BE-41). */
  readonly stats: PlayerStats;
  /** Highest input seq applied so far. */
  readonly ackSeq: number;
  /** Direction of the tile step in progress (absent / `none` while standing on a tile). */
  readonly walkDir?: Dir;
  /** D27: last direction the client asked for; the player keeps walking that way until `none`. */
  readonly heldDir: Dir;
  /**
   * Set when the player dies: owner of the bomb that started the flame (own id = suicide), or
   * `DEPARTED` when that owner has left the room (D33: nobody gets the kill). This is the raw
   * flame owner; who really gets the credit (a curse comes first) is decided in `attribution.ts`
   * and announced as the `kill` event.
   */
  readonly killedBy?: PlayerId | typeof DEPARTED;
  /** Present from the tick the player dies: they play on as a ghost on the rim of the board. */
  readonly ghost?: GhostState;
}

/** A bomb on the board. `fuse` counts down to 0, then it explodes. */
export interface Bomb {
  readonly x: number;
  readonly y: number;
  readonly ownerId: PlayerId;
  /** `PlayerSim.session` of the owner (D33); `ownerId` alone is a slot and can be reused. */
  readonly ownerSession: number;
  readonly fuse: number;
  /** `'ghost'` = lobbed by a ghost: smaller blast, and the kill counts as a ghost kill. */
  readonly kind?: 'ghost';
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
  /** Kind of bomb that lit it (absent = plain bomb); decides the kill `cause`. */
  readonly kind?: 'ghost';
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
