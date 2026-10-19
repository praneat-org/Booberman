import { describe, expect, it } from 'vitest';
import { resolveEntry } from './entryRoute';
import { roomIdFromPath, roomPath, roomShareUrl } from './joinTarget';

describe('roomIdFromPath', () => {
  it('accepts /room/<valid id>, with optional slash and any case', () => {
    expect(roomIdFromPath('/room/abc123')).toBe('abc123');
    expect(roomIdFromPath('/room/abc123/')).toBe('abc123');
    expect(roomIdFromPath('/room/ABC123')).toBe('abc123');
  });
  it('rejects everything else', () => {
    for (const p of [
      '/',
      '/room',
      '/room/',
      '/room/ab',
      '/room/a_b_c_d',
      '/room/abc123/x',
      '/rooms/abc123',
      '/room/%E0%A4%A',
      '/room/%2e%2e',
    ]) {
      expect(roomIdFromPath(p), p).toBeUndefined();
    }
  });
  it('roomPath is the inverse', () => {
    expect(roomIdFromPath(roomPath('xyz789'))).toBe('xyz789');
    expect(roomPath('xyz789')).toBe('/room/xyz789');
  });
  it('roomPath with a nickname round-trips through resolveEntry without any storage', () => {
    for (const nick of ['มิ้นท์', 'Mint_01', 'Bo']) {
      const url = new URL(roomPath('xyz789', nick), 'http://x');
      expect(resolveEntry(url, '')).toEqual({ kind: 'join', roomId: 'xyz789', nickname: nick });
    }
  });
});

describe('roomShareUrl', () => {
  it('is origin + /room/<id> with no query, so no nickname leaks into a shared link', () => {
    expect(roomShareUrl('http://localhost:5173', 'abc123')).toBe(
      'http://localhost:5173/room/abc123',
    );
    expect(roomShareUrl('https://booberman.example', 'xyz789')).not.toContain('?');
  });
});
