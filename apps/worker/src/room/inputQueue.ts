import type { PlayerId, PlayerInput } from '../game';

/** AC (CAR-3793): more than 30 inputs per second from one player are dropped. */
export const MAX_INPUTS_PER_SECOND = 30;

export type OfferResult = 'accepted' | 'stale' | 'rate-limited';

type Pending = { dir: PlayerInput['dir']; bomb: boolean; seq: number };

/**
 * Per-player input queue for the tick loop. Lives in RoomDO memory only: while anyone is
 * in the room the tick keeps the DO awake, and an empty room has nothing to remember.
 *
 * - rate limit: sliding window, at most `maxPerSecond` inputs in any 1000 ms (so "30 per second"
 *   holds for every second, not just per clock second). Checked first, so spamming stale or
 *   duplicate seqs counts too.
 * - seq: anything not newer than the newest accepted seq is dropped (`simulate` does not do this, D20).
 * - drain: `simulate` takes one input per player per tick, so inputs that piled up between two
 *   ticks are merged: direction of the newest, `bomb` if any of them asked for it, seq of the newest.
 */
export class InputQueue {
  private readonly pending = new Map<PlayerId, Pending>();
  private readonly lastSeq = new Map<PlayerId, number>();
  private readonly recent = new Map<PlayerId, number[]>();
  readonly counters = { accepted: 0, stale: 0, rateLimited: 0 };

  constructor(private readonly maxPerSecond = MAX_INPUTS_PER_SECOND) {}

  offer(playerId: PlayerId, input: PlayerInput, nowMs: number): OfferResult {
    if (!this.takeToken(playerId, nowMs)) {
      this.counters.rateLimited++;
      return 'rate-limited';
    }
    const last = this.lastSeq.get(playerId);
    if (last !== undefined && input.seq <= last) {
      this.counters.stale++;
      return 'stale';
    }
    this.lastSeq.set(playerId, input.seq);
    const before = this.pending.get(playerId);
    this.pending.set(playerId, {
      dir: input.dir,
      bomb: (before?.bomb ?? false) || input.bomb,
      seq: input.seq,
    });
    this.counters.accepted++;
    return 'accepted';
  }

  /** Inputs for this tick, one per player who sent something since the last drain. */
  drain(): Map<PlayerId, PlayerInput> {
    const out = new Map<PlayerId, PlayerInput>();
    for (const [id, p] of this.pending) out.set(id, { dir: p.dir, bomb: p.bomb, seq: p.seq });
    this.pending.clear();
    return out;
  }

  /** Player left: forget everything so a newcomer reusing the slot starts from seq 0. */
  remove(playerId: PlayerId): void {
    this.pending.delete(playerId);
    this.lastSeq.delete(playerId);
    this.recent.delete(playerId);
  }

  clear(): void {
    this.pending.clear();
    this.lastSeq.clear();
    this.recent.clear();
  }

  private takeToken(playerId: PlayerId, nowMs: number): boolean {
    const times = this.recent.get(playerId) ?? [];
    // times is ascending; drop everything older than 1 s
    let i = 0;
    while (i < times.length && (times[i] ?? 0) <= nowMs - 1000) i++;
    if (i > 0) times.splice(0, i);
    this.recent.set(playerId, times);
    if (times.length >= this.maxPerSecond) return false;
    times.push(nowMs);
    return true;
  }
}
