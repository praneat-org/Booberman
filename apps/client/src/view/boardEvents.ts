import type { GameEvent } from '@booberman/protocol';
import type { WelcomeMessage } from '../net/Transport';
import { toEndView } from './endView';
import type { RoundView } from './roundView';

/**
 * Applies the server messages that replace or edit the board. A new board (welcome / roundStart)
 * resets all per-round view state through `RoundView.reset` (snapshot, animations, boxes), otherwise
 * the old round keeps being drawn until the next snapshot. The scene also destroys its sprites.
 *
 * `welcome` also starts the roster over (`RoundView.resetSession`) and then puts our own name in it:
 * the server announces us to the others with `playerJoined` but never to ourselves, and `welcome`
 * has no nickname, so the name we joined with (`selfNickname`) is the only source (FE-29). The joins
 * of the players already in the room arrive after `welcome`.
 */
export function applyWelcome(
  msg: Pick<WelcomeMessage, 'grid' | 'playerId'>,
  round: RoundView,
  selfNickname: string,
): void {
  round.resetSession(msg.grid);
  round.selfId = msg.playerId;
  round.roster.join(msg.playerId, selfNickname);
}

/**
 * Returns true when the board was replaced (roundStart), so the scene can drop its sprites.
 * `now`: local clock (ms) for the kill feed's lines to age by; same clock the scene reads them with.
 */
export function applyBoardEvent(
  msg: GameEvent,
  round: RoundView,
  now: number = performance.now(),
): boolean {
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
  if (msg.kind === 'roundEnd') {
    round.sfx.roundEnded(msg.winner, round.buffer.latestTick);
    // the server's table as sent (D35): rows already sorted, titles already decided
    round.end = toEndView(msg, round.roster, round.selfId);
    round.rematch = undefined;
    return false;
  }
  if (msg.kind === 'kill') {
    round.killFeed.push(msg, round.roster, now);
    return false;
  }
  if (msg.kind === 'rematchStatus') {
    round.rematch = { ready: msg.ready, deadline: msg.deadline };
    return false;
  }
  return false;
}
