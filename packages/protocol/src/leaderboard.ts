import { z } from 'zod';

export const LEADERBOARD_PATH = '/api/leaderboard';

/** Rows returned by `GET /api/leaderboard` (top N only). */
export const LEADERBOARD_LIMIT = 20;

/** `?by=` of `GET /api/leaderboard`: total wins, total kills or total troll points per nickname. */
export const LeaderboardBy = z.enum(['wins', 'kills', 'troll']);
export type LeaderboardBy = z.infer<typeof LeaderboardBy>;

export const LeaderboardEntry = z.object({
  /** 1-based, ties broken by nickname so ranks are always distinct. */
  rank: z.number().int().min(1),
  nickname: z.string(),
  /** The summed stat chosen by `by`. Always > 0 (players with 0 are not listed). */
  value: z.number().int().min(1),
  /** Rounds this nickname played. */
  matches: z.number().int().min(1),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

/** Response body of `GET /api/leaderboard` (200). `entries` is `[]` when nobody has played. */
export const LeaderboardResponse = z.object({
  by: LeaderboardBy,
  entries: z.array(LeaderboardEntry).max(LEADERBOARD_LIMIT),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

/** `{ error }` codes of `GET /api/leaderboard` (HTTP API, separate from the WebSocket `ErrorCode`). */
export const LeaderboardApiErrorCode = z.enum(['BAD_BY']);
export type LeaderboardApiErrorCode = z.infer<typeof LeaderboardApiErrorCode>;
