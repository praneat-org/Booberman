import type { GameEvent } from '@booberman/protocol';
import type { WelcomeMessage } from '../net/Transport';
import type { BoxField } from './boardView';
import type { PlayerAnimTracker } from './playerAnim';

/**
 * Applies the server messages that replace or edit the board. A new board (welcome / roundStart)
 * also clears the animation tracker, otherwise the first snapshot of the new round is compared with
 * the old positions (e.g. a corpse) and plays a one-tick walk from the spawn.
 */
export function applyWelcome(
  msg: Pick<WelcomeMessage, 'grid'>,
  boxes: BoxField,
  anims: PlayerAnimTracker,
): void {
  boxes.reset(msg.grid);
  anims.reset();
}

export function applyBoardEvent(msg: GameEvent, boxes: BoxField, anims: PlayerAnimTracker): void {
  if (msg.kind === 'boxDestroyed') {
    boxes.destroy(msg.x, msg.y);
  } else if (msg.kind === 'roundStart') {
    boxes.reset(msg.grid);
    anims.reset();
  }
}
