import Phaser from 'phaser';
import { GameAsset } from '../assets/gameAssets';
import {
  createResolver,
  localResolver,
  normalizeBaseUrl,
  parseManifestText,
  type ResolveAsset,
} from '../assets/manifest';
import { AUDIO_FILES } from '../audio/sfx';
import { bootFailures } from '../view/bootAssets';
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX, loadingBarFill, TILE_SIZE } from '../view/layout';
import { FACINGS, WALK_FRAMES, walkAnimKey } from '../view/playerAnim';
import { AssetKey, SceneKey } from './keys';

const BAR_WIDTH = 120;
const BAR_HEIGHT = 8;
const REQUIRED_ASSETS: readonly string[] = [AssetKey.Arena, AssetKey.Sheet];
/**
 * Loader cache key of manifest.json; it is fetched (from this origin, never cached) only when a bucket base URL is configured.
 * Loaded as text and parsed by `parseManifestText`: with an SPA fallback a missing file is `index.html` with status 200, and
 * the Phaser JSON loader would throw from its XHR handler without reporting a failed file.
 */
const MANIFEST_KEY = 'asset-manifest';

export class BootScene extends Phaser.Scene {
  private failedKeys = new Set<string>();
  /** Why the boot cannot continue although no file failed (bad manifest / base URL / unknown asset name). */
  private bootError: string | null = null;
  /** True when assets come from a bucket (manifest.json is needed) / once that manifest was parsed. */
  private usesManifest = false;
  private manifestReady = false;
  private bar: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    this.failedKeys = new Set();
    this.bootError = null;
    this.usesManifest = false;
    this.manifestReady = false;
    const x = (CANVAS_WIDTH_PX - BAR_WIDTH) / 2;
    const y = CANVAS_HEIGHT_PX / 2;
    const frame = this.add.rectangle(x, y, BAR_WIDTH, BAR_HEIGHT).setOrigin(0, 0.5);
    frame.setStrokeStyle(1, 0xffffff);
    // inset 1px so the fill sits inside the border instead of overlapping it
    const fill = this.add.rectangle(x + 1, y, 0, BAR_HEIGHT - 2, 0xffffff).setOrigin(0, 0.5);

    this.bar = [frame, fill];
    // files are queued after manifest.json arrives, which can move the loader's progress back: never shrink the bar
    let shown = 0;
    const onProgress = (value: number) => {
      shown = Math.max(shown, value);
      fill.width = loadingBarFill(shown, BAR_WIDTH - 2);
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

    this.queueAssets();
  }

  /**
   * With a bucket base URL (build env) the files are loaded from the bucket under the hashed names
   * from manifest.json; without one (dev, `?mock=1`) by their plain names from this origin.
   */
  private queueAssets(): void {
    let baseUrl: string | null;
    try {
      baseUrl = normalizeBaseUrl(import.meta.env.VITE_ASSETS_BASE_URL);
    } catch (error) {
      this.bootError = errorMessage(error);
      return;
    }
    if (baseUrl === null) {
      this.queueGameFiles(localResolver);
      return;
    }
    const bucket = baseUrl;
    this.usesManifest = true;
    // a manifest from an earlier attempt would make the loader skip the file (cache key conflict) and never call us
    this.cache.text.remove(MANIFEST_KEY);
    this.load.text(MANIFEST_KEY, 'manifest.json');
    const event = `${Phaser.Loader.Events.FILE_KEY_COMPLETE}text-${MANIFEST_KEY}`;
    const onManifest = () => {
      try {
        const manifest = parseManifestText(this.cache.text.get(MANIFEST_KEY));
        this.queueGameFiles(createResolver(manifest, bucket));
        this.manifestReady = true;
      } catch (error) {
        this.bootError = errorMessage(error);
      }
    };
    this.load.once(event, onManifest);
    // if manifest.json fails to load the listener would stay and fire twice after a retry
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.load.off(event, onManifest));
  }

  private queueGameFiles(resolve: ResolveAsset): void {
    // resolve everything first: an unknown name must not leave half of the files queued
    const arena = resolve(GameAsset.Arena);
    const sheet = resolve(GameAsset.Sheet);
    const audio = AUDIO_FILES.map((file) => ({ key: file.key, urls: file.urls.map(resolve) }));

    this.load.tilemapTiledJSON(AssetKey.Arena, arena);
    this.load.spritesheet(AssetKey.Sheet, sheet, {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });
    // sound is optional: a file that fails to load only means that sound stays silent (see create)
    for (const file of audio) this.load.audio(file.key, file.urls);
  }

  create(): void {
    const silent = AUDIO_FILES.filter((f) => this.failedKeys.has(f.key)).map((f) => f.key);
    if (silent.length > 0)
      console.warn('[audio] failed to load, these sounds stay silent:', silent);
    const failed = bootFailures({
      bootError: this.bootError,
      usesManifest: this.usesManifest,
      manifestReady: this.manifestReady,
      failedKeys: this.failedKeys,
      required: REQUIRED_ASSETS,
    });
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
        frames: this.anims.generateFrameNumbers(AssetKey.Sheet, { start, end }),
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
      .text(cx, cy - 12, `load failed: ${failed.join(', ')}`, {
        ...style,
        fontSize: '8px',
        wordWrap: { width: CANVAS_WIDTH_PX - 8 },
      })
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

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[boot]', message);
  return message;
}
