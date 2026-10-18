import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('r2-cors.*.json', () => {
  for (const env of ['dev', 'production'] as const) {
    const cors = JSON.parse(read(`r2-cors.${env}.json`));
    const rule = cors.rules[0];

    it(`${env}: read-only, no wildcard origin, shape wrangler accepts`, () => {
      expect(cors.rules).toHaveLength(1);
      expect(rule.allowed.methods).toEqual(['GET', 'HEAD']);
      expect(rule.allowed.origins.length).toBeGreaterThan(0);
      for (const o of rule.allowed.origins) {
        expect(o).not.toContain('*');
        expect(o).toMatch(/^https:\/\/[a-z0-9.-]+$|^http:\/\/localhost:\d+$/);
      }
      expect(JSON.stringify(cors)).not.toMatch(/CORSRules|AllowedOrigins/);
    });
  }

  it('production allows only its own https origin; dev is a different set', () => {
    const dev = JSON.parse(read('r2-cors.dev.json')).rules[0].allowed.origins;
    const prod = JSON.parse(read('r2-cors.production.json')).rules[0].allowed.origins;
    expect(prod.some((o: string) => o.includes('localhost'))).toBe(false);
    expect(prod.some((o: string) => o.includes('-dev'))).toBe(false);
    expect(dev).toContain('https://booberman-dev.miryn.workers.dev');
    expect(dev).not.toContain('https://booberman.miryn.workers.dev');
  });
});

// The deploy workflows are only exercised by a real run after merge; pin the parts that make it safe.
describe.each([
  ['deploy-dev.yml', 'dev'],
  ['deploy-prod.yml', 'production'],
])('%s asset steps', (file, env) => {
  const yml = read(`.github/workflows/${file}`);

  it('syncs assets and applies CORS after the build and before wrangler deploy', () => {
    const build = yml.indexOf('run: pnpm build');
    const sync = yml.indexOf('scripts/upload-assets.ts sync');
    const cors = yml.indexOf(`r2-cors.${env}.json`);
    const deploy = yml.indexOf('pnpm exec wrangler deploy');
    expect(build).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(build);
    expect(cors).toBeGreaterThan(sync);
    expect(deploy).toBeGreaterThan(cors);
  });

  it('uses the Cloudflare secrets only on steps that call Cloudflare, never echoes them', () => {
    expect(yml).not.toMatch(/echo[^\n]*(secrets\.|CLOUDFLARE_API_TOKEN)/);
    const jobEnv = yml.slice(yml.indexOf('    env:'), yml.indexOf('    steps:'));
    expect(jobEnv).not.toContain('secrets.');
  });
});

// manifest.json is not in R2: it ships in the client build, so the static-assets rules decide its caching.
describe('apps/client/public/_headers', () => {
  const headers = read('apps/client/public/_headers');

  it('revalidates everything by default and only long-caches /assets/*, so manifest.json is never immutable', () => {
    expect(headers).toMatch(/^\/\*\n\s+Cache-Control: no-cache$/m);
    const immutable = headers.split(/\n(?=\/)/).filter((block) => block.includes('immutable'));
    expect(immutable).toHaveLength(1);
    expect(immutable[0]).toMatch(/^\/assets\/\*/);
  });
});
