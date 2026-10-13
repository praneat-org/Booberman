import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import raw from '../wrangler.jsonc?raw';

// BE-31 / CAR-3788: Workers Static Assets. The assets directory is a fixture (vitest.config.ts) that
// uses the real apps/client/public/_headers.
const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://localhost${path}`, init);

describe('static assets', () => {
  it('/ serves index.html with no-cache', async () => {
    const res = await call('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>Booberman</title>');
  });

  it('/room/abc123 (no such file) falls back to index.html, not 404', async () => {
    const res = await call('/room/abc123');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>Booberman</title>');
  });

  it('hashed asset is cached for a year, immutable', async () => {
    const res = await call('/assets/index-Ab12Cd34.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('/api/health stays JSON from the Worker, not index.html', async () => {
    const res = await call('/api/health');
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('unknown /api path is a JSON 404, not the SPA fallback', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('/ws path without upgrade reaches the Worker (426), not index.html', async () => {
    const res = await call('/ws/room/abc123');
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({ error: 'UPGRADE_REQUIRED' });
  });
});

// exports.default.fetch calls the Worker directly (skips Cloudflare's asset router), so the routing
// rules themselves are pinned here and exercised end to end with `wrangler dev` (see BE-31).
describe('wrangler.jsonc assets config', () => {
  it('runs the Worker first for /api/* and /ws/*, SPA fallback for the rest', () => {
    // strip whole-line // comments (no string value in this file starts a line with //)
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    expect(config.assets).toMatchObject({
      directory: '../client/dist',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api/*', '/ws/*'],
    });
  });
});
