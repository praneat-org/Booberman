import { PROTOCOL_VERSION } from '@booberman/protocol';
import Phaser from 'phaser';
import { appTitle } from '../title';
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX } from '../view/layout';
import { SceneKey } from './keys';

/** Placeholder — the real lobby (nickname, rooms) is CAR-3792. */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Lobby);
  }

  create(): void {
    const cx = CANVAS_WIDTH_PX / 2;
    const cy = CANVAS_HEIGHT_PX / 2;
    const style = { fontFamily: 'monospace', color: '#ffffff' };
    this.add
      .text(cx, cy - 16, appTitle(PROTOCOL_VERSION), { ...style, fontSize: '12px' })
      .setOrigin(0.5);
    const hint = this.add
      .text(cx, cy + 12, 'tap / press any key', { ...style, fontSize: '8px' })
      .setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      this.scene.start(SceneKey.Game);
    };
    this.input.once(Phaser.Input.Events.POINTER_DOWN, start);
    this.input.keyboard?.once('keydown', start);
  }
}
