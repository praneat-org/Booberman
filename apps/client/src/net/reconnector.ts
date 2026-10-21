import type { ErrorCode } from '@booberman/protocol';
import { CLOSE_REPLACED } from './closeCodes';
import type { JoinFailureKind, JoinWatcherTimers } from './joinWatcher';
import type { Transport, Unsubscribe } from './Transport';

/** Waits before the 1st, 2nd, 3rd... attempt; the last one repeats (FE-22). */
export const RECONNECT_BACKOFF_MS: readonly number[] = [500, 1000, 2000, 4000];

/** Total time we keep trying, the server's hold on the slot (BE-44 `RECONNECT_HOLD_MS`). */
export const RECONNECT_BUDGET_MS = 15_000;

/**
 * The last attempt starts this long before the 15 s are up, so a network that comes back late in the
 * window still gets one try while the server may still hold the slot.
 */
const FINAL_ATTEMPT_LEAD_MS = 1000;
/** No point in an attempt squeezed in less than this after the previous one failed. */
const MIN_ATTEMPT_GAP_MS = 250;

/** The wait before attempt number `attempt` (0 = the first one after the drop). */
export function reconnectDelay(attempt: number): number {
  const last = RECONNECT_BACKOFF_MS.length - 1;
  return RECONNECT_BACKOFF_MS[Math.min(Math.max(attempt, 0), last)] ?? 0;
}

export interface ReconnectorHandlers {
  /** The connection dropped: show "reconnecting" until `deadline` (same clock as `now`). Once per outage. */
  onReconnecting(deadline: number): void;
  /** `welcome` came back on a retry: the game goes on where it was. */
  onRestored(): void;
  /** Hopeless: out of time, or the server will not take us back. The transport is already disconnected. */
  onGaveUp(kind: JoinFailureKind): void;
}

const realTimers: JoinWatcherTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * What to do once we were in a room and the socket ended (FE-22). `arm()` after `welcome`; from then on
 * a close starts retrying: `transport.connect()` after 0.5, 1, 2, 4, 4... s, each attempt sending `join`
 * with the token of the last `welcome` (the transport keeps it), and one last attempt 1 s before the 15 s
 * are up. The first `welcome` back means we are in again, with the same slot (BE-44); several outages in
 * one session are fine, each gets a new 15 s.
 *
 * It gives up when
 * - the time is up (a failed attempt with no room left for another also ends it),
 * - the server refuses: any `error` (`INVALID_TOKEN` = the hold ran out, `VERSION_MISMATCH` = a new
 *   deploy), or a close 4004 (someone else took the slot with our token; retrying would only fight them).
 *
 * Giving up disconnects the transport, which also forgets the token. No DOM, no Phaser: timers and clock
 * are injected for the tests.
 */
export class Reconnector {
  private state: 'idle' | 'connected' | 'retrying' | 'done' = 'idle';
  private attempt = 0;
  private deadline = 0;
  private backoffTimer: unknown;
  private limitTimer: unknown;
  private readonly offs: Unsubscribe[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly handlers: ReconnectorHandlers,
    private readonly timers: JoinWatcherTimers = realTimers,
    private readonly now: () => number = Date.now,
  ) {
    this.offs.push(
      transport.onWelcome(() => this.welcome()),
      transport.onError((code) => this.refused(code)),
      transport.onClose((info) => this.closed(info.code)),
    );
  }

  /** We are in the room (first `welcome`): from now on a lost connection is retried. */
  arm(): void {
    if (this.state === 'idle') this.state = 'connected';
  }

  dispose(): void {
    this.state = 'done';
    this.stopTimers();
    for (const off of this.offs.splice(0)) off();
  }

  private welcome(): void {
    if (this.state !== 'retrying') return;
    this.stopTimers();
    this.state = 'connected';
    this.handlers.onRestored();
  }

  private refused(code: ErrorCode): void {
    if (this.state !== 'retrying') return;
    // a token join can only be answered with INVALID_TOKEN / VERSION_MISMATCH: nothing a retry fixes
    this.giveUp(code === 'VERSION_MISMATCH' ? 'VERSION_MISMATCH' : 'CONNECTION_LOST');
  }

  private closed(code: number): void {
    if (code === CLOSE_REPLACED && (this.state === 'connected' || this.state === 'retrying')) {
      this.giveUp('CONNECTION_LOST');
      return;
    }
    if (this.state === 'connected') this.begin();
    else if (this.state === 'retrying') this.scheduleNext(); // that attempt failed
  }

  private begin(): void {
    this.state = 'retrying';
    this.attempt = 0;
    this.deadline = this.now() + RECONNECT_BUDGET_MS;
    this.handlers.onReconnecting(this.deadline);
    this.limitTimer = this.timers.setTimeout(
      () => this.giveUp('CONNECTION_LOST'),
      RECONNECT_BUDGET_MS,
    );
    this.scheduleNext();
  }

  private scheduleNext(): void {
    let delay = reconnectDelay(this.attempt);
    const latest = this.deadline - FINAL_ATTEMPT_LEAD_MS - this.now();
    if (delay > latest) {
      if (latest < MIN_ATTEMPT_GAP_MS) {
        this.giveUp('CONNECTION_LOST');
        return;
      }
      delay = latest; // squeeze in one more before the time is up
    }
    this.attempt += 1;
    this.backoffTimer = this.timers.setTimeout(() => {
      this.backoffTimer = undefined;
      this.transport.connect();
    }, delay);
  }

  private giveUp(kind: JoinFailureKind): void {
    if (this.state === 'done') return;
    this.state = 'done';
    this.stopTimers();
    for (const off of this.offs.splice(0)) off();
    this.transport.disconnect();
    this.handlers.onGaveUp(kind);
  }

  private stopTimers(): void {
    if (this.backoffTimer !== undefined) this.timers.clearTimeout(this.backoffTimer);
    if (this.limitTimer !== undefined) this.timers.clearTimeout(this.limitTimer);
    this.backoffTimer = undefined;
    this.limitTimer = undefined;
  }
}
