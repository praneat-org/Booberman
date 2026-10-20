import { TitleId } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { awardTitles, summarizeRound } from './summary';
import type { PlayerId, PlayerSim, PlayerStats } from './types';

/** p1..p4 (as many as `ids`), each with the counters given for them. */
function room(stats: Partial<Record<PlayerId, Partial<PlayerStats>>>): PlayerSim[] {
  const ids = Object.keys(stats) as PlayerId[];
  return createInitialState(1, ids).players.map((p) => ({
    ...p,
    stats: { ...p.stats, ...stats[p.id] },
  }));
}
const titleOf = (players: PlayerSim[], title: TitleId) =>
  awardTitles(players).find((t) => t.title === title);

describe('titles: who gets which (CAR-3798)', () => {
  it('ผู้แพร่เชื้อ (spreader): curses passed on + kills made with a curse, most wins', () => {
    const players = room({
      p1: { transfers: 2, curseKills: 0 }, // 2
      p2: { transfers: 1, curseKills: 2 }, // 3  <- the sum, not either number alone
      p3: { transfers: 0, curseKills: 1 }, // 1
    });
    expect(titleOf(players, 'spreader')).toEqual({ title: 'spreader', players: ['p2'], value: 3 });
  });

  it('ฆ่าตัวเองเก่ง (selfKiller): most self-kills', () => {
    const players = room({ p1: { selfKills: 0 }, p2: { selfKills: 2 }, p3: { selfKills: 1 } });
    expect(titleOf(players, 'selfKiller')).toEqual({
      title: 'selfKiller',
      players: ['p2'],
      value: 2,
    });
  });

  it('ตัวตึงสายเกรียน (troll): most troll points', () => {
    const players = room({
      p1: { trollPoints: 4 },
      p2: { trollPoints: 9 },
      p3: { trollPoints: 0 },
    });
    expect(titleOf(players, 'troll')).toEqual({ title: 'troll', players: ['p2'], value: 9 });
  });

  it('จอมแทงข้างหลัง (backstabber) goes to the most kick kills and ผีดุ (haunter) to the most ghost kills', () => {
    const players = room({
      p1: { kickKills: 2, ghostKills: 0 },
      p2: { kickKills: 1, ghostKills: 3 },
    });
    expect(titleOf(players, 'backstabber')).toEqual({
      title: 'backstabber',
      players: ['p1'],
      value: 2,
    });
    expect(titleOf(players, 'haunter')).toEqual({ title: 'haunter', players: ['p2'], value: 3 });
  });

  it('a title nobody earned (best value 0) is not shown, and a round with nothing gives no titles', () => {
    expect(awardTitles(room({ p1: {}, p2: {} }))).toEqual([]);
    const players = room({ p1: { trollPoints: 1 }, p2: {} });
    expect(awardTitles(players).map((t) => t.title)).toEqual(['troll']);
    // kick and ghost kills cannot happen yet, so these two never show today
    expect(titleOf(players, 'backstabber')).toBeUndefined();
    expect(titleOf(players, 'haunter')).toBeUndefined();
  });

  it('titles come out in the TitleId order, whatever the players did', () => {
    const players = room({
      p1: { trollPoints: 5, selfKills: 1, transfers: 1, kickKills: 1, ghostKills: 1 },
    });
    expect(awardTitles(players).map((t) => t.title)).toEqual([...TitleId.options]);
  });
});

describe('titles: ties (rule: everybody on the highest value shares the title)', () => {
  it('two players tied at the top both hold the title, in player id order', () => {
    const players = room({ p3: { selfKills: 1 }, p1: { selfKills: 1 }, p2: { selfKills: 0 } });
    expect(titleOf(players, 'selfKiller')).toEqual({
      title: 'selfKiller',
      players: ['p1', 'p3'],
      value: 1,
    });
  });

  it('a tie for second place changes nothing: only the highest value counts', () => {
    const players = room({
      p1: { trollPoints: 5 },
      p2: { trollPoints: 2 },
      p3: { trollPoints: 2 },
    });
    expect(titleOf(players, 'troll')).toEqual({ title: 'troll', players: ['p1'], value: 5 });
  });

  it('all four tied above zero: all four hold it; tied at zero: nobody does', () => {
    const all = room({
      p1: { trollPoints: 3 },
      p2: { trollPoints: 3 },
      p3: { trollPoints: 3 },
      p4: { trollPoints: 3 },
    });
    expect(titleOf(all, 'troll')?.players).toEqual(['p1', 'p2', 'p3', 'p4']);
    const zero = room({ p1: {}, p2: {}, p3: {}, p4: {} });
    expect(titleOf(zero, 'troll')).toBeUndefined();
  });

  it('being the winner or the survivor does not matter', () => {
    const players = room({ p1: { trollPoints: 2 }, p2: { trollPoints: 2 } });
    const dead = players.map((p) => (p.id === 'p2' ? { ...p, alive: false } : p));
    expect(titleOf(dead, 'troll')?.players).toEqual(['p1', 'p2']);
  });

  it('is the same whatever order the players are listed in', () => {
    const players = room({ p1: { selfKills: 1 }, p2: { selfKills: 1 }, p3: {} });
    const shuffled = [...players].reverse();
    expect(awardTitles(shuffled).map((t) => t.title)).toEqual(
      awardTitles(players).map((t) => t.title),
    );
    expect(titleOf(shuffled, 'selfKiller')?.players.slice().sort()).toEqual(['p1', 'p2']);
  });
});

describe('summarizeRound: the table for the end screen', () => {
  it('has the D1 columns for every player and nothing else', () => {
    const players = room({
      p1: {
        kills: 3,
        deaths: 1,
        selfKills: 1,
        curseKills: 2,
        kickKills: 1,
        ghostKills: 1,
        transfers: 4,
        trollPoints: 12,
      },
    });
    expect(summarizeRound(players).stats).toEqual([
      { id: 'p1', kills: 3, deaths: 1, selfKills: 1, curseKills: 2, transfers: 4, trollPoints: 12 },
    ]);
  });

  it('sorted by troll points high to low', () => {
    const players = room({
      p1: { trollPoints: 1 },
      p2: { trollPoints: 7 },
      p3: { trollPoints: 4 },
    });
    expect(summarizeRound(players).stats.map((r) => r.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('equal troll points: more kills first, then fewer deaths, then lower id', () => {
    const players = room({
      p1: { trollPoints: 2, kills: 1, deaths: 1 },
      p2: { trollPoints: 2, kills: 2, deaths: 1 },
      p3: { trollPoints: 2, kills: 1, deaths: 0 },
      p4: { trollPoints: 2, kills: 1, deaths: 1 },
    });
    expect(summarizeRound(players).stats.map((r) => r.id)).toEqual(['p2', 'p3', 'p1', 'p4']);
  });

  it('only has the players it is given (someone who left is not in the table, D33)', () => {
    const players = room({ p1: { trollPoints: 3 }, p3: { trollPoints: 1 } });
    expect(summarizeRound(players).stats.map((r) => r.id)).toEqual(['p1', 'p3']);
  });

  it('does not change the players it reads', () => {
    const players = room({ p1: { trollPoints: 1 }, p2: { trollPoints: 7 } });
    const frozen = structuredClone(players);
    summarizeRound(players);
    expect(players).toEqual(frozen);
  });
});
