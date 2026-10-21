import {
  type GameEvent,
  type PlayerId,
  type RoundEndReason,
  TITLE_LABELS,
  type TitleId,
} from '@booberman/protocol';
import type { Roster } from './hudView';
import { PLAYER_TINTS } from './playerViews';

type RoundEndEvent = Extract<GameEvent, { kind: 'roundEnd' }>;
type RematchStatusEvent = Extract<GameEvent, { kind: 'rematchStatus' }>;

export interface EndRow {
  /** Place in the table: the server sends the rows already sorted, so this is just the position. */
  rank: number;
  id: PlayerId;
  name: string;
  color: number;
  isSelf: boolean;
  kills: number;
  deaths: number;
  trollPoints: number;
}

export interface EndTitleLine {
  title: TitleId;
  label: string;
  holders: { id: PlayerId; name: string; isSelf: boolean }[];
  value: number;
  unit: string;
}

export interface EndView {
  headline: string;
  /** Why the round ended, in words. */
  reason: string;
  /** The winner's id, `null` for a draw. */
  winner: PlayerId | null;
  youWon: boolean;
  rows: EndRow[];
  titles: EndTitleLine[];
}

const REASON_TEXT: Readonly<Record<RoundEndReason, string>> = {
  lastAlive: 'รอดคนสุดท้าย',
  allDead: 'ตายพร้อมกันทั้งหมด',
  timeout: 'หมดเวลา',
};

/** What `value` of each title counts, for the line under the name. */
const TITLE_UNIT: Readonly<Record<TitleId, string>> = {
  spreader: 'ครั้ง',
  backstabber: 'ครั้ง',
  haunter: 'ครั้ง',
  selfKiller: 'ครั้ง',
  troll: 'แต้ม',
};

const nameOf = (roster: Roster, id: PlayerId): string => roster.nameOf(id) ?? id;

/**
 * `roundEnd` → the end screen. Pure and decides nothing about the game: the order of the rows, who
 * won and who holds which title are the server's. Names are read when the event arrives, so a
 * player who leaves while the screen is up keeps their name in the table.
 */
export function toEndView(
  event: Pick<RoundEndEvent, 'winner' | 'reason' | 'stats' | 'titles'>,
  roster: Roster,
  selfId: PlayerId | undefined,
): EndView {
  const winnerName = event.winner === null ? undefined : nameOf(roster, event.winner);
  const youWon = event.winner !== null && event.winner === selfId;
  return {
    headline: youWon ? 'คุณชนะ!' : winnerName === undefined ? 'เสมอ' : `${winnerName} ชนะ`,
    reason: REASON_TEXT[event.reason],
    winner: event.winner,
    youWon,
    rows: event.stats.map((s, i) => ({
      rank: i + 1,
      id: s.id,
      name: nameOf(roster, s.id),
      color: PLAYER_TINTS[s.id] ?? 0xffffff,
      isSelf: s.id === selfId,
      kills: s.kills,
      deaths: s.deaths,
      trollPoints: s.trollPoints,
    })),
    titles: event.titles.map((t) => ({
      title: t.title,
      label: TITLE_LABELS[t.title],
      holders: t.players.map((id) => ({ id, name: nameOf(roster, id), isSelf: id === selfId })),
      value: t.value,
      unit: TITLE_UNIT[t.title],
    })),
  };
}

/** Same as the server's window (D9); only used to keep a wrong device clock from showing nonsense. */
export const REMATCH_WINDOW_MS = 15_000;

export type RematchStatus = Pick<RematchStatusEvent, 'ready' | 'deadline'>;

export interface RematchView {
  /** Who pressed, by name, in the server's order. */
  readyNames: string[];
  readyCount: number;
  /** Everyone in the room right now (the roster), people who joined after the round ended included. */
  total: number;
  selfReady: boolean;
  /**
   * Whole seconds until the round starts anyway, `undefined` while nobody pressed (the server sends
   * `deadline: 0` and no countdown runs). Clamped to 0..15: `deadline` is the server's epoch time and
   * this device's clock may be off, but the number is for show; the server alone starts the round.
   */
  secondsLeft: number | undefined;
}

export function toRematchView(
  status: RematchStatus | undefined,
  roster: Roster,
  selfId: PlayerId | undefined,
  nowMs: number,
): RematchView {
  const ready = status?.ready ?? [];
  const deadline = status?.deadline ?? 0;
  const left = deadline > 0 ? Math.ceil((deadline - nowMs) / 1000) : undefined;
  return {
    readyNames: ready.map((id) => nameOf(roster, id)),
    readyCount: ready.length,
    total: Math.max(roster.size, ready.length),
    selfReady: selfId !== undefined && ready.includes(selfId),
    secondsLeft:
      left === undefined
        ? undefined
        : Math.min(REMATCH_WINDOW_MS / 1000, Math.max(0, Number.isFinite(left) ? left : 0)),
  };
}

export const REMATCH_BUTTON_LABEL = 'เล่นอีกรอบ';
export const REMATCH_WAITING_LABEL = 'พร้อมแล้ว รอคนอื่น…';

/** Words for the line above the button: who is ready, or how the rematch works while nobody is. */
export function rematchStatusText(v: RematchView): string {
  if (v.readyCount === 0) return 'รอบใหม่เริ่มเมื่อทุกคนกดพร้อม หรือครบ 15 วินาทีหลังมีคนกดคนแรก';
  return `พร้อมแล้ว ${v.readyCount}/${v.total}: ${v.readyNames.join(', ')}`;
}

/** `undefined` while nobody has pressed (no countdown is running yet). */
export function rematchCountdownText(secondsLeft: number | undefined): string | undefined {
  if (secondsLeft === undefined) return undefined;
  return secondsLeft > 0 ? `เริ่มรอบใหม่ใน ${secondsLeft} วินาที` : 'กำลังเริ่มรอบใหม่…';
}

/**
 * How long a press may wait for the server's `rematchStatus` before the button is given back.
 * The answer normally takes one round trip; a press whose answer never comes must not leave us stuck.
 */
export const REMATCH_ECHO_TIMEOUT_MS = 3000;

/** Is the button locked? Yes once the server counts us ready, or for a moment after our press. */
export function rematchButtonLocked(
  selfReady: boolean,
  pressedAt: number | undefined,
  nowMs: number,
): boolean {
  if (selfReady) return true;
  return pressedAt !== undefined && nowMs - pressedAt < REMATCH_ECHO_TIMEOUT_MS;
}
