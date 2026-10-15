import type { GameConfig } from './config';
import type { PlayerSim, RoundResult } from './types';

/**
 * Has the round ended after this tick? `tick` is the tick count after the step.
 * Order matters: a death on the last tick still decides the round, the clock only
 * ends it when nobody did.
 *
 * - elimination only counts once the round has been `contested` (two or more players were in
 *   the state at the same time). A lone player would "win" on tick 1 (they can still hit the
 *   time limit), but once someone has been up against a rival, "last one standing" holds even
 *   if the rival then leaves (a closed tab is not a reason to wait out the clock);
 * - one survivor wins, nobody left (same tick) is a draw, time up is a draw.
 */
export function checkRoundEnd(
  players: readonly PlayerSim[],
  tick: number,
  cfg: GameConfig,
  contested: boolean,
): RoundResult | undefined {
  if (contested) {
    const alive = players.filter((p) => p.alive);
    if (alive.length === 1 && alive[0]) return { winner: alive[0].id, reason: 'lastAlive' };
    if (alive.length === 0) return { winner: null, reason: 'allDead' };
  }
  if (tick >= cfg.roundTicks) return { winner: null, reason: 'timeout' };
  return undefined;
}
