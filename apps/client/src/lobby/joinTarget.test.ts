import { describe, expect, it } from 'vitest';
import { resolveEntry } from './entryRoute';
import {
  joinFromLocation,
  roomIdFromPath,
  roomPath,
  roomShareUrl,
  roomUrlWithoutNickname,
} from './joinTarget';

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

describe('roomUrlWithoutNickname', () => {
  it('removes nick while retaining debug and other query parameters', () => {
    expect(
      roomUrlWithoutNickname({
        pathname: '/room/abc123',
        search: '?debug=1&nick=Mint&mode=fast',
      }),
    ).toBe('/room/abc123?debug=1&mode=fast');
  });

  it('removes every nick parameter and retains the URL hash', () => {
    expect(
      roomUrlWithoutNickname({
        pathname: '/room/abc123/',
        search: '?nick=Mint&debug=1&nick=Other',
        hash: '#game',
      }),
    ).toBe('/room/abc123/?debug=1#game');
  });

  it('updates the room path while preserving other query parameters and the hash', () => {
    expect(
      roomUrlWithoutNickname({
        pathname: roomPath('new789'),
        search: '?debug=1&nick=Mint&mode=fast',
        hash: '#game',
      }),
    ).toBe('/room/new789?debug=1&mode=fast#game');
  });

  it('does not add a query string when the URL has no other parameters', () => {
    expect(roomUrlWithoutNickname({ pathname: '/room/abc123', search: '?nick=Mint' })).toBe(
      '/room/abc123',
    );
  });
});

describe('joinFromLocation', () => {
  it('uses the remembered nickname when GameScene skips the lobby in mock mode', () => {
    expect(joinFromLocation({ pathname: '/', search: '?mock=1' }, 'มิ้นท์', () => 0)).toEqual({
      roomId: 'devroom',
      nickname: 'มิ้นท์',
    });
  });

  it('uses the valid query nickname before the remembered nickname', () => {
    expect(
      joinFromLocation({ pathname: '/room/abc123', search: '?mock=1&nick=Bo' }, 'มิ้นท์'),
    ).toEqual({ roomId: 'abc123', nickname: 'Bo' });
  });
});
