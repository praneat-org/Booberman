import type { ErrorCode } from '@booberman/protocol';

/** Application close codes the RoomDO uses (D17 / D21 / BE-44). 4000-4999 is free for applications. */
export const CLOSE_ROOM_FULL = 4001;
export const CLOSE_INVALID_NICKNAME = 4002;
export const CLOSE_INVALID_TOKEN = 4003;
/** Another socket took our slot over with our token (a second tab, or a retry racing a half-open socket). */
export const CLOSE_REPLACED = 4004;

/** The `ErrorCode` a close code stands for, or `undefined` for ordinary closes (1000, 1006, …). */
export function errorCodeForClose(code: number): ErrorCode | undefined {
  if (code === CLOSE_ROOM_FULL) return 'ROOM_FULL';
  if (code === CLOSE_INVALID_NICKNAME) return 'INVALID_NICKNAME';
  if (code === CLOSE_INVALID_TOKEN) return 'INVALID_TOKEN';
  return undefined;
}
