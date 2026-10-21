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
  /** Picked up the kick item (BE-45): walking into a bomb kicks it. Lasts until death / round end. */
  readonly hasKick: boolean;
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
}

/** A bomb on the board. `fuse` counts down to 0, then it explodes. */
export interface Bomb {
  readonly x: number;
  readonly y: number;
  readonly ownerId: PlayerId;
  /** `PlayerSim.session` of the owner (D33); `ownerId` alone is a slot and can be reused. */
  readonly ownerSession: number;
  readonly fuse: number;
  /** Set while the bomb slides after a kick (BE-45): the direction of the hops. Whole tiles only. */
  readonly slide?: Exclude<Dir, 'none'>;
  /** Ticks until the next hop of a sliding bomb. */
  readonly slideCd?: number;
  /**
   * Last player who kicked this bomb (kept after it stops): the credit for what its flames kill
   * (`cause: kick`). `session` as in D33; a kicker who has left counts for nobody.
   */
  readonly kickedBy?: { readonly id: PlayerId; readonly session: number };
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
  /** `kick` when the bomb that lit it was kicked (BE-45); absent = a normal bomb. */
  readonly kind?: 'kick';
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
