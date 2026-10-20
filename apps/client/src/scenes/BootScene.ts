import Phaser from 'phaser';
import { AUDIO_FILES } from '../audio/sfx';
import { failedRequiredAssets } from '../view/bootAssets';
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, loadingBarFill, TILE_SIZE } from '../view/layout';
import { FACINGS, WALK_FRAMES, walkAnimKey } from '../view/playerAnim';
import { AssetKey, SceneKey } from './keys';

const BAR_WIDTH = 120;
const BAR_HEIGHT = 8;
const REQUIRED_ASSETS: readonly string[] = [
  AssetKey.Arena,
  AssetKey.Tiles,
  AssetKey.Player,
  AssetKey.Box,
  AssetKey.Bomb,
  AssetKey.Flame,
  AssetKey.Items,
  AssetKey.Marker,
];

export class BootScene extends Phaser.Scene {
  private failedKeys = new Set<string>();
  private bar: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    this.failedKeys = new Set();
    const x = (CANVAS_WIDTH_PX - BAR_WIDTH) / 2;
    const y = CANVAS_HEIGHT_PX / 2;
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
    this.load.image(AssetKey.Box, 'sprites/box.png');
    for (const key of [AssetKey.Bomb, AssetKey.Flame, AssetKey.Items]) {
      this.load.spritesheet(key, `sprites/${key}.png`, {
        frameWidth: TILE_SIZE,
        frameHeight: TILE_SIZE,
      });
    }
    this.load.image(AssetKey.Marker, 'sprites/marker.png');
    // sound is optional: a file that fails to load only means that sound stays silent (see create)
    for (const file of AUDIO_FILES) this.load.audio(file.key, file.urls);
  }

  create(): void {
    const silent = AUDIO_FILES.filter((f) => this.failedKeys.has(f.key)).map((f) => f.key);
    if (silent.length > 0)
      console.warn('[audio] failed to load, these sounds stay silent:', silent);
    const failed = failedRequiredAssets(this.failedKeys, REQUIRED_ASSETS);
    if (failed.length === 0) {
      // only after every required sheet loaded: an anim made from a failed sheet has no frames and `exists` would block a later retry
      this.createAnimations();
      this.scene.start(SceneKey.Lobby);
      return;
    }
    this.showLoadError(failed);
  }

  /** Walk cycles live in the player sheet (see `WALK_FRAMES`); created once, shared by every scene. */
  private createAnimations(): void {
    for (const facing of FACINGS) {
      const key = walkAnimKey(facing);
      if (this.anims.exists(key)) continue;
      const [start, end] = WALK_FRAMES[facing];
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(AssetKey.Player, { start, end }),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  /** Required asset missing: do not enter Lobby/Game; offer a retry (restart re-runs preload). */
  private showLoadError(failed: string[]): void {
    for (const part of this.bar) part.destroy();
    this.bar = [];
    const cx = CANVAS_WIDTH_PX / 2;
    const cy = CANVAS_HEIGHT_PX / 2;
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
