/**
 * Shared contract between apps/client and apps/worker.
 * Must stay runtime-agnostic: no Phaser, DOM or Workers APIs here
 * (enforced by tsconfig `lib`/`types` and test/imports.test.ts).
 * Game message schemas arrive in Protocol v1 (BE-23).
 */

/** Bump on any breaking change to a message shape. */
export const PROTOCOL_VERSION = 0;

export const MAX_PLAYERS_PER_ROOM = 4;

export function isSupportedProtocol(version: number): boolean {
  return version === PROTOCOL_VERSION;
}

export * from './health';
