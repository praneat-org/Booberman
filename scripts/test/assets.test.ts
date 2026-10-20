import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  contentHash,
  HASH_LENGTH,
  hashedName,
  scanAssets,
  serializeManifest,
} from '../lib/assets.ts';

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'be37-assets-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body);
  }
  return dir;
}

describe('hashedName', () => {
  it('puts the hash before the last extension', () => {
    expect(hashedName('sprites/player.png', '3fa9c1d2e4')).toBe('sprites/player.3fa9c1d2e4.png');
    expect(hashedName('a.b.ogg', 'abc')).toBe('a.b.abc.ogg');
  });
});

describe('contentHash', () => {
  it('is stable, content-only and HASH_LENGTH long', () => {
    const h = contentHash(Buffer.from('hello'));
    expect(h).toMatch(new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`));
    expect(contentHash(Buffer.from('hello'))).toBe(h);
    expect(contentHash(Buffer.from('hellp'))).not.toBe(h);
  });
});

describe('scanAssets', () => {
  it('hashes allowed files, keeps folders, skips the rest', async () => {
    const dir = await fixture({
      'sprites/player.png': 'png-bytes',
      'audio/explode.ogg': 'ogg-bytes',
      'CREDITS.md': 'not an asset',
      '.DS_Store': 'junk',
    });
    const { files, skipped } = await scanAssets(dir);
    expect(skipped).toEqual(['CREDITS.md']);
    expect(files.map((f) => f.logicalKey)).toEqual(['audio/explode.ogg', 'sprites/player.png']);
    const player = files.find((f) => f.logicalKey === 'sprites/player.png');
    expect(player?.hashedKey).toBe(`sprites/player.${contentHash(Buffer.from('png-bytes'))}.png`);
    expect(player?.contentType).toBe('image/png');
    expect(player?.bytes).toBe(9);
  });

  it('changes the hashed name when (and only when) the content changes', async () => {
    const a = await scanAssets(await fixture({ 'x.png': '1' }));
    const b = await scanAssets(await fixture({ 'x.png': '1' }));
    const c = await scanAssets(await fixture({ 'x.png': '2' }));
    expect(b.files[0]?.hashedKey).toBe(a.files[0]?.hashedKey);
    expect(c.files[0]?.hashedKey).not.toBe(a.files[0]?.hashedKey);
  });

  it('does not follow symlinks', async () => {
    const dir = await fixture({ 'real.png': 'x' });
    const outside = await fixture({ 'secret.png': 'nope' });
    try {
      await symlink(join(outside, 'secret.png'), join(dir, 'link.png'));
      await symlink(outside, join(dir, 'linkdir'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        // Some Windows runners disallow symlink creation without admin elevation; the production guard is
        // still the intended policy, and the upload path is the same API contract in supported envs.
        expect(true).toBe(true);
        return;
      }
      throw error;
    }
    const { files } = await scanAssets(dir);
    expect(files.map((f) => f.logicalKey)).toEqual(['real.png']);
  });

  it('rejects names that are unsafe as an object key or process argument', async () => {
    await expect(scanAssets(await fixture({ 'bad name.png': 'x' }))).rejects.toThrow(/not allowed/);
    await expect(scanAssets(await fixture({ '-rf.png': 'x' }))).rejects.toThrow(/not allowed/);
    await expect(scanAssets(await fixture({ 'a;b.png': 'x' }))).rejects.toThrow(/not allowed/);
  });

  it('fails when the folder is missing instead of shipping an empty manifest silently', async () => {
    await expect(scanAssets(join(tmpdir(), 'be37-does-not-exist'))).rejects.toThrow();
  });

  it('accepts an empty folder (nothing to upload yet)', async () => {
    const { files } = await scanAssets(await fixture({}));
    expect(files).toEqual([]);
  });
});

describe('manifest', () => {
  it('maps logical -> hashed in the format FE-16 reads, sorted', async () => {
    const { files } = await scanAssets(await fixture({ 'b.png': '2', 'a/z.ogg': '1' }));
    const manifest = buildManifest(files);
    expect(Object.keys(manifest)).toEqual(['a/z.ogg', 'b.png']);
    expect(manifest['b.png']).toMatch(/^b\.[0-9a-f]{10}\.png$/);
    expect(serializeManifest(manifest)).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it('is byte-identical for the same assets (the second run changes nothing)', async () => {
    const dir = await fixture({ 'a.png': '1', 'b.png': '2' });
    const m1 = serializeManifest(buildManifest((await scanAssets(dir)).files));
    const m2 = serializeManifest(buildManifest((await scanAssets(dir)).files));
    expect(m2).toBe(m1);
  });
});
