import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { LobbyScene } from './scenes/LobbyScene';
import { CANVAS_HEIGHT_PX, CANVAS_WIDTH_PX } from './view/layout';

export const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1b1b2f',
  // asset paths are relative ('maps/arena.json'); without this /room/:id would resolve them to /room/maps/... (SPA fallback HTML)
  // crossOrigin: files from the asset bucket (another origin, FE-16) need CORS; absolute URLs ignore baseURL
  loader: { baseURL: import.meta.env.BASE_URL, crossOrigin: 'anonymous' },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: CANVAS_WIDTH_PX,
    height: CANVAS_HEIGHT_PX,
  },
  scene: [BootScene, LobbyScene, GameScene, HudScene],
};
