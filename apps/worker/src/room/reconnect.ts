import type { PlayerId } from '@booberman/protocol';

/** CAR-3800: a player whose connection dropped keeps their slot this long. */
export const RECONNECT_HOLD_MS = 15_000;

/**
 * A player whose socket dropped. Their character stays in the game (it just gets no input) and the slot
 * stays taken until `expiresAt`. Persisted in Durable Object storage (`held`), so it outlives a hibernation
 * or an eviction; the DO alarm is what removes it on time.
 */
export type HeldSlot = {
  playerId: PlayerId;
  nickname: string;
  /** D33 join id: kept on the way back, so the game state counts it as the same player. */
  session: number;
  token: string;
  /** Room id, so a DO with no socket left can still rebuild the room after an eviction. */
  room: string;
  /** Epoch ms; from this moment on the slot is gone. */
  expiresAt: number;
};

/** 128 random bits as hex: unguessable, URL- and JSON-safe. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares without stopping at the first different character. */
export function sameToken(a: string | undefined, b: string): boolean {
  if (a === undefined || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The dropped players of one room, by playerId. Pure bookkeeping: no clock, no storage (RoomDO passes
 * `now` in and saves `list()`), so every rule of the 15 s window is testable without a Durable Object.
 */
export class HeldSlots {
  private readonly slots = new Map<PlayerId, HeldSlot>();

  constructor(initial: readonly HeldSlot[] = []) {
    for (const s of initial) this.slots.set(s.playerId, s);
  }

  get size(): number {
    return this.slots.size;
  }

  has(playerId: PlayerId): boolean {
    return this.slots.has(playerId);
  }

  /** Sorted by playerId, like the room's player list. */
  list(): HeldSlot[] {
    return [...this.slots.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
  }

  add(slot: HeldSlot): void {
    this.slots.set(slot.playerId, slot);
  }

  /**
   * Takes the slot `token` belongs to out of the list and returns it. `undefined` for an unknown token or
   * one whose time is up (those are removed by `expire`, with the "player left" bookkeeping that needs).
   */
  claim(token: string, now: number): HeldSlot | undefined {
    for (const s of this.slots.values()) {
      if (!sameToken(s.token, token)) continue;
      if (s.expiresAt <= now) return undefined;
      this.slots.delete(s.playerId);
      return s;
    }
    return undefined;
  }

  /** Removes and returns every slot whose time is up at `now`. */
  expire(now: number): HeldSlot[] {
    const gone = this.list().filter((s) => s.expiresAt <= now);
    for (const s of gone) this.slots.delete(s.playerId);
    return gone;
  }

  /** The earliest `expiresAt`, or `undefined` when nothing is held (what the DO alarm waits for). */
  nextExpiry(): number | undefined {
    let next: number | undefined;
    for (const s of this.slots.values())
      if (next === undefined || s.expiresAt < next) next = s.expiresAt;
    return next;
  }
}
