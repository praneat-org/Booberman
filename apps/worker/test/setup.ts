import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before every test file (vitest `setupFiles`); applyD1Migrations skips what is already applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
