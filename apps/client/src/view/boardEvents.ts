import type { GameEvent } from '@booberman/protocol';
import type { WelcomeMessage } from '../net/Transport';
import type { RoundView } from './roundView';

/**
 * Applies the server messages that replace or edit the board. A new board (welcome / roundStart)
 * resets all per-round view state through `RoundView.reset` (snapshot, animations, boxes), otherwise
 * the old round keeps being drawn until the next snapshot. The scene also destroys its sprites.
 */
export function applyWelcome(msg: Pick<WelcomeMessage, 'grid'>, round: RoundView): void {
  round.resetSession(msg.grid);
}

/** Returns true when the board was replaced (roundStart), so the scene can drop its sprites. */
export function applyBoardEvent(msg: GameEvent, round: RoundView): boolean {
  if (msg.kind === 'boxDestroyed') {
    round.boxes.destroy(msg.x, msg.y);
    return false;
  }
  if (msg.kind === 'playerJoined') {
    round.roster.join(msg.playerId, msg.nickname);
    return false;
  }
  if (msg.kind === 'playerLeft') {
    round.roster.leave(msg.playerId);
    return false;
  }
  if (msg.kind === 'roundStart') {
    round.reset(msg.grid);
    return true;
  }
  return false;
}
