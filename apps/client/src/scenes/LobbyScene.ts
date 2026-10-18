import Phaser from 'phaser';
import { roomIdFromPath } from '../lobby/joinTarget';
import { LobbyController } from '../lobby/LobbyController';
import { LobbyOverlay } from '../lobby/LobbyOverlay';
import { transportKind } from '../net/createTransport';
import { SceneKey } from './keys';

/**
 * Home screen (`/`): nickname + create room + room list, drawn as a DOM overlay (see LobbyOverlay).
 * `/room/:id` and `?mock=1` skip it and go straight to the game until FE-19 adds the join form.
 */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Lobby);
  }

  create(): void {
    const { pathname, search } = window.location;
    if (roomIdFromPath(pathname) !== undefined || transportKind(search) === 'mock') {
      this.scene.start(SceneKey.Game);
      return;
    }

    const parent = document.getElementById('app') ?? document.body;
    const controller = new LobbyController({
      navigate: (path) => window.location.assign(path),
    });
    const overlay = new LobbyOverlay(controller, parent);
    // scene shutdown (or game destroy) must drop the DOM, timers and any in-flight fetch
    const cleanup = () => {
      overlay.destroy();
      controller.destroy();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    controller.start();
  }
}
