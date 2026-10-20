import type { PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_OBSERVE_GAP_TICKS, type ObservedSnapshot, SfxTracker } from './sfxTracker';

const player = (id: string, alive = true): PlayerState => ({
  id: id as PlayerState['id'],
  x: 1,
  y: 1,
  alive,
  curse: 0,
  teleport: false,
});

const snap = (tick: number, patch: Partial<ObservedSnapshot> = {}): ObservedSnapshot => ({
  tick,
  players: [player('p1'), player('p2')],
  bombs: [],
  flames: [],
  items: [],
  ...patch,
});

const bomb = (x: number, y: number) => ({ x, y, fuse: 20 });

/** A tracker that has already drawn tick 1 (the baseline). */
const started = (first: Partial<ObservedSnapshot> = {}, options?: { deriveDeaths?: boolean }) => {
  const t = new SfxTracker(options);
  expect(t.observe(snap(1, first))).toEqual([]);
  return t;
};

describe('SfxTracker', () => {
  it('the first snapshot is only remembered: bombs, flames, items and corpses already there are silent', () => {
    const t = new SfxTracker();
    const first = snap(5, {
      bombs: [bomb(3, 3)],
      flames: [[4, 4]],
      items: [{ x: 5, y: 1, kind: 'curse' }],
      players: [player('p1'), player('p2', false)],
    });
    expect(t.observe(first)).toEqual([]);
  });

  it('a bomb on a new tile is bombPlace, once per snapshot however many were placed', () => {
    const t = started();
    expect(t.observe(snap(2, { bombs: [bomb(3, 3), bomb(5, 5)] }))).toEqual(['bombPlace']);
    expect(t.observe(snap(3, { bombs: [bomb(3, 3), bomb(5, 5)] }))).toEqual([]);
  });

  it('the same tick drawn again on the next frame (60 fps vs 20 Hz) makes no sound', () => {
    const t = started();
    const placed = snap(2, { bombs: [bomb(3, 3)] });
    expect(t.observe(placed)).toEqual(['bombPlace']);
    expect(t.observe(placed)).toEqual([]);
    expect(t.observe(placed)).toEqual([]);
  });

  it('a bomb that is gone while a flame burns on its tile is explode', () => {
    const t = started({ bombs: [bomb(3, 3)] });
    expect(t.observe(snap(2, { flames: [[3, 3]] }))).toEqual(['explode']);
  });

  it('a chain of three bombs is one explode, not three', () => {
    const t = started({ bombs: [bomb(3, 3), bomb(4, 3), bomb(5, 3)] });
    const flames: [number, number][] = [
      [3, 3],
      [4, 3],
      [5, 3],
      [6, 3],
    ];
    expect(t.observe(snap(2, { flames }))).toEqual(['explode']);
  });

  it('a bomb that just vanishes (no flame on its tile) is not an explosion', () => {
    const t = started({ bombs: [bomb(3, 3)] });
    expect(t.observe(snap(2, { flames: [[9, 9]] }))).toEqual([]);
  });

  it('a flame that keeps burning for the next ticks does not explode again', () => {
    const t = started({ bombs: [bomb(3, 3)] });
    expect(t.observe(snap(2, { flames: [[3, 3]] }))).toEqual(['explode']);
    expect(t.observe(snap(3, { flames: [[3, 3]] }))).toEqual([]);
  });

  it('alive -> dead is die once; staying dead, leaving the room or appearing dead are silent', () => {
    const t = started();
    const dead = snap(2, { players: [player('p1'), player('p2', false)] });
    expect(t.observe(dead)).toEqual(['die']);
    expect(t.observe(snap(3, dead))).toEqual([]);

    const t2 = started();
    expect(t2.observe(snap(2, { players: [player('p1')] }))).toEqual([]); // p2 left
    expect(t2.observe(snap(3, { players: [player('p1'), player('p3', false)] }))).toEqual([]);
  });

  it('with deriveDeaths off (the server kill event takes over) a death in the snapshot is silent', () => {
    const t = started({}, { deriveDeaths: false });
    expect(t.observe(snap(2, { players: [player('p1'), player('p2', false)] }))).toEqual([]);
  });

  it('an item that left the floor is pickup; new items and items that stay are silent', () => {
    const t = started({ items: [{ x: 5, y: 1, kind: 'curse' }] });
    expect(t.observe(snap(2, { items: [{ x: 5, y: 1, kind: 'curse' }] }))).toEqual([]);
    expect(
      t.observe(
        snap(3, {
          items: [
            { x: 5, y: 1, kind: 'curse' },
            { x: 7, y: 7, kind: 'kick' },
          ],
        }),
      ),
    ).toEqual([]);
    expect(t.observe(snap(4, { items: [{ x: 7, y: 7, kind: 'kick' }] }))).toEqual(['pickup']);
  });

  it('several things in one tick each sound once, place before explode before die before pickup', () => {
    const t = started({ bombs: [bomb(3, 3)], items: [{ x: 5, y: 1, kind: 'curse' }] });
    const out = t.observe(
      snap(2, {
        bombs: [bomb(8, 8)],
        flames: [[3, 3]],
        items: [],
        players: [player('p1'), player('p2', false)],
      }),
    );
    expect(out).toEqual(['bombPlace', 'explode', 'die', 'pickup']);
  });

  it('a skipped tick still shows the change (the draw loop can be slower than the server)', () => {
    const t = started({ bombs: [bomb(3, 3)] });
    expect(t.observe(snap(4, { flames: [[3, 3]] }))).toEqual(['explode']);
  });

  describe('win', () => {
    it('plays when the snapshot after the newest one received is drawn, after the death sound', () => {
      const t = started();
      t.observe(snap(10));
      // roundEnd arrives before the snapshot of the tick it happened in (tick 11)
      t.roundEnded('p1', 10);
      expect(t.observe(snap(10))).toEqual([]);
      const end = snap(11, { players: [player('p1'), player('p2', false)] });
      expect(t.observe(end)).toEqual(['die', 'win']);
      expect(t.observe(snap(12, end))).toEqual([]);
    });

    it('waits while older snapshots are still being drawn', () => {
      const t = started();
      t.roundEnded('p1', 5);
      expect(t.observe(snap(3))).toEqual([]);
      expect(t.observe(snap(4))).toEqual([]);
      expect(t.observe(snap(5))).toEqual([]);
      expect(t.observe(snap(6))).toEqual(['win']);
    });

    it('a draw (winner null) has no jingle', () => {
      const t = started();
      t.roundEnded(null, 1);
      expect(t.observe(snap(2))).toEqual([]);
      expect(t.observe(snap(3))).toEqual([]);
    });

    it('a win that arrives before any snapshot is drawn is dropped (we joined a finished round)', () => {
      const t = new SfxTracker();
      t.roundEnded('p1', undefined);
      expect(t.observe(snap(7))).toEqual([]);
      expect(t.observe(snap(8))).toEqual([]);
    });

    it('is dropped by reset(): the next round starts quiet', () => {
      const t = started();
      t.roundEnded('p1', 1);
      t.reset();
      expect(t.observe(snap(1))).toEqual([]);
      expect(t.observe(snap(2))).toEqual([]);
    });
  });

  describe('stale news is not played', () => {
    it('a gap longer than MAX_OBSERVE_GAP_TICKS (tab was in the background) only re-baselines', () => {
      const t = started({ bombs: [bomb(3, 3)] });
      t.roundEnded('p1', 1);
      const later = snap(2 + MAX_OBSERVE_GAP_TICKS, {
        flames: [[3, 3]],
        players: [player('p1'), player('p2', false)],
      });
      expect(t.observe(later)).toEqual([]);
      // the win that was waiting is old news too
      expect(t.observe(snap(3 + MAX_OBSERVE_GAP_TICKS, later))).toEqual([]);
    });

    it('a gap of exactly MAX_OBSERVE_GAP_TICKS is still played', () => {
      const t = started({ bombs: [bomb(3, 3)] });
      expect(t.observe(snap(1 + MAX_OBSERVE_GAP_TICKS, { flames: [[3, 3]] }))).toEqual(['explode']);
    });

    it('a tick counter that jumped back a long way (server restart) re-baselines instead of staying mute', () => {
      const t = new SfxTracker();
      t.observe(snap(500, { bombs: [bomb(3, 3)] }));
      expect(t.observe(snap(2, { bombs: [bomb(3, 3)] }))).toEqual([]);
      expect(t.observe(snap(3, { bombs: [bomb(3, 3), bomb(4, 4)] }))).toEqual(['bombPlace']);
    });
  });

  it('reset(): a new round starts from a clean slate, the old bombs vanishing is not an explosion', () => {
    const t = started({
      bombs: [bomb(3, 3)],
      items: [{ x: 5, y: 1, kind: 'curse' }],
      players: [player('p1'), player('p2', false)],
    });
    t.reset();
    expect(t.observe(snap(1, { players: [player('p1'), player('p2')] }))).toEqual([]);
    expect(t.observe(snap(2, { players: [player('p1'), player('p2')] }))).toEqual([]);
  });
});
