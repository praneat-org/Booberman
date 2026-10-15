import Phaser from 'phaser';
import { failedRequiredAssets } from '../view/bootAssets';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX, loadingBarFill, TILE_SIZE } from '../view/layout';
import { AssetKey, SceneKey } from './keys';

const BAR_WIDTH = 120;
const BAR_HEIGHT = 8;
const REQUIRED_ASSETS: readonly string[] = [AssetKey.Arena, AssetKey.Tiles, AssetKey.Player];

export class BootScene extends Phaser.Scene {
  private failedKeys = new Set<string>();
  private bar: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    this.failedKeys = new Set();
    const x = (BOARD_WIDTH_PX - BAR_WIDTH) / 2;
    const y = BOARD_HEIGHT_PX / 2;
    const frame = this.add.rectangle(x, y, BAR_WIDTH, BAR_HEIGHT).setOrigin(0, 0.5);
    frame.setStrokeStyle(1, 0xffffff);
    // inset 1px so the fill sits inside the border instead of overlapping it
    const fill = this.add.rectangle(x + 1, y, 0, BAR_HEIGHT - 2, 0xffffff).setOrigin(0, 0.5);

    this.bar = [frame, fill];
    const onProgress = (value: number) => {
      fill.width = loadingBarFill(value, BAR_WIDTH - 2);
    };
    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    const onFileError = (file: Phaser.Loader.File) => {
      this.failedKeys.add(file.key);
    };
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileError);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileError);
    });

    this.load.tilemapTiledJSON(AssetKey.Arena, 'maps/arena.json');
    this.load.image(AssetKey.Tiles, 'tiles/tileset.png');
    this.load.spritesheet(AssetKey.Player, 'sprites/player.png', {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });
  }

  create(): void {
    const failed = failedRequiredAssets(this.failedKeys, REQUIRED_ASSETS);
    if (failed.length === 0) {
      this.scene.start(SceneKey.Lobby);
      return;
    }
    this.showLoadError(failed);
  }

  /** Required asset missing: do not enter Lobby/Game; offer a retry (restart re-runs preload). */
  private showLoadError(failed: string[]): void {
    for (const part of this.bar) part.destroy();
    this.bar = [];
    const cx = BOARD_WIDTH_PX / 2;
    const cy = BOARD_HEIGHT_PX / 2;
    const style = { fontFamily: 'monospace', color: '#ffffff', align: 'center' };
    this.add
      .text(cx, cy - 12, `load failed: ${failed.join(', ')}`, { ...style, fontSize: '8px' })
      .setOrigin(0.5);
    this.add
      .text(cx, cy + 8, 'tap / press any key to retry', { ...style, fontSize: '8px' })
      .setOrigin(0.5);

    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      this.scene.restart();
    };
    this.input.once(Phaser.Input.Events.POINTER_DOWN, retry);
    this.input.keyboard?.once('keydown', retry);
  }
}
