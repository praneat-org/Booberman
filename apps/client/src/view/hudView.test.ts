import { exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import {
  cardRect,
  curseFrameVisible,
  curseSeconds,
  fitText,
  formatRoundTime,
  ROUND_TICKS,
  Roster,
  toHudView,
} from './hudView';

const player = (id: PlayerState['id'], over: Partial<PlayerState> = {}): PlayerState => ({
  id,
  x: 1,
  y: 1,
  alive: true,
  curse: 0,
  teleport: false,
  ...over,
});
const snap = (tick: number, players: PlayerState[]) => ({
  ...exampleServerMessages.snapshot,
  tick,
  players,
});

describe('formatRoundTime', () => {
  it('counts down from the round length', () => {
    expect(formatRoundTime(0)).toBe('2:30');
    expect(formatRoundTime(20)).toBe('2:29');
    expect(formatRoundTime(ROUND_TICKS - 1)).toBe('0:01');
  });
  it('never goes negative and survives garbage', () => {
    expect(formatRoundTime(ROUND_TICKS)).toBe('0:00');
    expect(formatRoundTime(ROUND_TICKS + 500)).toBe('0:00');
    expect(formatRoundTime(-5)).toBe('2:30');
    expect(formatRoundTime(undefined)).toBe('--:--');
    expect(formatRoundTime(Number.NaN)).toBe('--:--');
  });
});

describe('fitText', () => {
  // 5 px per UTF-16 unit; combining marks are zero width like a real font
  const measure = (s: string) => [...s].filter((c) => !/[ัิ-ฺ็-๎]/u.test(c)).length * 5;
  it('keeps text that fits', () => {
    expect(fitText('bob', 40, measure)).toBe('bob');
    expect(fitText('', 0, measure)).toBe('');
  });
  it('cuts to the width with an ellipsis', () => {
    expect(fitText('abcdefghij', 30, measure)).toBe('abcde…');
    expect(measure(fitText('abcdefghij', 30, measure))).toBeLessThanOrEqual(30);
  });
  it('never splits a Thai letter from its marks', () => {
    expect(fitText('กิ้กิ้กิ้กิ้', 15, measure)).toBe('กิ้กิ้…');
  });
  it('returns empty when even the ellipsis does not fit', () => {
    expect(fitText('abc', 4, measure)).toBe('');
  });
});

describe('curse timing', () => {
  it('rounds seconds up and is 0 only when not cursed', () => {
    expect(curseSeconds(0)).toBe(0);
    expect(curseSeconds(1)).toBe(1);
    expect(curseSeconds(120)).toBe(6);
    expect(curseSeconds(121)).toBe(7);
  });
  it('blink phase follows the server tick', () => {
    expect([0, 1, 2, 3, 5, 6].map(curseFrameVisible)).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });
});

describe('toHudView', () => {
  const roster = new Roster();
  roster.join('p1', 'มิ้นท์');
  roster.join('p2', 'averyveryverylongname');

  it('is empty before the first snapshot', () => {
    expect(toHudView(undefined, roster, 'p1')).toEqual({ time: '--:--', cards: [] });
  });

  it('builds a card per player in id order with status read from the snapshot', () => {
    const v = toHudView(
      snap(40, [
        player('p3', { alive: false, curse: 99 }),
        player('p2', { curse: 41 }),
        player('p1'),
      ]),
      roster,
      'p1',
    );
    expect(v.time).toBe('2:28');
    expect(v.cards.map((c) => [c.id, c.name, c.status, c.curseSeconds, c.isSelf])).toEqual([
      ['p1', 'มิ้นท์', 'alive', 0, true],
      ['p2', 'averyveryverylongname', 'cursed', 3, false],
      // dead beats cursed, and a dead player shows no curse timer; no nickname yet -> the id
      ['p3', 'p3', 'dead', 0, false],
    ]);
  });

  it('a player who left the roster and the snapshot disappears; a stranger falls back to the id', () => {
    roster.join('p4', 'x');
    roster.leave('p4');
    expect(roster.nameOf('p4')).toBeUndefined();
    const v = toHudView(snap(0, [player('p1')]), roster, undefined);
    expect(v.cards).toHaveLength(1);
    expect(v.cards[0]?.isSelf).toBe(false);
  });
});

describe('cardRect', () => {
  it('lays out a 2x2 grid that stays inside the canvas', () => {
    const rects = [0, 1, 2, 3].map((i) => cardRect(i, 208, 14));
    expect(rects[0]?.x).toBeLessThan(rects[1]?.x ?? 0);
    expect(rects[2]?.y).toBeGreaterThan(rects[0]?.y ?? 0);
    expect(rects[2]?.x).toBe(rects[0]?.x);
    for (const r of rects) expect(r.x + r.w).toBeLessThanOrEqual(208);
  });
});
