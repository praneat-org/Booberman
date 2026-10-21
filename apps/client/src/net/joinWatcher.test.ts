import type { ErrorCode } from '@booberman/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  failureForError,
  JOIN_TIMEOUT_MS,
  JoinWatcher,
  type JoinWatcherTimers,
} from './joinWatcher';
import type { CloseInfo, Transport, WelcomeMessage } from './Transport';
import { WsTransport } from './WsTransport';

function track<T>(set: Set<T>, cb: T): () => void {
  set.add(cb);
  return () => set.delete(cb);
}

/** A transport whose signals the test fires by hand. */
function fakeTransport() {
  const welcome = new Set<(m: WelcomeMessage) => void>();
  const error = new Set<(c: ErrorCode, m?: string) => void>();
  const close = new Set<(i: CloseInfo) => void>();
  const disconnect = vi.fn();
  const transport = {
    connect: vi.fn(),
    disconnect,
    send: vi.fn(),
    ping: vi.fn(),
    rematch: vi.fn(),
    onWelcome: (cb) => track(welcome, cb),
    onSnapshot: () => () => {},
    onEvent: () => () => {},
    onPong: () => () => {},
    onError: (cb) => track(error, cb),
    onClose: (cb) => track(close, cb),
  } satisfies Transport;
  return {
    transport,
    disconnect,
    listeners: { welcome, error, close },
    sendWelcome: () => {
      for (const cb of [...welcome]) cb({ t: 'welcome' } as WelcomeMessage);
    },
    sendError: (code: ErrorCode) => {
      for (const cb of [...error]) cb(code);
    },
    sendClose: (code: number) => {
      for (const cb of [...close]) cb({ code, reason: '', clean: code === 1000 });
    },
  };
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers: JoinWatcherTimers = {
    setTimeout: (fn, ms) => {
      pending.set(nextId, { fn, ms });
      return nextId++;
    },
    clearTimeout: (id) => void pending.delete(id as number),
  };
  return {
    timers,
    pending,
    fire: () => {
      for (const [id, t] of [...pending]) {
        pending.delete(id);
        t.fn();
      }
    },
  };
}

function setup() {
  const t = fakeTransport();
  const clock = fakeTimers();
  const handlers = { onJoined: vi.fn(), onFailed: vi.fn(), onLost: vi.fn() };
  const watcher = new JoinWatcher(t.transport, handlers, clock.timers);
  return { ...t, clock, handlers, watcher };
}

describe('JoinWatcher', () => {
  it('welcome means joined, and the timeout is cancelled', () => {
    const s = setup();
    expect([...s.clock.pending.values()].map((p) => p.ms)).toEqual([JOIN_TIMEOUT_MS]);
    s.sendWelcome();
    expect(s.handlers.onJoined).toHaveBeenCalledTimes(1);
    expect(s.handlers.onFailed).not.toHaveBeenCalled();
    expect(s.clock.pending.size).toBe(0);
  });

  it('ROOM_FULL error then its 4001 close is one failure', () => {
    const s = setup();
    s.sendError('ROOM_FULL');
    s.sendClose(4001);
    expect(s.handlers.onFailed).toHaveBeenCalledTimes(1);
    expect(s.handlers.onFailed).toHaveBeenCalledWith('ROOM_FULL');
    expect(s.handlers.onLost).not.toHaveBeenCalled();
    expect(s.clock.pending.size).toBe(0);
  });

  it('maps a bare 4001 / 4002 close even when no error message arrived', () => {
    const full = setup();
    full.sendClose(4001);
    expect(full.handlers.onFailed).toHaveBeenCalledWith('ROOM_FULL');
    const nick = setup();
    nick.sendClose(4002);
    expect(nick.handlers.onFailed).toHaveBeenCalledWith('INVALID_NICKNAME');
  });

  it('a close before welcome that is not ours (1006, 1000, 1011) is a failed connection', () => {
    for (const code of [1006, 1000, 1011, 1005]) {
      const s = setup();
      s.sendClose(code);
      expect(s.handlers.onFailed, String(code)).toHaveBeenCalledWith('CONNECT_FAILED');
    }
  });

  it('every ErrorCode before welcome maps to a failure the player can act on', () => {
    expect(failureForError('ROOM_FULL')).toBe('ROOM_FULL');
    expect(failureForError('INVALID_NICKNAME')).toBe('INVALID_NICKNAME');
    expect(failureForError('VERSION_MISMATCH')).toBe('VERSION_MISMATCH');
    expect(failureForError('BAD_MESSAGE')).toBe('CONNECT_FAILED');
  });

  it('no welcome in time → CONNECT_FAILED and the socket is dropped', () => {
    const s = setup();
    s.clock.fire();
    expect(s.handlers.onFailed).toHaveBeenCalledWith('CONNECT_FAILED');
    expect(s.disconnect).toHaveBeenCalledTimes(1);
  });

  it('the timeout does nothing once joined', () => {
    const s = setup();
    s.sendWelcome();
    s.clock.fire();
    expect(s.handlers.onFailed).not.toHaveBeenCalled();
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('a close after welcome is "lost", once, not a failed join', () => {
    const s = setup();
    s.sendWelcome();
    s.sendClose(1006);
    s.sendClose(1006);
    expect(s.handlers.onLost).toHaveBeenCalledTimes(1);
    expect(s.handlers.onFailed).not.toHaveBeenCalled();
  });

  it('an error after welcome is not a join failure', () => {
    const s = setup();
    s.sendWelcome();
    s.sendError('BAD_MESSAGE');
    expect(s.handlers.onFailed).not.toHaveBeenCalled();
  });

  it('ignores a late welcome after a failure', () => {
    const s = setup();
    s.sendError('ROOM_FULL');
    s.sendWelcome();
    expect(s.handlers.onJoined).not.toHaveBeenCalled();
  });

  it('dispose unsubscribes and cancels the timer', () => {
    const s = setup();
    s.watcher.dispose();
    expect(s.clock.pending.size).toBe(0);
    expect(s.listeners.welcome.size + s.listeners.error.size + s.listeners.close.size).toBe(0);
    s.sendWelcome();
    s.sendClose(1006);
    expect(s.handlers.onJoined).not.toHaveBeenCalled();
    expect(s.handlers.onFailed).not.toHaveBeenCalled();
  });
});

describe('JoinWatcher with the real WsTransport', () => {
  /** The wire shape the RoomDO produces when the room has 4 players: `error` message, then close 4001. */
  function socketPair() {
    const sock = {
      readyState: 1,
      onopen: null as null | ((e: unknown) => void),
      onmessage: null as null | ((e: { data: unknown }) => void),
      onclose: null as null | ((e: { code: number; reason: string; wasClean: boolean }) => void),
      onerror: null as null | ((e: unknown) => void),
      send: vi.fn(),
      close: vi.fn(),
    };
    return sock;
  }

  it('reports ROOM_FULL exactly once for error + close 4001', () => {
    const sock = socketPair();
    const ws = new WsTransport({
      roomId: 'abc123',
      nickname: 'Bo',
      location: { protocol: 'http:', host: 'x' },
      createSocket: () => sock,
    });
    const handlers = { onJoined: vi.fn(), onFailed: vi.fn(), onLost: vi.fn() };
    new JoinWatcher(ws, handlers, fakeTimers().timers);
    ws.connect();
    sock.onopen?.({});
    sock.onmessage?.({ data: JSON.stringify({ v: 1, t: 'error', code: 'ROOM_FULL' }) });
    sock.onclose?.({ code: 4001, reason: 'ROOM_FULL', wasClean: true });
    expect(handlers.onFailed.mock.calls).toEqual([['ROOM_FULL']]);
  });

  it('a socket that never opens (handshake refused) is CONNECT_FAILED', () => {
    const sock = socketPair();
    sock.readyState = 3;
    const ws = new WsTransport({
      roomId: 'abc123',
      nickname: 'Bo',
      location: { protocol: 'http:', host: 'x' },
      createSocket: () => sock,
    });
    const handlers = { onJoined: vi.fn(), onFailed: vi.fn(), onLost: vi.fn() };
    new JoinWatcher(ws, handlers, fakeTimers().timers);
    ws.connect();
    sock.onclose?.({ code: 1006, reason: '', wasClean: false });
    expect(handlers.onFailed.mock.calls).toEqual([['CONNECT_FAILED']]);
  });
});
