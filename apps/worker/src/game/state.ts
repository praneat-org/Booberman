import { createBoard, SPAWNS } from './board';
import type { GameState, PlayerId, PlayerSim } from './types';

/**
 * New round. `seed` comes from the server (outside `game/`); the board is
 * generated from it (same seed → same board).
 */
export function createInitialState(seed: number, players: readonly PlayerId[]): GameState {
  const ids = [...new Set(players)].sort();
  const sims: PlayerSim[] = ids.map((id) => {
    const spawn = SPAWNS[id];
    if (!spawn) throw new Error(`unknown player id: ${id}`);
    const [x, y] = spawn;
    return { id, x, y, alive: true, curse: 0, ackSeq: 0, heldDir: 'none' };
  });
  const { grid, rngSeed } = createBoard(seed);
  return {
    tick: 0,
    seed: seed >>> 0,
    rngSeed,
    grid,
    players: sims,
    bombs: [],
    flames: [],
    items: [],
  };
}
