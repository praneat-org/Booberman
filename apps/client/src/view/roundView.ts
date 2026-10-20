import type { PlayerId } from '@booberman/protocol';
import type { SfxName } from '../audio/sfx';
import { SfxTracker } from '../audio/sfxTracker';
import type { SnapshotMessage } from '../net/Transport';
import { BoxField } from './boardView';
import { toBombViews, toFlameViews, toItemViews } from './entityViews';
import { Roster } from './hudView';
import { type PlayerAnim, PlayerAnimTracker } from './playerAnim';
import { type PlayerView, toPlayerViews } from './playerViews';
import { DEFAULT_INTERPOLATION_DELAY_MS, SnapshotBuffer } from './snapshotBuffer';

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
  readonly buffer: SnapshotBuffer;
  /** Which sounds the drawn snapshots call for (FE-18); compares each drawn snapshot with the one before. */
  readonly sfx = new SfxTracker();
  /** Nicknames for the HUD. Per connection, not per round: only `resetSession` clears it. */
  readonly roster = new Roster();
  /** What is being drawn: the buffered snapshot at the render time, players interpolated. */
  latest: SnapshotMessage | undefined;
  playerAnims: Map<string, PlayerAnim> = new Map();
  renderTick: number | undefined;

  constructor(delayMs: number = DEFAULT_INTERPOLATION_DELAY_MS) {
    this.buffer = new SnapshotBuffer({ delayMs });
  }

  reset(grid?: string): void {
    if (grid !== undefined) this.boxes.reset(grid);
    this.animTracker.reset();
    this.sfx.reset();
    this.buffer.reset();
    this.latest = undefined;
    this.renderTick = undefined;
    this.playerAnims = new Map();
  }

  /** `welcome`: a new connection, so the roster starts empty too (joins are replayed after it). */
  resetSession(grid?: string): void {
    this.roster.clear();
    this.reset(grid);
  }

  /** `recvAt`: local clock (ms) when the snapshot arrived; same clock as `frame`. */
  applySnapshot(msg: SnapshotMessage, recvAt: number): void {
    this.buffer.push(msg, recvAt);
  }

  /**
   * Once per rendered frame: move `latest` to the render time (nothing before the first snapshot).
   * Returns the sounds that the newly drawn snapshot calls for (usually none).
   */
  frame(now: number): SfxName[] {
    const sample = this.buffer.sample(now);
    if (!sample) return [];
    this.latest = { ...sample.base, players: sample.players };
    this.renderTick = sample.renderTick;
    this.playerAnims = this.animTracker.update(sample.players, sample.renderTick);
    return this.sfx.observe(this.latest);
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
