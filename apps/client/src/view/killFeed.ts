import type { GameEvent, KillCause, PlayerId } from '@booberman/protocol';
import type { Roster } from './hudView';
import { PLAYER_TINTS } from './playerViews';

/** How long a line stays on screen. */
export const KILL_FEED_TTL_MS = 5000;
/** The corner is small: only the newest lines show, the older ones go early. */
export const KILL_FEED_MAX_LINES = 4;
/** What we keep in memory; a round can have a handful of deaths, never a stream. */
const KEEP = 16;

export const KILL_CAUSE_LABEL: Readonly<Record<KillCause, string>> = {
  curse: 'คำสาป',
  ghost: 'ผี',
  kick: 'เตะ',
  bomb: 'ระเบิด',
  self: 'ฆ่าตัวเอง',
};

/** Shown when the credit belongs to somebody who has left (D33: `killer: null`). */
export const DEPARTED_NAME = 'ผู้เล่นที่ออกไปแล้ว';

type KillEvent = Extract<GameEvent, { kind: 'kill' }>;

export interface KillFeedLine {
  id: number;
  /** Local clock (ms) when the event arrived. */
  at: number;
  /** `null` when the credit went to someone who left; the line then names nobody. */
  killerName: string | null;
  killerColor: number | undefined;
  victimName: string;
  victimColor: number;
  cause: KillCause;
  /** The cause in words ("ระเบิด", "คำสาป"...). */
  label: string;
  /** The victim got the credit themselves (`cause: 'self'`): the line has no arrow. */
  self: boolean;
  /** The whole line as plain text (screen readers, tests). */
  text: string;
}

const nameOf = (roster: Roster, id: PlayerId): string => roster.nameOf(id) ?? id;

/**
 * Turns a `kill` event into a line. Names are read now: a player who leaves a moment later is gone
 * from the roster, but the line keeps the name it was written with.
 */
export function toKillLine(
  event: KillEvent,
  roster: Roster,
  now: number,
  id: number,
): KillFeedLine {
  const victimName = nameOf(roster, event.victim);
  const self = event.cause === 'self' || event.killer === event.victim;
  const killerName = event.killer === null ? null : nameOf(roster, event.killer);
  const label = KILL_CAUSE_LABEL[event.cause];
  const text = self
    ? `${victimName} ${label}`
    : `${killerName ?? DEPARTED_NAME} → ${victimName} (${label})`;
  return {
    id,
    at: now,
    killerName,
    killerColor: event.killer === null ? undefined : PLAYER_TINTS[event.killer],
    victimName,
    victimColor: PLAYER_TINTS[event.victim] ?? 0xffffff,
    cause: event.cause,
    label,
    self,
    text,
  };
}

/**
 * The corner list of "who killed whom" (CAR-3798 AC 1). Pure: it only keeps what the server's
 * `kill` events said, and decides which lines are still young enough to show. The clock is passed in.
 */
export class KillFeed {
  private lines: KillFeedLine[] = [];
  private nextId = 1;

  push(event: KillEvent, roster: Roster, now: number): void {
    this.lines.push(toKillLine(event, roster, now, this.nextId++));
    if (this.lines.length > KEEP) this.lines = this.lines.slice(-KEEP);
  }

  /** The newest lines that are younger than the TTL, oldest first. */
  visible(now: number): KillFeedLine[] {
    return this.lines.filter((l) => now - l.at < KILL_FEED_TTL_MS).slice(-KILL_FEED_MAX_LINES);
  }

  /** A new round (roundStart / welcome) starts with an empty corner. */
  clear(): void {
    this.lines = [];
  }
}

/** `0xrrggbb` → `#rrggbb` for the DOM overlays. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
