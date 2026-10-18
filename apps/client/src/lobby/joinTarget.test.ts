import { RoomId } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { joinFromLocation, roomIdFromPath, roomPath } from './joinTarget';

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
  it('roomPath with a nickname round-trips through joinFromLocation without any storage', () => {
    for (const nick of ['มิ้นท์', 'Mint_01', 'Bo']) {
      const url = new URL(roomPath('xyz789', nick), 'http://x');
      expect(joinFromLocation(url, '')).toEqual({ roomId: 'xyz789', nickname: nick });
    }
  });
});

describe('joinFromLocation', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });
  it('uses path room and the remembered nickname', () => {
    expect(joinFromLocation(at('/room/abc123'), 'มิ้นท์')).toEqual({
      roomId: 'abc123',
      nickname: 'มิ้นท์',
    });
  });
  it('?nick wins over stored; invalid ?nick falls back', () => {
    expect(joinFromLocation(at('/room/abc123', '?nick=Bo'), 'Mint').nickname).toBe('Bo');
    expect(joinFromLocation(at('/room/abc123', '?nick=a b'), 'Mint').nickname).toBe('Mint');
  });
  it('?room works off the room path and falls back to a valid default', () => {
    expect(joinFromLocation(at('/', '?room=zzz999'), 'a').roomId).toBe('zzz999');
    const j = joinFromLocation(at('/', '?room=!!'), '', () => 0.5);
    expect(RoomId.safeParse(j.roomId).success).toBe(true);
    expect(j.nickname).toBe('Player55');
  });
});
