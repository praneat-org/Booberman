import type { GameConfig } from './config';
import type { PlayerSim, RoundResult } from './types';

/**
 * Has the round ended after this tick? `tick` is the tick count after the step.
 * Order matters: a death on the last tick still decides the round, the clock only
 * ends it when nobody did.
 *
 * - needs at least two players in the room for elimination to count — a lone player
 *   would "win" on tick 1 (they can still hit the time limit);
 * - one survivor wins, nobody left (same tick) is a draw, time up is a draw.
 */
export function checkRoundEnd(
  players: readonly PlayerSim[],
  tick: number,
  cfg: GameConfig,
): RoundResult | undefined {
  if (players.length >= 2) {
    const alive = players.filter((p) => p.alive);
    if (alive.length === 1 && alive[0]) return { winner: alive[0].id, reason: 'lastAlive' };
    if (alive.length === 0) return { winner: null, reason: 'allDead' };
  }
  if (tick >= cfg.roundTicks) return { winner: null, reason: 'timeout' };
  return undefined;
}
