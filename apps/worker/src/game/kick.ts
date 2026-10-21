import { GRID_WIDTH } from '@booberman/protocol';
import { isWalkable } from './board';
import type { GameConfig } from './config';
import { effectiveDir } from './curse';
import { VECTORS } from './dirs';
import type { Bomb, PlayerSim } from './types';

const tileKey = (x: number, y: number) => y * GRID_WIDTH + x;

/**
 * Tiles living players stand on. A player between two tiles covers both (the floor and the
 * ceiling of the position), so a bomb never slides into a tile somebody is walking into.
 */
function occupiedBy(players: readonly PlayerSim[]): Set<number> {
  const tiles = new Set<number>();
  for (const p of players) {
    if (!p.alive) continue;
    for (const x of new Set([Math.floor(p.x), Math.ceil(p.x)]))
      for (const y of new Set([Math.floor(p.y), Math.ceil(p.y)])) tiles.add(tileKey(x, y));
  }
  return tiles;
}

/** A bomb cannot go onto a wall, a box, another bomb or a player. */
const isBlocked = (
  grid: string,
  bombs: readonly Bomb[],
  occupied: ReadonlySet<number>,
  x: number,
  y: number,
): boolean =>
  !isWalkable(grid, x, y) ||
  occupied.has(tileKey(x, y)) ||
  bombs.some((b) => b.x === x && b.y === y);

/**
 * Kicks (CAR-3801): a living player who has the kick item, standing on a tile centre and walking
 * (held direction, reversed by a curse) into a bomb that is standing still sets it sliding that way,
 * and is credited as `kickedBy` (the last kicker wins). The walk itself already refuses to enter the
 * bomb's tile, so the kicker stays put. A kick whose first hop is blocked does nothing. Players go
 * in id order, so two kicks of the same bomb in one tick are settled by id.
 */
export function kickBombs(
  players: readonly PlayerSim[],
  bombs: readonly Bomb[],
  grid: string,
): Bomb[] {
  const occupied = occupiedBy(players);
  const out = [...bombs];
  for (const p of players) {
    if (!p.alive || !p.hasKick || (p.walkDir !== undefined && p.walkDir !== 'none')) continue;
    const dir = effectiveDir(p);
    if (dir === 'none') continue;
    const [dx, dy] = VECTORS[dir];
    const at = out.findIndex((b) => b.x === p.x + dx && b.y === p.y + dy);
    const bomb = out[at];
    if (!bomb || bomb.slide !== undefined || bomb.fuse <= 0) continue;
    if (isBlocked(grid, out, occupied, bomb.x + dx, bomb.y + dy)) continue;
    out[at] = { ...bomb, slide: dir, slideCd: 0, kickedBy: { id: p.id, session: p.session } };
  }
  return out;
}

/**
 * Moves every sliding bomb one tile each `bombSlideTicksPerTile` ticks (the first hop is the tick
 * it was kicked). It stops, for good, in front of a wall, box, bomb or player. The fuse keeps
 * counting while it slides (that is done by the caller) and a bomb that is due this tick explodes
 * where it is. A bomb that ends on a burning tile is set off by `resolveExplosions`, which comes next.
 * Bombs go in array order, so a bomb sees where the earlier ones already are this tick.
 */
export function slideBombs(
  players: readonly PlayerSim[],
  bombs: readonly Bomb[],
  grid: string,
  cfg: GameConfig,
): Bomb[] {
  const occupied = occupiedBy(players);
  const out = [...bombs];
  out.forEach((bomb, i) => {
    const { slide, slideCd = 0, ...rest } = bomb;
    if (slide === undefined || bomb.fuse <= 0) return;
    if (slideCd > 0) {
      out[i] = { ...bomb, slideCd: slideCd - 1 };
      return;
    }
    const [dx, dy] = VECTORS[slide];
    const x = bomb.x + dx;
    const y = bomb.y + dy;
    out[i] = isBlocked(grid, out, occupied, x, y)
      ? rest
      : { ...rest, x, y, slide, slideCd: cfg.bombSlideTicksPerTile - 1 };
  });
  return out;
}
