import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_ERROR_MESSAGE,
  LobbyController,
  type LobbyTimers,
  rateLimitedMessage,
} from './LobbyController';
import { NICKNAME_STORAGE_KEY } from './nicknameStore';

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const room = (id: string, players = 1) => ({ roomId: id, players, max: 4, createdAt: 1 });

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial ? [[NICKNAME_STORAGE_KEY, initial]] : []);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** Manual interval clock. */
function fakeTimers() {
  let nextId = 1;
  const active = new Map<number, { fn: () => void; ms: number }>();
  const timers: LobbyTimers = {
    setInterval: (fn, ms) => {
      active.set(nextId, { fn, ms });
      return nextId++;
    },
    clearInterval: (id) => void active.delete(id as number),
  };
  return {
    timers,
    active,
    tick: (ms: number) => {
      for (const t of [...active.values()]) if (t.ms === ms) t.fn();
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.restoreAllMocks());

function make(fetchFn: typeof fetch, storage = memoryStorage()) {
  const clock = fakeTimers();
  const navigate = vi.fn();
  const c = new LobbyController({ fetchFn, storage, navigate, timers: clock.timers });
  return { c, clock, navigate, storage };
}

describe('LobbyController nickname', () => {
  it('starts with the remembered nickname', () => {
    const { c } = make(vi.fn() as never, memoryStorage('มิ้นท์'));
    expect(c.state.nickname).toBe('มิ้นท์');
    expect(c.state.nicknameError).toBeNull();
  });

  it('shows a different Thai message per kind of mistake and stores only valid names', () => {
    const { c, storage } = make(vi.fn() as never);
    const seen = new Set<string>();
    for (const bad of ['', 'abcdefghijklm', 'a b', 'a-b']) {
      c.setNickname(bad);
      expect(c.state.nicknameError).not.toBeNull();
      seen.add(c.state.nicknameError as string);
    }
    expect(seen.size).toBe(4);
    expect(storage.data.size).toBe(0);
    c.setNickname(' Mint ');
    expect(c.state.nicknameError).toBeNull();
    expect(storage.data.get(NICKNAME_STORAGE_KEY)).toBe('Mint');
  });
});

describe('LobbyController create room', () => {
  it('blocks an invalid nickname without calling the API', async () => {
    const f = vi.fn();
    const { c, navigate } = make(f as never);
    c.setNickname('a b');
    await c.createRoom();
    expect(f).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(c.state.nicknameError).toContain('ช่องว่าง');
  });

  it('flags an untouched empty nickname on submit', async () => {
    const f = vi.fn();
    const { c } = make(f as never);
    await c.createRoom();
    expect(f).not.toHaveBeenCalled();
    expect(c.state.nicknameError).toBe('ใส่ชื่อก่อนนะ');
  });

  it('creates then navigates to /room/<id> and ignores double clicks', async () => {
    const gate = deferred<Response>();
    const f = vi.fn(() => gate.promise);
    const { c, navigate } = make(f as never);
    c.setNickname('Mint');
    const first = c.createRoom();
    void c.createRoom();
    expect(c.state.creating).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    gate.resolve(json({ roomId: 'abc123' }, { status: 201 }));
    await first;
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/room/abc123');
    expect(c.state.navigating).toBe(true);
    // everything is locked once we leave
    c.joinRoom('zzz999');
    await c.createRoom();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('429 shows a wait message, locks the button and counts down to free', async () => {
    const f = vi.fn(async () =>
      json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '2' } }),
    );
    const { c, clock, navigate } = make(f as never);
    c.setNickname('Mint');
    await c.createRoom();
    expect(c.state.creating).toBe(false);
    expect(c.state.cooldownSeconds).toBe(2);
    expect(c.state.createError).toBe(rateLimitedMessage(2));
    await c.createRoom(); // still cooling down
    expect(f).toHaveBeenCalledTimes(1);
    clock.tick(1000);
    expect(c.state.createError).toBe(rateLimitedMessage(1));
    clock.tick(1000);
    expect(c.state.cooldownSeconds).toBe(0);
    expect(c.state.createError).toBeNull();
    expect(clock.active.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a failed create shows an error and can be retried', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ roomId: 'abc123' }, { status: 201 }));
    const { c, navigate } = make(f as never);
    c.setNickname('Mint');
    await c.createRoom();
    expect(c.state.createError).toBe(CREATE_ERROR_MESSAGE);
    expect(c.state.creating).toBe(false);
    await c.createRoom();
    expect(navigate).toHaveBeenCalledWith('/room/abc123');
  });

  it('does not navigate if the screen was destroyed while the POST was in flight', async () => {
    const gate = deferred<Response>();
    const { c, navigate } = make((() => gate.promise) as never);
    c.setNickname('Mint');
    const p = c.createRoom();
    c.destroy();
    gate.resolve(json({ roomId: 'abc123' }, { status: 201 }));
    await p;
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('LobbyController join from list', () => {
  it('needs a valid nickname, then saves it and navigates', () => {
    const { c, navigate, storage } = make(vi.fn() as never);
    c.joinRoom('abc123');
    expect(navigate).not.toHaveBeenCalled();
    expect(c.state.nicknameError).toBe('ใส่ชื่อก่อนนะ');
    c.setNickname('Mint');
    c.joinRoom('abc123');
    expect(navigate).toHaveBeenCalledWith('/room/abc123');
    expect(storage.data.get(NICKNAME_STORAGE_KEY)).toBe('Mint');
  });
});

describe('LobbyController room list', () => {
  it('loads on start and refreshes on the interval', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ rooms: [room('aaaa11')] }))
      .mockResolvedValueOnce(json({ rooms: [room('aaaa11'), room('bbbb22', 3)] }));
    const { c, clock } = make(f as never);
    expect(c.state.rooms).toBeNull();
    c.start();
    await flush();
    expect(c.state.rooms).toHaveLength(1);
    clock.tick(5000);
    await flush();
    expect(c.state.rooms).toHaveLength(2);
  });

  it('an error keeps the previous list and flags the error; success clears it', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ rooms: [room('aaaa11')] }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(json({ rooms: [] }));
    const { c } = make(f as never);
    await c.refreshRooms();
    await c.refreshRooms();
    expect(c.state.roomsError).toBe(true);
    expect(c.state.rooms).toHaveLength(1);
    await c.refreshRooms();
    expect(c.state.roomsError).toBe(false);
    expect(c.state.rooms).toEqual([]);
  });

  it('skips a refresh while one is in flight', async () => {
    const gate = deferred<Response>();
    const f = vi.fn(() => gate.promise);
    const { c } = make(f as never);
    const a = c.refreshRooms();
    await c.refreshRooms();
    expect(f).toHaveBeenCalledTimes(1);
    gate.resolve(json({ rooms: [] }));
    await a;
  });

  it('drops a response that arrives after destroy and stops timers + aborts the fetch', async () => {
    const gate = deferred<Response>();
    let signal: AbortSignal | undefined;
    const f = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return gate.promise;
    });
    const { c, clock } = make(f as never);
    const listener = vi.fn();
    c.subscribe(listener);
    c.start();
    expect(clock.active.size).toBe(1);
    c.destroy();
    expect(signal?.aborted).toBe(true);
    expect(clock.active.size).toBe(0);
    gate.resolve(json({ rooms: [room('aaaa11')] }));
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(c.state.rooms).toBeNull();
  });

  it('destroy also clears a running 429 countdown', async () => {
    const f = vi.fn(async () => json({}, { status: 429 }));
    const { c, clock } = make(f as never);
    c.setNickname('Mint');
    await c.createRoom();
    expect(clock.active.size).toBe(1);
    c.destroy();
    expect(clock.active.size).toBe(0);
  });
});
