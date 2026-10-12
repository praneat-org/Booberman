import { HEALTH_PATH, PROTOCOL_VERSION } from '@booberman/protocol';
import { describe, expect, it, vi } from 'vitest';
import { checkHealth } from './health';

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('checkHealth', () => {
  it('calls /api/health and returns the worker response', async () => {
    const fetchFn = respond({ ok: true, protocol: PROTOCOL_VERSION });
    expect(await checkHealth(fetchFn)).toEqual({
      status: 'ok',
      health: { ok: true, protocol: PROTOCOL_VERSION },
    });
    expect(fetchFn).toHaveBeenCalledWith(HEALTH_PATH);
  });

  it('reports non-200', async () => {
    expect(await checkHealth(respond({}, 502))).toEqual({ status: 'error', reason: 'HTTP 502' });
  });

  it('reports a body that is not HealthResponse', async () => {
    expect(await checkHealth(respond({ ok: 'yes' }))).toEqual({
      status: 'error',
      reason: 'unexpected body',
    });
  });

  it('reports network errors', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkHealth(fetchFn)).toEqual({ status: 'error', reason: 'offline' });
  });
});
