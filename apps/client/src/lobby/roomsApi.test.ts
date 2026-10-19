import { describe, expect, it, vi } from 'vitest';
import { createRoom, DEFAULT_RETRY_AFTER_SECONDS, listRooms } from './roomsApi';

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });
const fetchOf = (res: Response | Error) =>
  vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

describe('createRoom', () => {
  it('POSTs and returns the room id', async () => {
    const f = fetchOf(json({ roomId: 'abc123' }, { status: 201 }));
    expect(await createRoom(f)).toEqual({ status: 'ok', roomId: 'abc123' });
    expect(f).toHaveBeenCalledWith('/api/rooms', expect.objectContaining({ method: 'POST' }));
  });

  it('reads Retry-After on 429, defaulting when it is missing or junk', async () => {
    const limited = (h?: string) =>
      fetchOf(
        json({ error: 'RATE_LIMITED' }, { status: 429, headers: h ? { 'Retry-After': h } : {} }),
      );
    expect(await createRoom(limited('42'))).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: 42,
    });
    expect(await createRoom(limited())).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
    expect(await createRoom(limited('soon'))).toEqual({
      status: 'rate-limited',
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it('turns HTTP errors, bad bodies, invalid ids and network failures into error', async () => {
    expect(await createRoom(fetchOf(new Response('x', { status: 500 })))).toEqual({
      status: 'error',
    });
    expect(await createRoom(fetchOf(json({ nope: 1 }, { status: 201 })))).toEqual({
      status: 'error',
    });
    expect(await createRoom(fetchOf(json({ roomId: '../x' }, { status: 201 })))).toEqual({
      status: 'error',
    });
    expect(await createRoom(fetchOf(new Response('<html>', { status: 201 })))).toEqual({
      status: 'error',
    });
    expect(await createRoom(fetchOf(new TypeError('offline')))).toEqual({ status: 'error' });
  });
});

describe('listRooms', () => {
  it('parses rooms', async () => {
    const rooms = [{ roomId: 'abc123', players: 2, max: 4, createdAt: 1 }];
    expect(await listRooms(fetchOf(json({ rooms })))).toEqual({ status: 'ok', rooms });
  });

  it('rejects malformed rows and failures', async () => {
    expect(await listRooms(fetchOf(json({ rooms: [{ roomId: 'ABC' }] })))).toEqual({
      status: 'error',
    });
    expect(await listRooms(fetchOf(new Response('', { status: 503 })))).toEqual({
      status: 'error',
    });
    expect(await listRooms(fetchOf(new Error('abort')))).toEqual({ status: 'error' });
  });
});
