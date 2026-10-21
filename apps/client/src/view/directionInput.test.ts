import { describe, expect, it } from 'vitest';
import type { TransportInput } from '../net/Transport';
import { DirectionTracker, InputSender } from './directionInput';

describe('DirectionTracker', () => {
  it('is none with nothing held and follows the most recent press', () => {
    const t = new DirectionTracker();
    expect(t.current()).toBe('none');
    t.press('left');
    t.press('up');
    expect(t.current()).toBe('up');
    t.release('up');
    expect(t.current()).toBe('left');
    t.release('left');
    expect(t.current()).toBe('none');
  });

  it('re-pressing moves a key to the top; clear() forgets all', () => {
    const t = new DirectionTracker();
    t.press('left');
    t.press('right');
    t.press('left');
    expect(t.current()).toBe('left');
    t.clear();
    expect(t.current()).toBe('none');
  });
});

describe('InputSender (D27)', () => {
  function setup() {
    const sent: TransportInput[] = [];
    return { sent, sender: new InputSender((i) => sent.push(i)) };
  }

  it('sends nothing while idle and nothing again while the direction is unchanged', () => {
    const { sent, sender } = setup();
    for (let i = 0; i < 5; i++) expect(sender.update('none', false)).toBe(false);
    sender.update('right', false);
    for (let i = 0; i < 60; i++) sender.update('right', false);
    expect(sent).toEqual([{ seq: 1, dir: 'right', bomb: false }]);
  });

  it('sends on every change with a growing seq, including release → none', () => {
    const { sent, sender } = setup();
    sender.update('right', false);
    sender.update('up', false);
    sender.update('none', false);
    expect(sent.map((s) => [s.seq, s.dir])).toEqual([
      [1, 'right'],
      [2, 'up'],
      [3, 'none'],
    ]);
  });

  it('a bomb press is sent once, with the current direction', () => {
    const { sent, sender } = setup();
    sender.update('left', false);
    sender.update('left', true);
    sender.update('left', false);
    expect(sent).toEqual([
      { seq: 1, dir: 'left', bomb: false },
      { seq: 2, dir: 'left', bomb: true },
    ]);
  });

  it('blur while moving → one `none`', () => {
    const { sent, sender } = setup();
    const tracker = new DirectionTracker();
    tracker.press('down');
    sender.update(tracker.current(), false);
    tracker.clear();
    sender.update(tracker.current(), false);
    sender.update(tracker.current(), false);
    expect(sent.map((s) => s.dir)).toEqual(['down', 'none']);
  });

  it('resync (a new connection) sends the held direction again, once', () => {
    const sent: unknown[] = [];
    const sender = new InputSender((i) => sent.push(i));
    sender.update('right', false);
    expect(sender.update('right', false)).toBe(false);
    sender.resync();
    expect(sender.update('right', false)).toBe(true);
    expect(sender.update('right', false)).toBe(false);
    expect(sent).toEqual([
      { seq: 1, dir: 'right', bomb: false },
      { seq: 2, dir: 'right', bomb: false },
    ]);
  });

  it('resync with nothing held sends nothing', () => {
    const sender = new InputSender(() => {
      throw new Error('should not send');
    });
    sender.resync();
    expect(sender.update('none', false)).toBe(false);
  });
});
