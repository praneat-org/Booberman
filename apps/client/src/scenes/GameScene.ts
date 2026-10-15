import Phaser from 'phaser';
import { AssetKey, SceneKey } from './keys';

/** Draws the arena tilemap. Boxes, bombs, players come from server snapshots (FE-12 / FE-15). */
export class GameScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Game);
  }

  create(): void {
    const map = this.make.tilemap({ key: AssetKey.Arena });
    const tiles = map.addTilesetImage('tileset', AssetKey.Tiles);
    if (!tiles) throw new Error('tileset "tileset" missing from arena.json');
    map.createLayer('ground', tiles, 0, 0);

    if (import.meta.env.DEV) {
      (window as unknown as { __booberman?: unknown }).__booberman = { scene: this };
    }
  }
}
