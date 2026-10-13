/**
 * Every tunable number of the game rules lives here (CAR-3795: no balance
 * values scattered through the code). Ticks are 20Hz (50 ms).
 */
export interface GameConfig {
  /** Ticks to walk one tile (4 → 0.2 s). */
  readonly walkTicksPerTile: number;
  /** Tiles per tick; `1 / walkTicksPerTile` unless a test overrides it. */
  readonly playerSpeed: number;
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
  /** Chance a free tile starts as a box (0–1). */
  readonly boxChance: number;
}

const WALK_TICKS_PER_TILE = 4;

export const GAME_CONFIG: GameConfig = {
  walkTicksPerTile: WALK_TICKS_PER_TILE,
  playerSpeed: 1 / WALK_TICKS_PER_TILE,
  bombFuseTicks: 40,
  flameTicks: 10,
  roundTicks: 3000,
  maxBombs: 2,
  bombRadius: 2,
  itemDropChance: 0.35,
  boxChance: 0.72,
};

/** Name used by `simulate`'s default argument (D20). */
export const DEFAULT_CONFIG = GAME_CONFIG;
