import { describe, expect, it } from 'vitest';

// Vite's `import.meta.glob` (not typed here because the worker tsconfig has no vite/client types).
declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

// Every non-test source file in game/ as raw text (resolved by Vite at build time).
const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FORBIDDEN = [
  /\bMath\.random\b/,
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bperformance\.now\b/,
  /\bcrypto\b/,
  /\bconsole\./,
  /cloudflare:/,
];

describe('game/ stays deterministic and platform-free', () => {
  it('finds the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(6);
  });

  it('scans recursively (sub-folders of game/ are covered too)', () => {
    expect(Object.keys(sources)).toContain('./config.ts');
    expect(Object.keys(sources)).toContain('./board.ts');
  });

  for (const [file, text] of Object.entries(sources)) {
    if (file !== './config.ts') {
      it(`${file} has no 4 / 40 / 10 / 3000 balance literal (they live in config.ts)`, () => {
        expect(stripComments(text), file).not.toMatch(/(?<![\w.])(?:4|40|10|3000)(?![\w.])/);
      });
    }

    it(`${file} has no Math.random / Date.now / Workers API`, () => {
      const code = stripComments(text);
      for (const re of FORBIDDEN) expect(code, `${file} matches ${re}`).not.toMatch(re);
    });

    it(`${file} imports only relative files or @booberman/protocol`, () => {
      const specs = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of specs) {
        expect(spec.startsWith('.') || spec === '@booberman/protocol', `${file}: ${spec}`).toBe(
          true,
        );
      }
    });
  }
});
