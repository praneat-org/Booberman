import { describe, expect, it } from 'vitest';
import { resolveEntry } from './entryRoute';
import { roomPath } from './joinTarget';

const at = (pathname: string, search = '') => ({ pathname, search });

describe('resolveEntry', () => {
  it('shows the home screen for / and for room-less paths', () => {
    for (const p of ['/', '/room', '/room/', '/rooms/abc123', '/index.html']) {
      expect(resolveEntry(at(p), 'Mint'), p).toEqual({ kind: 'home' });
    }
    expect(resolveEntry(at('/', '?nick=Bo&room=abc123'), '')).toEqual({ kind: 'home' });
  });

  it('opens the name form for a room link, prefilled with the remembered name', () => {
    expect(resolveEntry(at('/room/abc123'), 'มิ้นท์')).toEqual({
      kind: 'form',
      roomId: 'abc123',
      nickname: 'มิ้นท์',
    });
    // nothing remembered: an empty box, never a made-up PlayerNN
    expect(resolveEntry(at('/room/abc123/'), '')).toEqual({
      kind: 'form',
      roomId: 'abc123',
      nickname: '',
    });
    // ids are case-insensitive, like the server's RoomId (lower-cased before use)
    expect(resolveEntry(at('/room/ABC123'), '').kind).toBe('form');
  });

  it('goes straight in when ?nick= passes the rules (and trims it)', () => {
    expect(resolveEntry(at('/room/abc123', '?nick=Bo'), 'Mint')).toEqual({
      kind: 'join',
      roomId: 'abc123',
      nickname: 'Bo',
    });
    expect(resolveEntry(at('/room/abc123', '?nick=%20%20ab%20%20'), '')).toMatchObject({
      kind: 'join',
      nickname: 'ab',
    });
  });

  it('?nick= beats the remembered name, and the lobby URL round-trips', () => {
    for (const nick of ['มิ้นท์', 'Mint_01', 'Bo']) {
      const url = new URL(roomPath('xyz789', nick), 'http://x');
      expect(resolveEntry(url, 'someone_else')).toEqual({
        kind: 'join',
        roomId: 'xyz789',
        nickname: nick,
      });
    }
  });

  it('keeps an invalid ?nick= in the form instead of swapping it for another name', () => {
    for (const bad of ['a b', 'a-b', 'x'.repeat(13), '', '%F0%9F%98%80']) {
      const route = resolveEntry(at('/room/abc123', `?nick=${bad}`), 'Mint');
      expect(route.kind, bad).toBe('form');
      expect((route as { nickname: string }).nickname, bad).not.toBe('Mint');
    }
    expect(resolveEntry(at('/room/abc123', '?nick=a%20b'), 'Mint')).toEqual({
      kind: 'form',
      roomId: 'abc123',
      nickname: 'a b',
    });
  });

  it('says not-found for a /room/<junk> link', () => {
    for (const p of [
      '/room/ab', // too short
      '/room/waytoolongroomid1', // too long
      '/room/a_b_c_d',
      '/room/ab-cd',
      '/room/%E0%A4%A', // broken escape
      '/room/%2e%2e',
      '/room/abc123/x', // extra segment
      '/room/abc123/x/y',
    ]) {
      expect(resolveEntry(at(p, '?nick=Bo'), 'Mint'), p).toEqual({ kind: 'not-found' });
    }
  });
});
