import type { LeaderboardBy } from '@booberman/protocol';
import type { LeaderboardResult } from './leaderboardApi';

/** Tab order and Thai labels (what the number means for a player). */
export const LEADERBOARD_TABS: ReadonlyArray<{ by: LeaderboardBy; label: string }> = [
  { by: 'wins', label: 'ชนะ' },
  { by: 'kills', label: 'ฆ่า' },
  { by: 'troll', label: 'แต้มเกรียน' },
];

/** WAI-ARIA tabs: where focus goes for a key press (arrows wrap, Home/End jump). `null` = not a tab key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export type LeaderboardView = 'loading' | 'error' | 'empty' | 'rows';

/** `null` = request in flight. */
export function leaderboardView(result: LeaderboardResult | null): LeaderboardView {
  if (result === null || result.status === 'aborted') return 'loading';
  if (result.status === 'error') return 'error';
  return result.entries.length === 0 ? 'empty' : 'rows';
}
