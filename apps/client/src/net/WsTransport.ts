import {
  type ErrorCode,
  type GameEvent,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from '@booberman/protocol';
import { errorCodeForClose } from './closeCodes';
import { sessionTokenStore, type TokenStore } from './reconnectToken';
import type {
  CloseInfo,
  PongMessage,
  SnapshotMessage,
  Transport,
  TransportInput,
  Unsubscribe,
  WelcomeMessage,
} from './Transport';

/** The slice of the browser `WebSocket` we use (so tests can pass a fake). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export interface WsTransportOptions {
  /** Room id (a-z0-9, 4-12). */
  roomId: string;
  nickname: string;
  /** Page location; picks `ws` / `wss` and the host (same origin). Defaults to `window.location`. */
  location?: Pick<Location, 'protocol' | 'host'>;
  createSocket?: (url: string) => SocketLike;
  /** Where the reconnect token survives a page reload. Defaults to `sessionStorage`. */
  tokens?: TokenStore;
  /** Calls `cb` when the page is being left (reload, navigation, tab closing). Defaults to `pagehide`. */
  onPageHide?: (cb: () => void) => Unsubscribe;
}

function browserPageHide(cb: () => void): Unsubscribe {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('pagehide', cb);
  return () => window.removeEventListener('pagehide', cb);
}

/** `/ws/room/:id` on the same origin; `wss` when the page is https. */
export function roomSocketUrl(
  roomId: string,
  location: Pick<Location, 'protocol' | 'host'>,
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws/room/${encodeURIComponent(roomId)}`;
}

type Listeners = {
  welcome: Set<(m: WelcomeMessage) => void>;
  snapshot: Set<(m: SnapshotMessage) => void>;
  event: Set<(m: GameEvent) => void>;
  pong: Set<(m: PongMessage) => void>;
  error: Set<(c: ErrorCode, m?: string) => void>;
  close: Set<(i: CloseInfo) => void>;
};

/**
 * The real server (`/ws/room/:id`). Sends `join` as soon as the socket opens; every incoming
 * frame goes through `parseServerMessage` (bad frames are logged and skipped). `error` messages
 * and the 4001 / 4002 close codes surface through `onError`; any close surfaces through `onClose`.
 * A deliberate `disconnect()` fires nothing. Input is dropped while the socket is not open: nothing is
 * queued, the scene sends the held direction again once we are back.
 *
 * Reconnecting (BE-44 / FE-22): the token of the latest `welcome` is kept in memory, and every `join`
 * sends it, so `connect()` after a drop asks for the old slot back (the Reconnector decides when to call
 * it). It goes into `sessionStorage` only when the page is being left (`pagehide`), and is taken out again
 * as soon as the next page reads it: a reload picks the slot up, but a duplicated tab, which gets a copy
 * of `sessionStorage` while the first tab is still playing, finds nothing and joins as a newcomer. A token
 * left over from an earlier page load that the server no longer knows is not an error: the join is
 * repeated without it. `disconnect()` forgets the token.
 */
export class WsTransport implements Transport {
  private readonly listeners: Listeners = {
    welcome: new Set(),
    snapshot: new Set(),
    event: new Set(),
    pong: new Set(),
    error: new Set(),
    close: new Set(),
  };
  private socket: SocketLike | undefined;
  /** An error already reported for this socket, so `error` + close 4001 is one callback. */
  private reported: ErrorCode | undefined;
  private readonly tokens: TokenStore;
  private token: string | undefined;
  /** The token was read from storage (an earlier page load), not issued to this transport: it may be stale. */
  private tokenFromStorage: boolean;
  private offPageHide: Unsubscribe | undefined;

  constructor(private readonly opts: WsTransportOptions) {
    this.tokens = opts.tokens ?? sessionTokenStore();
    this.token = this.tokens.load(opts.roomId);
    this.tokenFromStorage = this.token !== undefined;
    // claimed: this page owns the slot now, so a copy of this tab's storage must not carry it
    this.tokens.clear();
    this.watchPageHide();
  }

  connect(): void {
    if (this.socket) return;
    this.watchPageHide();
    const { roomId, nickname } = this.opts;
    const url = roomSocketUrl(roomId, this.opts.location ?? window.location);
    const socket = (
      this.opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike)
    )(url);
    this.socket = socket;
    this.reported = undefined;
    socket.onopen = () => {
      this.write({
        v: PROTOCOL_VERSION,
        t: 'join',
        room: roomId,
        nickname,
        ...(this.token === undefined ? {} : { token: this.token }),
      });
    };
    socket.onmessage = (ev) => this.receive(ev.data);
    socket.onerror = () => {
      // The browser gives no detail here and always follows with `close`.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.detach();
      const mapped = errorCodeForClose(ev.code);
      if (mapped === 'INVALID_TOKEN' && this.tokenFromStorage) {
        this.joinWithoutToken();
        return;
      }
      if (mapped && this.reported !== mapped) this.emitError(mapped, ev.reason || undefined);
      for (const cb of this.listeners.close) {
        cb({ code: ev.code, reason: ev.reason, clean: ev.wasClean });
      }
    };
  }

  disconnect(): void {
    // leaving for good (or giving up): the slot is not ours any more
    this.forgetToken();
    this.offPageHide?.();
    this.offPageHide = undefined;
    const socket = this.socket;
    if (!socket) return;
    this.detach();
    try {
      socket.close(1000, 'client leaving');
    } catch {
      // already closed
    }
  }

  send(input: TransportInput): void {
    this.write({ v: PROTOCOL_VERSION, t: 'input', ...input });
  }

  ping(ts: number): void {
    this.write({ v: PROTOCOL_VERSION, t: 'ping', ts });
  }

  rematch(): void {
    this.write({ v: PROTOCOL_VERSION, t: 'rematch' });
  }

  onWelcome(cb: (msg: WelcomeMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.welcome, cb);
  }
  onSnapshot(cb: (msg: SnapshotMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.snapshot, cb);
  }
  onEvent(cb: (msg: GameEvent) => void): Unsubscribe {
    return this.subscribe(this.listeners.event, cb);
  }
  onPong(cb: (msg: PongMessage) => void): Unsubscribe {
    return this.subscribe(this.listeners.pong, cb);
  }
  onError(cb: (code: ErrorCode, message?: string) => void): Unsubscribe {
    return this.subscribe(this.listeners.error, cb);
  }
  onClose(cb: (info: CloseInfo) => void): Unsubscribe {
    return this.subscribe(this.listeners.close, cb);
  }

  private subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
    set.add(cb);
    return () => set.delete(cb);
  }

  private write(msg: object): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(msg));
  }

  /** The page is going away: leave the token where the next page of this tab can find it. */
  private watchPageHide(): void {
    if (this.offPageHide) return;
    this.offPageHide = (this.opts.onPageHide ?? browserPageHide)(() => {
      if (this.token !== undefined) this.tokens.save(this.opts.roomId, this.token);
    });
  }

  private forgetToken(): void {
    this.token = undefined;
    this.tokenFromStorage = false;
    this.tokens.clear();
  }

  /** The stored token was refused (too old): drop it and join as a newcomer on a new socket. */
  private joinWithoutToken(): void {
    const socket = this.socket;
    this.detach();
    try {
      socket?.close(1000, 'stale reconnect token');
    } catch {
      // already closed
    }
    this.forgetToken();
    this.connect();
  }

  private detach(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') {
      console.warn('[WsTransport] dropped non-text frame');
      return;
    }
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      console.warn('[WsTransport] dropped invalid message:', parsed.error.message);
      return;
    }
    this.dispatch(parsed.data);
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        // every welcome carries the token to use next time (a reconnect rotates it)
        this.token = msg.token;
        this.tokenFromStorage = false;
        for (const cb of this.listeners.welcome) cb(msg);
        break;
      case 'snapshot':
        for (const cb of this.listeners.snapshot) cb(msg);
        break;
      case 'event':
        for (const cb of this.listeners.event) cb(msg);
        break;
      case 'pong':
        for (const cb of this.listeners.pong) cb(msg);
        break;
      case 'error':
        if (msg.code === 'INVALID_TOKEN' && this.tokenFromStorage) this.joinWithoutToken();
        else this.emitError(msg.code, msg.message);
        break;
    }
  }

  private emitError(code: ErrorCode, message?: string): void {
    this.reported = code;
    for (const cb of this.listeners.error) cb(code, message);
  }
}
