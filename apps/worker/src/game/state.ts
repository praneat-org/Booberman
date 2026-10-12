import { exampleGrid } from '@booberman/protocol';
import type { GameState, PlayerId, PlayerSim } from './types';

/** Spawn tiles, matching the clear corners of `exampleGrid()`. */
const SPAWNS: Record<PlayerId, readonly [x: number, y: number]> = {
  p1: [1, 1],
  p2: [11, 1],
  p3: [1, 9],
  p4: [11, 9],
};

/**
 * New round. `seed` comes from the server (outside `game/`); the grid is the
 * fixed example arena until BE-36 builds boards from the seed.
 */
export function createInitialState(seed: number, players: readonly PlayerId[]): GameState {
  const ids = [...new Set(players)].sort();
  const sims: PlayerSim[] = ids.map((id) => {
    const spawn = SPAWNS[id];
    if (!spawn) throw new Error(`unknown player id: ${id}`);
    const [x, y] = spawn;
    return { id, x, y, alive: true, curse: 0, ackSeq: 0 };
  });
  return {
    tick: 0,
    seed: seed >>> 0,
    rngSeed: seed >>> 0,
    grid: exampleGrid(),
    players: sims,
  };
}
