/** Bump on any breaking change to a message shape. Every message carries it as `v`. */
export const PROTOCOL_VERSION = 1;

export const MAX_PLAYERS_PER_ROOM = 4;

export function isSupportedProtocol(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
