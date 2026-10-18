import { RoomId } from '@booberman/protocol';
import { MockTransport, type MockTransportOptions } from './MockTransport';
import type { Transport } from './Transport';
import { WsTransport } from './WsTransport';

export type TransportKind = 'mock' | 'ws';

/** `?mock=1` → MockTransport, anything else → the real WebSocket. */
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

const DEFAULT_ROOM = 'dev';

/** Who joins which room. Until the lobby (FE-17 / FE-19) supplies it: `?room=abc123&nick=Mint`. */
export function joinFromSearch(
  search: string,
  random: () => number = Math.random,
): { roomId: string; nickname: string } {
  const params = new URLSearchParams(search);
  const room = params.get('room')?.toLowerCase() ?? '';
  const nick = params.get('nick')?.trim() ?? '';
  return {
    roomId: RoomId.safeParse(room).success ? room : DEFAULT_ROOM,
    nickname: nick || `Player${Math.floor(random() * 90) + 10}`,
  };
}

/**
 * `?mock=1` → MockTransport, otherwise WsTransport on `/ws/room/:id` (same origin).
 * `null` only when the browser has no WebSocket.
 */
export function createTransport(
  search: string,
  join: { roomId: string; nickname: string } = joinFromSearch(search),
): Transport | null {
  if (transportKind(search) === 'mock') return new MockTransport(mockOptionsFromSearch(search));
  if (typeof WebSocket === 'undefined') return null;
  return new WsTransport(join);
}
