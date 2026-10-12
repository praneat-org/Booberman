import { PROTOCOL_VERSION } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import worker from './index';

describe('worker', () => {
  it('responds 200 with service info', async () => {
    const res = await worker.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      service: 'booberman-worker',
      protocol: PROTOCOL_VERSION,
    });
  });
});
