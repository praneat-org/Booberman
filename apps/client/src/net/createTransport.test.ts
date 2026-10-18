import { describe, expect, it, vi } from 'vitest';
import {
  createTransport,
  joinFromSearch,
  mockOptionsFromSearch,
  transportKind,
} from './createTransport';
import { MockTransport } from './MockTransport';
import { WsTransport } from './WsTransport';

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

describe('joinFromSearch', () => {
  it('reads room + nick, falling back to a dev room and a random Player name', () => {
    expect(joinFromSearch('?room=Abc123&nick=Mint')).toEqual({
      roomId: 'abc123',
      nickname: 'Mint',
    });
    expect(joinFromSearch('?room=x', () => 0)).toEqual({ roomId: 'dev', nickname: 'Player10' });
    expect(joinFromSearch('', () => 0.99).nickname).toBe('Player99');
  });
});

describe('createTransport', () => {
  it('gives MockTransport for ?mock=1 and WsTransport otherwise', () => {
    vi.stubGlobal('WebSocket', class {});
    expect(createTransport('?mock=1')).toBeInstanceOf(MockTransport);
    expect(createTransport('')).toBeInstanceOf(WsTransport);
    expect(createTransport('?mock=0&room=abcd')).toBeInstanceOf(WsTransport);
    vi.unstubAllGlobals();
  });

  it('is null without a WebSocket', () => {
    vi.stubGlobal('WebSocket', undefined);
    expect(createTransport('')).toBeNull();
    vi.unstubAllGlobals();
  });
});
