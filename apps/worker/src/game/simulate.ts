import { isWalkable } from './board';
import { DEFAULT_CONFIG } from './config';
import type {
  Dir,
  GameConfig,
  GameState,
  PlayerId,
  PlayerInput,
  PlayerSim,
  StepResult,
} from './types';

export { DEFAULT_CONFIG };

const VECTORS: Record<Dir, readonly [dx: number, dy: number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  none: [0, 0],
};

/** Tile the step in direction `dir` ends on, given where the player is now. */
function stepTarget(x: number, y: number, dir: Dir): readonly [number, number] {
  const [dx, dy] = VECTORS[dir];
  return [
    dx > 0 ? Math.ceil(x) : dx < 0 ? Math.floor(x) : x,
    dy > 0 ? Math.ceil(y) : dy < 0 ? Math.floor(y) : y,
  ];
}

/** Move up to `speed` tiles toward (tx, ty); snaps onto the tile when it is reached. */
function advance(p: PlayerSim, dir: Dir, tx: number, ty: number, speed: number): PlayerSim {
  const [dx, dy] = VECTORS[dir];
  const x = dx === 0 ? p.x : dx > 0 ? Math.min(p.x + speed, tx) : Math.max(p.x - speed, tx);
  const y = dy === 0 ? p.y : dy > 0 ? Math.min(p.y + speed, ty) : Math.max(p.y - speed, ty);
  const arrived = x === tx && y === ty;
  return { ...p, x, y, walkDir: arrived ? 'none' : dir };
}

/**
 * Players walk one tile at a time (`walkTicksPerTile` ticks per tile). A step
 * in progress always finishes; a new step starts from a tile centre and only
 * if the next tile is floor. Other players never block.
 */
function walk(p: PlayerSim, input: PlayerInput | undefined, grid: string, cfg: GameConfig) {
  const midStep = p.walkDir !== undefined && p.walkDir !== 'none';
  if (midStep) {
    const [tx, ty] = stepTarget(p.x, p.y, p.walkDir ?? 'none');
    return advance(p, p.walkDir ?? 'none', tx, ty, cfg.playerSpeed);
  }
  if (!input || input.dir === 'none') return p;
  const [dx, dy] = VECTORS[input.dir];
  const tx = p.x + dx;
  const ty = p.y + dy;
  if (!isWalkable(grid, tx, ty)) return p;
  return advance(p, input.dir, tx, ty, cfg.playerSpeed);
}

function step(p: PlayerSim, input: PlayerInput | undefined, grid: string, cfg: GameConfig) {
  const ackSeq = input ? Math.max(p.ackSeq, input.seq) : p.ackSeq;
  if (!p.alive) return { ...p, ackSeq };
  return { ...walk(p, input, grid, cfg), ackSeq };
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
      players: state.players.map((p) => step(p, inputs.get(p.id), state.grid, cfg)),
    },
    events: [],
  };
}
