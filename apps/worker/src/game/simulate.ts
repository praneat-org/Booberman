import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import type {
  Dir,
  GameConfig,
  GameState,
  PlayerId,
  PlayerInput,
  PlayerSim,
  StepResult,
} from './types';

export const DEFAULT_CONFIG: GameConfig = { playerSpeed: 0.25 };

const VECTORS: Record<Dir, readonly [dx: number, dy: number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  none: [0, 0],
};

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

function step(p: PlayerSim, input: PlayerInput | undefined, cfg: GameConfig): PlayerSim {
  if (!input) return p;
  const ackSeq = Math.max(p.ackSeq, input.seq);
  if (!p.alive) return { ...p, ackSeq };
  const [dx, dy] = VECTORS[input.dir];
  return {
    ...p,
    // BE-29: only the board edge stops a player. Walls, boxes and bombs come with CAR-3795.
    x: clamp(p.x + dx * cfg.playerSpeed, GRID_WIDTH - 1),
    y: clamp(p.y + dy * cfg.playerSpeed, GRID_HEIGHT - 1),
    ackSeq,
  };
}

/**
 * One 50 ms tick. Pure: never mutates `state` or `inputs`; the result does not
 * depend on Map iteration order (players are stepped in id order, state keeps them sorted).
 */
export function simulate(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  cfg: GameConfig = DEFAULT_CONFIG,
): StepResult {
  return {
    state: {
      ...state,
      tick: state.tick + 1,
      players: state.players.map((p) => step(p, inputs.get(p.id), cfg)),
    },
    events: [],
  };
}
