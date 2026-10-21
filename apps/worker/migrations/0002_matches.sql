-- 0002_matches (BE-42 / CAR-3799): one row per finished round + one row per player in it.
-- Written by RoomDO when a round ends (src/room/matchStore.ts). Never edit an applied migration, add a new file.
CREATE TABLE matches (
  id          TEXT PRIMARY KEY,          -- uuid
  room_id     TEXT NOT NULL,
  seed        INTEGER NOT NULL,          -- uint32; with an input log this rebuilds the round (replay is out of scope)
  started_at  INTEGER NOT NULL,          -- epoch ms
  ended_at    INTEGER NOT NULL,          -- epoch ms
  end_reason  TEXT NOT NULL,             -- 'last_alive' | 'all_dead' | 'time_up'
  winner_nick TEXT                       -- null = draw
);

CREATE TABLE match_players (
  match_id     TEXT NOT NULL REFERENCES matches(id),
  nickname     TEXT NOT NULL,
  kills        INTEGER NOT NULL,
  deaths       INTEGER NOT NULL,
  self_kills   INTEGER NOT NULL,
  curse_kills  INTEGER NOT NULL,
  transfers    INTEGER NOT NULL,
  troll_points INTEGER NOT NULL,
  is_winner    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, nickname)
);
