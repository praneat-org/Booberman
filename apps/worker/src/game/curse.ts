import type { GameConfig } from './config';
import { addStats } from './stats';
import type { Dir, Item, PlayerId, PlayerSim } from './types';
import { DEPARTED } from './types';

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
  none: 'none',
};

/**
 * The direction a player really walks. The reversal happens here, on the server, when the held
 * input is read (never on the client), and is derived from the *current* curse every tick: the
 * stored `heldDir` stays what the player is pressing, so when the curse ends or is passed on a key
 * that is still held walks the normal way again without needing a new input.
 */
export function effectiveDir(p: PlayerSim): Dir {
  return p.curse > 0 ? OPPOSITE[p.heldDir] : p.heldDir;
}

/**
 * Who deserves the credit if `p` dies cursed, judged against the players still in the room:
 * a player id, `DEPARTED` when the source has left (D33: nobody), `null` when there is no curse
 * credit (not cursed, or the curse came from a box the player broke themselves) and the normal
 * flame credit applies. Works on dead players too (their curse is frozen at death).
 */
export function curseSourceOf(
  players: readonly PlayerSim[],
  p: PlayerSim,
): PlayerId | typeof DEPARTED | null {
  if (p.curse <= 0 || p.cursedBySession === null) return null;
  return players.find((q) => q.session === p.cursedBySession)?.id ?? DEPARTED;
}

const tileOf = (p: PlayerSim): string => `${Math.round(p.x)},${Math.round(p.y)}`;

/** `p` with a fresh curse of `ticks` from `source` (`null` = a box they broke themselves). */
function withCurse(
  p: PlayerSim,
  ticks: number,
  source: { id: PlayerId | typeof DEPARTED; session: number } | null,
  cooldown: number,
): PlayerSim {
  return {
    ...p,
    curse: ticks,
    cursedBy: source ? source.id : null,
    cursedBySession: source ? source.session : null,
    curseCooldown: cooldown,
  };
}

const cured = (p: PlayerSim): PlayerSim => ({
  ...p,
  curse: 0,
  cursedBy: null,
  cursedBySession: null,
  curseCooldown: 0,
});

/**
 * The curse part of a tick, after movement, flames and deaths (so the dead neither pick up nor
 * pass anything on), in this order:
 *
 * 1. age: every living player's curse and hand-back cooldown lose one tick; a curse that reaches 0
 *    is gone. A curse set at the end of tick N therefore reverses the controls for ticks
 *    N+1..N+curseTicks, and can be handed back exactly `curseTransferCooldownTicks` ticks later;
 * 2. pick up: a living, uncursed player standing on an item takes it (players in id order, so two
 *    on the same tile get it by id). A curse item curses them for `curseTicks`, credited to whoever
 *    broke the box (`null` if that was the player themselves). Any other item is used up with no
 *    effect for now (kick: CAR-3801). A cursed player walks over curse items without taking them;
 * 3. contact: a cursed player (not one who picked it up this very tick) on the same tile as living, uncursed players passes the curse to the
 *    first of them by id, skipping `cursedBy` while the hand-back cooldown runs. It lasts for what
 *    was left or `curseMinTicksAfterTransfer` if more, `cursedBy` becomes the sender, and the
 *    sender is clean and scores the transfer (`transfers` +1 and its troll points). Senders go in
 *    id order from the state before any transfer: a curse moves at most one hop per tick (no chain
 *    through three players in one tick) and two cursed players reaching the same clean player on
 *    the same tick is settled by id, the other keeps theirs.
 *
 * Contact uses the nearest tile (`Math.round`), same as bombs and flames; players walk through each
 * other (D23), so passing in a corridor also counts. Pure; items come back without the taken ones.
 */
export function stepCurses(
  players: readonly PlayerSim[],
  items: readonly Item[],
  cfg: GameConfig,
): { players: PlayerSim[]; items: Item[] } {
  // 1. age
  let next = players.map((p) => {
    if (!p.alive) return p;
    const aged = {
      ...p,
      curse: Math.max(0, p.curse - 1),
      curseCooldown: Math.max(0, p.curseCooldown - 1),
    };
    return aged.curse === 0 ? cured(aged) : aged;
  });

  // 2. pick up
  const left = [...items];
  const fresh = new Set<PlayerId>(); // picked a curse up this tick: felt for a tick before passing on
  next = next.map((p) => {
    if (!p.alive || p.curse > 0) return p;
    const at = left.findIndex((it) => `${it.x},${it.y}` === tileOf(p));
    if (at < 0) return p;
    const [item] = left.splice(at, 1) as [Item];
    if (item.kind !== 'curse') return p;
    fresh.add(p.id);
    if (item.droppedBySession === p.session) return withCurse(p, cfg.curseTicks, null, 0);
    const breaker = players.find((q) => q.session === item.droppedBySession);
    return withCurse(
      p,
      cfg.curseTicks,
      { id: breaker?.id ?? DEPARTED, session: item.droppedBySession },
      0,
    );
  });
  // 3. contact
  const before = next;
  const received = new Set<PlayerId>();
  const out = new Map<PlayerId, PlayerSim>(before.map((p) => [p.id, p]));
  for (const sender of before) {
    if (!sender.alive || sender.curse <= 0 || fresh.has(sender.id)) continue;
    const here = tileOf(sender);
    const target = before.find(
      (q) =>
        q.id !== sender.id &&
        q.alive &&
        q.curse <= 0 &&
        !received.has(q.id) &&
        tileOf(q) === here &&
        !(sender.curseCooldown > 0 && q.session === sender.cursedBySession),
    );
    if (!target) continue;
    received.add(target.id);
    out.set(
      target.id,
      withCurse(
        target,
        Math.max(sender.curse, cfg.curseMinTicksAfterTransfer),
        { id: sender.id, session: sender.session },
        cfg.curseTransferCooldownTicks,
      ),
    );
    out.set(
      sender.id,
      addStats(cured(sender), { transfers: 1, trollPoints: cfg.trollPoints.transfer }),
    );
  }
  return { players: before.map((p) => out.get(p.id) as PlayerSim), items: left };
}
