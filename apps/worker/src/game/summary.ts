import type { PlayerRoundStats, RoundTitle, TitleId } from '@booberman/protocol';
import { TitleId as TitleIds } from '@booberman/protocol';
import type { PlayerSim, PlayerStats } from './types';

/**
 * What each title is scored on (CAR-3798). `spreader` counts curses passed on plus kills made with
 * a curse. `backstabber` (kicked bombs) and `haunter` (ghost) are 0 for everyone until BE-45 /
 * BE-46 exist, so nobody gets them yet.
 */
const TITLE_SCORE: Readonly<Record<TitleId, (s: PlayerStats) => number>> = {
  spreader: (s) => s.transfers + s.curseKills,
  backstabber: (s) => s.kickKills,
  haunter: (s) => s.ghostKills,
  selfKiller: (s) => s.selfKills,
  troll: (s) => s.trollPoints,
};

/**
 * Titles of a finished round, in `TitleId` order.
 *
 * Tie rule: everybody who has the highest value holds the title together (the title lists all of
 * them). A title whose best value is 0 is left out. Players are in id order inside a title. The
 * reason for sharing instead of picking one: a player dies at most once per round, so ties on
 * `selfKiller` and the like are the normal case, and any single pick (lowest id, first to score)
 * would always favour the same seat.
 */
export function awardTitles(players: readonly PlayerSim[]): RoundTitle[] {
  const titles: RoundTitle[] = [];
  for (const title of TitleIds.options) {
    const score = TITLE_SCORE[title];
    const value = Math.max(0, ...players.map((p) => score(p.stats)));
    if (value === 0) continue;
    const holders = players.filter((p) => score(p.stats) === value).map((p) => p.id);
    titles.push({ title, players: holders, value });
  }
  return titles;
}

/** The end screen order: troll points high to low, then kills high to low, deaths low to high, then id. */
const byEndScreen = (a: PlayerRoundStats, b: PlayerRoundStats): number =>
  b.trollPoints - a.trollPoints ||
  b.kills - a.kills ||
  a.deaths - b.deaths ||
  a.id.localeCompare(b.id);

/**
 * The summary `roundEnd` carries: one row per player still in the room (D33: whoever left is not in
 * the table), sorted for the end screen, plus the titles. Pure: the same players give the same table.
 */
export function summarizeRound(players: readonly PlayerSim[]): {
  stats: PlayerRoundStats[];
  titles: RoundTitle[];
} {
  const stats = players
    .map((p) => ({
      id: p.id,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      selfKills: p.stats.selfKills,
      curseKills: p.stats.curseKills,
      transfers: p.stats.transfers,
      trollPoints: p.stats.trollPoints,
    }))
    .sort(byEndScreen);
  return { stats, titles: awardTitles(players) };
}
