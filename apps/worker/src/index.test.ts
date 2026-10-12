import { exports } from 'cloudflare:workers';
import { HEALTH_PATH, type HealthResponse, PROTOCOL_VERSION } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';

const call = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://localhost${path}`, init);

describe('worker', () => {
  it('GET /api/health returns HealthResponse', async () => {
    const res = await call(HEALTH_PATH);
    expect(res.status).toBe(200);
    const body: HealthResponse = await res.json();
    expect(body).toEqual({ ok: true, protocol: PROTOCOL_VERSION });
  });

  it('unknown path → 404 NOT_FOUND', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_FOUND' });
  });

  it('wrong method → 405 with Allow header', async () => {
    const res = await call(HEALTH_PATH, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
  });
});
