import { describe, expect, it } from 'vitest';
import { failedRequiredAssets } from './bootAssets';

describe('failedRequiredAssets', () => {
  it('returns only required keys that failed, in required order', () => {
    expect(
      failedRequiredAssets(new Set(['tiles', 'arena', 'sfx']), ['arena', 'tiles', 'player']),
    ).toEqual(['arena', 'tiles']);
  });

  it('is empty when nothing failed', () => {
    expect(failedRequiredAssets(new Set(), ['arena'])).toEqual([]);
    expect(failedRequiredAssets(new Set(['other']), ['arena'])).toEqual([]);
  });
});
