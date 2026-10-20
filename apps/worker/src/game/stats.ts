import type { PlayerSim, PlayerStats } from './types';

export const EMPTY_STATS: PlayerStats = {
  kills: 0,
  deaths: 0,
  selfKills: 0,
  curseKills: 0,
  kickKills: 0,
  ghostKills: 0,
  transfers: 0,
  trollPoints: 0,
};

/** `p` with `delta` added to its counters (never mutates `p`). */
export function addStats(p: PlayerSim, delta: Partial<PlayerStats>): PlayerSim {
  const next = { ...p.stats };
  for (const key of Object.keys(delta) as (keyof PlayerStats)[]) {
    next[key] += delta[key] ?? 0;
  }
  return { ...p, stats: next };
}
