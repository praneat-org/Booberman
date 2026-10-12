/**
 * Shared contract between apps/client and apps/worker.
 * Must stay runtime-agnostic: no Phaser, DOM or Workers APIs here
 * (enforced by tsconfig `lib`/`types` and test/imports.test.ts).
 */
export * from './board';
export * from './fixtures';
export * from './health';
export * from './messages';
export * from './parse';
export * from './rooms';
export * from './version';
