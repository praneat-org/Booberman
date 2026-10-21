import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { isWalkable } from './board';
import type { GameConfig } from './config';
import { VECTORS } from './dirs';
import type { Bomb, Dir, GhostState, PlayerId, PlayerInput, PlayerSim } from './types';

/** Ghost revenge (CAR-3802): the dead walk the rim of the board and lob small bombs inward. */

const LAST_X = GRID_WIDTH - 1;
const LAST_Y = GRID_HEIGHT - 1;

/** A tile a ghost may stand on: the outer ring of the board, corners excluded. */
export const isGhostTile = (x: number, y: number): boolean => {
  const onX = x === 0 || x === LAST_X;
  const onY = y === 0 || y === LAST_Y;
  return onX !== onY && x >= 0 && x <= LAST_X && y >= 0 && y <= LAST_Y;
};

/** Ring tile closest to (x, y); ties go to the first in row-major order (deterministic). */
export function nearestRimTile(x: number, y: number): readonly [number, number] {
  let best: readonly [number, number] = [1, 0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (let ty = 0; ty < GRID_HEIGHT; ty++) {
    for (let tx = 0; tx < GRID_WIDTH; tx++) {
      if (!isGhostTile(tx, ty)) continue;
      const d = Math.abs(tx - x) + Math.abs(ty - y);
      if (d < bestDist) {
        bestDist = d;
        best = [tx, ty];
      }
    }
  }
  return best;
}

/** Everyone who is dead and not yet a ghost becomes one on the rim tile nearest where they died. */
export function spawnGhosts(players: readonly PlayerSim[], cfg: GameConfig): PlayerSim[] {
  return players.map((p) => {
    if (p.alive || p.ghost) return p;
    const [x, y] = nearestRimTile(Math.round(p.x), Math.round(p.y));
    const ghost: GhostState = { moveCd: 0, throwCd: cfg.ghostFirstThrowTicks, teleport: true };
    return { ...p, x, y, ghost };
  });
}

/** Direction pointing from the rim into the board. */
const inward = (x: number, y: number): Dir =>
  y === 0 ? 'down' : y === LAST_Y ? 'up' : x === 0 ? 'right' : 'left';

/** Where the bomb lands: the free floor tile 1..N tiles in from the rim nearest to a survivor. */
function landingTile(
  g: PlayerSim,
  grid: string,
  bombs: readonly Bomb[],
  survivors: readonly PlayerSim[],
  cfg: GameConfig,
): readonly [number, number] | undefined {
  if (survivors.length === 0) return undefined; // nobody to aim at (and `Math.min()` would be Infinity)
  const [dx, dy] = VECTORS[inward(g.x, g.y)];
  let best: readonly [number, number] | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let r = cfg.ghostThrowMinRange; r <= cfg.ghostThrowMaxRange; r++) {
    const x = g.x + dx * r;
    const y = g.y + dy * r;
    if (!isWalkable(grid, x, y) || bombs.some((b) => b.x === x && b.y === y)) continue;
    const d = Math.min(
      ...survivors.map((s) => Math.abs(Math.round(s.x) - x) + Math.abs(Math.round(s.y) - y)),
    );
    if (d < bestDist) {
      bestDist = d;
      best = [x, y];
    }
  }
  return best;
}

/**
 * One tick of every ghost, in id order: cool down, walk along the rim (one tile per
 * `ghostWalkTicksPerTile` while a direction is held; never off the rim, never into a corner), and
 * on a bomb input with the cooldown over throw a bomb at the survivor-nearest free tile. No
 * survivor or no free tile in range = no throw and the cooldown is kept. Ghosts never block anyone.
 */
export function stepGhosts(
  players: readonly PlayerSim[],
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  grid: string,
  bombs: readonly Bomb[],
  cfg: GameConfig,
): { players: PlayerSim[]; bombs: Bomb[] } {
  const survivors = players.filter((p) => p.alive);
  const out = [...bombs];
  const next = players.map((p) => {
    if (!p.ghost) return p;
    let { moveCd, throwCd } = p.ghost;
    moveCd = Math.max(0, moveCd - 1);
    throwCd = Math.max(0, throwCd - 1);
    let { x, y } = p;
    const held = inputs.get(p.id)?.dir ?? p.heldDir;
    const [dx, dy] = VECTORS[held];
    if (moveCd === 0 && isGhostTile(x + dx, y + dy)) {
      x += dx;
      y += dy;
      moveCd = cfg.ghostWalkTicksPerTile;
    }
    const me = { ...p, x, y };
    if (inputs.get(p.id)?.bomb && throwCd === 0) {
      const land = landingTile(me, grid, out, survivors, cfg);
      if (land) {
        out.push({
          x: land[0],
          y: land[1],
          ownerId: p.id,
          ownerSession: p.session,
          fuse: cfg.ghostBombFuseTicks,
          kind: 'ghost',
        });
        throwCd = cfg.ghostThrowCooldownTicks;
      }
    }
    return { ...me, heldDir: held, ghost: { moveCd, throwCd, teleport: false } };
  });
  return { players: next, bombs: out };
}
