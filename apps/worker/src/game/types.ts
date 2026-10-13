import type { GameEvent, PlayerId } from '@booberman/protocol';

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
}

export interface StepResult {
  readonly state: GameState;
  readonly events: GameEvent[];
}
