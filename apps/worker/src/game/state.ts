import { PROTOCOL_VERSION } from '@booberman/protocol';
import { createBoard, SPAWNS } from './board';
import type { GameState, PlayerId, PlayerSim, StepResult } from './types';

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

/**
 * Start a (new) round: the fresh state plus the `roundStart` event (D8) that tells clients to
 * clear the board and redraw from `grid`. The server picks `seed` outside `game/` (no Math.random here).
 */
export function startRound(seed: number, players: readonly PlayerId[]): StepResult {
  const state = createInitialState(seed, players);
  return {
    state,
    events: [
      { v: PROTOCOL_VERSION, t: 'event', kind: 'roundStart', seed: state.seed, grid: state.grid },
    ],
  };
}
