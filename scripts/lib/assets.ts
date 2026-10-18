// Pure asset logic for BE-37 (CAR-3789): scan assets/, hash the content, name the files, build manifest.json.
// No network, no wrangler here: everything in this file is unit-tested (scripts/test/assets.test.ts).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

/** Hex chars of the sha256 kept in the file name: `player.png` -> `player.3fa9c1d2e4.png`. */
export const HASH_LENGTH = 10;

/** Every R2 object is content-addressed (the hash is in the name) -> cacheable forever. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Allow-list of what goes to R2 (extension -> Content-Type). Anything else under assets/ (CREDITS.md,
 * scratch files) is skipped and logged, never uploaded by accident.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

// Logical keys end up in an R2 object path and in a process argument: keep them boring.
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface AssetFile {
  /** Name the game code uses, relative to assets/ with `/` separators: `sprites/player.png` */
  logicalKey: string;
  /** Name in the bucket: `sprites/player.3fa9c1d2e4.png` */
  hashedKey: string;
  absPath: string;
  contentType: string;
  bytes: number;
}

export type Manifest = Record<string, string>;

export function contentHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, HASH_LENGTH);
}

/** `sprites/player.png` + `3fa9c1d2e4` -> `sprites/player.3fa9c1d2e4.png` (the last extension only). */
export function hashedName(logicalKey: string, hash: string): string {
  const ext = posix.extname(logicalKey);
  return `${logicalKey.slice(0, logicalKey.length - ext.length)}.${hash}${ext}`;
}

export function contentTypeFor(logicalKey: string): string | undefined {
  return CONTENT_TYPES[posix.extname(logicalKey).toLowerCase()];
}

function assertSafeKey(logicalKey: string): void {
  if (!SAFE_KEY.test(logicalKey) || logicalKey.split('/').some((p) => p === '' || p === '..')) {
    throw new Error(
      `asset name "${logicalKey}" is not allowed: use only A-Z a-z 0-9 . _ - and "/" between folders`,
    );
  }
}

async function* walk(dir: string, prefix: string): AsyncGenerator<{ rel: string; abs: string }> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // .DS_Store, .gitkeep ...
    const abs = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    // symlinks are neither isFile() nor isDirectory() on a Dirent -> never followed
    if (e.isDirectory()) yield* walk(abs, rel);
    else if (e.isFile()) yield { rel, abs };
  }
}

export interface ScanResult {
  files: AssetFile[];
  /** logical keys that were ignored because their extension is not in CONTENT_TYPES */
  skipped: string[];
}

/** Hash every allowed file under `srcDir`. Throws on an unsafe name; a missing srcDir is an error too. */
export async function scanAssets(srcDir: string): Promise<ScanResult> {
  const files: AssetFile[] = [];
  const skipped: string[] = [];
  for await (const { rel, abs } of walk(srcDir, '')) {
    const contentType = contentTypeFor(rel);
    if (!contentType) {
      skipped.push(rel);
      continue;
    }
    assertSafeKey(rel);
    const data = await readFile(abs);
    files.push({
      logicalKey: rel,
      hashedKey: hashedName(rel, contentHash(data)),
      absPath: abs,
      contentType,
      bytes: data.byteLength,
    });
  }
  return { files, skipped };
}

/** logical -> hashed, keys sorted so the same assets always give byte-identical manifest.json. */
export function buildManifest(files: readonly AssetFile[]): Manifest {
  const manifest: Manifest = {};
  for (const f of [...files].sort((a, b) => (a.logicalKey < b.logicalKey ? -1 : 1))) {
    if (f.logicalKey in manifest) throw new Error(`duplicate asset name ${f.logicalKey}`);
    manifest[f.logicalKey] = f.hashedKey;
  }
  return manifest;
}

export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
