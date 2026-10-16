import { describe, expect, it } from 'vitest';
import { createTransport, mockOptionsFromSearch, transportKind } from './createTransport';
import { MockTransport } from './MockTransport';

describe('transportKind', () => {
  it('?mock=1 selects the mock, everything else the real socket', () => {
    expect(transportKind('?mock=1')).toBe('mock');
    expect(transportKind('?debug=1&mock=1')).toBe('mock');
    expect(transportKind('')).toBe('ws');
    expect(transportKind('?mock=0')).toBe('ws');
    expect(transportKind('?mock=')).toBe('ws');
  });
});

describe('mockOptionsFromSearch', () => {
  it('reads numeric knobs and ignores junk', () => {
    expect(
      mockOptionsFromSearch('?mock=1&mockLatency=80&mockJitter=30&mockBots=3&mockSeed=9'),
    ).toEqual({
      latencyMs: 80,
      jitterMs: 30,
      bots: 3,
      seed: 9,
    });
    expect(mockOptionsFromSearch('?mockLatency=abc&mockJitter=')).toEqual({
      latencyMs: undefined,
      jitterMs: undefined,
      bots: undefined,
      seed: undefined,
    });
  });
});

describe('createTransport', () => {
  it('gives a MockTransport for ?mock=1 and null until WsTransport exists', () => {
    expect(createTransport('?mock=1')).toBeInstanceOf(MockTransport);
    expect(createTransport('')).toBeNull();
  });
});
