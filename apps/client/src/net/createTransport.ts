import { MockTransport, type MockTransportOptions } from './MockTransport';
import type { Transport } from './Transport';

export type TransportKind = 'mock' | 'ws';

/** `?mock=1` → MockTransport, anything else → the real WebSocket (FE-13). */
export function transportKind(search: string): TransportKind {
  return new URLSearchParams(search).get('mock') === '1' ? 'mock' : 'ws';
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Optional `mockBots`, `mockSeed`, `mockLatency`, `mockJitter` (ms) for exercising CAR-3794. */
export function mockOptionsFromSearch(search: string): MockTransportOptions {
  const params = new URLSearchParams(search);
  return {
    bots: numberParam(params, 'mockBots'),
    seed: numberParam(params, 'mockSeed'),
    latencyMs: numberParam(params, 'mockLatency'),
    jitterMs: numberParam(params, 'mockJitter'),
  };
}

/** `null` = no transport available for this URL yet (WsTransport arrives in FE-13). */
export function createTransport(search: string): Transport | null {
  if (transportKind(search) === 'mock') return new MockTransport(mockOptionsFromSearch(search));
  return null;
}
