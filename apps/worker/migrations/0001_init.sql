-- 0001_init: intentionally empty (BE-26). Lets `wrangler d1 migrations apply` run end to end;
-- BE-42 adds the real tables in 0002_*.sql. Never edit an applied migration, add a new file.
SELECT 1;
