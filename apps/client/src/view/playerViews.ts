import type { PlayerId } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';
import { TILE_SIZE } from './layout';

export interface PlayerView {
  id: PlayerId;
  /** Top-left of the player's tile-sized sprite in board pixels. */
  px: number;
  py: number;
  alive: boolean;
  /** Dead, playing on as a ghost on the rim (BE-46): drawn see-through. */
  ghost: boolean;
  cursed: boolean;
  isSelf: boolean;
  tint: number;
}

/** Placeholder colours until FE-15 / FE-20 give players real colours. */
export const PLAYER_TINTS: Record<string, number> = {
  p1: 0xffffff,
  p2: 0xff8080,
  p3: 0x80ff80,
  p4: 0x80a0ff,
};

/** Snapshot → what to draw. Pure: the server decided positions and who is alive. */
export function toPlayerViews(
  players: SnapshotMessage['players'],
  selfId: PlayerId | undefined,
): PlayerView[] {
  return players.map((p) => ({
    id: p.id,
    px: p.x * TILE_SIZE,
    py: p.y * TILE_SIZE,
    alive: p.alive,
    ghost: p.ghost === true,
    cursed: p.curse > 0,
    isSelf: p.id === selfId,
    tint: PLAYER_TINTS[p.id] ?? 0xffffff,
  }));
}
