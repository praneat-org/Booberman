import type { PlayerState } from '@booberman/protocol';

export type Facing = 'down' | 'up' | 'left' | 'right';

/** Cosmetic only: how long the death animation plays, in server ticks (0.4 s). */
export const DEATH_TICKS = 8;

export interface PlayerAnim {
  facing: Facing;
  moving: boolean;
  /** 'alive' → draw normally · 'dying' with progress 0..1 → shrink / spin · 'gone' → draw nothing. */
  phase: 'alive' | 'dying' | 'gone';
  progress: number;
}

interface Track {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  diedAt?: number;
}

/**
 * Works out which sprite animation to show from successive snapshots (position change → walking
 * direction, `alive` flipping to false → death animation). It only picks art; the server alone
 * decides where players are and who died.
 */
export class PlayerAnimTracker {
  private readonly tracks = new Map<string, Track>();

  update(players: readonly PlayerState[], tick: number): Map<string, PlayerAnim> {
    const out = new Map<string, PlayerAnim>();
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let t = this.tracks.get(p.id);
      if (!t) {
        t = { x: p.x, y: p.y, facing: 'down', moving: false };
        // First sight of a corpse (joined late / new tab): don't replay the death.
        if (!p.alive) t.diedAt = tick - DEATH_TICKS;
        this.tracks.set(p.id, t);
      }
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      t.moving = !p.teleport && (dx !== 0 || dy !== 0);
      if (t.moving) t.facing = facingOf(dx, dy, t.facing);
      t.x = p.x;
      t.y = p.y;

      if (p.alive) {
        t.diedAt = undefined;
      } else if (t.diedAt === undefined) {
        t.diedAt = tick;
      }

      let phase: PlayerAnim['phase'] = 'alive';
      let progress = 0;
      if (t.diedAt !== undefined) {
        progress = Math.min(1, Math.max(0, (tick - t.diedAt) / DEATH_TICKS));
        phase = progress >= 1 ? 'gone' : 'dying';
      }
      out.set(p.id, { facing: t.facing, moving: t.moving && phase === 'alive', phase, progress });
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);
    return out;
  }

  reset(): void {
    this.tracks.clear();
  }
}

function facingOf(dx: number, dy: number, previous: Facing): Facing {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return previous;
}
