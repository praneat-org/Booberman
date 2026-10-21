import type { HeldDir } from './directionInput';

/** The five on-screen buttons: the D-pad's four directions and the bomb. */
export type TouchButton = HeldDir | 'bomb';

export const TOUCH_DIRECTIONS: readonly HeldDir[] = ['up', 'left', 'right', 'down'];

export interface TouchEnv {
  /** `matchMedia('(pointer: coarse)')`: the primary pointer is a finger. `undefined` = no matchMedia. */
  coarsePointer: boolean | undefined;
  maxTouchPoints: number;
}

/**
 * Whether to show the on-screen controls: only where the primary pointer is a finger, so a desktop
 * (even one with a touch screen next to its mouse) never gets them. `?touch=1` / `?touch=0` force it
 * on / off for testing on a desktop. With no `matchMedia` at all, touch points decide.
 */
export function touchEnabled(search: string, env: TouchEnv): boolean {
  const flag = new URLSearchParams(search).get('touch');
  if (flag === '1') return true;
  if (flag === '0') return false;
  return env.coarsePointer ?? env.maxTouchPoints > 0;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What a finger is over: a button, or `neutral` = on the D-pad but in its dead centre (no direction).
 * `undefined` (where it is used) = over neither the D-pad nor the bomb.
 */
export type TouchHit = TouchButton | 'neutral';

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.left && x < r.right && y >= r.top && y < r.bottom;

/**
 * The direction a finger on the D-pad means, from where it is inside the pad's whole box, not from
 * which button it happens to be over: the dominant axis relative to the pad's centre picks it, so a
 * finger that slides across the empty centre, a corner or the 2 px gaps between buttons keeps
 * steering instead of letting go. The middle third (the centre cell, which has no button) is
 * `neutral`: nothing held, but the finger is still on the pad. Outside the box: `undefined`.
 */
export function padDirection(pad: Rect, x: number, y: number): HeldDir | 'neutral' | undefined {
  if (!inside(pad, x, y)) return undefined;
  const dx = x - (pad.left + pad.right) / 2;
  const dy = y - (pad.top + pad.bottom) / 2;
  const deadX = (pad.right - pad.left) / 6;
  const deadY = (pad.bottom - pad.top) / 6;
  if (Math.abs(dx) < deadX && Math.abs(dy) < deadY) return 'neutral';
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/** What is under the finger: the D-pad's direction (or neutral), the bomb button, or nothing. */
export function hitTouch(pad: Rect, bomb: Rect, x: number, y: number): TouchHit | undefined {
  const dir = padDirection(pad, x, y);
  if (dir !== undefined) return dir;
  return inside(bomb, x, y) ? 'bomb' : undefined;
}

export interface TouchHandlers {
  /** A direction went down for the first finger on it, or the bomb was tapped (every tap). */
  press(button: TouchButton): void;
  /** The last finger left a direction. Also called for the bomb, which has nothing to undo. */
  release(button: TouchButton): void;
}

/**
 * Which finger is on which button. Pure: the DOM layer feeds it pointer ids and what is under the
 * finger (`hitTouch`), and it calls `press` / `release` so the keyboard's `DirectionTracker` is the
 * one thing that decides the held direction (D27), whatever the source.
 *
 * - Multi-touch: every finger is tracked on its own, so a held direction and a bomb tap can overlap.
 *   A direction counts as held while ANY finger is on it (two fingers on `up`, lift one: still `up`).
 * - A finger that stays on the D-pad follows it: sliding between directions switches without
 *   lifting, and passing over the dead centre releases the direction (nothing held) until the
 *   finger comes out of it on a side.
 * - Sliding off the D-pad (or from the D-pad onto the bomb, or back) lets go for good; the finger
 *   has to lift and press again, so a thumb drifting away never leaves the character walking.
 */
export class TouchPointers {
  private readonly active = new Map<number, TouchHit>();

  constructor(private readonly handlers: TouchHandlers) {}

  down(pointerId: number, hit: TouchHit): void {
    this.up(pointerId); // a pointer id that was never lifted (lost event): let go of the old one first
    this.active.set(pointerId, hit);
    if (hit === 'neutral') return;
    if (hit === 'bomb' || this.fingersOn(hit) === 1) this.handlers.press(hit);
  }

  /** `hit` = what is under the finger now, `undefined` when it is over neither pad nor bomb. */
  move(pointerId: number, hit: TouchHit | undefined): void {
    const current = this.active.get(pointerId);
    if (current === undefined || hit === current) return;
    if (hit === undefined || hit === 'bomb' || current === 'bomb') {
      this.up(pointerId);
      return;
    }
    this.down(pointerId, hit); // still on the D-pad: follow the finger
  }

  up(pointerId: number): void {
    const hit = this.active.get(pointerId);
    if (hit === undefined) return;
    this.active.delete(pointerId);
    if (hit === 'neutral') return;
    if (hit === 'bomb' || this.fingersOn(hit) === 0) this.handlers.release(hit);
  }

  /** Blur / hidden tab / the controls going away: nothing stays held. */
  clear(): void {
    for (const id of [...this.active.keys()]) this.up(id);
  }

  private fingersOn(button: TouchButton): number {
    let n = 0;
    for (const b of this.active.values()) if (b === button) n += 1;
    return n;
  }
}
