import { LEADERBOARD_PATH, type LeaderboardBy, LeaderboardResponse } from '@booberman/protocol';

export type LeaderboardResult =
  | { status: 'ok'; by: LeaderboardBy; entries: LeaderboardResponse['entries'] }
  | { status: 'error' };

/** `GET /api/leaderboard?by=`. Never throws; a body for the wrong tab (`by` mismatch) is an error too. */
export async function fetchLeaderboard(
  by: LeaderboardBy,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LeaderboardResult> {
  try {
    const res = await fetchFn(`${LEADERBOARD_PATH}?by=${by}`, { signal });
    if (!res.ok) return { status: 'error' };
    const body = LeaderboardResponse.safeParse(await res.json());
    return body.success && body.data.by === by
      ? { status: 'ok', by, entries: body.data.entries }
      : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
