import type { PlayerId } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';
import { BoxField } from './boardView';
import { toBombViews, toFlameViews, toItemViews } from './entityViews';
import { type PlayerAnim, PlayerAnimTracker } from './playerAnim';
import { type PlayerView, toPlayerViews } from './playerViews';

export interface Drawable {
  bombs: ReturnType<typeof toBombViews>;
  flames: ReturnType<typeof toFlameViews>;
  items: ReturnType<typeof toItemViews>;
  players: { view: PlayerView; anim: PlayerAnim }[];
}

const EMPTY: Drawable = { bombs: [], flames: [], items: [], players: [] };

/**
 * Every piece of per-round view state that is not a Phaser object, in one place. `reset` is the
 * only way a new round (welcome / roundStart) starts, so a field added here cannot be forgotten.
 * The scene draws only what `drawable()` returns, and destroys its sprites on reset.
 */
export class RoundView {
  readonly boxes = new BoxField();
  readonly animTracker = new PlayerAnimTracker();
  latest: SnapshotMessage | undefined;
  playerAnims: Map<string, PlayerAnim> = new Map();

  reset(grid?: string): void {
    if (grid !== undefined) this.boxes.reset(grid);
    this.animTracker.reset();
    this.latest = undefined;
    this.playerAnims = new Map();
  }

  applySnapshot(msg: SnapshotMessage): void {
    this.latest = msg;
    this.playerAnims = this.animTracker.update(msg.players, msg.tick);
  }

  /** What may be on screen right now: nothing until the first snapshot of the current round. */
  drawable(selfId: PlayerId | undefined): Drawable {
    const s = this.latest;
    if (!s) return EMPTY;
    const players: Drawable['players'] = [];
    for (const view of toPlayerViews(s.players, selfId)) {
      const anim = this.playerAnims.get(view.id);
      if (anim && anim.phase !== 'gone') players.push({ view, anim });
    }
    return {
      bombs: toBombViews(s.bombs),
      flames: toFlameViews(s.flames, s.tick),
      items: toItemViews(s.items),
      players,
    };
  }
}
