import type { PlayerId } from '@booberman/protocol';
import Phaser from 'phaser';
import { createTransport } from '../net/createTransport';
import type { SnapshotMessage, Unsubscribe } from '../net/Transport';
import { applyBoardEvent, applyWelcome } from '../view/boardEvents';
import { BoxField } from '../view/boardView';
import { DirectionTracker, type HeldDir, InputSender } from '../view/directionInput';
import { toBombViews, toFlameViews, toItemViews } from '../view/entityViews';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX, TILE_SIZE } from '../view/layout';
import { IDLE_FRAME, type PlayerAnim, PlayerAnimTracker, walkAnimKey } from '../view/playerAnim';
import { toPlayerViews } from '../view/playerViews';
import { AssetKey, SceneKey } from './keys';

/** Draw order, back to front. */
const Depth = { Box: 1, Item: 2, Bomb: 3, Flame: 4, Player: 10, Marker: 11 } as const;
const MARKER_OFFSET = { x: (TILE_SIZE - 8) / 2, y: -7 };

type Sprite = Phaser.GameObjects.Sprite;

/**
 * Draws the arena from what the server says: walls from the tilemap, boxes from `grid` +
 * `boxDestroyed`, players / bombs / flames / items from the latest snapshot. Nothing here decides
 * a death, a pickup or a win.
 */
export class GameScene extends Phaser.Scene {
  private selfId: PlayerId | undefined;
  private latest: SnapshotMessage | undefined;
  private playerAnims: Map<string, PlayerAnim> = new Map();
  private readonly animTracker = new PlayerAnimTracker();
  private boxes = new BoxField();
  private players = new Map<string, Sprite>();
  private boxSprites = new Map<string, Sprite>();
  private bombSprites = new Map<string, Sprite>();
  private flameSprites = new Map<string, Sprite>();
  private itemSprites = new Map<string, Sprite>();
  private marker: Phaser.GameObjects.Image | undefined;
  private tracker = new DirectionTracker();
  private sender: InputSender | undefined;
  private bombPressed = false;

  constructor() {
    super(SceneKey.Game);
  }

  create(): void {
    const map = this.make.tilemap({ key: AssetKey.Arena });
    const tiles = map.addTilesetImage('tileset', AssetKey.Tiles);
    if (!tiles) throw new Error('tileset "tileset" missing from arena.json');
    map.createLayer('ground', tiles, 0, 0);

    this.players = new Map();
    this.boxSprites = new Map();
    this.bombSprites = new Map();
    this.flameSprites = new Map();
    this.itemSprites = new Map();
    this.boxes = new BoxField();
    this.animTracker.reset();
    this.playerAnims = new Map();
    this.tracker = new DirectionTracker();
    this.latest = undefined;
    this.selfId = undefined;
    this.bombPressed = false;
    this.marker = this.add
      .image(0, 0, AssetKey.Marker)
      .setOrigin(0, 0)
      .setDepth(Depth.Marker)
      .setVisible(false);

    const transport = createTransport(window.location.search);
    if (!transport) {
      this.add
        .text(
          BOARD_WIDTH_PX / 2,
          BOARD_HEIGHT_PX / 2,
          'no server transport yet (FE-13)\nopen with ?mock=1',
          {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#ffffff',
            align: 'center',
          },
        )
        .setOrigin(0.5);
      return;
    }

    const cleanups: Unsubscribe[] = [
      transport.onWelcome((msg) => {
        this.selfId = msg.playerId;
        applyWelcome(msg, this.boxes, this.animTracker);
      }),
      transport.onSnapshot((msg) => {
        this.latest = msg;
        this.playerAnims = this.animTracker.update(msg.players, msg.tick);
      }),
      transport.onEvent((msg) => {
        applyBoardEvent(msg, this.boxes, this.animTracker);
      }),
      transport.onError((code, message) => console.warn('[transport] error', code, message)),
    ];
    this.sender = new InputSender((input) => transport.send(input));
    cleanups.push(...this.bindKeyboard());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of cleanups) off();
      transport.disconnect();
      this.sender = undefined;
    });
    transport.connect();

    if (import.meta.env.DEV) {
      (window as unknown as { __booberman?: unknown }).__booberman = {
        scene: this,
        transport,
        snapshot: () => this.latest,
        selfId: () => this.selfId,
      };
    }
  }

  override update(): void {
    this.sender?.update(this.tracker.current(), this.bombPressed);
    this.bombPressed = false;
    this.drawBoxes();
    if (this.latest) {
      this.drawBombs(this.latest);
      this.drawFlames(this.latest);
      this.drawItems(this.latest);
      this.drawPlayers(this.latest);
    }
  }

  private drawBoxes(): void {
    const views = this.boxes.list().map((b) => ({ key: `${b.x},${b.y}`, ...b }));
    this.sync(this.boxSprites, views, (v) =>
      this.add
        .sprite(v.x * TILE_SIZE, v.y * TILE_SIZE, AssetKey.Box)
        .setOrigin(0, 0)
        .setDepth(Depth.Box),
    );
  }

  private drawBombs(snapshot: SnapshotMessage): void {
    const views = toBombViews(snapshot.bombs);
    this.sync(this.bombSprites, views, (v) =>
      this.add.sprite(v.px, v.py, AssetKey.Bomb, 0).setOrigin(0, 0).setDepth(Depth.Bomb),
    );
    for (const v of views) {
      // bright frame + slight pulse; the phase comes from the server's fuse
      this.bombSprites
        .get(v.key)
        ?.setFrame(v.bright ? 1 : 0)
        .setScale(v.bright ? 1 : 0.9);
    }
  }

  private drawFlames(snapshot: SnapshotMessage): void {
    const views = toFlameViews(snapshot.flames, snapshot.tick);
    this.sync(this.flameSprites, views, (v) =>
      this.add.sprite(v.px, v.py, AssetKey.Flame, v.frame).setOrigin(0, 0).setDepth(Depth.Flame),
    );
    for (const v of views) this.flameSprites.get(v.key)?.setFrame(v.frame);
  }

  private drawItems(snapshot: SnapshotMessage): void {
    const views = toItemViews(snapshot.items);
    this.sync(this.itemSprites, views, (v) =>
      this.add.sprite(v.px, v.py, AssetKey.Items, v.frame).setOrigin(0, 0).setDepth(Depth.Item),
    );
    for (const v of views) this.itemSprites.get(v.key)?.setFrame(v.frame);
  }

  private drawPlayers(snapshot: SnapshotMessage): void {
    const views = toPlayerViews(snapshot.players, this.selfId);
    const seen = new Set<string>();
    let selfSprite: Sprite | undefined;
    for (const view of views) {
      const anim = this.playerAnims.get(view.id);
      if (!anim || anim.phase === 'gone') continue;
      seen.add(view.id);
      let sprite = this.players.get(view.id);
      if (!sprite) {
        sprite = this.add.sprite(0, 0, AssetKey.Player, 0).setDepth(Depth.Player);
        this.players.set(view.id, sprite);
      }
      // origin at the sprite centre so the death spin / shrink stays on the tile
      sprite.setOrigin(0.5, 0.5).setPosition(view.px + TILE_SIZE / 2, view.py + TILE_SIZE / 2);
      sprite.setTint(view.tint);
      if (anim.phase === 'dying') {
        sprite.anims.stop();
        sprite.setFrame(IDLE_FRAME[anim.facing]);
        sprite
          .setScale(1 - anim.progress)
          .setAngle(anim.progress * 360)
          .setAlpha(1 - anim.progress);
      } else {
        sprite.setScale(1).setAngle(0).setAlpha(1);
        if (anim.moving) sprite.anims.play(walkAnimKey(anim.facing), true);
        else {
          sprite.anims.stop();
          sprite.setFrame(IDLE_FRAME[anim.facing]);
        }
        if (view.isSelf) selfSprite = sprite;
      }
    }
    for (const [id, sprite] of this.players) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.players.delete(id);
    }
    this.placeMarker(selfSprite);
  }

  /** Arrow above our own head, bobbing; hidden while we are dead / not yet in the snapshot. */
  private placeMarker(self: Sprite | undefined): void {
    if (!this.marker) return;
    if (!self) {
      this.marker.setVisible(false);
      return;
    }
    const bob = Math.round(Math.sin(this.time.now / 150));
    this.marker
      .setPosition(
        self.x - TILE_SIZE / 2 + MARKER_OFFSET.x,
        self.y - TILE_SIZE / 2 + MARKER_OFFSET.y + bob,
      )
      .setVisible(true);
  }

  /** Create / keep / destroy one sprite per view key (never one sprite per snapshot). */
  private sync<V extends { key: string }>(
    sprites: Map<string, Sprite>,
    views: readonly V[],
    create: (v: V) => Sprite,
  ): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.key);
      if (!sprites.has(v.key)) sprites.set(v.key, create(v));
    }
    for (const [key, sprite] of sprites) {
      if (seen.has(key)) continue;
      sprite.destroy();
      sprites.delete(key);
    }
  }

  /** Arrow keys + Space; blur / hidden tab → release everything so we send `none` (D27). */
  private bindKeyboard(): Unsubscribe[] {
    const keyboard = this.input.keyboard;
    if (!keyboard) return [];
    const cursors = keyboard.createCursorKeys();
    const space = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    const offs: Unsubscribe[] = [];
    const dirKeys: [Phaser.Input.Keyboard.Key, HeldDir][] = [
      [cursors.up, 'up'],
      [cursors.down, 'down'],
      [cursors.left, 'left'],
      [cursors.right, 'right'],
    ];
    for (const [key, dir] of dirKeys) {
      const down = () => this.tracker.press(dir);
      const up = () => this.tracker.release(dir);
      key.on('down', down);
      key.on('up', up);
      offs.push(() => {
        key.off('down', down);
        key.off('up', up);
      });
    }
    const bomb = () => {
      this.bombPressed = true;
    };
    space.on('down', bomb);
    offs.push(() => space.off('down', bomb));

    const release = () => this.tracker.clear();
    this.game.events.on(Phaser.Core.Events.BLUR, release);
    this.game.events.on(Phaser.Core.Events.HIDDEN, release);
    offs.push(() => {
      this.game.events.off(Phaser.Core.Events.BLUR, release);
      this.game.events.off(Phaser.Core.Events.HIDDEN, release);
      keyboard.removeKey(space);
      for (const [key] of dirKeys) keyboard.removeKey(key);
    });
    return offs;
  }
}
