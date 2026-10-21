/** Frame indices in `public/tiles/tileset.png` (14 columns of 16px, no spacing). */
export const SheetFrame = {
  floor: 13,
  wall: 45,
  box: 47,
  bomb: 42,
  /** centre tiles of the small and the big explosion cross */
  flame: [86, 91],
  curse: 203,
  kick: 198,
  marker: 27,
  /** idle frame per facing: the middle one of each 3-frame walk cycle */
  idle: { left: 1, down: 4, right: 15, up: 18 },
  walk: { left: [0, 2], down: [3, 5], right: [14, 16], up: [17, 19] },
} as const;
