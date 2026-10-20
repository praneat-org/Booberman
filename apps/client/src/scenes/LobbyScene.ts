import Phaser from 'phaser';
import { type EntryActions, EntryOverlay, type EntryScreen } from '../lobby/EntryOverlay';
import { SERVER_REJECTED_NICKNAME_MESSAGE } from '../lobby/entryNotice';
import { resolveEntry } from '../lobby/entryRoute';
import { roomPath, roomUrlWithoutNickname } from '../lobby/joinTarget';
import { LobbyController } from '../lobby/LobbyController';
import { LobbyOverlay } from '../lobby/LobbyOverlay';
import { loadNickname } from '../lobby/nicknameStore';
import { transportKind } from '../net/createTransport';
import type { JoinFailureKind } from '../net/joinWatcher';
import type { GameSceneData } from './GameScene';
import { SceneKey } from './keys';

/** Sent by GameScene when a join failed or the room was lost: show why, with a way forward. */
export interface LobbySceneData {
  failure?: { kind: JoinFailureKind; roomId: string; nickname: string };
}

interface Mounted {
  destroy(): void;
}

/**
 * First screen after boot, as a DOM overlay (see LobbyOverlay / EntryOverlay):
 * - `/` → name + create room + room list
 * - `/room/:id` → name form → "เข้าห้อง" (or straight in when `?nick=` is valid, which is how the home page sends us)
 * - `/room/<junk>` → "ไม่พบห้อง"; a failed join sent back from GameScene → why + what to do next
 * `?mock=1` skips all of it.
 */
export class LobbyScene extends Phaser.Scene {
  private failure: LobbySceneData['failure'];

  constructor() {
    super(SceneKey.Lobby);
  }

  init(data?: LobbySceneData): void {
    this.failure = data?.failure;
  }

  create(): void {
    const { search } = window.location;
    if (transportKind(search) === 'mock') {
      this.scene.start(SceneKey.Game);
      return;
    }
    if (this.failure) {
      this.showFailure(this.failure);
      return;
    }
    const route = resolveEntry(window.location, loadNickname());
    switch (route.kind) {
      case 'home':
        this.showHome();
        break;
      case 'join':
        this.enterRoom(route.roomId, route.nickname);
        break;
      case 'form': {
        const controller = this.entryController();
        // a `?nick=` that broke the rules is shown with the reason; a remembered name needs nothing
        if (route.nickname !== '') controller.setNickname(route.nickname);
        this.showEntry(controller, { kind: 'form', roomId: route.roomId }, undefined);
        break;
      }
      case 'not-found':
        this.showEntry(this.entryController(), { kind: 'notice', notice: 'NOT_FOUND' }, undefined);
        break;
    }
  }

  /** Into the room in place. The URL becomes the plain link, with no `?nick=` (anyone could copy it). */
  private enterRoom(roomId: string, nickname: string): void {
    try {
      const { search, hash } = window.location;
      window.history.replaceState(
        null,
        '',
        roomUrlWithoutNickname({ pathname: roomPath(roomId), search, hash }),
      );
    } catch {
      // the URL is cosmetic; entering the room is what matters
    }
    this.scene.start(SceneKey.Game, { roomId, nickname } satisfies GameSceneData);
  }

  private parent(): HTMLElement {
    return document.getElementById('app') ?? document.body;
  }

  private entryController(): LobbyController {
    return new LobbyController({
      navigate: (path) => window.location.assign(path),
      enter: (roomId, nickname) => this.enterRoom(roomId, nickname),
    });
  }

  private showHome(): void {
    const controller = new LobbyController({
      navigate: (path) => window.location.assign(path),
    });
    const overlay = new LobbyOverlay(controller, this.parent());
    this.ownUntilShutdown(overlay, controller);
    controller.start();
    if (import.meta.env.DEV) (window as unknown as { __bbLobby?: unknown }).__bbLobby = this;
  }

  private showFailure(f: NonNullable<LobbySceneData['failure']>): void {
    const controller = this.entryController();
    controller.setNickname(f.nickname);
    const retry = () => this.enterRoom(f.roomId, f.nickname);
    if (f.kind === 'INVALID_NICKNAME') {
      // fixable in place: back to the name box, saying the server did not take the name
      this.showEntry(
        controller,
        { kind: 'form', roomId: f.roomId, hint: SERVER_REJECTED_NICKNAME_MESSAGE },
        retry,
      );
      return;
    }
    this.showEntry(controller, { kind: 'notice', notice: f.kind, roomId: f.roomId }, retry);
  }

  private showEntry(
    controller: LobbyController,
    screen: EntryScreen,
    retry: (() => void) | undefined,
  ): void {
    const actions: EntryActions = {
      retry: () => retry?.(),
      reload: () => window.location.reload(),
      home: () => window.location.assign('/'),
    };
    const overlay = new EntryOverlay(controller, this.parent(), screen, actions);
    this.ownUntilShutdown(overlay, controller);
    if (import.meta.env.DEV) (window as unknown as { __bbLobby?: unknown }).__bbLobby = this;
  }

  /** Scene shutdown (or game destroy) must drop the DOM, timers and any in-flight fetch. */
  private ownUntilShutdown(overlay: Mounted, controller: LobbyController): void {
    const cleanup = () => {
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup);
      overlay.destroy();
      controller.destroy();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }
}
