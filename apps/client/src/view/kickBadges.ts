import { TILE_SIZE } from './layout';
import type { Drawable } from './roundView';

/** The skate badge is half a tile, at the player's bottom-right corner. */
export const KICK_BADGE_SCALE = 0.5;
/** Green tint, the colour of the kick item. */
export const KICK_BADGE_TINT = 0x7cfc7c;

export interface KickBadgeView {
  key: string;
  /** Centre of the badge in board pixels. */
  cx: number;
  cy: number;
}

/**
 * One green skate per living player who has the kick item (the sprite sheet has one fixed set of
 * walk frames, so "the shoe changes colour" is drawn as a coloured skate on the player). Not shown
 * while the death animation runs. `kick` itself is the server's.
 */
export function toKickBadges(players: Drawable['players']): KickBadgeView[] {
  const out: KickBadgeView[] = [];
  for (const { view, anim } of players) {
    if (!view.kick || !view.alive || anim.phase === 'dying') continue;
    out.push({
      key: view.id,
      cx: view.px + TILE_SIZE * 0.8,
      cy: view.py + TILE_SIZE * 0.8,
    });
  }
  return out;
}
