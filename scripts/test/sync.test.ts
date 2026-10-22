import { describe, expect, it } from 'vitest';
import { type AssetFile, IMMUTABLE_CACHE_CONTROL } from '../lib/assets.ts';
import { createWranglerR2Client } from '../lib/r2-wrangler.ts';
import { type R2Client, syncAssets } from '../lib/sync.ts';

const file = (name: string): AssetFile => ({
  logicalKey: `${name}.png`,
  hashedKey: `${name}.0123456789.png`,
  absPath: `/tmp/${name}.png`,
  contentType: 'image/png',
  bytes: 3,
});

function fakeBucket(initial: string[] = []) {
  const keys = new Set(initial);
  const puts: { key: string; cacheControl: string; contentType: string }[] = [];
  const client: R2Client = {
    exists: async (k) => keys.has(k),
    put: async (f, meta) => {
      keys.add(f.hashedKey);
      puts.push({ key: f.hashedKey, ...meta });
    },
  };
  return { client, puts, keys };
}

describe('syncAssets', () => {
  it('uploads only what is missing, with the immutable Cache-Control', async () => {
    const { client, puts } = fakeBucket(['a.0123456789.png']);
    const r = await syncAssets({ files: [file('a'), file('b'), file('c')], client });
    expect(r.uploaded).toEqual(['b.0123456789.png', 'c.0123456789.png']);
    expect(r.skipped).toEqual(['a.0123456789.png']);
    for (const p of puts) {
      expect(p.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(p.contentType).toBe('image/png');
    }
  });

  it('run 2 with unchanged assets uploads 0 files', async () => {
    const bucket = fakeBucket();
    const files = [file('a'), file('b')];
    expect((await syncAssets({ files, client: bucket.client })).uploaded).toHaveLength(2);
    const second = await syncAssets({ files, client: bucket.client });
    expect(second.uploaded).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(bucket.puts).toHaveLength(2);
  });

  it('dry run never touches the bucket', async () => {
    const client: R2Client = {
      exists: async () => {
        throw new Error('network used');
      },
      put: async () => {
        throw new Error('network used');
      },
    };
    const r = await syncAssets({ files: [file('a')], client, dryRun: true });
    expect(r.uploaded).toEqual(['a.0123456789.png']);
  });

  it('fails the whole sync if one upload fails, and stops scheduling more', async () => {
    const { client } = fakeBucket();
    let calls = 0;
    const failing: R2Client = {
      exists: client.exists,
      put: async (f, m) => {
        calls++;
        if (f.hashedKey.startsWith('b.')) throw new Error('boom');
        await client.put(f, m);
      },
    };
    const files = ['a', 'b', 'c', 'd', 'e', 'f'].map(file);
    await expect(syncAssets({ files, client: failing, concurrency: 1 })).rejects.toThrow(
      /b\.0123456789\.png: boom/,
    );
    expect(calls).toBe(2);
  });

  it('an exists() error (auth, network) is a failure, not "missing"', async () => {
    const client: R2Client = {
      exists: async () => {
        throw new Error('401');
      },
      put: async () => {
        throw new Error('must not upload');
      },
    };
    await expect(syncAssets({ files: [file('a')], client })).rejects.toThrow(/401/);
  });
});

describe('createWranglerR2Client', () => {
  const calls: string[][] = [];
  const make = (fail?: { stderr: string }) =>
    createWranglerR2Client({
      wranglerBin: 'wrangler',
      bucket: 'bkt',
      run: async (_bin, args) => {
        calls.push(args);
        if (fail) throw Object.assign(new Error('Command failed'), fail);
        return { stdout: '', stderr: '' };
      },
    });

  it('remote get/put use --remote, the bucket path and the headers', async () => {
    calls.length = 0;
    const c = make();
    expect(await c.exists('sprites/a.0123456789.png')).toBe(true);
    await c.put(file('a'), { cacheControl: IMMUTABLE_CACHE_CONTROL, contentType: 'image/png' });
    expect(calls[0]).toEqual([
      'r2',
      'object',
      'get',
      'bkt/sprites/a.0123456789.png',
      '--pipe',
      '--remote',
    ]);
    expect(calls[1]).toEqual([
      'r2',
      'object',
      'put',
      'bkt/a.0123456789.png',
      '--file',
      '/tmp/a.png',
      '--content-type',
      'image/png',
      '--cache-control',
      IMMUTABLE_CACHE_CONTROL,
      '--remote',
    ]);
  });

  it('a "key does not exist" error means missing; any other error is thrown', async () => {
    expect(
      await make({ stderr: 'The specified key does not exist. [code: 10007]' }).exists('k'),
    ).toBe(false);
    await expect(
      make({ stderr: 'Authentication error [code: 10000]' }).exists('k'),
    ).rejects.toThrow(/Authentication error/);
  });
});
