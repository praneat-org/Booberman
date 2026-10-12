import { exports } from 'cloudflare:workers';
import {
  type ClientMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from '@booberman/protocol';

export const v = PROTOCOL_VERSION;

/** Collects server messages from a test socket and lets a test await the next matching one. */
export class Client {
  readonly received: ServerMessage[] = [];
  closed: { code: number; reason: string } | undefined;
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const parsed = parseServerMessage(e.data);
      if (!parsed.ok) throw new Error(`server sent an invalid message: ${parsed.error.message}`);
      this.received.push(parsed.data);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(parsed.data)) return true;
        w.resolve(parsed.data);
        return false;
      });
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
  }

  send(msg: ClientMessage | Record<string, unknown> | string) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Resolves with the first message (already received or future) that matches. */
  next<T extends ServerMessage>(
    match: (m: ServerMessage) => m is T,
    timeoutMs?: number,
  ): Promise<T>;
  next(match: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  next(match: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const seen = this.received.find(match);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  close() {
    this.ws.close(1000, 'bye');
  }
}

export async function connect(room = 'abc123'): Promise<Client> {
  const res = await exports.default.fetch(`http://localhost/ws/room/${room}`, {
    headers: { Upgrade: 'websocket' },
  });
  if (res.status !== 101 || !res.webSocket) throw new Error(`expected 101, got ${res.status}`);
  res.webSocket.accept();
  return new Client(res.webSocket);
}

export async function join(room: string, nickname: string): Promise<Client & { playerId: string }> {
  const c = await connect(room);
  c.send({ v, t: 'join', room, nickname });
  const welcome = await c.next((m) => m.t === 'welcome');
  if (welcome.t !== 'welcome') throw new Error('unreachable');
  return Object.assign(c, { playerId: welcome.playerId });
}

export const isEvent =
  <K extends string>(kind: K) =>
  (m: ServerMessage) =>
    m.t === 'event' && m.kind === kind;
