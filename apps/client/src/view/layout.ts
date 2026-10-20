import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';

/** Logical tile size in px; Scale.FIT enlarges the whole canvas (pixelArt, no blur). */
export const TILE_SIZE = 16;
export const BOARD_WIDTH_PX = GRID_WIDTH * TILE_SIZE;
export const BOARD_HEIGHT_PX = GRID_HEIGHT * TILE_SIZE;
/**
 * The HUD strip sits above the board, never over it, so on a portrait phone the two cannot cover
 * each other. The canvas is `HUD + board`; Scale.FIT enlarges the whole thing.
 */
export const HUD_HEIGHT_PX = 56;
export const BOARD_ORIGIN_Y = HUD_HEIGHT_PX;
export const CANVAS_WIDTH_PX = BOARD_WIDTH_PX;
export const CANVAS_HEIGHT_PX = HUD_HEIGHT_PX + BOARD_HEIGHT_PX;

/** Width of the filled part of a loading bar for a Phaser load progress value (0..1). */
export function loadingBarFill(progress: number, barWidth: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * barWidth);
}
