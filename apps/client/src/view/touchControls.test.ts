import { describe, expect, it } from 'vitest';
import { DirectionTracker, InputSender } from './directionInput';
import {
  hitTouch,
  padDirection,
  type Rect,
  TOUCH_DIRECTIONS,
  type TouchHit,
  TouchPointers,
  touchEnabled,
} from './touchControls';

describe('touchEnabled', () => {
  it('shows the controls where the primary pointer is a finger, not on a desktop', () => {
    expect(touchEnabled('', { coarsePointer: true, maxTouchPoints: 5 })).toBe(true);
    expect(touchEnabled('', { coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });

  it('a desktop with a touch screen still has a mouse as its primary pointer: no controls', () => {
    expect(touchEnabled('', { coarsePointer: false, maxTouchPoints: 10 })).toBe(false);
  });

  it('with no matchMedia the touch points decide', () => {
    expect(touchEnabled('', { coarsePointer: undefined, maxTouchPoints: 1 })).toBe(true);
    expect(touchEnabled('', { coarsePointer: undefined, maxTouchPoints: 0 })).toBe(false);
  });

  it('?touch=1 forces them on and ?touch=0 off, whatever the device says', () => {
    expect(touchEnabled('?touch=1', { coarsePointer: false, maxTouchPoints: 0 })).toBe(true);
    expect(touchEnabled('?mock=1&touch=1', { coarsePointer: false, maxTouchPoints: 0 })).toBe(true);
    expect(touchEnabled('?touch=0', { coarsePointer: true, maxTouchPoints: 5 })).toBe(false);
    expect(touchEnabled('?touch=yes', { coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });
});

/** The real layout: 3x3 grid of 56 px cells with 2 px gaps = 172 px, bomb button to its right. */
const PAD: Rect = { left: 16, top: 560, right: 188, bottom: 732 };
const BOMB: Rect = { left: 252, top: 600, right: 344, bottom: 692 };
const CX = (PAD.left + PAD.right) / 2; // 102
const CY = (PAD.top + PAD.bottom) / 2; // 646

describe('padDirection', () => {
  it('reads the direction from where the finger is in the pad, wherever the buttons are', () => {
    expect(padDirection(PAD, CX, PAD.top + 10)).toBe('up');
    expect(padDirection(PAD, CX, PAD.bottom - 10)).toBe('down');
    expect(padDirection(PAD, PAD.left + 10, CY)).toBe('left');
    expect(padDirection(PAD, PAD.right - 10, CY)).toBe('right');
  });

  it('the dead centre is neutral: on the pad, no direction', () => {
    expect(padDirection(PAD, CX, CY)).toBe('neutral');
    expect(padDirection(PAD, CX + 20, CY - 20)).toBe('neutral'); // inside the centre cell
    // the edge of the centre cell is a sixth of the pad each way: just inside is neutral, just past it a direction
    const edge = 172 / 6;
    expect(padDirection(PAD, CX + edge - 0.01, CY)).toBe('neutral');
    expect(padDirection(PAD, CX + edge + 0.01, CY)).toBe('right');
    expect(padDirection(PAD, CX, CY - edge + 0.01)).toBe('neutral');
    expect(padDirection(PAD, CX, CY - edge - 0.01)).toBe('up');
  });

  it('the gaps between buttons and the empty corners still mean a direction (the finger keeps steering)', () => {
    // the 2 px gap between the "up" button (cell 2,1) and the centre cell sits at y = top + 56 .. top + 58
    expect(padDirection(PAD, CX, PAD.top + 57)).not.toBeUndefined();
    // a corner cell has no button: the dominant axis picks, ties go horizontal
    expect(padDirection(PAD, PAD.left + 5, PAD.top + 5)).toBe('left');
    expect(padDirection(PAD, PAD.left + 5, PAD.top + 20)).toBe('left');
    expect(padDirection(PAD, PAD.left + 30, PAD.top + 3)).toBe('up');
    expect(padDirection(PAD, PAD.right - 5, PAD.bottom - 30)).toBe('right');
    expect(padDirection(PAD, PAD.right - 30, PAD.bottom - 5)).toBe('down');
  });

  it('outside the pad box there is nothing; the far edges are outside', () => {
    expect(padDirection(PAD, PAD.left - 1, CY)).toBeUndefined();
    expect(padDirection(PAD, PAD.right, CY)).toBeUndefined();
    expect(padDirection(PAD, CX, PAD.top - 1)).toBeUndefined();
    expect(padDirection(PAD, CX, PAD.bottom)).toBeUndefined();
    expect(padDirection(PAD, PAD.left, PAD.top)).toBe('left'); // the near edges are inside
  });
});

describe('hitTouch', () => {
  it('pad first, then the bomb button, then nothing', () => {
    expect(hitTouch(PAD, BOMB, PAD.left + 10, CY)).toBe('left');
    expect(hitTouch(PAD, BOMB, CX, CY)).toBe('neutral');
    expect(hitTouch(PAD, BOMB, 300, 646)).toBe('bomb');
    expect(hitTouch(PAD, BOMB, 220, 646)).toBeUndefined(); // between the pad and the bomb
    expect(hitTouch(PAD, BOMB, 300, 740)).toBeUndefined();
  });
});

/** The real wiring: touch drives the same DirectionTracker the keyboard does, the sender sends on change. */
function rig() {
  const tracker = new DirectionTracker();
  const sent: { seq: number; dir: string; bomb: boolean }[] = [];
  const sender = new InputSender((i) => sent.push(i));
  let bombPressed = false;
  const pointers = new TouchPointers({
    press: (b) => {
      if (b === 'bomb') bombPressed = true;
      else tracker.press(b);
    },
    release: (b) => {
      if (b !== 'bomb') tracker.release(b);
    },
  });
  /** One game tick, like GameScene.update. */
  const tick = () => {
    sender.update(tracker.current(), bombPressed);
    bombPressed = false;
  };
  return { pointers, tracker, sent, tick };
}

describe('TouchPointers', () => {
  it('has all four directions', () => {
    expect([...TOUCH_DIRECTIONS].sort()).toEqual(['down', 'left', 'right', 'up']);
  });

  it('walks each of the four directions while held, and stops on release (D27)', () => {
    for (const dir of TOUCH_DIRECTIONS) {
      const { pointers, tracker, sent, tick } = rig();
      pointers.down(1, dir);
      tick();
      expect(tracker.current()).toBe(dir);
      expect(sent).toEqual([{ seq: 1, dir, bomb: false }]);
      tick(); // still held: nothing more is sent
      expect(sent).toHaveLength(1);
      pointers.up(1);
      tick();
      expect(sent.at(-1)).toEqual({ seq: 2, dir: 'none', bomb: false });
    }
  });

  it('a bomb tap sends one input with bomb, and nothing is held afterwards', () => {
    const { pointers, tracker, sent, tick } = rig();
    pointers.down(1, 'bomb');
    tick();
    pointers.up(1);
    tick();
    expect(sent).toEqual([{ seq: 1, dir: 'none', bomb: true }]);
    expect(tracker.current()).toBe('none');
  });

  it('multi-touch: a held direction and a bomb tap at the same time', () => {
    const { pointers, tracker, sent, tick } = rig();
    pointers.down(1, 'left');
    tick();
    pointers.down(2, 'bomb');
    tick();
    pointers.up(2);
    tick();
    expect(tracker.current()).toBe('left'); // the bomb finger lifting does not stop the walk
    expect(sent).toEqual([
      { seq: 1, dir: 'left', bomb: false },
      { seq: 2, dir: 'left', bomb: true },
    ]);
    pointers.up(1);
    tick();
    expect(tracker.current()).toBe('none');
  });

  it('two bomb taps in a row are two bombs', () => {
    const { pointers, sent, tick } = rig();
    for (const id of [1, 2]) {
      pointers.down(id, 'bomb');
      tick();
      pointers.up(id);
    }
    expect(sent.filter((s) => s.bomb)).toHaveLength(2);
  });

  it('dragging out of the button lets go: no input is left walking', () => {
    const { pointers, tracker, tick } = rig();
    pointers.down(1, 'right');
    tick();
    pointers.move(1, undefined); // the thumb slid off every button
    tick();
    expect(tracker.current()).toBe('none');
    pointers.move(1, 'right'); // sliding back does not re-grab: lift and press again
    expect(tracker.current()).toBe('none');
    pointers.up(1); // the late pointerup finds nothing to release
    expect(tracker.current()).toBe('none');
  });

  it('sliding from one direction to another switches direction without lifting', () => {
    const { pointers, tracker, sent, tick } = rig();
    pointers.down(1, 'left');
    tick();
    pointers.move(1, 'up');
    tick();
    expect(tracker.current()).toBe('up');
    pointers.move(1, 'up'); // still on it: no change
    tick();
    expect(sent.map((s) => s.dir)).toEqual(['left', 'up']);
    pointers.up(1);
    tick();
    expect(tracker.current()).toBe('none');
  });

  it('sliding from the D-pad onto the bomb (or back) lets go and does not drop a bomb', () => {
    const { pointers, tracker, sent, tick } = rig();
    pointers.down(1, 'down');
    tick();
    pointers.move(1, 'bomb');
    tick();
    expect(tracker.current()).toBe('none');
    expect(sent.some((s) => s.bomb)).toBe(false);
    pointers.up(1);
    pointers.down(2, 'bomb');
    pointers.move(2, 'up');
    tick();
    expect(tracker.current()).toBe('none');
  });

  it('two fingers on one direction: it stays held until the last one lifts', () => {
    const { pointers, tracker } = rig();
    pointers.down(1, 'up');
    pointers.down(2, 'up');
    pointers.up(1);
    expect(tracker.current()).toBe('up');
    pointers.up(2);
    expect(tracker.current()).toBe('none');
  });

  it('two fingers on two directions: the latest wins, and lifting it hands back the other', () => {
    const { pointers, tracker } = rig();
    pointers.down(1, 'left');
    pointers.down(2, 'up');
    expect(tracker.current()).toBe('up');
    pointers.up(2);
    expect(tracker.current()).toBe('left');
  });

  it('a pointer id that was never lifted (lost event) is replaced, not stuck', () => {
    const { pointers, tracker } = rig();
    pointers.down(1, 'left');
    pointers.down(1, 'right');
    pointers.up(1);
    expect(tracker.current()).toBe('none');
  });

  it('clear (blur, hidden tab, controls removed) lets go of every finger', () => {
    const { pointers, tracker, sent, tick } = rig();
    pointers.down(1, 'down');
    pointers.down(2, 'right');
    tick();
    pointers.clear();
    tick();
    expect(tracker.current()).toBe('none');
    expect(sent.at(-1)?.dir).toBe('none');
    pointers.up(1); // the real pointerup arrives after the blur: harmless
    pointers.up(2);
    expect(tracker.current()).toBe('none');
  });

  it('events for a pointer that was never pressed do nothing', () => {
    const { pointers, tracker } = rig();
    pointers.move(9, 'left');
    pointers.up(9);
    expect(tracker.current()).toBe('none');
  });
});

describe('dragging a finger across the real pad (what pointermove does)', () => {
  type Pt = [number, number];
  const line = (a: Pt, b: Pt, steps = 40): Pt[] =>
    Array.from(
      { length: steps + 1 },
      (_, i): Pt => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps],
    );

  /** Presses where the path starts, follows every point, and records what is held after each. */
  function swipe(path: Pt[]) {
    const r = rig();
    const [first, ...rest] = path;
    if (!first) throw new Error('empty path');
    const start = hitTouch(PAD, BOMB, first[0], first[1]);
    if (start === undefined) throw new Error('the swipe must start on the pad');
    r.pointers.down(1, start);
    const held = [r.tracker.current()];
    for (const [x, y] of rest) {
      r.pointers.move(1, hitTouch(PAD, BOMB, x, y));
      held.push(r.tracker.current());
    }
    return { ...r, held, seen: [...new Set(held)] };
  }
  const centre = (name: 'up' | 'left' | 'right' | 'down'): Pt => {
    const w = 56;
    const cells = { up: [1, 0], left: [0, 1], right: [2, 1], down: [1, 2] } as const;
    const [cx, cy] = cells[name];
    return [PAD.left + cx * (w + 2) + w / 2, PAD.top + cy * (w + 2) + w / 2];
  };

  it('left to right straight through the empty centre: left, a pause in the middle, then right', () => {
    const s = swipe(line(centre('left'), centre('right')));
    expect(s.seen).toEqual(['left', 'none', 'right']);
    expect(s.held.at(-1)).toBe('right');
    s.pointers.up(1);
    expect(s.tracker.current()).toBe('none'); // still tracked all the way: the lift releases it
  });

  it('up to down through the centre works the same way', () => {
    const s = swipe(line(centre('up'), centre('down')));
    expect(s.seen).toEqual(['up', 'none', 'down']);
    expect(s.held.at(-1)).toBe('down');
  });

  it('every pair of directions: the swipe ends on the direction it ended on, never dropped on the way', () => {
    const names = ['up', 'left', 'right', 'down'] as const;
    for (const from of names) {
      for (const to of names) {
        if (from === to) continue;
        const s = swipe(line(centre(from), centre(to)));
        expect(s.held.at(-1), `${from} -> ${to}`).toBe(to);
        // the finger stayed tracked the whole way: lifting it releases what it held, it is not already gone
        s.pointers.up(1);
        expect(s.tracker.current(), `${from} -> ${to} lifted`).toBe('none');
      }
    }
  });

  it('a diagonal swipe left -> up, over the corner and the gaps, holds only left and up', () => {
    const s = swipe(line(centre('left'), centre('up'), 200));
    expect(s.held.at(-1)).toBe('up');
    for (const dir of s.seen) expect(['left', 'up', 'none']).toContain(dir);
  });

  it('a finger landing in a gap or the corner picks a direction instead of doing nothing', () => {
    const gap = hitTouch(PAD, BOMB, CX, PAD.top + 57); // between the up button and the centre cell
    expect(gap).toBe('up');
    const r = rig();
    r.pointers.down(1, hitTouch(PAD, BOMB, PAD.left + 5, PAD.top + 5) as TouchHit);
    expect(r.tracker.current()).toBe('left');
  });

  it('swiping off the pad lets go for good, even if it comes back', () => {
    const r = rig();
    r.pointers.down(1, 'left');
    r.pointers.move(1, hitTouch(PAD, BOMB, 220, 646)); // the gap between the pad and the bomb
    expect(r.tracker.current()).toBe('none');
    r.pointers.move(1, hitTouch(PAD, BOMB, PAD.left + 10, CY));
    expect(r.tracker.current()).toBe('none');
  });

  it('a finger resting in the centre holds nothing and can still set off in any direction', () => {
    const r = rig();
    r.pointers.down(1, 'neutral');
    expect(r.tracker.current()).toBe('none');
    r.pointers.move(1, 'left');
    expect(r.tracker.current()).toBe('left');
    r.pointers.move(1, 'neutral');
    expect(r.tracker.current()).toBe('none');
    r.pointers.move(1, undefined);
    r.pointers.move(1, 'right'); // let go for good
    expect(r.tracker.current()).toBe('none');
    r.pointers.up(1);
  });

  it('a finger that started on the bomb and slides onto the pad (or back) lets go and does not walk', () => {
    const r = rig();
    r.pointers.down(1, 'bomb');
    r.pointers.move(1, 'left');
    expect(r.tracker.current()).toBe('none');
    r.pointers.up(1);
  });
});
