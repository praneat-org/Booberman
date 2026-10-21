declare namespace Cloudflare {
  interface Env {
    /** The real migrations/ files, read by vitest.config.ts and applied by test/setup.ts. */
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
