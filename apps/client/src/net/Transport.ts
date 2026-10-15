import type { ClientMessage, ErrorCode, GameEvent, ServerMessage } from '@booberman/protocol';

type InputMessage = Extract<ClientMessage, { t: 'input' }>;
export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;
export type SnapshotMessage = Extract<ServerMessage, { t: 'snapshot' }>;
export type PongMessage = Extract<ServerMessage, { t: 'pong' }>;

export type InputDir = InputMessage['dir'];
/** What a scene sends: direction held + seq (never a position). The transport adds `v` / `t`. */
export type TransportInput = Pick<InputMessage, 'seq' | 'dir' | 'bomb'>;

export type Unsubscribe = () => void;

/**
 * The only thing scenes know about the network. Implemented by MockTransport (`?mock=1`) and,
 * in FE-13, WsTransport. Every incoming message has already passed `parseServerMessage`.
 * Subscribe before `connect()`; each `on*` returns an unsubscribe function for scene shutdown.
 */
export interface Transport {
  connect(): void;
  disconnect(): void;
  send(input: TransportInput): void;
  /** Sends `ping { ts }`; the server answers with `pong { ts }` (D7). */
  ping(ts: number): void;
  onWelcome(cb: (msg: WelcomeMessage) => void): Unsubscribe;
  onSnapshot(cb: (msg: SnapshotMessage) => void): Unsubscribe;
  onEvent(cb: (msg: GameEvent) => void): Unsubscribe;
  onPong(cb: (msg: PongMessage) => void): Unsubscribe;
  onError(cb: (code: ErrorCode, message?: string) => void): Unsubscribe;
}
