import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIO_FILES } from '../audio/sfx';
import { GameAsset } from './gameAssets';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('logical asset names', () => {
  const names = [GameAsset.Arena, GameAsset.Sheet, ...AUDIO_FILES.flatMap((f) => f.urls)];

  it('are files under public/, which is what CI hashes into manifest.json', () => {
    for (const name of names) expect(existsSync(join(PUBLIC, name)), name).toBe(true);
  });

  it('are listed once', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('no hashed file name in the source (FE-16 done-when)', () => {
  it('finds no name.<10 hex>.ext in apps/client/src', () => {
    const hashedName = /[\w-]+\.[0-9a-f]{6,64}\.(png|jpe?g|gif|webp|svg|ogg|mp3|wav|json)\b/;
    const offenders = sourceFiles(SRC).filter((file) =>
      hashedName.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
