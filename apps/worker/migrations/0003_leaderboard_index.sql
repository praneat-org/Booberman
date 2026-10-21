-- 0003_leaderboard_index (BE-47 / CAR-3803): GET /api/leaderboard sums kills / troll_points / is_winner
-- GROUP BY nickname. This covering index lets D1 do that as one ordered index scan (no table lookups,
-- no temp b-tree for the GROUP BY). Never edit an applied migration, add a new file.
CREATE INDEX idx_match_players_leaderboard
  ON match_players (nickname, is_winner, kills, troll_points);
