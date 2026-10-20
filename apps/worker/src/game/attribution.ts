import type { KillCause, PlayerId } from '@booberman/protocol';
import type { GameConfig } from './config';
import { curseSourceOf } from './curse';
import { addStats } from './stats';
import type { PlayerSim } from './types';
import { DEPARTED } from './types';

/** The verdict for one death: who gets the credit and why. */
export interface Kill {
  readonly victim: PlayerId;
  /** The credited player (the victim themselves for `self`); `null` = a player who has left (D33). */
  readonly killer: PlayerId | null;
  readonly cause: KillCause;
}

/**
 * What lit the flame that killed someone: whose it is (`DEPARTED` when they have left, D33) and
 * what kind of bomb it was. Only plain bombs exist now. BE-45 (kicked bomb, owner = the kicker) and
 * BE-46 (a ghost's bomb, owner = the ghost) pass their own `kind` here; the table below already
 * knows what to do with them.
 */
export interface FlameOrigin {
  readonly owner: PlayerId | typeof DEPARTED;
  readonly kind: 'bomb' | 'kick' | 'ghost';
}

const verdict = (
  victim: PlayerId,
  credited: PlayerId | typeof DEPARTED,
  cause: Exclude<KillCause, 'self'>,
): Kill => {
  if (credited === DEPARTED) return { victim, killer: null, cause };
  // the credit fell on the victim themselves: a self-kill, whatever the bomb was
  if (credited === victim) return { victim, killer: victim, cause: 'self' };
  return { victim, killer: credited, cause };
};

/**
 * Who gets the credit for `victim` dying in `origin`'s flame: the credit table of CAR-3798, checked
 * in order, the first row that matches wins.
 *
 * 1. the victim carries a curse from somebody else -> that somebody (`curse`), even when the fire
 *    is the victim's own bomb (A curses B, B walks back into B's bomb: A gets it, not a self-kill);
 * 2. a ghost's bomb -> the ghost (`ghost`);
 * 3. a kicked bomb -> the one who kicked it (`kick`);
 * 4. a normal bomb -> its owner (`bomb`).
 *
 * Whenever the player who would get the credit turns out to be the victim it is a `self`-kill, and
 * when that player has left the room (D33, also a curse sender who left) nobody gets it
 * (`killer: null`) but the victim still dies. `players` = everyone in the room at the moment of
 * death, so a sender is looked up by join session (a new player in the same slot is not them).
 */
export function attributeKill(
  players: readonly PlayerSim[],
  victim: PlayerSim,
  origin: FlameOrigin,
): Kill {
  const sender = curseSourceOf(players, victim);
  if (sender !== null) return verdict(victim.id, sender, 'curse');
  return verdict(victim.id, origin.owner, origin.kind);
}

/**
 * Books the verdicts into the players' counters: every victim `deaths` +1; the credited player
 * gets the troll points of the cause plus `selfKills` (self) or `kills` and the counter of that
 * cause. Nobody is booked for `killer: null`.
 */
export function scoreKills(
  players: readonly PlayerSim[],
  kills: readonly Kill[],
  cfg: GameConfig,
): PlayerSim[] {
  let next = [...players];
  const update = (id: PlayerId, delta: Parameters<typeof addStats>[1]) => {
    next = next.map((p) => (p.id === id ? addStats(p, delta) : p));
  };
  for (const k of kills) {
    update(k.victim, { deaths: 1 });
    if (k.killer === null) continue;
    const trollPoints = cfg.trollPoints[k.cause];
    if (k.cause === 'self') update(k.killer, { selfKills: 1, trollPoints });
    else
      update(k.killer, {
        kills: 1,
        trollPoints,
        curseKills: k.cause === 'curse' ? 1 : 0,
        kickKills: k.cause === 'kick' ? 1 : 0,
        ghostKills: k.cause === 'ghost' ? 1 : 0,
      });
  }
  return next;
}
