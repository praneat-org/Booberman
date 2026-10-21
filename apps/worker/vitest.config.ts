import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// `pnpm test` runs before `pnpm build` (CI order), so ../client/dist may not exist. Tests serve a tiny
// fixture instead: fake index.html + hashed asset, plus the REAL apps/client/public/_headers.
const assetsDir = mkdtempSync(join(tmpdir(), 'booberman-assets-'));
mkdirSync(join(assetsDir, 'assets'));
writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>Booberman</title>');
writeFileSync(join(assetsDir, 'assets', 'index-Ab12Cd34.js'), 'console.log("game")');
cpSync(new URL('../client/public/_headers', import.meta.url), join(assetsDir, '_headers'));

// BE-42: the REAL migrations/ files (the ones `wrangler d1 migrations apply` runs in deploy-*.yml) are read
// here in Node and applied to the local test D1 by test/setup.ts, so a broken migration fails `pnpm test`.
const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname);

// Tests run inside workerd with the real RoomDO binding from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        assets: { directory: assetsDir },
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
});
