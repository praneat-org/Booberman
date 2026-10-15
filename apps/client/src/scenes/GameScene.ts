import type { PlayerId } from '@booberman/protocol';
import Phaser from 'phaser';
import { createTransport } from '../net/createTransport';
import type { SnapshotMessage, Unsubscribe } from '../net/Transport';
import { DirectionTracker, type HeldDir, InputSender } from '../view/directionInput';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX } from '../view/layout';
import { toPlayerViews } from '../view/playerViews';
import { AssetKey, SceneKey } from './keys';

const DEAD_ALPHA = 0.35;

/**
 * Draws the arena tilemap and the players from the latest snapshot.
 * The scene only knows `Transport`; boxes / bombs / flames come with FE-15.
 */
export class GameScene extends Phaser.Scene {
  private selfId: PlayerId | undefined;
  private latest: SnapshotMessage | undefined;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
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

    this.sprites = new Map();
    this.tracker = new DirectionTracker();
    this.latest = undefined;
    this.selfId = undefined;
    this.bombPressed = false;

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
      }),
      transport.onSnapshot((msg) => {
        this.latest = msg;
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
    if (this.latest) this.drawPlayers(this.latest);
  }

  private drawPlayers(snapshot: SnapshotMessage): void {
    const views = toPlayerViews(snapshot.players, this.selfId);
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.id);
      let sprite = this.sprites.get(view.id);
      if (!sprite) {
        sprite = this.add.sprite(0, 0, AssetKey.Player, 0).setOrigin(0, 0).setDepth(10);
        this.sprites.set(view.id, sprite);
      }
      sprite
        .setPosition(view.px, view.py)
        .setTint(view.tint)
        .setAlpha(view.alive ? 1 : DEAD_ALPHA);
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
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
