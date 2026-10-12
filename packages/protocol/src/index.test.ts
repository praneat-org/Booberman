import { describe, expect, it } from 'vitest';
import { isSupportedProtocol, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION } from './index';

describe('protocol', () => {
  it('accepts only the current protocol version', () => {
    expect(isSupportedProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocol(PROTOCOL_VERSION + 1)).toBe(false);
  });

  it('caps a room at 4 players', () => {
    expect(MAX_PLAYERS_PER_ROOM).toBe(4);
  });
});
