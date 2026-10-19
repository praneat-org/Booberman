import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import {
  type CreateRoomResponse,
  MAX_PLAYERS_PER_ROOM,
  ROOM_KV_TTL_SECONDS,
  ROOMS_PATH,
} from '@booberman/protocol';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoomDO } from '../src/room/RoomDO';
import {
  ROOM_KV_MIN_WRITE_INTERVAL_MS,
  ROOM_KV_RENEW_INTERVAL_MS,
  RoomKvSync,
} from '../src/room/roomKv';
import { join } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));
const kvStats = (room: string) => runInDurableObject(stubFor(room), (r: RoomDO) => r.roomKvStats());
const entry = (room: string) => env.ROOMS.getWithMetadata(`room:${room}`);

/** Every room the integration tests touch; the unit tests below wait for all of them to go quiet. */
const usedRooms = new Set<string>();

let nextIp = 0;
async function createRoom(): Promise<string> {
  const res = await exports.default.fetch(`http://localhost${ROOMS_PATH}`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `10.9.0.${++nextIp}` },
  });
  expect(res.status).toBe(201);
  const { roomId } = (await res.json()) as CreateRoomResponse;
  usedRooms.add(roomId);
  return roomId;
}

/** Polls until `check` passes (KV in miniflare is immediate, the DO's write is fire-and-forget). */
async function eventually(check: () => Promise<void>, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > end) throw error;
      await sleep(50);
    }
  }
}

describe('RoomDO keeps the KV lobby entry in step (integration)', () => {
  it('3 players join within a second -> at most 2 KV writes, final value 3, createdAt / max kept, TTL renewed', async () => {
    const room = await createRoom();
    const before = await entry(room);
    const createdAt = (before.metadata as { createdAt: number }).createdAt;

    const a = await join(room, 'A');
    const b = await join(room, 'B');
    const c = await join(room, 'C');

    await eventually(async () => {
      expect((await entry(room)).metadata).toEqual({
        players: 3,
        max: MAX_PLAYERS_PER_ROOM,
        createdAt,
      });
    });
    const stats = await kvStats(room);
    expect(stats.puts).toBeLessThanOrEqual(2);
    expect(stats.puts).toBeGreaterThanOrEqual(1);
    expect(stats.errors).toBe(0);

    // the key's TTL was renewed to ~300 s from the last write
    const { keys } = await env.ROOMS.list({ prefix: `room:${room}` });
    expect(keys[0]?.expiration).toBeGreaterThan(Date.now() / 1000 + ROOM_KV_TTL_SECONDS - 5);
    a.close();
    b.close();
    c.close();
  });

  it('a leave updates the count; the last player leaving deletes the key and leaves no timer behind', async () => {
    const room = await createRoom();
    const a = await join(room, 'A');
    const b = await join(room, 'B');
    await eventually(async () => {
      expect((await entry(room)).metadata).toMatchObject({ players: 2 });
    });

    b.close();
    await eventually(async () => {
      expect((await entry(room)).metadata).toMatchObject({ players: 1 });
    });

    a.close();
    await eventually(async () => {
      expect((await entry(room)).metadata).toBeNull();
      const { keys } = await env.ROOMS.list({ prefix: `room:${room}` });
      expect(keys).toHaveLength(0);
    });
    await eventually(async () => {
      const stats = await kvStats(room);
      expect(stats.deletes).toBe(1);
      expect(stats.pending).toBe(false);
    });
  });

  it('leave then rejoin inside one second ends with the right count (last value always written)', async () => {
    const room = await createRoom();
    const a = await join(room, 'A');
    const b = await join(room, 'B');
    b.close();
    const c = await join(room, 'C');
    await eventually(async () => {
      expect((await entry(room)).metadata).toMatchObject({ players: 2 });
    });
    a.close();
    c.close();
  });

  it('a room opened by a direct link (no POST key) is playable but never gets a key', async () => {
    const room = 'direct1';
    usedRooms.add(room);
    const a = await join(room, 'A');
    const b = await join(room, 'B');
    await eventually(async () => {
      expect((await kvStats(room)).skipped).toBeGreaterThanOrEqual(1);
    });
    expect((await kvStats(room)).puts).toBe(0);
    expect((await entry(room)).metadata).toBeNull();
    a.close();
    b.close();
  });

  it('fullness comes from the sockets: KV saying "4/4" does not block a join, KV saying "0/4" does not allow a 5th', async () => {
    const room = await createRoom();
    const meta = (await entry(room)).metadata as { createdAt: number };
    await env.ROOMS.put(`room:${room}`, '', {
      metadata: {
        players: MAX_PLAYERS_PER_ROOM,
        max: MAX_PLAYERS_PER_ROOM,
        createdAt: meta.createdAt,
      },
      expirationTtl: ROOM_KV_TTL_SECONDS,
    });
    const players = [];
    for (const name of ['A', 'B', 'C', 'D']) players.push(await join(room, name));
    const fifth = await join(room, 'E').catch((e: Error) => e);
    // join() waits for welcome; ROOM_FULL never sends one, so it must time out
    expect(fifth).toBeInstanceOf(Error);
    for (const p of players) p.close();
  });
});

describe('RoomKvSync (unit, fake KV + fake timers)', () => {
  afterEach(() => vi.useRealTimers());

  // The DOs of the integration tests above share this isolate's globals. Test code closes their sockets
  // and returns, so a DO may still process that close (leave -> RoomKvSync.update -> trailing setTimeout)
  // after `vi.useFakeTimers()` ran, and its timer would land in the fake clock and break
  // `vi.getTimerCount()` below (BE-52). Start the fake-timer tests only once every such room has run
  // its last `leave()`.
  // `!isTicking()` alone is NOT a safe signal: once a close starts, the socket is already gone from
  // `getWebSockets()`, so a tick can call `stopLoop()` before `leave()` has run. Every room here ends
  // empty, and only `leave()` -> `update(0)` -> `flush()` deletes the key, so `deletes >= 1` means
  // the last leave ran; `!pending` then waits out the delete and any trailing timer.
  beforeAll(async () => {
    for (const room of usedRooms) {
      await eventually(async () => {
        const left = await runInDurableObject(stubFor(room), (r: RoomDO) => {
          const stats = r.roomKvStats();
          return (stats.deletes ?? 0) >= 1 && !stats.pending && !r.isTicking();
        });
        expect(left).toBe(true);
      }, 10_000);
    }
  });

  function fakeKv(existing: unknown = { players: 0, max: 4, createdAt: 123 }) {
    const puts: { players: number; max: number; createdAt: number }[] = [];
    const deletes: string[] = [];
    const kv = {
      getWithMetadata: vi.fn(async () => ({ value: '', metadata: existing, cacheStatus: null })),
      put: vi.fn(async (_k: string, _v: string, opts: { metadata: (typeof puts)[number] }) => {
        puts.push(opts.metadata);
      }),
      delete: vi.fn(async (k: string) => {
        deletes.push(k);
      }),
    };
    return {
      kv: kv as unknown as ConstructorParameters<typeof RoomKvSync>[0],
      puts,
      deletes,
      raw: kv,
    };
  }
  const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  it('burst of 3 updates in one window -> 2 writes (leading + trailing), last value 3', async () => {
    vi.useFakeTimers();
    const { kv, puts } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(1);
    sync.update(2);
    sync.update(3);
    await settle();
    expect(puts.map((p) => p.players)).toEqual([1]);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(puts.map((p) => p.players)).toEqual([1, 3]);
    expect(puts.every((p) => p.createdAt === 123 && p.max === 4)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never writes the same key twice inside the 1 s window, however many updates', async () => {
    vi.useFakeTimers();
    const { kv, raw } = fakeKv();
    const stamps: number[] = [];
    raw.put.mockImplementation(async () => {
      stamps.push(Date.now());
    });
    const sync = new RoomKvSync(kv, 'r1');
    for (let i = 1; i <= 40; i++) {
      sync.update(i % 4 || 1);
      await settle(100);
    }
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    for (let i = 1; i < stamps.length; i++) {
      expect((stamps[i] ?? 0) - (stamps[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        ROOM_KV_MIN_WRITE_INTERVAL_MS,
      );
    }
    expect(stamps.length).toBeGreaterThan(1);
  });

  it('empty room deletes the key; delete respects the window after a put; no timer remains', async () => {
    vi.useFakeTimers();
    const { kv, puts, deletes } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(1);
    await settle();
    sync.update(0);
    await settle(10);
    expect(deletes).toEqual([]); // still inside the 1 s window
    expect(sync.pending).toBe(true);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(deletes).toEqual(['room:r1']);
    expect(puts).toHaveLength(1);
    expect(sync.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('empty then someone joins before the trailing write -> writes the count, no delete', async () => {
    vi.useFakeTimers();
    const { kv, puts, deletes } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(1);
    await settle();
    sync.update(0);
    sync.update(2);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(deletes).toEqual([]);
    expect(puts.map((p) => p.players)).toEqual([1, 2]);
  });

  it('no valid POST key -> nothing is written (skipped), and a KV failure does not throw', async () => {
    vi.useFakeTimers();
    const none = fakeKv(null);
    const s1 = new RoomKvSync(none.kv, 'direct');
    s1.update(2);
    await settle();
    expect(none.puts).toEqual([]);
    expect(s1.counters.skipped).toBe(1);

    const bad = fakeKv({ players: 'x' });
    const s2 = new RoomKvSync(bad.kv, 'garbage');
    s2.update(1);
    await settle();
    expect(bad.puts).toEqual([]);

    const broken = fakeKv();
    broken.raw.put.mockRejectedValueOnce(new Error('kv down'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s3 = new RoomKvSync(broken.kv, 'r3');
    s3.update(1);
    await settle();
    expect(s3.counters.errors).toBe(1);
    s3.update(2);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(broken.puts.map((p) => p.players)).toEqual([2]);
    errorLog.mockRestore();
  });

  it('a key POST created < 1 s ago is not written again until its window has passed', async () => {
    vi.useFakeTimers();
    const { kv, puts } = fakeKv({ players: 0, max: 4, createdAt: Date.now() });
    const sync = new RoomKvSync(kv, 'fresh');
    sync.update(1); // join right after create
    await settle(10);
    expect(puts).toEqual([]);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(puts.map((p) => p.players)).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failed write is retried once after the window with the latest value; a second failure is not', async () => {
    vi.useFakeTimers();
    const { kv, puts, raw } = fakeKv();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    raw.put.mockRejectedValueOnce(new Error('429'));
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(3);
    await settle();
    expect(puts).toEqual([]);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(puts.map((p) => p.players)).toEqual([3]);

    raw.put.mockRejectedValueOnce(new Error('429')).mockRejectedValueOnce(new Error('429'));
    sync.update(2);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS * 3);
    expect(sync.counters.errors).toBe(3);
    expect(puts.map((p) => p.players)).toEqual([3]);
    expect(vi.getTimerCount()).toBe(0);
    errorLog.mockRestore();
  });

  it('a join while the delete is in flight keeps the room listed (base is not cleared)', async () => {
    vi.useFakeTimers();
    const { kv, puts, deletes, raw } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(1);
    await settle();
    let finishDelete: () => void = () => {};
    raw.delete.mockImplementationOnce(
      (k: string) =>
        new Promise<void>((resolve) => {
          finishDelete = () => {
            deletes.push(k);
            resolve();
          };
        }),
    );
    // after the delete the key is gone: reading it again would find nothing
    raw.getWithMetadata.mockResolvedValue({ value: '', metadata: null, cacheStatus: null });
    sync.update(0);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS); // delete starts and hangs
    sync.update(2); // someone joins while it is in flight
    finishDelete();
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(deletes).toEqual(['room:r1']);
    expect(puts.map((p) => p.players)).toEqual([1, 2]);
    expect(puts.at(-1)).toMatchObject({ createdAt: 123, max: 4 });
  });

  it('heartbeat renews only after the renew interval; first call after a restart writes at once', async () => {
    vi.useFakeTimers();
    const { kv, puts } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.heartbeat(2); // fresh instance (e.g. after a deploy) -> sync right away
    await settle();
    expect(puts).toHaveLength(1);
    sync.heartbeat(2);
    await settle(ROOM_KV_RENEW_INTERVAL_MS - 1000);
    sync.heartbeat(2);
    await settle();
    expect(puts).toHaveLength(1);
    await settle(1000);
    sync.heartbeat(2);
    await settle();
    expect(puts).toHaveLength(2);
  });

  it('after the room emptied, a new joiner re-reads the key instead of reusing old metadata', async () => {
    vi.useFakeTimers();
    const { kv, raw, puts } = fakeKv();
    const sync = new RoomKvSync(kv, 'r1');
    sync.update(1);
    await settle();
    sync.update(0);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    raw.getWithMetadata.mockResolvedValueOnce({ value: '', metadata: null, cacheStatus: null });
    sync.update(1);
    await settle(ROOM_KV_MIN_WRITE_INTERVAL_MS);
    expect(raw.getWithMetadata).toHaveBeenCalledTimes(2);
    expect(puts).toHaveLength(1); // not resurrected
  });
});
