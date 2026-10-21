import type { GameEvent, PlayerId, RoundEndReason } from '@booberman/protocol';

type RoundEndEvent = Extract<GameEvent, { kind: 'roundEnd' }>;

/** `matches.end_reason` (migration 0002): snake_case, and `timeout` is called `time_up` there. */
export type MatchEndReason = 'last_alive' | 'all_dead' | 'time_up';

const END_REASONS: Record<RoundEndReason, MatchEndReason> = {
  lastAlive: 'last_alive',
  allDead: 'all_dead',
  timeout: 'time_up',
};

export type MatchPlayerRow = {
  nickname: string;
  kills: number;
  deaths: number;
  selfKills: number;
  curseKills: number;
  transfers: number;
  trollPoints: number;
  isWinner: boolean;
};

/** One finished round, shaped like the `matches` + `match_players` rows (camelCase here, snake_case in SQL). */
export type MatchRecord = {
  id: string;
  roomId: string;
  seed: number;
  startedAt: number;
  endedAt: number;
  endReason: MatchEndReason;
  /** `null` = draw */
  winnerNick: string | null;
  players: MatchPlayerRow[];
};

export type MatchContext = {
  id: string;
  roomId: string;
  seed: number;
  startedAt: number;
  endedAt: number;
  /** Who is in the room right now: the `roundEnd` table only has ids, the nickname comes from here. */
  nicknames: ReadonlyMap<PlayerId, string>;
};

/**
 * Turns the `roundEnd` event into the rows to store.
 *
 * `match_players` is keyed by (match_id, nickname) but the game allows two players with the same
 * nickname in one room. The first one (by player id, the order of `stats`' input) keeps the name, the
 * next ones become `name#2`, `name#3`: `#` is not an allowed nickname character (protocol
 * `Nickname`), so a suffixed name can never collide with a real one, and no player's row is lost or
 * merged into somebody else's. `winner_nick` uses the same stored name as the winner's row.
 *
 * Players who left before the end are not in `stats` (D33) and so not in the record either.
 */
export function buildMatchRecord(end: RoundEndEvent, ctx: MatchContext): MatchRecord {
  const used = new Map<string, number>();
  const stored = new Map<PlayerId, string>();
  for (const row of [...end.stats].sort((a, b) => a.id.localeCompare(b.id))) {
    const base = ctx.nicknames.get(row.id) ?? row.id; // a player id always has a nickname; id is a safe fallback
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    stored.set(row.id, n === 1 ? base : `${base}#${n}`);
  }
  return {
    id: ctx.id,
    roomId: ctx.roomId,
    seed: ctx.seed,
    startedAt: ctx.startedAt,
    endedAt: ctx.endedAt,
    endReason: END_REASONS[end.reason],
    winnerNick: end.winner === null ? null : (stored.get(end.winner) ?? null),
    players: end.stats.map((row) => ({
      nickname: stored.get(row.id) ?? row.id,
      kills: row.kills,
      deaths: row.deaths,
      selfKills: row.selfKills,
      curseKills: row.curseKills,
      transfers: row.transfers,
      trollPoints: row.trollPoints,
      isWinner: row.id === end.winner,
    })),
  };
}
