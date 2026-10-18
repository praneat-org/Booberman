import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BOARD_HEIGHT_PX, BOARD_WIDTH_PX } from './view/layout';

export const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1b1b2f',
  // asset paths are relative ('maps/arena.json'); without this /room/:id would resolve them to /room/maps/... (SPA fallback HTML)
  loader: { baseURL: import.meta.env.BASE_URL },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BOARD_WIDTH_PX,
    height: BOARD_HEIGHT_PX,
  },
  scene: [BootScene, LobbyScene, GameScene],
};
