import type { LeaderboardBy } from '@booberman/protocol';
import type { LeaderboardResult } from './leaderboardApi';

/** Tab order and Thai labels (what the number means for a player). */
export const LEADERBOARD_TABS: ReadonlyArray<{ by: LeaderboardBy; label: string }> = [
  { by: 'wins', label: 'ชนะ' },
  { by: 'kills', label: 'ฆ่า' },
  { by: 'troll', label: 'แต้มเกรียน' },
];

export type LeaderboardView = 'loading' | 'error' | 'empty' | 'rows';

/** `null` = request in flight. */
export function leaderboardView(result: LeaderboardResult | null): LeaderboardView {
  if (result === null) return 'loading';
  if (result.status === 'error') return 'error';
  return result.entries.length === 0 ? 'empty' : 'rows';
}
