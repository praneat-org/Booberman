import { ROOM_KV_TTL_SECONDS, RoomKvMetadata } from '@booberman/protocol';
import { ROOM_KEY_PREFIX } from '../api/rooms';

/** KV allows one write per second per key, so RoomDO never writes `room:<id>` more often than this. */
export const ROOM_KV_MIN_WRITE_INTERVAL_MS = 1000;
/** While people are in the room but nobody joins / leaves, the key is renewed this often (TTL is 300 s). */
export const ROOM_KV_RENEW_INTERVAL_MS = 120_000;

type Kv = Pick<KVNamespace, 'put' | 'delete' | 'getWithMetadata'>;

/**
 * Keeps the lobby entry `room:<id>` (CAR-3791) in step with the number of sockets in the room.
 *
 * - Display only: nothing here decides whether the room is full (RoomDO counts sockets; KV is ~60 s stale).
 * - Throttled: the first change is written at once, later changes inside the 1 s window are merged
 *   into ONE trailing write of the latest value, so the final value is always written.
 * - The write never blocks the caller: `update` returns at once and errors are logged, not thrown,
 *   so a KV outage cannot stall the tick loop or a join.
 * - `createdAt` / `max` are copied from the key POST /api/rooms created. A room with no such key
 *   (joined by a direct link, or the key already expired) is NOT listed: see `readBase`.
 * - Count 0 deletes the key. Only the single trailing timer (<= 1 s) can outlive the last player.
 */
export class RoomKvSync {
  readonly counters = { puts: 0, deletes: 0, skipped: 0, errors: 0 };
  private readonly key: string;
  private desired: number | undefined;
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private base: Pick<RoomKvMetadata, 'max' | 'createdAt'> | undefined;

  constructor(
    private readonly kv: Kv,
    roomId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `${ROOM_KEY_PREFIX}${roomId}`;
  }

  /** Player count changed (join / leave). Never awaits KV. */
  update(players: number): void {
    this.desired = players;
    this.schedule();
  }

  /** Called every tick (cheap): renews the key when nothing was written for a while, and re-syncs after a restart. */
  heartbeat(players: number): void {
    if (this.now() - this.lastWriteAt >= ROOM_KV_RENEW_INTERVAL_MS) this.update(players);
  }

  /** True while a write is running or waiting on its timer (tests). */
  get pending(): boolean {
    return this.timer !== null || this.running;
  }

  private schedule(): void {
    // a running flush re-schedules itself in `finally` if the value moved meanwhile
    if (this.timer !== null || this.running) return;
    const wait = Math.max(0, this.lastWriteAt + ROOM_KV_MIN_WRITE_INTERVAL_MS - this.now());
    if (wait === 0) {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    const target = this.desired;
    if (target === undefined) return;
    this.running = true;
    this.lastWriteAt = this.now();
    try {
      if (target === 0) {
        await this.kv.delete(this.key);
        this.counters.deletes++;
        // an emptied room is gone from the lobby; a later joiner must not resurrect old metadata
        this.base = undefined;
      } else {
        this.base ??= await this.readBase();
        if (this.base === undefined) {
          this.counters.skipped++;
        } else {
          const metadata: RoomKvMetadata = { players: target, ...this.base };
          await this.kv.put(this.key, '', { metadata, expirationTtl: ROOM_KV_TTL_SECONDS });
          this.counters.puts++;
        }
      }
    } catch (error) {
      this.counters.errors++;
      console.error(JSON.stringify({ msg: 'room-kv-failed', key: this.key, error: String(error) }));
    } finally {
      this.running = false;
      if (this.desired !== target) this.schedule();
    }
  }

  /**
   * Reads `createdAt` / `max` from the key POST /api/rooms wrote (a read, not a write; it only copies
   * two immutable fields, so a stale read is harmless). No valid key -> undefined -> the room is not
   * listed. Reason: creating keys here would let anyone open /ws/room/<anything> and fill the lobby
   * with rooms, bypassing the POST rate limit. Such rooms are unlisted but fully playable by link.
   * If KV has not propagated the key yet (~60 s), the next heartbeat / join / leave retries.
   */
  private async readBase(): Promise<Pick<RoomKvMetadata, 'max' | 'createdAt'> | undefined> {
    const { metadata } = await this.kv.getWithMetadata<unknown>(this.key);
    const parsed = RoomKvMetadata.safeParse(metadata);
    return parsed.success ? { max: parsed.data.max, createdAt: parsed.data.createdAt } : undefined;
  }
}
