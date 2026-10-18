import type { PlayerId } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';
import { PLAYER_TINTS } from './playerViews';

/** Server tick rate (D7: 20 Hz). Only used to turn server ticks into seconds for display. */
export const TICK_RATE = 20;
/**
 * Mirror of the worker's `roundTicks` (apps/worker/src/game/config.ts). The snapshot has no round
 * clock field yet, so the display counts down from this; the server alone ends the round.
 */
export const ROUND_TICKS = 3000;
/** Names longer than this (Thai combining marks excluded) are cut with an ellipsis. */
export const HUD_NAME_MAX = 8;
/** Curse frame blink: visible for 3 ticks, hidden for 3 ticks, phase taken from the server tick. */
const CURSE_BLINK_TICKS = 3;
const THAI_MARK = /[ัิ-ฺ็-๎]/u;

/** Who is in the room, by nickname. Lives for one connection: cleared on `welcome`, not on `roundStart`. */
export class Roster {
  private names = new Map<string, string>();

  join(id: PlayerId, nickname: string): void {
    this.names.set(id, nickname);
  }

  leave(id: PlayerId): void {
    this.names.delete(id);
  }

  clear(): void {
    this.names = new Map();
  }

  nameOf(id: PlayerId): string | undefined {
    return this.names.get(id);
  }
}

/** Cut to `max` visible characters; Thai combining marks ride on their base letter and do not count. */
export function truncateName(name: string, max: number = HUD_NAME_MAX): string {
  let visible = 0;
  let out = '';
  for (const ch of name) {
    if (!THAI_MARK.test(ch)) {
      if (visible === max) return `${out}…`;
      visible++;
    }
    out += ch;
  }
  return out;
}

/** Seconds left in the round as `m:ss`. Never negative; `--:--` before the first snapshot. */
export function formatRoundTime(tick: number | undefined): string {
  if (tick === undefined || !Number.isFinite(tick)) return '--:--';
  const seconds = Math.ceil(Math.min(ROUND_TICKS, Math.max(0, ROUND_TICKS - tick)) / TICK_RATE);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Whole seconds of curse left (rounded up so "0" is never shown while still cursed). */
export function curseSeconds(curseTicks: number): number {
  return curseTicks > 0 ? Math.ceil(curseTicks / TICK_RATE) : 0;
}

/** The purple frame blinks; its phase comes from the server tick so it cannot drift. */
export function curseFrameVisible(tick: number): boolean {
  return Math.floor(tick / CURSE_BLINK_TICKS) % 2 === 0;
}

export type PlayerStatus = 'alive' | 'cursed' | 'dead';

export interface HudCard {
  id: PlayerId;
  /** Nickname, or the id until `playerJoined` arrives. Already truncated for the card. */
  name: string;
  color: number;
  status: PlayerStatus;
  /** Seconds of curse left; 0 unless `status === 'cursed'`. */
  curseSeconds: number;
  isSelf: boolean;
}

export interface HudView {
  time: string;
  cards: HudCard[];
}

/** Snapshot + roster → what the HUD shows. Pure: every value is read from the server's snapshot. */
export function toHudView(
  snapshot: SnapshotMessage | undefined,
  roster: Roster,
  selfId: PlayerId | undefined,
): HudView {
  if (!snapshot) return { time: formatRoundTime(undefined), cards: [] };
  const cards = [...snapshot.players]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p): HudCard => {
      const secs = p.alive ? curseSeconds(p.curse) : 0;
      return {
        id: p.id,
        name: truncateName(roster.nameOf(p.id) ?? p.id),
        color: PLAYER_TINTS[p.id] ?? 0xffffff,
        status: !p.alive ? 'dead' : secs > 0 ? 'cursed' : 'alive',
        curseSeconds: secs,
        isSelf: p.id === selfId,
      };
    });
  return { time: formatRoundTime(snapshot.tick), cards };
}

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2×2 grid of cards inside the HUD strip, below the time row; card `i` goes left→right, top→bottom. */
export function cardRect(index: number, canvasWidth: number, top: number): CardRect {
  const gap = 2;
  const w = (canvasWidth - gap * 3) / 2;
  const h = 18;
  const col = index % 2;
  const row = Math.floor(index / 2);
  return { x: gap + col * (w + gap), y: top + row * (h + gap), w, h };
}
