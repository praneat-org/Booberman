import { env, exports } from 'cloudflare:workers';
import {
  type CreateRoomResponse,
  type ListRoomsResponse,
  MAX_PLAYERS_PER_ROOM,
  ROOMS_PATH,
  RoomId,
  RoomsApiErrorCode,
} from '@booberman/protocol';
import { describe, expect, it, vi } from 'vitest';
import { CREATE_ROOM_ATTEMPTS, createRoom, generateRoomId, listRooms } from '../src/api/rooms';

let nextIp = 0;
const freshIp = () => `10.0.0.${++nextIp}`;

const post = (ip: string) =>
  exports.default.fetch(`http://localhost${ROOMS_PATH}`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  });
const list = async (): Promise<ListRoomsResponse> => {
  const res = await exports.default.fetch(`http://localhost${ROOMS_PATH}`);
  expect(res.status).toBe(200);
  return res.json();
};

describe('POST /api/rooms', () => {
  it('returns 201 { roomId } with a valid 6-char id and stores key with metadata + TTL', async () => {
    const res = await post(freshIp());
    expect(res.status).toBe(201);
    const body: CreateRoomResponse = await res.json();
    expect(body.roomId).toMatch(/^[a-z0-9]{6}$/);
    expect(RoomId.safeParse(body.roomId).success).toBe(true);

    const { keys } = await env.ROOMS.list({ prefix: `room:${body.roomId}` });
    expect(keys).toHaveLength(1);
    expect(keys[0]?.metadata).toMatchObject({ players: 0, max: MAX_PLAYERS_PER_ROOM });
    expect(keys[0]?.expiration).toBeGreaterThan(Date.now() / 1000);
    expect(keys[0]?.expiration).toBeLessThanOrEqual(Date.now() / 1000 + 301);
  });

  it('created room shows up in GET /api/rooms', async () => {
    const created: CreateRoomResponse = await (await post(freshIp())).json();
    const { rooms } = await list();
    const found = rooms.find((r) => r.roomId === created.roomId);
    expect(found).toMatchObject({ players: 0, max: MAX_PLAYERS_PER_ROOM });
  });

  it('6th POST within a minute from one IP → 429 RATE_LIMITED; other IPs unaffected', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await post(ip)).status).toBe(201);
    const limited = await post(ip);
    expect(limited.status).toBe(429);
    const body: { error: string } = await limited.json();
    expect(RoomsApiErrorCode.parse(body.error)).toBe('RATE_LIMITED');
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect((await post(freshIp())).status).toBe(201);
  });

  it('rate-limited request does not create a room', async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) await post(ip);
    const before = (await env.ROOMS.list({ prefix: 'room:' })).keys.length;
    expect((await post(ip)).status).toBe(429);
    expect((await env.ROOMS.list({ prefix: 'room:' })).keys.length).toBe(before);
  });
});

describe('POST /api/rooms id collisions', () => {
  const limiter = { limit: async () => ({ success: true }) } as unknown as RateLimit;
  const req = () => new Request(`http://localhost${ROOMS_PATH}`, { method: 'POST' });

  it('skips an id that already exists and never overwrites its metadata', async () => {
    const taken = { players: 2, max: 4, createdAt: 123 };
    await env.ROOMS.put('room:takenid', '', { metadata: taken });
    const ids = ['takenid', 'freshid'];
    const res = await createRoom(
      req(),
      { ROOMS: env.ROOMS, ROOM_CREATE_LIMITER: limiter },
      () => ids.shift() ?? 'zzzzzz',
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as CreateRoomResponse).roomId).toBe('freshid');
    expect((await env.ROOMS.getWithMetadata('room:takenid')).metadata).toEqual(taken);
  });

  it(`gives up with 503 ROOM_ID_UNAVAILABLE after ${CREATE_ROOM_ATTEMPTS} taken ids`, async () => {
    await env.ROOMS.put('room:alwaysid', '', { metadata: { players: 1, max: 4, createdAt: 1 } });
    const res = await createRoom(
      req(),
      { ROOMS: env.ROOMS, ROOM_CREATE_LIMITER: limiter },
      () => 'alwaysid',
    );
    expect(res.status).toBe(503);
    expect(RoomsApiErrorCode.parse(((await res.json()) as { error: string }).error)).toBe(
      'ROOM_ID_UNAVAILABLE',
    );
  });
});

describe('GET /api/rooms', () => {
  it('follows the KV.list cursor past the first page', async () => {
    const ids = ['pagea1', 'pagea2', 'pagea3', 'pagea4', 'pagea5'];
    for (const [i, id] of ids.entries()) {
      await env.ROOMS.put(`room:${id}`, '', { metadata: { players: 0, max: 4, createdAt: i } });
    }
    const body: ListRoomsResponse = await (await listRooms({ ROOMS: env.ROOMS }, 2)).json();
    const got = body.rooms.map((r) => r.roomId);
    for (const id of ids) expect(got).toContain(id);
  });

  it('hides full rooms and ignores keys with bad metadata', async () => {
    await env.ROOMS.put('room:openroom', '', { metadata: { players: 3, max: 4, createdAt: 1 } });
    await env.ROOMS.put('room:fullroom', '', { metadata: { players: 4, max: 4, createdAt: 2 } });
    await env.ROOMS.put('room:badmeta', '', { metadata: { nope: true } });
    await env.ROOMS.put('room:nometa', '');
    await env.ROOMS.put('other:key', '', { metadata: { players: 0, max: 4, createdAt: 3 } });

    const ids = (await list()).rooms.map((r) => r.roomId);
    expect(ids).toContain('openroom');
    expect(ids).not.toContain('fullroom');
    expect(ids).not.toContain('badmeta');
    expect(ids).not.toContain('nometa');
    expect(ids).not.toContain('key');
  });

  it('uses KV.list once and never KV.get', async () => {
    const real = env.ROOMS;
    const listSpy = vi.fn((opts?: KVNamespaceListOptions) => real.list(opts));
    const getSpy = vi.fn();
    const spyKv = { list: listSpy, get: getSpy, getWithMetadata: getSpy } as unknown as KVNamespace;

    await real.put('room:spyroom', '', { metadata: { players: 1, max: 4, createdAt: 1 } });
    const res = await listRooms({ ROOMS: spyKv });
    const body: ListRoomsResponse = await res.json();

    expect(body.rooms.map((r) => r.roomId)).toContain('spyroom');
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith({ prefix: 'room:' });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('unsupported method → 405', async () => {
    const res = await exports.default.fetch(`http://localhost${ROOMS_PATH}`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, POST');
  });
});

describe('generateRoomId', () => {
  it('always produces valid 6-char ids', () => {
    for (let i = 0; i < 500; i++) expect(generateRoomId()).toMatch(/^[a-z0-9]{6}$/);
  });
});
