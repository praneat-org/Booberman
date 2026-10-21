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

/** The button whose rectangle holds the point (left / top edges inside, right / bottom edges outside). */
export function hitButton(
  rects: Readonly<Record<TouchButton, Rect>>,
  x: number,
  y: number,
): TouchButton | undefined {
  for (const [button, r] of Object.entries(rects) as [TouchButton, Rect][]) {
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return button;
  }
  return undefined;
}

export interface TouchHandlers {
  /** A direction went down for the first finger on it, or the bomb was tapped (every tap). */
  press(button: TouchButton): void;
  /** The last finger left a direction. Also called for the bomb, which has nothing to undo. */
  release(button: TouchButton): void;
}

/**
 * Which finger is on which button. Pure: the DOM layer feeds it pointer ids and the button under
 * the finger, and it calls `press` / `release` so the keyboard's `DirectionTracker` is the one thing
 * that decides the held direction (D27), whatever the source.
 *
 * - Multi-touch: every finger is tracked on its own, so a held direction and a bomb tap can overlap.
 *   A direction counts as held while ANY finger is on it (two fingers on `up`, lift one: still `up`).
 * - Sliding from one direction button to another switches direction without lifting.
 * - Sliding off every button (or from the D-pad onto the bomb, or back) lets go; the finger has to
 *   lift and press again, so a thumb drifting out of the D-pad never leaves the character walking.
 */
export class TouchPointers {
  private readonly active = new Map<number, TouchButton>();

  constructor(private readonly handlers: TouchHandlers) {}

  down(pointerId: number, button: TouchButton): void {
    this.up(pointerId); // a pointer id that was never lifted (lost event): let go of the old one first
    this.active.set(pointerId, button);
    if (button === 'bomb' || this.fingersOn(button) === 1) this.handlers.press(button);
  }

  /** `hit` = the button under the finger now, `undefined` when it is over none. */
  move(pointerId: number, hit: TouchButton | undefined): void {
    const current = this.active.get(pointerId);
    if (current === undefined || hit === current) return;
    if (hit !== undefined && hit !== 'bomb' && current !== 'bomb') {
      this.up(pointerId);
      this.down(pointerId, hit);
      return;
    }
    this.up(pointerId);
  }

  up(pointerId: number): void {
    const button = this.active.get(pointerId);
    if (button === undefined) return;
    this.active.delete(pointerId);
    if (button === 'bomb' || this.fingersOn(button) === 0) this.handlers.release(button);
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
