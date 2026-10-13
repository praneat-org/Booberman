import type { Dir } from './types';

export const VECTORS: Record<Dir, readonly [dx: number, dy: number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  none: [0, 0],
};

/** The directions a flame spreads in. */
export const FLAME_DIRS = ['up', 'down', 'left', 'right'] as const;
