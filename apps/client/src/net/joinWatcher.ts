import type { ErrorCode } from '@booberman/protocol';
import { errorCodeForClose } from './closeCodes';
import type { Transport, Unsubscribe } from './Transport';

/** Why a join did not work, or why we left a room we were in (FE-19). */
export type JoinFailureKind =
  | 'ROOM_FULL'
  | 'INVALID_NICKNAME'
  | 'VERSION_MISMATCH'
  | 'CONNECT_FAILED'
  | 'CONNECTION_LOST';

/** How long the server gets to answer `join` with `welcome` before we call it a failed connection. */
export const JOIN_TIMEOUT_MS = 10_000;

export interface JoinWatcherTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realTimers: JoinWatcherTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface JoinWatcherHandlers {
  /** `welcome` arrived: we are in the room. */
  onJoined(): void;
  /** The join did not complete. Called at most once, never after `onJoined`. */
  onFailed(kind: JoinFailureKind): void;
  /** We were in the room and the socket ended (server restart, network). Called at most once. */
  onLost(): void;
}

/**
 * Turns the transport's raw signals into one answer to "did joining work?":
 *
 * - `welcome` → joined
 * - `error` / a 4001 / 4002 close before `welcome` → that error (`ROOM_FULL`, `INVALID_NICKNAME`...)
 * - any other close, or no `welcome` within the timeout → `CONNECT_FAILED`
 * - a close after `welcome` → lost
 *
 * `WsTransport` reports `error` and then the matching close; only the first one counts.
 */
export class JoinWatcher {
  private state: 'joining' | 'joined' | 'done' = 'joining';
  private readonly offs: Unsubscribe[] = [];
  private timer: unknown;

  constructor(
    private readonly transport: Transport,
    private readonly handlers: JoinWatcherHandlers,
    private readonly timers: JoinWatcherTimers = realTimers,
    timeoutMs: number = JOIN_TIMEOUT_MS,
  ) {
    this.offs.push(
      transport.onWelcome(() => this.welcome()),
      transport.onError((code) => this.error(code)),
      transport.onClose((info) => this.closed(info.code)),
    );
    this.timer = timers.setTimeout(() => this.timedOut(), timeoutMs);
  }

  dispose(): void {
    this.state = 'done';
    this.stopTimer();
    for (const off of this.offs.splice(0)) off();
  }

  private welcome(): void {
    if (this.state !== 'joining') return;
    this.state = 'joined';
    this.stopTimer();
    this.handlers.onJoined();
  }

  private error(code: ErrorCode): void {
    if (this.state !== 'joining') return;
    this.fail(failureForError(code));
  }

  private closed(code: number): void {
    if (this.state === 'joined') {
      this.state = 'done';
      this.handlers.onLost();
      return;
    }
    if (this.state !== 'joining') return;
    const mapped = errorCodeForClose(code);
    this.fail(mapped ? failureForError(mapped) : 'CONNECT_FAILED');
  }

  private timedOut(): void {
    this.timer = undefined;
    if (this.state !== 'joining') return;
    // the socket may still be half-open; do not leave it behind
    this.transport.disconnect();
    this.fail('CONNECT_FAILED');
  }

  private fail(kind: JoinFailureKind): void {
    this.state = 'done';
    this.stopTimer();
    this.handlers.onFailed(kind);
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * `BAD_MESSAGE` before a welcome means client and server disagree on the protocol in a way the
 * player cannot fix by retyping anything, so it reads as a failed connection.
 */
export function failureForError(code: ErrorCode): JoinFailureKind {
  switch (code) {
    case 'ROOM_FULL':
    case 'INVALID_NICKNAME':
    case 'VERSION_MISMATCH':
      return code;
    case 'BAD_MESSAGE':
      return 'CONNECT_FAILED';
  }
}
