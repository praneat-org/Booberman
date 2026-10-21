import type { PlayerId } from '@booberman/protocol';
import Phaser from 'phaser';
import { KenneyFrame } from '../assets/kenneyTinyDungeon';
import { GameAudio } from '../audio/GameAudio';
import { MuteButton } from '../audio/MuteButton';
import { loadMuted, saveMuted } from '../audio/muteStore';
import { toSoundPort } from '../audio/phaserSound';
import { joinFromLocation } from '../lobby/joinTarget';
import { createTransport, transportKind } from '../net/createTransport';
import { type JoinFailureKind, JoinWatcher } from '../net/joinWatcher';
import type { Unsubscribe } from '../net/Transport';
import { CurseFrames } from '../ui/CurseFrames';
import { attachDebugOverlay } from '../ui/DebugOverlay';
import { RoomBar } from '../ui/RoomBar';
import { applyBoardEvent, applyWelcome } from '../view/boardEvents';
import { toCurseFrames } from '../view/curseFrames';
import { debugEnabled } from '../view/debugStats';
import { DirectionTracker, type HeldDir, InputSender } from '../view/directionInput';
import { BOARD_HEIGHT_PX, BOARD_ORIGIN_Y, BOARD_WIDTH_PX, TILE_SIZE } from '../view/layout';
import { IDLE_FRAME, walkAnimKey } from '../view/playerAnim';
import { type Drawable, RoundView } from '../view/roundView';
import { AssetKey, SceneKey } from './keys';
import type { LobbySceneData } from './LobbyScene';

/** Draw order, back to front. */
const Depth = { Box: 1, Item: 2, Bomb: 3, Flame: 4, Player: 10, Marker: 11, Curse: 12 } as const;
const MARKER_OFFSET = { x: 0, y: -7 };

type Sprite = Phaser.GameObjects.Sprite;

/** Who joins which room; the lobby passes it in `scene.start(Game, ...)`. Absent with `?mock=1`. */
export interface GameSceneData {
  roomId?: string;
  nickname?: string;
}

/**
 * Draws the arena from what the server says: walls from the tilemap, boxes from `grid` +
 * `boxDestroyed`, players / bombs / flames / items from the latest snapshot. Nothing here decides
 * a death, a pickup or a win.
 */
export class GameScene extends Phaser.Scene {
  private selfId: PlayerId | undefined;
  /** All per-round view state that is not a sprite; `resetRound` is the only way to start a round. */
  private round = new RoundView();
  private players = new Map<string, Sprite>();
  private boxSprites = new Map<string, Sprite>();
  private bombSprites = new Map<string, Sprite>();
  private flameSprites = new Map<string, Sprite>();
  private itemSprites = new Map<string, Sprite>();
  private marker: Phaser.GameObjects.Image | undefined;
  private curseFrames: CurseFrames | undefined;
  private tracker = new DirectionTracker();
  private sender: InputSender | undefined;
  private bombPressed = false;
  private target: GameSceneData = {};
  private audio: GameAudio | undefined;

  constructor() {
    super(SceneKey.Game);
  }

  init(data?: GameSceneData): void {
    this.target = data ?? {};
  }

  create(): void {
    const map = this.make.tilemap({ key: AssetKey.Arena });
    const tiles = map.addTilesetImage('tileset', AssetKey.Kenney);
    if (!tiles) throw new Error('tileset "tileset" missing from arena.json');
    map.createLayer('ground', tiles, 0, 0);

    this.players = new Map();
    this.boxSprites = new Map();
    this.bombSprites = new Map();
    this.flameSprites = new Map();
    this.itemSprites = new Map();
    this.round = new RoundView();
    this.tracker = new DirectionTracker();
    this.selfId = undefined;
    this.bombPressed = false;
    this.audio = undefined;
    // the HUD strip lives above the board: the game camera only covers the board
    this.cameras.main.setViewport(0, BOARD_ORIGIN_Y, BOARD_WIDTH_PX, BOARD_HEIGHT_PX);
    this.curseFrames = new CurseFrames(this, Depth.Curse, TILE_SIZE);
    this.marker = this.add
      .image(0, 0, AssetKey.Kenney, KenneyFrame.marker)
      .setOrigin(0, 0)
      .setDepth(Depth.Marker)
      .setVisible(false);

    const { roomId, nickname } = this.target;
    const join =
      roomId !== undefined && nickname !== undefined
        ? { roomId, nickname }
        : joinFromLocation(window.location);
    const transport = createTransport(window.location.search, join);
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

    const scene = this;
    this.scene.launch(SceneKey.Hud, {
      get round() {
        return scene.round;
      },
      selfId: () => this.selfId,
    });

    const cleanups: Unsubscribe[] = [
      transport.onWelcome((msg) => {
        this.selfId = msg.playerId;
        // the server never announces us to ourselves: our card's name is the one we joined with
        applyWelcome(msg, this.round, join.nickname);
        this.destroyRoundSprites();
      }),
      transport.onSnapshot((msg) => this.round.applySnapshot(msg, performance.now())),
      transport.onEvent((msg) => {
        if (applyBoardEvent(msg, this.round)) this.destroyRoundSprites();
      }),
      transport.onError((code, message) => console.warn('[transport] error', code, message)),
    ];
    this.sender = new InputSender((input) => transport.send(input));
    // sound follows the server's snapshots / events (see SfxTracker), never our own key presses
    const audio = new GameAudio({
      sound: toSoundPort(this.sound),
      cache: this.cache.audio,
      loadMuted,
      saveMuted,
      onLog: debugEnabled(window.location.search)
        ? (e) => console.info('[sfx]', e.name, e.outcome)
        : undefined,
    });
    this.audio = audio;
    cleanups.push(() => audio.dispose());
    const muteButton = new MuteButton(audio);
    cleanups.push(() => muteButton.destroy());
    cleanups.push(...this.watchJoin(transport, join));
    cleanups.push(...this.bindKeyboard(audio));
    if (debugEnabled(window.location.search)) {
      cleanups.push(
        attachDebugOverlay(transport, () => ({
          buffered: this.round.buffer.size,
          latestTick: this.round.buffer.latestTick,
          renderTick: this.round.renderTick,
        })),
      );
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop(SceneKey.Hud);
      this.curseFrames?.clear();
      this.curseFrames = undefined;
      for (const off of cleanups) off();
      transport.disconnect();
      this.sender = undefined;
      this.audio = undefined;
    });
    transport.connect();

    if (import.meta.env.DEV) {
      (window as unknown as { __booberman?: unknown }).__booberman = {
        scene: this,
        transport,
        snapshot: () => this.round.latest,
        selfId: () => this.selfId,
        audio,
        sound: this.sound,
      };
    }
  }

  override update(): void {
    this.sender?.update(this.tracker.current(), this.bombPressed);
    this.bombPressed = false;
    for (const name of this.round.frame(performance.now())) this.audio?.trigger(name);
    this.drawBoxes();
    const d = this.round.drawable(this.selfId);
    this.drawBombs(d.bombs);
    this.drawFlames(d.flames);
    this.drawItems(d.items);
    this.drawPlayers(d.players);
    this.curseFrames?.sync(toCurseFrames(d.players, this.round.latest?.tick ?? 0));
  }

  /**
   * The real server only: show the room bar (copy / share link) and turn "did the join work?" into
   * either the bar's button or a trip back to the lobby with the reason. `?mock=1` has no room.
   */
  private watchJoin(
    transport: NonNullable<ReturnType<typeof createTransport>>,
    join: { roomId: string; nickname: string },
  ): Unsubscribe[] {
    if (transportKind(window.location.search) !== 'ws') return [];
    const host = document.getElementById('app');
    const bar = host
      ? new RoomBar({ roomId: join.roomId }, host, () => this.refitCanvas())
      : undefined;
    const leave = (kind: JoinFailureKind) => {
      const failure = { kind, roomId: join.roomId, nickname: join.nickname };
      this.scene.start(SceneKey.Lobby, { failure } satisfies LobbySceneData);
    };
    const watcher = new JoinWatcher(transport, {
      onJoined: () => bar?.setJoined(true),
      onFailed: leave,
      onLost: () => leave('CONNECTION_LOST'),
    });
    return [() => watcher.dispose(), () => bar?.destroy()];
  }

  /**
   * The room bar changes how much height `#app` has. Phaser only re-measures its parent every
   * 500 ms, and `refresh()` alone reuses the old measurement, so measure first.
   */
  private refitCanvas(): void {
    if (this.scale.getParentBounds()) this.scale.refresh();
  }

  /**
   * New round: drop every sprite of the old one (the view state itself was reset by
   * `RoundView.reset`). Boxes are re-synced from the new grid on the next update.
   */
  private destroyRoundSprites(): void {
    for (const pool of [
      this.boxSprites,
      this.bombSprites,
      this.flameSprites,
      this.itemSprites,
      this.players,
    ]) {
      for (const sprite of pool.values()) sprite.destroy();
      pool.clear();
    }
    this.marker?.setVisible(false);
    this.curseFrames?.clear();
  }

  private drawBoxes(): void {
    const views = this.round.boxes.list().map((b) => ({ key: `${b.x},${b.y}`, ...b }));
    this.sync(this.boxSprites, views, (v) =>
      this.add
        .sprite(v.x * TILE_SIZE, v.y * TILE_SIZE, AssetKey.Kenney, KenneyFrame.box)
        .setOrigin(0, 0)
        .setDepth(Depth.Box),
    );
  }

  private drawBombs(views: Drawable['bombs']): void {
    this.sync(this.bombSprites, views, (v) =>
      this.add
        .sprite(v.px, v.py, AssetKey.Kenney, KenneyFrame.bomb)
        .setOrigin(0, 0)
        .setDepth(Depth.Bomb),
    );
    for (const v of views) {
      // The Kenney pack has a single barrel frame; tint and pulse it as the fuse runs down.
      this.bombSprites
        .get(v.key)
        ?.setTint(v.bright ? 0xffffff : 0x999999)
        .setScale(v.bright ? 1 : 0.9);
    }
  }

  private drawFlames(views: Drawable['flames']): void {
    this.sync(this.flameSprites, views, (v) =>
      this.add
        .sprite(v.px, v.py, AssetKey.Kenney, KenneyFrame.flame[0])
        .setOrigin(0, 0)
        .setDepth(Depth.Flame),
    );
    for (const v of views)
      this.flameSprites
        .get(v.key)
        ?.setFrame(v.frame === 0 ? KenneyFrame.flame[0] : KenneyFrame.flame[1]);
  }

  private drawItems(views: Drawable['items']): void {
    this.sync(this.itemSprites, views, (v) =>
      this.add
        .sprite(v.px, v.py, AssetKey.Kenney, KenneyFrame.curse)
        .setOrigin(0, 0)
        .setDepth(Depth.Item),
    );
    for (const v of views)
      this.itemSprites.get(v.key)?.setFrame(v.frame === 0 ? KenneyFrame.curse : KenneyFrame.kick);
  }

  private drawPlayers(players: Drawable['players']): void {
    const seen = new Set<string>();
    let selfSprite: Sprite | undefined;
    for (const { view, anim } of players) {
      seen.add(view.id);
      let sprite = this.players.get(view.id);
      if (!sprite) {
        sprite = this.add.sprite(0, 0, AssetKey.Kenney, KenneyFrame.player).setDepth(Depth.Player);
        this.players.set(view.id, sprite);
      }
      // origin at the sprite centre so the death spin / shrink stays on the tile
      const bob = anim.moving ? Math.round(Math.sin(this.time.now / 80)) : 0;
      sprite
        .setOrigin(0.5, 0.5)
        .setPosition(view.px + TILE_SIZE / 2, view.py + TILE_SIZE / 2 - bob)
        .setFlipX(anim.facing === 'left');
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

  /** Kenney marker brackets our player; hidden while we are dead / not yet in the snapshot. */
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

  /** Arrow keys + Space, `M` mutes; blur / hidden tab → release everything so we send `none` (D27). */
  private bindKeyboard(audio: GameAudio): Unsubscribe[] {
    const keyboard = this.input.keyboard;
    if (!keyboard) return [];
    const cursors = keyboard.createCursorKeys();
    const space = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    const mute = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
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
    const toggleMute = () => audio.toggleMuted();
    mute.on('down', toggleMute);
    offs.push(() => mute.off('down', toggleMute));

    const release = () => this.tracker.clear();
    this.game.events.on(Phaser.Core.Events.BLUR, release);
    this.game.events.on(Phaser.Core.Events.HIDDEN, release);
    offs.push(() => {
      this.game.events.off(Phaser.Core.Events.BLUR, release);
      this.game.events.off(Phaser.Core.Events.HIDDEN, release);
      keyboard.removeKey(space);
      keyboard.removeKey(mute);
      for (const [key] of dirKeys) keyboard.removeKey(key);
    });
    return offs;
  }
}
