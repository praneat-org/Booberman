import { GRID_WIDTH } from '@booberman/protocol';
import { isWalkable } from './board';
import { resolveExplosions } from './bombs';
import { DEFAULT_CONFIG } from './config';
import { VECTORS } from './dirs';
import type {
  Bomb,
  Dir,
  GameConfig,
  GameState,
  PlayerId,
  PlayerInput,
  PlayerSim,
  StepResult,
} from './types';

export { DEFAULT_CONFIG };

const tileKey = (x: number, y: number) => y * GRID_WIDTH + x;

/** The tile a (possibly mid-step) player counts as standing on: the nearest one. */
const tileOf = (p: PlayerSim): readonly [number, number] => [Math.round(p.x), Math.round(p.y)];

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
 * in progress always finishes; a new step starts from a tile centre, in the
 * direction the player is holding (D27), and only if the next tile is floor
 * without a bomb. Leaving a bomb tile is always fine, entering one is not
 * (so you can step off your own bomb but not back onto it). Other players never block.
 */
function walk(p: PlayerSim, grid: string, bombTiles: ReadonlySet<number>, cfg: GameConfig) {
  const midStep = p.walkDir !== undefined && p.walkDir !== 'none';
  if (midStep) {
    const [tx, ty] = stepTarget(p.x, p.y, p.walkDir ?? 'none');
    return advance(p, p.walkDir ?? 'none', tx, ty, cfg.playerSpeed);
  }
  if (p.heldDir === 'none') return p;
  const [dx, dy] = VECTORS[p.heldDir];
  const tx = p.x + dx;
  const ty = p.y + dy;
  if (!isWalkable(grid, tx, ty) || bombTiles.has(tileKey(tx, ty))) return p;
  return advance(p, p.heldDir, tx, ty, cfg.playerSpeed);
}

function step(
  p: PlayerSim,
  input: PlayerInput | undefined,
  grid: string,
  bombTiles: ReadonlySet<number>,
  cfg: GameConfig,
): PlayerSim {
  const ackSeq = input ? Math.max(p.ackSeq, input.seq) : p.ackSeq;
  if (!p.alive) return { ...p, ackSeq };
  // D27: any input sets the held direction; no input keeps the old one.
  const held = input ? { ...p, heldDir: input.dir } : p;
  return { ...walk(held, grid, bombTiles, cfg), ackSeq };
}

/** Bombs dropped this tick: on the nearest tile, at most `maxBombs` per owner, one per tile. */
function placeBombs(
  players: readonly PlayerSim[],
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  bombs: readonly Bomb[],
  cfg: GameConfig,
): Bomb[] {
  const out = [...bombs];
  for (const p of players) {
    if (!p.alive || !inputs.get(p.id)?.bomb) continue;
    const [x, y] = tileOf(p);
    const mine = out.filter((b) => b.ownerId === p.id).length;
    if (mine >= cfg.maxBombs || out.some((b) => b.x === x && b.y === y)) continue;
    out.push({ x, y, ownerId: p.id, fuse: cfg.bombFuseTicks });
  }
  return out;
}

/** Anyone on a burning tile dies; the credit goes to the owner of the first flame on that tile. */
function applyDeaths(players: readonly PlayerSim[], flames: GameState['flames']): PlayerSim[] {
  return players.map((p) => {
    if (!p.alive) return p;
    const [x, y] = tileOf(p);
    const fire = flames.find((f) => f.x === x && f.y === y);
    if (!fire) return p;
    return { ...p, alive: false, heldDir: 'none', walkDir: 'none', killedBy: fire.ownerId };
  });
}

/**
 * One 50 ms tick, in a fixed order: age bombs and flames -> walk -> place bombs ->
 * explode due bombs and their chain (boxes break, items drop) -> deaths.
 * Pure: never mutates `state` or `inputs`; the result does not depend on Map iteration
 * order (players are stepped in id order, state keeps them sorted).
 */
export function simulate(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  cfg: GameConfig = DEFAULT_CONFIG,
): StepResult {
  const bombTiles = new Set(state.bombs.map((b) => tileKey(b.x, b.y)));
  // A bomb placed this tick keeps its full fuse: only bombs that already existed count down.
  const counting = state.bombs.map((b) => ({ ...b, fuse: b.fuse - 1 }));
  const burning = state.flames.map((f) => ({ ...f, ttl: f.ttl - 1 })).filter((f) => f.ttl > 0);

  const walked = state.players.map((p) => step(p, inputs.get(p.id), state.grid, bombTiles, cfg));
  const blast = resolveExplosions(
    {
      grid: state.grid,
      bombs: placeBombs(walked, inputs, counting, cfg),
      flames: burning,
      items: state.items,
      rngSeed: state.rngSeed,
    },
    cfg,
  );

  return {
    state: {
      ...state,
      tick: state.tick + 1,
      rngSeed: blast.rngSeed,
      grid: blast.grid,
      players: applyDeaths(walked, blast.flames),
      bombs: blast.bombs,
      flames: blast.flames,
      items: blast.items,
    },
    events: blast.events,
  };
}
