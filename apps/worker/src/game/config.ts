import type { ItemKind, KillCause } from '@booberman/protocol';

/**
 * แต้มเกรียน (troll points) from the credit table of CAR-3798: what the credited player earns per
 * kill, by cause, and per curse passed on by contact (`transfer`).
 */
export interface TrollPoints extends Readonly<Record<KillCause, number>> {
  readonly transfer: number;
}

/**
 * Every tunable number of the game rules lives here (CAR-3795: no balance
 * values scattered through the code). Ticks are 20Hz (50 ms).
 */
export interface GameConfig {
  /** Ticks to walk one tile (4 → 0.2 s). */
  readonly walkTicksPerTile: number;
  /** Tiles per tick; `1 / walkTicksPerTile` unless a test overrides it. */
  readonly playerSpeed: number;
  /** Ticks per tile for a kicked bomb (2 → 0.1 s). */
  readonly bombSlideTicksPerTile: number;
  /** Ticks from placing a bomb to its explosion (40 → 2 s). */
  readonly bombFuseTicks: number;
  /** Ticks a flame tile stays lethal (10 → 0.5 s). */
  readonly flameTicks: number;
  /** Ticks per round (3000 → 150 s). */
  readonly roundTicks: number;
  /** Bombs one player may have on the board at once. */
  readonly maxBombs: number;
  /** Flame reach in tiles. */
  readonly bombRadius: number;
  /** Chance a destroyed box drops an item (0–1). */
  readonly itemDropChance: number;
  /** Share of dropped items that are a curse (0–1); the rest are `otherItemKind`. */
  readonly curseItemShare: number;
  /** Kind of every dropped item that is not a curse (kick lets the holder kick bombs: CAR-3801). */
  readonly otherItemKind: ItemKind;
  /** Ticks of reverse-controls curse after picking one up (120 → 6 s per D39). */
  readonly curseTicks: number;
  /** A transferred curse lasts at least this many ticks (80 → 4 s), or what was left if more. */
  readonly curseMinTicksAfterTransfer: number;
  /**
   * After receiving a curse by contact the receiver cannot pass it straight back to the sender
   * for this many ticks (20 → 1 s): the first possible hand-back is exactly this many ticks later.
   */
  readonly curseTransferCooldownTicks: number;
  /** Playtest switch: a cursed player cannot drop bombs (they can only chase to pass it on). */
  readonly curseBlocksBombing: boolean;
  /** Chance a free tile starts as a box (0–1). */
  readonly boxChance: number;
  /** Points per credited kill and per curse passed on (CAR-3798); a self-kill earns nothing. */
  readonly trollPoints: TrollPoints;
}

const WALK_TICKS_PER_TILE = 4;

export const GAME_CONFIG: GameConfig = {
  walkTicksPerTile: WALK_TICKS_PER_TILE,
  playerSpeed: 1 / WALK_TICKS_PER_TILE,
  bombSlideTicksPerTile: 2,
  bombFuseTicks: 40,
  flameTicks: 10,
  roundTicks: 3000,
  maxBombs: 2,
  bombRadius: 2,
  itemDropChance: 0.35,
  curseItemShare: 0.6,
  otherItemKind: 'kick',
  curseTicks: 120,
  curseMinTicksAfterTransfer: 80,
  curseTransferCooldownTicks: 20,
  curseBlocksBombing: false,
  boxChance: 0.72,
  trollPoints: { curse: 3, ghost: 3, kick: 2, bomb: 1, self: 0, transfer: 1 },
};

/** Name used by `simulate`'s default argument (D20). */
export const DEFAULT_CONFIG = GAME_CONFIG;
