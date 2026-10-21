import type { ClientMessage, ErrorCode, GameEvent, ServerMessage } from '@booberman/protocol';

type InputMessage = Extract<ClientMessage, { t: 'input' }>;
export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;
export type SnapshotMessage = Extract<ServerMessage, { t: 'snapshot' }>;
export type PongMessage = Extract<ServerMessage, { t: 'pong' }>;

export type InputDir = InputMessage['dir'];
/** What a scene sends: direction held + seq (never a position). The transport adds `v` / `t`. */
export type TransportInput = Pick<InputMessage, 'seq' | 'dir' | 'bomb'>;

export type Unsubscribe = () => void;

/** The socket is gone. `ROOM_FULL` / `INVALID_NICKNAME` closes also arrive through `onError`. */
export interface CloseInfo {
  code: number;
  reason: string;
  clean: boolean;
}

/**
 * The only thing scenes know about the network. Implemented by MockTransport (`?mock=1`) and WsTransport. Every incoming message has already passed `parseServerMessage`.
 * Subscribe before `connect()`; each `on*` returns an unsubscribe function for scene shutdown.
 */
export interface Transport {
  /**
   * Opens the connection. After `onClose` it may be called again (FE-22): the real transport then asks for
   * its old slot back with the token of the last `welcome`, and answers `onWelcome` again when it got it.
   */
  connect(): void;
  /** Leaves for good; also forgets the reconnect token. */
  disconnect(): void;
  send(input: TransportInput): void;
  /** Sends `ping { ts }`; the server answers with `pong { ts }` (D7). */
  ping(ts: number): void;
  /**
   * D9 / D35: "play again" — we are ready. Only meaningful on the end screen; the server ignores it
   * while a round is running and answers every press with a `rematchStatus` event. Pressing again changes nothing.
   */
  rematch(): void;
  onWelcome(cb: (msg: WelcomeMessage) => void): Unsubscribe;
  onSnapshot(cb: (msg: SnapshotMessage) => void): Unsubscribe;
  onEvent(cb: (msg: GameEvent) => void): Unsubscribe;
  onPong(cb: (msg: PongMessage) => void): Unsubscribe;
  onError(cb: (code: ErrorCode, message?: string) => void): Unsubscribe;
  /** Connection ended by the server / network (never fired by our own `disconnect()`). */
  onClose(cb: (info: CloseInfo) => void): Unsubscribe;
}
