import { type ClientMessage, PROTOCOL_VERSION } from '@booberman/protocol';

type Dir = 'up' | 'down' | 'left' | 'right' | 'none';

/** Builds the input message. Sends our locally simulated position so the server can skip its own physics. */
export function buildInput(
  seq: number,
  dir: Dir,
  bomb: boolean,
  local: { x: number; y: number; alive: boolean },
): ClientMessage {
  return {
    v: PROTOCOL_VERSION,
    t: 'input',
    seq,
    dir,
    bomb,
    x: local.x,
    y: local.y,
    alive: local.alive,
  };
}
