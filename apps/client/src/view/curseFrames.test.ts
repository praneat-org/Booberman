import { describe, expect, it } from 'vitest';
import { toCurseFrames } from './curseFrames';
import type { Drawable } from './roundView';

const entry = (
  id: 'p1' | 'p2',
  over: { cursed?: boolean; alive?: boolean; phase?: 'alive' | 'dying' } = {},
): Drawable['players'][number] =>
  ({
    view: {
      id,
      px: 16,
      py: 32,
      alive: over.alive ?? true,
      cursed: over.cursed ?? true,
      isSelf: false,
      tint: 0xffffff,
    },
    anim: { phase: over.phase ?? 'alive' },
  }) as Drawable['players'][number];

describe('toCurseFrames', () => {
  it('frames only cursed, living, non-dying players', () => {
    const frames = toCurseFrames(
      [
        entry('p1'),
        entry('p2', { cursed: false }),
        entry('p2', { alive: false }),
        entry('p2', { phase: 'dying' }),
      ],
      0,
    );
    expect(frames).toEqual([{ key: 'p1', px: 16, py: 32, visible: true }]);
  });
  it('blinks with the server tick', () => {
    expect(toCurseFrames([entry('p1')], 3)[0]?.visible).toBe(false);
    expect(toCurseFrames([entry('p1')], 6)[0]?.visible).toBe(true);
  });
});
