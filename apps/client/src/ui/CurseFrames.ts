import type Phaser from 'phaser';
import type { CurseFrameView } from '../view/curseFrames';

export const CURSE_COLOR = 0xb03cff;

/** Purple frames around cursed players: one rectangle per player id, created / moved / destroyed from the views. */
export class CurseFrames {
  private frames = new Map<string, Phaser.GameObjects.Rectangle>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly size: number,
  ) {}

  sync(views: readonly CurseFrameView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.key);
      let frame = this.frames.get(v.key);
      if (!frame) {
        frame = this.scene.add
          .rectangle(0, 0, this.size - 1, this.size - 1)
          .setOrigin(0, 0)
          .setStrokeStyle(1, CURSE_COLOR)
          .setDepth(this.depth);
        this.frames.set(v.key, frame);
      }
      frame.setPosition(v.px + 0.5, v.py + 0.5).setVisible(v.visible);
    }
    for (const [key, frame] of this.frames) {
      if (seen.has(key)) continue;
      frame.destroy();
      this.frames.delete(key);
    }
  }

  clear(): void {
    for (const frame of this.frames.values()) frame.destroy();
    this.frames.clear();
  }
}
