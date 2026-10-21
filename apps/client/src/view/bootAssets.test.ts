import { describe, expect, it } from 'vitest';
import { type BootState, bootFailures, failedRequiredAssets } from './bootAssets';

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

describe('bootFailures', () => {
  const ok: BootState = {
    bootError: null,
    usesManifest: true,
    manifestReady: true,
    failedKeys: new Set(),
    required: ['arena', 'sheet'],
  };

  it('continues when the manifest is ready and nothing failed', () => {
    expect(bootFailures(ok)).toEqual([]);
  });

  it('fails in bucket mode when the manifest never became ready, although the loader reported no failed file', () => {
    // manifest.json answered with index.html + 200: no FILE_LOAD_ERROR, onManifest never ran
    const failures = bootFailures({ ...ok, manifestReady: false });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('manifest.json');
  });

  it('fails the same way when manifest.json is a real 404', () => {
    expect(
      bootFailures({ ...ok, manifestReady: false, failedKeys: new Set(['asset-manifest']) }),
    ).toHaveLength(1);
  });

  it('does not need a manifest without a bucket (dev, ?mock=1)', () => {
    expect(bootFailures({ ...ok, usesManifest: false, manifestReady: false })).toEqual([]);
  });

  it('reports the boot error first', () => {
    expect(bootFailures({ ...ok, manifestReady: false, bootError: 'bad value' })).toEqual([
      'bad value',
    ]);
  });

  it('still reports a required file that failed to load', () => {
    expect(bootFailures({ ...ok, failedKeys: new Set(['sheet', 'sfx']) })).toEqual(['sheet']);
  });
});
