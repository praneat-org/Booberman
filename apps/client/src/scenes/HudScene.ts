import type { PlayerId } from '@booberman/protocol';
import Phaser from 'phaser';
import { Hud } from '../ui/Hud';
import { toHudView } from '../view/hudView';
import { CANVAS_WIDTH_PX, HUD_HEIGHT_PX } from '../view/layout';
import type { RoundView } from '../view/roundView';
import { SceneKey } from './keys';

export interface HudSource {
  round: RoundView;
  selfId: () => PlayerId | undefined;
}

/**
 * HUD above the board, in its own scene so the game camera never moves it. Holds no game state:
 * every frame it reads the round view (latest snapshot + roster) that `GameScene` owns.
 */
export class HudScene extends Phaser.Scene {
  private hud: Hud | undefined;
  private source: HudSource | undefined;

  constructor() {
    super(SceneKey.Hud);
  }

  init(data: HudSource): void {
    this.source = data;
  }

  create(): void {
    this.cameras.main.setViewport(0, 0, CANVAS_WIDTH_PX, HUD_HEIGHT_PX);
    this.hud = new Hud(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hud = undefined;
      this.source = undefined;
    });
  }

  override update(): void {
    if (!this.hud || !this.source) return;
    const { round, selfId } = this.source;
    this.hud.update(toHudView(round.latest, round.roster, selfId()));
  }
}
