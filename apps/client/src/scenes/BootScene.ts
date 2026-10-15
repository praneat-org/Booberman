import Phaser from 'phaser';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX, loadingBarFill, TILE_SIZE } from '../view/layout';
import { AssetKey, SceneKey } from './keys';

const BAR_WIDTH = 120;
const BAR_HEIGHT = 8;

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    const x = (BOARD_WIDTH_PX - BAR_WIDTH) / 2;
    const y = BOARD_HEIGHT_PX / 2;
    const frame = this.add.rectangle(x, y, BAR_WIDTH, BAR_HEIGHT).setOrigin(0, 0.5);
    frame.setStrokeStyle(1, 0xffffff);
    const fill = this.add.rectangle(x, y, 0, BAR_HEIGHT - 2, 0xffffff).setOrigin(0, 0.5);

    const onProgress = (value: number) => {
      fill.width = loadingBarFill(value, BAR_WIDTH);
    };
    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
    });

    this.load.tilemapTiledJSON(AssetKey.Arena, 'maps/arena.json');
    this.load.image(AssetKey.Tiles, 'tiles/tileset.png');
    this.load.spritesheet(AssetKey.Player, 'sprites/player.png', {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });
  }

  create(): void {
    this.scene.start(SceneKey.Lobby);
  }
}
