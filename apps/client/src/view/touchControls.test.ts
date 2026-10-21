import { describe, expect, it } from 'vitest';
import { DirectionTracker, InputSender } from './directionInput';
import {
  hitButton,
  type Rect,
  TOUCH_DIRECTIONS,
  type TouchButton,
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

describe('hitButton', () => {
  const box = (left: number, top: number): Rect => ({
    left,
    top,
    right: left + 10,
    bottom: top + 10,
  });
  const rects: Record<TouchButton, Rect> = {
    up: box(10, 0),
    left: box(0, 10),
    right: box(20, 10),
    down: box(10, 20),
    bomb: box(50, 10),
  };

  it('finds the button under the point', () => {
    expect(hitButton(rects, 15, 5)).toBe('up');
    expect(hitButton(rects, 5, 15)).toBe('left');
    expect(hitButton(rects, 25, 15)).toBe('right');
    expect(hitButton(rects, 15, 25)).toBe('down');
    expect(hitButton(rects, 55, 15)).toBe('bomb');
  });

  it('is undefined between and outside the buttons, and the far edges are outside', () => {
    expect(hitButton(rects, 15, 15)).toBeUndefined(); // the D-pad's centre has no button
    expect(hitButton(rects, 100, 100)).toBeUndefined();
    expect(hitButton(rects, 20, 5)).toBeUndefined(); // up spans x 10..20, 20 is outside
    expect(hitButton(rects, 10, 5)).toBe('up');
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
