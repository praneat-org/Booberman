import type { PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { DEATH_TICKS, PlayerAnimTracker } from './playerAnim';

const p = (x: number, y: number, alive = true, teleport = false): PlayerState => ({
  id: 'p1',
  x,
  y,
  alive,
  curse: 0,
  teleport,
});

describe('PlayerAnimTracker', () => {
  it('derives facing and moving from position changes', () => {
    const t = new PlayerAnimTracker();
    expect(t.update([p(1, 1)], 1).get('p1')).toMatchObject({ facing: 'down', moving: false });
    expect(t.update([p(1.25, 1)], 2).get('p1')).toMatchObject({ facing: 'right', moving: true });
    expect(t.update([p(1.25, 0.75)], 3).get('p1')).toMatchObject({ facing: 'up', moving: true });
    expect(t.update([p(1, 0.75)], 4).get('p1')).toMatchObject({ facing: 'left', moving: true });
    // stopped: keeps the last facing
    expect(t.update([p(1, 0.75)], 5).get('p1')).toMatchObject({ facing: 'left', moving: false });
  });

  it('a teleport is not a walk', () => {
    const t = new PlayerAnimTracker();
    t.update([p(1, 1)], 1);
    expect(t.update([p(5, 5, true, true)], 2).get('p1')?.moving).toBe(false);
  });

  it('death plays for DEATH_TICKS then is gone', () => {
    const t = new PlayerAnimTracker();
    t.update([p(1, 1)], 10);
    const dying = t.update([p(1, 1, false)], 11).get('p1');
    expect(dying).toMatchObject({ phase: 'dying', progress: 0 });
    expect(t.update([p(1, 1, false)], 11 + DEATH_TICKS / 2).get('p1')?.progress).toBe(0.5);
    expect(t.update([p(1, 1, false)], 11 + DEATH_TICKS).get('p1')?.phase).toBe('gone');
  });

  it('a corpse seen for the first time is gone at once; coming back alive redraws', () => {
    const t = new PlayerAnimTracker();
    expect(t.update([p(1, 1, false)], 50).get('p1')?.phase).toBe('gone');
    expect(t.update([p(1, 1, true)], 51).get('p1')?.phase).toBe('alive');
  });

  it('forgets players that left and reset() clears everything', () => {
    const t = new PlayerAnimTracker();
    t.update([p(1, 1)], 1);
    t.update([], 2);
    expect(t.update([p(3, 3)], 3).get('p1')).toMatchObject({ facing: 'down', moving: false });
    t.update([p(3, 3.25)], 4);
    t.reset();
    expect(t.update([p(3, 3.5)], 5).get('p1')?.moving).toBe(false);
  });
});
