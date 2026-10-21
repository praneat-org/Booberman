import {
  LEADERBOARD_LIMIT,
  type LeaderboardApiErrorCode,
  LeaderboardBy,
  type LeaderboardResponse,
} from '@booberman/protocol';
import { jsonError } from '../http/router';

export const CACHE_SECONDS = 60;

// `by` is validated against LeaderboardBy first, so the column expression is never user text.
const SUM = { wins: 'SUM(is_winner)', kills: 'SUM(kills)', troll: 'SUM(troll_points)' } as const;

export function leaderboardSql(by: LeaderboardBy): string {
  return `SELECT nickname, ${SUM[by]} AS value, COUNT(*) AS matches FROM match_players GROUP BY nickname HAVING value > 0 ORDER BY value DESC, nickname ASC LIMIT ${LEADERBOARD_LIMIT}`;
}

async function query(db: D1Database, by: LeaderboardBy): Promise<LeaderboardResponse> {
  const { results } = await db
    .prepare(leaderboardSql(by))
    .all<{ nickname: string; value: number; matches: number }>();
  return { by, entries: results.map((r, i) => ({ rank: i + 1, ...r })) };
}

/**
 * GET /api/leaderboard?by=wins|kills|troll → 200 LeaderboardResponse · 400 BAD_BY.
 * Cached at the edge for 60s (Cache API, key = the URL with only `by`); `x-cache: HIT|MISS` says which.
 * The Cache API is a no-op on `*.workers.dev`, so there it is always MISS (works on a custom domain).
 */
export async function leaderboard(
  request: Request,
  env: Pick<Cloudflare.Env, 'DB'>,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  const parsed = LeaderboardBy.safeParse(new URL(request.url).searchParams.get('by'));
  if (!parsed.success) return jsonError(400, 'BAD_BY' satisfies LeaderboardApiErrorCode);
  const by = parsed.data;

  const cache = caches.default;
  const key = new Request(new URL(`/api/leaderboard?by=${by}`, request.url));
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('x-cache', 'HIT');
    return res;
  }

  const res = Response.json(await query(env.DB, by), {
    headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}`, 'x-cache': 'MISS' },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
