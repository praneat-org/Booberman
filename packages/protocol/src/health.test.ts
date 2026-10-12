import { describe, expect, it } from 'vitest';
import { isHealthResponse } from './health';

describe('isHealthResponse', () => {
  it('accepts a valid body', () => {
    expect(isHealthResponse({ ok: true, protocol: 0 })).toBe(true);
  });

  it.each([null, 'ok', {}, { ok: false, protocol: 0 }, { ok: true }, { ok: true, protocol: '0' }])(
    'rejects %j',
    (value) => {
      expect(isHealthResponse(value)).toBe(false);
    },
  );
});
