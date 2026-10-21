import type { ItemKind } from '@booberman/protocol';
import type { SnapshotMessage } from '../net/Transport';
import { tileKey } from './boardView';
import { TILE_SIZE } from './layout';

/** CAR-3796: a fuse under 0.75 s (15 ticks at 20 Hz) makes the bomb blink faster. */
export const FAST_BLINK_FUSE = 15;
const SLOW_BLINK_TICKS = 6;
const FAST_BLINK_TICKS = 2;

export interface BombView {
  key: string;
  px: number;
  py: number;
  /** Bright phase of the blink (drawn lighter / larger). */
  bright: boolean;
  fast: boolean;
}

/** Blink phase comes from the server's `fuse`, not from a local timer, so it can't drift. */
export function bombBlink(fuse: number): { fast: boolean; bright: boolean } {
  const fast = fuse < FAST_BLINK_FUSE;
  const period = fast ? FAST_BLINK_TICKS : SLOW_BLINK_TICKS;
  return { fast, bright: Math.floor(fuse / period) % 2 === 0 };
}

/** `drawn` = tween positions for sliding bombs (FE-23), same order as `bombs`; absent = on the tile. */
export function toBombViews(
  bombs: SnapshotMessage['bombs'],
  drawn?: readonly { x: number; y: number }[],
): BombView[] {
  return bombs.map((b, i) => ({
    key: tileKey(b.x, b.y),
    px: (drawn?.[i]?.x ?? b.x) * TILE_SIZE,
    py: (drawn?.[i]?.y ?? b.y) * TILE_SIZE,
    ...bombBlink(b.fuse),
  }));
}

export interface FlameView {
  key: string;
  px: number;
  py: number;
  /** Alternates every 2 ticks so fire flickers. */
  frame: 0 | 1;
}

export function toFlameViews(flames: SnapshotMessage['flames'], tick: number): FlameView[] {
  const frame = Math.floor(tick / 2) % 2 === 0 ? 0 : 1;
  return flames.map(([x, y]) => ({
    key: tileKey(x, y),
    px: x * TILE_SIZE,
    py: y * TILE_SIZE,
    frame,
  }));
}

export interface ItemView {
  key: string;
  px: number;
  py: number;
  kind: ItemKind;
  /** Spritesheet frame: 0 = curse (? block), 1 = kick (skate). */
  frame: number;
}

const ITEM_FRAME: Record<ItemKind, number> = { curse: 0, kick: 1 };

export function toItemViews(items: SnapshotMessage['items']): ItemView[] {
  return items.map((i) => ({
    key: tileKey(i.x, i.y),
    px: i.x * TILE_SIZE,
    py: i.y * TILE_SIZE,
    kind: i.kind,
    frame: ITEM_FRAME[i.kind],
  }));
}
