import type { MatchRecord } from './matchRecord';

const INSERT_MATCH =
  'INSERT INTO matches (id, room_id, seed, started_at, ended_at, end_reason, winner_nick) VALUES (?, ?, ?, ?, ?, ?, ?)';
const INSERT_PLAYER =
  'INSERT INTO match_players (match_id, nickname, kills, deaths, self_kills, curse_kills, transfers, troll_points, is_winner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Writes one finished round: ONE `DB.batch` (D1 runs a batch as a single transaction, so a round is
 * either fully there or not at all), prepared statements with bound values only, no SQL built from
 * strings.
 *
 * Callers never await this inside the game loop (D12): it is handed to `ctx.waitUntil` with a
 * `.catch` that logs. It is `async` on purpose so even a synchronous throw from `prepare` comes out
 * as a rejected promise, never as an exception in the tick.
 */
export async function saveMatch(db: D1Database, m: MatchRecord): Promise<void> {
  await db.batch([
    db
      .prepare(INSERT_MATCH)
      .bind(m.id, m.roomId, m.seed, m.startedAt, m.endedAt, m.endReason, m.winnerNick),
    ...m.players.map((p) =>
      db
        .prepare(INSERT_PLAYER)
        .bind(
          m.id,
          p.nickname,
          p.kills,
          p.deaths,
          p.selfKills,
          p.curseKills,
          p.transfers,
          p.trollPoints,
          p.isWinner ? 1 : 0,
        ),
    ),
  ]);
}
