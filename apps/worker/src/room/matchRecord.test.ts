import type { GameEvent } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { buildMatchRecord } from './matchRecord';
import { saveMatch } from './matchStore';

type RoundEnd = Extract<GameEvent, { kind: 'roundEnd' }>;
const row = (
  id: string,
  o: Partial<RoundEnd['stats'][number]> = {},
): RoundEnd['stats'][number] => ({
  id,
  kills: 0,
  deaths: 0,
  selfKills: 0,
  curseKills: 0,
  transfers: 0,
  trollPoints: 0,
  ...o,
});
const end = (o: Partial<RoundEnd>): RoundEnd => ({
  v: 1,
  t: 'event',
  kind: 'roundEnd',
  winner: null,
  reason: 'timeout',
  stats: [],
  titles: [],
  ...o,
});
const ctx = (names: Record<string, string>) => ({
  id: 'm1',
  roomId: 'room1',
  seed: 4_000_000_000,
  startedAt: 1000,
  endedAt: 2000,
  nicknames: new Map(Object.entries(names)),
});

describe('buildMatchRecord (BE-42)', () => {
  it.each([
    ['lastAlive', 'last_alive'],
    ['allDead', 'all_dead'],
    ['timeout', 'time_up'],
  ] as const)('end reason %s is stored as %s', (reason, stored) => {
    const m = buildMatchRecord(end({ reason, stats: [row('p1')] }), ctx({ p1: 'A' }));
    expect(m.endReason).toBe(stored);
  });

  it('carries the room facts and one row per player with the winner flagged', () => {
    const m = buildMatchRecord(
      end({
        winner: 'p2',
        reason: 'lastAlive',
        stats: [
          row('p2', { kills: 2, curseKills: 1, transfers: 3, trollPoints: 7 }),
          row('p1', { deaths: 1, selfKills: 1 }),
        ],
      }),
      ctx({ p1: 'Ann', p2: 'Bob' }),
    );
    expect(m).toMatchObject({
      id: 'm1',
      roomId: 'room1',
      seed: 4_000_000_000,
      startedAt: 1000,
      endedAt: 2000,
      winnerNick: 'Bob',
    });
    expect(m.players).toEqual([
      {
        nickname: 'Bob',
        kills: 2,
        deaths: 0,
        selfKills: 0,
        curseKills: 1,
        transfers: 3,
        trollPoints: 7,
        isWinner: true,
      },
      {
        nickname: 'Ann',
        kills: 0,
        deaths: 1,
        selfKills: 1,
        curseKills: 0,
        transfers: 0,
        trollPoints: 0,
        isWinner: false,
      },
    ]);
  });

  it('a draw has no winner_nick and nobody is flagged', () => {
    const m = buildMatchRecord(
      end({ winner: null, stats: [row('p1'), row('p2')] }),
      ctx({ p1: 'A', p2: 'B' }),
    );
    expect(m.winnerNick).toBeNull();
    expect(m.players.map((p) => p.isWinner)).toEqual([false, false]);
  });

  it('two players with the same nickname get distinct stored names (PK is match_id + nickname)', () => {
    const m = buildMatchRecord(
      end({ winner: 'p3', stats: [row('p3', { kills: 1 }), row('p1'), row('p2')] }),
      ctx({ p1: 'Dup', p2: 'Dup', p3: 'Dup' }),
    );
    // p1 keeps the name, later ids get a suffix that no real nickname can contain
    expect(m.players.map((p) => p.nickname).sort()).toEqual(['Dup', 'Dup#2', 'Dup#3']);
    expect(m.winnerNick).toBe('Dup#3');
    expect(m.players.find((p) => p.isWinner)).toMatchObject({ nickname: 'Dup#3', kills: 1 });
  });
});

describe('saveMatch (BE-42)', () => {
  it('sends ONE batch of prepared statements: 1 match + n players, values only as bindings', async () => {
    const prepared: { sql: string; args: unknown[] }[] = [];
    const batches: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        const entry = { sql, args: [] as unknown[] };
        prepared.push(entry);
        return {
          bind(...args: unknown[]) {
            entry.args = args;
            return entry;
          },
        };
      },
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;
    const m = buildMatchRecord(
      end({ winner: 'p1', reason: 'lastAlive', stats: [row('p1'), row('p2', { deaths: 1 })] }),
      ctx({ p1: "A'); DROP TABLE matches;--", p2: 'B' }),
    );
    await saveMatch(db, m);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    for (const p of prepared) {
      expect(p.sql).not.toContain('DROP');
      expect(p.sql.match(/\?/g)).toHaveLength(p.args.length);
    }
    expect(prepared[0]?.args).toEqual([
      'm1',
      'room1',
      4_000_000_000,
      1000,
      2000,
      'last_alive',
      "A'); DROP TABLE matches;--",
    ]);
    expect(prepared[1]?.args.at(-1)).toBe(1); // is_winner
    expect(prepared[2]?.args.at(-1)).toBe(0);
  });

  it('turns a synchronous throw into a rejected promise', async () => {
    const db = {
      prepare() {
        throw new Error('boom');
      },
    } as unknown as D1Database;
    const m = buildMatchRecord(end({ stats: [row('p1')] }), ctx({ p1: 'A' }));
    await expect(saveMatch(db, m)).rejects.toThrow('boom');
  });
});
