import { describe, expect, it } from 'vitest';
import { LEADERBOARD_TABS, leaderboardView, nextTabIndex } from './leaderboardView';

describe('leaderboardView', () => {
  it('picks the state', () => {
    expect(leaderboardView(null)).toBe('loading');
    expect(leaderboardView({ status: 'error' })).toBe('error');
    expect(leaderboardView({ status: 'ok', by: 'wins', entries: [] })).toBe('empty');
    const entries = [{ rank: 1, nickname: 'a', value: 2, matches: 3 }];
    expect(leaderboardView({ status: 'ok', by: 'wins', entries })).toBe('rows');
  });
  it('moves tab focus like WAI-ARIA tabs', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('Tab', 0, 3)).toBeNull();
  });
  it('has the three categories', () => {
    expect(LEADERBOARD_TABS.map((t) => t.by)).toEqual(['wins', 'kills', 'troll']);
  });
});
