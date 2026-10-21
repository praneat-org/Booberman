import { describe, expect, it } from 'vitest';
import { LEADERBOARD_TABS, leaderboardView } from './leaderboardView';

describe('leaderboardView', () => {
  it('picks the state', () => {
    expect(leaderboardView(null)).toBe('loading');
    expect(leaderboardView({ status: 'error' })).toBe('error');
    expect(leaderboardView({ status: 'ok', by: 'wins', entries: [] })).toBe('empty');
    const entries = [{ rank: 1, nickname: 'a', value: 2, matches: 3 }];
    expect(leaderboardView({ status: 'ok', by: 'wins', entries })).toBe('rows');
  });
  it('has the three categories', () => {
    expect(LEADERBOARD_TABS.map((t) => t.by)).toEqual(['wins', 'kills', 'troll']);
  });
});
