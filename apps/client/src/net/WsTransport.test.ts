import { ClientMessage, exampleServerMessages, PROTOCOL_VERSION } from '@booberman/protocol';
import { describe, expect, it, vi } from 'vitest';
import { RECONNECT_STORAGE_KEY, sessionTokenStore, type TokenStorage } from './reconnectToken';
import { roomSocketUrl, type SocketLike, WsTransport } from './WsTransport';

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | undefined;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  serverClose(code: number, reason = '', wasClean = true) {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean });
  }
}

function setup(protocol = 'http:') {
  const sockets: FakeSocket[] = [];
  const t = new WsTransport({
    roomId: 'abc123',
    nickname: 'Mint',
    location: { protocol, host: 'example.test:5173' },
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
  });
  return { t, sockets, sock: () => sockets[0] as FakeSocket };
}

describe('roomSocketUrl', () => {
  it('uses ws on http, wss on https, same host', () => {
    expect(roomSocketUrl('abc123', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws/room/abc123',
    );
    expect(roomSocketUrl('abc123', { protocol: 'https:', host: 'x.workers.dev' })).toBe(
      'wss://x.workers.dev/ws/room/abc123',
    );
  });
});

describe('WsTransport', () => {
  it('connects to /ws/room/:id and sends join as soon as it opens', () => {
    const { t, sock } = setup('https:');
    t.connect();
    expect(sock().url).toBe('wss://example.test:5173/ws/room/abc123');
    expect(sock().sent).toEqual([]);
    sock().open();
    expect(sock().sent).toEqual([
      { v: PROTOCOL_VERSION, t: 'join', room: 'abc123', nickname: 'Mint' },
    ]);
  });

  it('connect twice opens one socket', () => {
    const { t, sockets } = setup();
    t.connect();
    t.connect();
    expect(sockets).toHaveLength(1);
  });

  it('routes every server message kind to its callback', () => {
    const { t, sock } = setup();
    const got: Record<string, unknown[]> = { w: [], s: [], e: [], p: [], err: [] };
    t.onWelcome((m) => got.w?.push(m));
    t.onSnapshot((m) => got.s?.push(m));
    t.onEvent((m) => got.e?.push(m));
    t.onPong((m) => got.p?.push(m));
    t.onError((c, m) => got.err?.push([c, m]));
    t.connect();
    sock().open();
    const m = exampleServerMessages;
    for (const msg of [m.welcome, m.snapshot, m.pong, m.error]) sock().receive(msg);
    for (const msg of Object.values(m)) if (msg.t === 'event') sock().receive(msg);
    expect(got.w).toHaveLength(1);
    expect(got.s).toHaveLength(1);
    expect(got.p).toHaveLength(1);
    expect(got.err).toEqual([['ROOM_FULL', undefined]]);
    expect(got.e?.length).toBeGreaterThan(0);
  });

  it('logs and skips invalid, wrong-version and binary frames without throwing', () => {
    const { t, sock } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();
    t.onSnapshot(cb);
    t.onEvent(cb);
    t.connect();
    sock().open();
    sock().receive('not json');
    sock().receive({ v: PROTOCOL_VERSION, t: 'nope' });
    sock().receive({ ...exampleServerMessages.snapshot, v: 99 });
    sock().onmessage?.({ data: new ArrayBuffer(4) });
    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
    sock().receive(exampleServerMessages.snapshot);
    expect(cb).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('send / ping use protocol shapes, and are dropped until the socket is open', () => {
    const { t, sock } = setup();
    t.connect();
    t.send({ seq: 1, dir: 'left', bomb: false });
    t.ping(5);
    expect(sock().sent).toEqual([]);
    sock().open();
    t.send({ seq: 2, dir: 'up', bomb: true });
    t.ping(123);
    expect(sock().sent.slice(1)).toEqual([
      { v: PROTOCOL_VERSION, t: 'input', seq: 2, dir: 'up', bomb: true },
      { v: PROTOCOL_VERSION, t: 'ping', ts: 123 },
    ]);
  });

  it('rematch sends exactly `{ v, t: rematch }` (D9), a valid ClientMessage, and is dropped until the socket is open', () => {
    const { t, sock } = setup();
    t.connect();
    t.rematch();
    expect(sock().sent).toEqual([]);
    sock().open();
    t.rematch();
    expect(sock().sent.slice(1)).toEqual([{ v: PROTOCOL_VERSION, t: 'rematch' }]);
    expect(ClientMessage.safeParse(sock().sent[1]).success).toBe(true);
  });

  it('ROOM_FULL: error message then close 4001 is one onError, plus onClose', () => {
    const { t, sock } = setup();
    const errs: unknown[] = [];
    const closes: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.onClose((i) => closes.push(i));
    t.connect();
    sock().open();
    sock().receive({ v: PROTOCOL_VERSION, t: 'error', code: 'ROOM_FULL' });
    sock().serverClose(4001, 'ROOM_FULL');
    expect(errs).toEqual(['ROOM_FULL']);
    expect(closes).toEqual([{ code: 4001, reason: 'ROOM_FULL', clean: true }]);
  });

  it('close 4002 without a prior error message still reports INVALID_NICKNAME', () => {
    const { t, sock } = setup();
    const errs: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.connect();
    sock().open();
    sock().serverClose(4002);
    expect(errs).toEqual(['INVALID_NICKNAME']);
  });

  it('an ordinary drop (1006) is only onClose, not an ErrorCode', () => {
    const { t, sock } = setup();
    const err = vi.fn();
    const close = vi.fn();
    t.onError(err);
    t.onClose(close);
    t.connect();
    sock().serverClose(1006, '', false);
    expect(err).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({ code: 1006, reason: '', clean: false });
  });

  it('disconnect closes the socket, silences callbacks and allows a fresh connect', () => {
    const { t, sockets } = setup();
    const snap = vi.fn();
    const close = vi.fn();
    t.onSnapshot(snap);
    t.onClose(close);
    t.connect();
    const first = sockets[0] as FakeSocket;
    first.open();
    t.disconnect();
    expect(first.closed?.code).toBe(1000);
    expect(first.onmessage).toBeNull();
    first.onclose?.({ code: 1000, reason: '', wasClean: true });
    expect(close).not.toHaveBeenCalled();
    t.send({ seq: 1, dir: 'up', bomb: false });
    expect(first.sent).toHaveLength(1); // only the join
    t.connect();
    expect(sockets).toHaveLength(2);
    t.disconnect();
    t.disconnect(); // harmless
  });

  it('unsubscribe stops callbacks', () => {
    const { t, sock } = setup();
    const cb = vi.fn();
    const off = t.onSnapshot(cb);
    t.connect();
    sock().receive(exampleServerMessages.snapshot);
    off();
    sock().receive(exampleServerMessages.snapshot);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

/** FE-22: the reconnect token — kept from `welcome`, sent with every `join`, forgotten on `disconnect`. */
describe('WsTransport reconnect token', () => {
  function memory(initial: Record<string, string> = {}): TokenStorage {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }
  const saved = (room: string, token: string) => JSON.stringify({ room, token });
  const welcome = (token: string) => ({ ...exampleServerMessages.welcome, token });

  function withTokens(storage: TokenStorage = memory()) {
    const sockets: FakeSocket[] = [];
    const tokens = sessionTokenStore(storage);
    const t = new WsTransport({
      roomId: 'abc123',
      nickname: 'Mint',
      location: { protocol: 'http:', host: 'example.test' },
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      tokens,
    });
    const last = () => sockets[sockets.length - 1] as FakeSocket;
    return { t, tokens, sockets, last };
  }

  it('a first join carries no token; the welcome saves its token', () => {
    const { t, last, tokens } = withTokens();
    t.connect();
    last().open();
    expect(last().sent).toEqual([
      { v: PROTOCOL_VERSION, t: 'join', room: 'abc123', nickname: 'Mint' },
    ]);
    last().receive(welcome('tok-1'));
    expect(tokens.load('abc123')).toBe('tok-1');
  });

  it('after a drop, connect() joins again with the token of the last welcome', () => {
    const { t, last, sockets } = withTokens();
    t.connect();
    last().open();
    last().receive(welcome('tok-1'));
    last().serverClose(1006, '', false);
    t.connect();
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent).toEqual([
      { v: PROTOCOL_VERSION, t: 'join', room: 'abc123', nickname: 'Mint', token: 'tok-1' },
    ]);
  });

  it('every welcome rotates the token: the next join uses the newest', () => {
    const { t, last } = withTokens();
    t.connect();
    last().open();
    last().receive(welcome('tok-1'));
    last().serverClose(1006, '', false);
    t.connect();
    last().open();
    last().receive(welcome('tok-2'));
    last().serverClose(1006, '', false);
    t.connect();
    last().open();
    expect(last().sent[0]).toMatchObject({ t: 'join', token: 'tok-2' });
  });

  it('a join that answers INVALID_TOKEN is reported (a reconnect that was too late)', () => {
    const { t, last } = withTokens();
    const errs: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.connect();
    last().open();
    last().receive(welcome('tok-1'));
    last().serverClose(1006, '', false);
    t.connect();
    last().open();
    last().receive({ v: PROTOCOL_VERSION, t: 'error', code: 'INVALID_TOKEN' });
    last().serverClose(4003, 'INVALID_TOKEN');
    expect(errs).toEqual(['INVALID_TOKEN']);
  });

  it('a close 4003 without the error message still reports INVALID_TOKEN', () => {
    const { t, last } = withTokens();
    const errs: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.connect();
    last().open();
    last().receive(welcome('tok-1'));
    last().serverClose(1006, '', false);
    t.connect();
    last().open();
    last().serverClose(4003);
    expect(errs).toEqual(['INVALID_TOKEN']);
  });

  it('disconnect forgets the token: a new connect joins as a newcomer, and nothing is left in storage', () => {
    const { t, last, tokens } = withTokens();
    t.connect();
    last().open();
    last().receive(welcome('tok-1'));
    t.disconnect();
    expect(tokens.load('abc123')).toBeUndefined();
    t.connect();
    last().open();
    expect(last().sent[0]).not.toHaveProperty('token');
  });

  it('a reload: a token saved by the earlier page for this room is sent on the first join', () => {
    const { t, last } = withTokens(memory({ [RECONNECT_STORAGE_KEY]: saved('abc123', 'old-tok') }));
    t.connect();
    last().open();
    expect(last().sent[0]).toMatchObject({ t: 'join', nickname: 'Mint', token: 'old-tok' });
  });

  it('a stored token of another room is ignored', () => {
    const { t, last } = withTokens(
      memory({ [RECONNECT_STORAGE_KEY]: saved('other99', 'old-tok') }),
    );
    t.connect();
    last().open();
    expect(last().sent[0]).not.toHaveProperty('token');
  });

  it('a stored token the server no longer knows is not a failure: the join is repeated without it', () => {
    const { t, last, sockets, tokens } = withTokens(
      memory({ [RECONNECT_STORAGE_KEY]: saved('abc123', 'old-tok') }),
    );
    const errs: unknown[] = [];
    const closes: unknown[] = [];
    const welcomes: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.onClose((i) => closes.push(i));
    t.onWelcome((m) => welcomes.push(m.token));
    t.connect();
    const first = last();
    first.open();
    first.receive({ v: PROTOCOL_VERSION, t: 'error', code: 'INVALID_TOKEN' });
    first.serverClose(4003, 'INVALID_TOKEN'); // arrives after we moved on: ignored
    expect(errs).toEqual([]);
    expect(closes).toEqual([]);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent).toEqual([
      { v: PROTOCOL_VERSION, t: 'join', room: 'abc123', nickname: 'Mint' },
    ]);
    last().receive(welcome('new-tok'));
    expect(welcomes).toEqual(['new-tok']);
    expect(tokens.load('abc123')).toBe('new-tok');
  });

  it('the same fallback when only the close 4003 arrives', () => {
    const { t, last, sockets } = withTokens(
      memory({ [RECONNECT_STORAGE_KEY]: saved('abc123', 'old-tok') }),
    );
    const errs: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.connect();
    last().open();
    last().serverClose(4003, 'INVALID_TOKEN');
    expect(errs).toEqual([]);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent[0]).not.toHaveProperty('token');
  });

  it('the fallback happens once: after it, INVALID_TOKEN is an error again', () => {
    const { t, last } = withTokens(memory({ [RECONNECT_STORAGE_KEY]: saved('abc123', 'old-tok') }));
    const errs: unknown[] = [];
    t.onError((c) => errs.push(c));
    t.connect();
    last().open();
    last().receive({ v: PROTOCOL_VERSION, t: 'error', code: 'INVALID_TOKEN' });
    last().open();
    last().receive({ v: PROTOCOL_VERSION, t: 'error', code: 'INVALID_TOKEN' });
    expect(errs).toEqual(['INVALID_TOKEN']);
  });
});
