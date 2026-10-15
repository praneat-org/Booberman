import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';

/** Logical tile size in px; Scale.FIT enlarges the whole canvas (pixelArt, no blur). */
export const TILE_SIZE = 16;
export const BOARD_WIDTH_PX = GRID_WIDTH * TILE_SIZE;
export const BOARD_HEIGHT_PX = GRID_HEIGHT * TILE_SIZE;

/** Width of the filled part of a loading bar for a Phaser load progress value (0..1). */
export function loadingBarFill(progress: number, barWidth: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * barWidth);
}
