import type { ErrorCode } from '@booberman/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { JoinWatcherTimers } from './joinWatcher';
import {
  RECONNECT_BACKOFF_MS,
  RECONNECT_BUDGET_MS,
  Reconnector,
  reconnectDelay,
} from './reconnector';
import type { CloseInfo, Transport, WelcomeMessage } from './Transport';

function track<T>(set: Set<T>, cb: T): () => void {
  set.add(cb);
  return () => set.delete(cb);
}

/** A transport whose signals the test fires by hand. */
function fakeTransport() {
  const welcome = new Set<(m: WelcomeMessage) => void>();
  const error = new Set<(c: ErrorCode, m?: string) => void>();
  const close = new Set<(i: CloseInfo) => void>();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const transport = {
    connect,
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
    connect,
    disconnect,
    sendWelcome: () => {
      for (const cb of [...welcome]) cb({ t: 'welcome' } as WelcomeMessage);
    },
    sendError: (code: ErrorCode) => {
      for (const cb of [...error]) cb(code);
    },
    sendClose: (code = 1006) => {
      for (const cb of [...close]) cb({ code, reason: '', clean: code === 1000 });
    },
  };
}

/** A clock the test moves by hand; timers fire in order as it passes them. */
function fakeClock() {
  let time = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: JoinWatcherTimers = {
    setTimeout: (fn, ms) => {
      pending.set(nextId, { at: time + ms, fn });
      return nextId++;
    },
    clearTimeout: (id) => void pending.delete(id as number),
  };
  return {
    timers,
    pending,
    now: () => time,
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const due = [...pending]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        const next = due[0];
        if (!next) break;
        pending.delete(next[0]);
        time = next[1].at;
        next[1].fn();
      }
      time = target;
    },
  };
}

function setup() {
  const t = fakeTransport();
  const clock = fakeClock();
  const handlers = { onReconnecting: vi.fn(), onRestored: vi.fn(), onGaveUp: vi.fn() };
  const reconnector = new Reconnector(t.transport, handlers, clock.timers, clock.now);
  return { ...t, clock, handlers, reconnector };
}

/** Joined and armed, then the socket drops. */
function dropped() {
  const s = setup();
  s.sendWelcome();
  s.reconnector.arm();
  s.sendClose(1006);
  return s;
}

describe('reconnectDelay', () => {
  it('goes 0.5 → 1 → 2 → 4 s and stays at 4 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 4000, 4000]);
    expect(RECONNECT_BACKOFF_MS).toEqual([500, 1000, 2000, 4000]);
  });
});

describe('Reconnector', () => {
  it('does nothing before it is armed (the join is the JoinWatcher’s)', () => {
    const s = setup();
    s.sendClose(1006);
    expect(s.handlers.onReconnecting).not.toHaveBeenCalled();
    expect(s.connect).not.toHaveBeenCalled();
  });

  it('a drop shows "reconnecting" once with a 15 s deadline, then retries after 0.5 s', () => {
    const s = dropped();
    expect(s.handlers.onReconnecting).toHaveBeenCalledTimes(1);
    expect(s.handlers.onReconnecting).toHaveBeenCalledWith(s.clock.now() + RECONNECT_BUDGET_MS);
    expect(s.connect).not.toHaveBeenCalled();
    s.clock.advance(499);
    expect(s.connect).not.toHaveBeenCalled();
    s.clock.advance(1);
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it('retries at 0.5, 1.5, 3.5, 7.5, 11.5 s after the drop and once more at 14 s, then gives up', () => {
    const s = dropped();
    const start = s.clock.now();
    const attemptsAt: number[] = [];
    s.connect.mockImplementation(() => {
      attemptsAt.push(s.clock.now() - start);
      s.sendClose(1006); // the attempt fails at once
    });
    s.clock.advance(RECONNECT_BUDGET_MS + 1000);
    expect(attemptsAt).toEqual([500, 1500, 3500, 7500, 11500, 14000]);
    expect(s.handlers.onGaveUp).toHaveBeenCalledTimes(1);
    expect(s.handlers.onGaveUp).toHaveBeenCalledWith('CONNECTION_LOST');
    expect(s.handlers.onReconnecting).toHaveBeenCalledTimes(1);
    expect(s.disconnect).toHaveBeenCalledTimes(1);
    expect(s.handlers.onRestored).not.toHaveBeenCalled();
  });

  it('the last attempt, 1 s before the time is up, can still win the slot back', () => {
    const s = dropped();
    let attempts = 0;
    s.connect.mockImplementation(() => {
      attempts += 1;
      if (attempts === 6) s.sendWelcome();
      else s.sendClose(1006);
    });
    s.clock.advance(RECONNECT_BUDGET_MS + 1000);
    expect(attempts).toBe(6);
    expect(s.handlers.onRestored).toHaveBeenCalledTimes(1);
    expect(s.handlers.onGaveUp).not.toHaveBeenCalled();
  });

  it('gives up at once when the failed attempt leaves no room for another', () => {
    const s = dropped();
    s.clock.advance(14_500);
    s.connect.mockClear();
    s.sendClose(1006); // an attempt that was in flight fails at 14.5 s: 0.5 s left is too little
    expect(s.handlers.onGaveUp).toHaveBeenCalledTimes(1);
    expect(s.connect).not.toHaveBeenCalled();
  });

  it('an attempt still pending when the 15 s are up is given up on at 15 s, not later', () => {
    const s = dropped();
    const start = s.clock.now();
    s.clock.advance(500); // attempt 1 goes out and never answers
    expect(s.connect).toHaveBeenCalledTimes(1);
    s.clock.advance(RECONNECT_BUDGET_MS - 500 - 1);
    expect(s.handlers.onGaveUp).not.toHaveBeenCalled();
    s.clock.advance(1);
    expect(s.clock.now() - start).toBe(RECONNECT_BUDGET_MS);
    expect(s.handlers.onGaveUp).toHaveBeenCalledWith('CONNECTION_LOST');
    expect(s.disconnect).toHaveBeenCalledTimes(1);
  });

  it('a welcome on a retry restores the game and stops the clock', () => {
    const s = dropped();
    s.clock.advance(500);
    s.sendWelcome();
    expect(s.handlers.onRestored).toHaveBeenCalledTimes(1);
    expect(s.clock.pending.size).toBe(0);
    s.clock.advance(RECONNECT_BUDGET_MS * 2);
    expect(s.handlers.onGaveUp).not.toHaveBeenCalled();
    expect(s.disconnect).not.toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it('after a restore the next drop is retried again, with a new 15 s', () => {
    const s = dropped();
    s.clock.advance(500);
    s.sendWelcome();
    s.clock.advance(60_000);
    const before = s.clock.now();
    s.sendClose(1006);
    expect(s.handlers.onReconnecting).toHaveBeenCalledTimes(2);
    expect(s.handlers.onReconnecting).toHaveBeenLastCalledWith(before + RECONNECT_BUDGET_MS);
    s.clock.advance(500);
    expect(s.connect).toHaveBeenCalledTimes(2);
    s.sendWelcome();
    expect(s.handlers.onRestored).toHaveBeenCalledTimes(2);
  });

  it('INVALID_TOKEN (the hold ran out) gives up at once, without waiting for the clock', () => {
    const s = dropped();
    s.clock.advance(500);
    s.sendError('INVALID_TOKEN');
    expect(s.handlers.onGaveUp).toHaveBeenCalledWith('CONNECTION_LOST');
    expect(s.disconnect).toHaveBeenCalledTimes(1);
    expect(s.clock.pending.size).toBe(0);
    s.sendClose(4003); // the close that follows is not a second give-up
    expect(s.handlers.onGaveUp).toHaveBeenCalledTimes(1);
  });

  it('VERSION_MISMATCH (a new deploy) gives up as such, so the player is told to reload', () => {
    const s = dropped();
    s.clock.advance(500);
    s.sendError('VERSION_MISMATCH');
    expect(s.handlers.onGaveUp).toHaveBeenCalledWith('VERSION_MISMATCH');
  });

  it('close 4004 (someone took the slot) gives up at once, while connected or retrying', () => {
    const connected = setup();
    connected.sendWelcome();
    connected.reconnector.arm();
    connected.sendClose(4004);
    expect(connected.handlers.onReconnecting).not.toHaveBeenCalled();
    expect(connected.handlers.onGaveUp).toHaveBeenCalledWith('CONNECTION_LOST');

    const retrying = dropped();
    retrying.clock.advance(500);
    retrying.sendClose(4004);
    expect(retrying.handlers.onGaveUp).toHaveBeenCalledWith('CONNECTION_LOST');
  });

  it('errors outside an outage are not its business', () => {
    const s = setup();
    s.sendWelcome();
    s.reconnector.arm();
    s.sendError('BAD_MESSAGE');
    expect(s.handlers.onGaveUp).not.toHaveBeenCalled();
  });

  it('dispose stops the retries and ignores later signals', () => {
    const s = dropped();
    s.reconnector.dispose();
    expect(s.clock.pending.size).toBe(0);
    s.clock.advance(RECONNECT_BUDGET_MS);
    s.sendWelcome();
    s.sendClose(1006);
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.handlers.onRestored).not.toHaveBeenCalled();
    expect(s.handlers.onGaveUp).not.toHaveBeenCalled();
  });
});
