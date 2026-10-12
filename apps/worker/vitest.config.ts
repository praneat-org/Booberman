import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// `pnpm test` runs before `pnpm build` (CI order), so ../client/dist may not exist. Tests serve a tiny
// fixture instead: fake index.html + hashed asset, plus the REAL apps/client/public/_headers.
const assetsDir = mkdtempSync(join(tmpdir(), 'booberman-assets-'));
mkdirSync(join(assetsDir, 'assets'));
writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>Booberman</title>');
writeFileSync(join(assetsDir, 'assets', 'index-Ab12Cd34.js'), 'console.log("game")');
cpSync(new URL('../client/public/_headers', import.meta.url), join(assetsDir, '_headers'));

// Tests run inside workerd with the real RoomDO binding from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { assets: { directory: assetsDir } },
    }),
  ],
});
