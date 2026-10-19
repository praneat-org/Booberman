import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * packages/protocol runs in both the browser and the Worker, so it may only
 * import its own files and these runtime-agnostic packages.
 */
const ALLOWED_PACKAGES = new Set(['zod']);

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

export function importSpecifiers(code: string): string[] {
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

function isAllowed(specifier: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
  if (specifier === 'vitest') return true; // *.test.ts only run under vitest
  const pkg = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  return ALLOWED_PACKAGES.has(pkg ?? '');
}

describe('packages/protocol imports', () => {
  it('finds the import specifiers it checks', () => {
    const code = `import { a } from './a';\nexport * from "../b";\nimport Phaser from 'phaser';\nconst m = import('cloudflare:workers');\nimport 'side-effect';`;
    expect(importSpecifiers(code)).toEqual([
      './a',
      '../b',
      'phaser',
      'cloudflare:workers',
      'side-effect',
    ]);
  });

  it('imports nothing from Phaser, the DOM or the Workers runtime', () => {
    const offending = sourceFiles(SRC).flatMap((file) =>
      importSpecifiers(readFileSync(file, 'utf8'))
        .filter((s) => !isAllowed(s))
        .map((s) => `${relative(SRC, file)} → ${s}`),
    );
    expect(offending).toEqual([]);
  });
});
