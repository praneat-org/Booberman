import { env, exports } from 'cloudflare:workers';
import {
  LEADERBOARD_LIMIT,
  LEADERBOARD_PATH,
  LeaderboardApiErrorCode,
  type LeaderboardResponse,
} from '@booberman/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leaderboardSql } from '../src/api/leaderboard';

const get = (qs: string) => exports.default.fetch(`http://localhost${LEADERBOARD_PATH}${qs}`);
const body = async (qs: string): Promise<LeaderboardResponse> => (await get(qs)).json();

type P = [nickname: string, kills: number, troll: number, win: number];
let n = 0;
const seed = (...players: P[]) => {
  const id = `lb-${++n}`;
  return env.DB.batch([
    env.DB.prepare(
      "INSERT INTO matches (id, room_id, seed, started_at, ended_at, end_reason) VALUES (?, 'r', 1, 0, 1, 'time_up')",
    ).bind(id),
    ...players.map(([nick, kills, troll, win]) =>
      env.DB.prepare(
        'INSERT INTO match_players (match_id, nickname, kills, deaths, self_kills, curse_kills, transfers, troll_points, is_winner) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?)',
      ).bind(id, nick, kills, troll, win),
    ),
  ]);
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM match_players'),
    env.DB.prepare('DELETE FROM matches'),
  ]);
  for (const by of ['wins', 'kills', 'troll']) {
    await caches.default.delete(new Request(`http://localhost${LEADERBOARD_PATH}?by=${by}`));
  }
});

describe('GET /api/leaderboard', () => {
  it('sorts each category by the sum per nickname, ties by nickname, zeros left out', async () => {
    await seed(['Ann', 3, 1, 1], ['Bob', 5, 0, 0], ['Cat', 0, 0, 0]);
    await seed(['Ann', 1, 0, 1], ['Bob', 0, 4, 1], ['Dan', 4, 0, 0]);
    expect(await body('?by=wins')).toEqual({
      by: 'wins',
      entries: [
        { rank: 1, nickname: 'Ann', value: 2, matches: 2 },
        { rank: 2, nickname: 'Bob', value: 1, matches: 2 },
      ],
    });
    // kills: Bob 5, Ann 4, Dan 4 (tie broken by nickname), Cat 0 left out
    expect((await body('?by=kills')).entries.map((e) => [e.rank, e.nickname, e.value])).toEqual([
      [1, 'Bob', 5],
      [2, 'Ann', 4],
      [3, 'Dan', 4],
    ]);
    expect((await body('?by=troll')).entries.map((e) => [e.nickname, e.value])).toEqual([
      ['Bob', 4],
      ['Ann', 1],
    ]);
  });

  it('returns entries [] with no data', async () => {
    expect(await body('?by=kills')).toEqual({ by: 'kills', entries: [] });
  });

  it('limits to LEADERBOARD_LIMIT rows', async () => {
    const total = LEADERBOARD_LIMIT + 5;
    await seed(
      ...Array.from(
        { length: total },
        (_, i): P => [`P${String(i).padStart(2, '0')}`, i + 1, 0, 0],
      ),
    );
    const { entries } = await body('?by=kills');
    expect(entries).toHaveLength(LEADERBOARD_LIMIT);
    expect(entries[0]).toMatchObject({ rank: 1, nickname: `P${total - 1}` });
  });

  it.each(['', '?by=', '?by=deaths', '?by=WINS'])('400 BAD_BY for %j', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: LeaderboardApiErrorCode.enum.BAD_BY });
  });

  it('405 for POST', async () => {
    const res = await exports.default.fetch(`http://localhost${LEADERBOARD_PATH}?by=wins`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
  });

  it('second call is served from the edge cache (x-cache HIT)', async () => {
    await seed(['Ann', 1, 0, 1]);
    const first = await get('?by=wins');
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=60');
    await first.arrayBuffer();
    await seed(['Ann', 1, 0, 1]); // new data must NOT show while cached
    const second = await vi.waitFor(async () => {
      const res = await get('?by=wins');
      expect(res.headers.get('x-cache')).toBe('HIT'); // waitUntil(cache.put) may need a moment
      return res;
    });
    expect((await second.json<LeaderboardResponse>()).entries[0]?.value).toBe(1);
  });
});

describe('leaderboard query plan', () => {
  it.each(['wins', 'kills', 'troll'] as const)(
    '%s uses the covering index, no temp b-tree for GROUP BY',
    async (by) => {
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${leaderboardSql(by)}`).all<{
        detail: string;
      }>();
      const plan = results.map((r) => r.detail).join('\n');
      expect(plan).toContain('USING COVERING INDEX idx_match_players_leaderboard');
      expect(plan).not.toContain('GROUP BY');
    },
  );
});
