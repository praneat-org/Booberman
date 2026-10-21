import { exampleServerMessages } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import {
  REMATCH_ECHO_TIMEOUT_MS,
  REMATCH_WINDOW_MS,
  type RematchView,
  rematchButtonLocked,
  rematchCountdownText,
  rematchStatusText,
  toEndView,
  toRematchView,
  toWaitingRows,
  waitingStatusText,
} from './endView';
import { Roster } from './hudView';

const roster = () => {
  const r = new Roster();
  r.join('p1', 'มิ้นท์');
  r.join('p2', 'Bob');
  r.join('p3', 'Cat');
  return r;
};

describe('waiting room (BE-57)', () => {
  it('lists everyone in the room by id, with who is ready and who we are', () => {
    const rows = toWaitingRows({ ready: ['p2'], deadline: 0 }, roster(), 'p1');
    expect(rows.map((r) => [r.id, r.name, r.isSelf, r.ready])).toEqual([
      ['p1', 'มิ้นท์', true, false],
      ['p2', 'Bob', false, true],
      ['p3', 'Cat', false, false],
    ]);
  });

  it('asks for a friend while alone, then counts who is ready', () => {
    const alone = new Roster();
    alone.join('p1', 'มิ้นท์');
    expect(waitingStatusText(toRematchView(undefined, alone, 'p1', 0))).toContain('อย่างน้อย 2 คน');
    const v = toRematchView({ ready: ['p1'], deadline: 0 }, roster(), 'p1', 0);
    expect(waitingStatusText(v)).toBe('พร้อมแล้ว 1/3 · เริ่มเมื่อทุกคนกดพร้อม');
  });
});

describe('toEndView', () => {
  it('keeps the server order of the rows: rank is the position, nothing is re-sorted', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), 'p1');
    expect(v.rows.map((r) => [r.rank, r.id, r.name])).toEqual([
      [1, 'p2', 'Bob'],
      [2, 'p1', 'มิ้นท์'],
      [3, 'p3', 'Cat'],
    ]);
    // a server table that is NOT sorted by แต้มเกรียน is shown as sent (the server owns the order)
    const odd = {
      ...exampleServerMessages.roundEndWin,
      stats: [...exampleServerMessages.roundEndWin.stats].reverse(),
    };
    expect(toEndView(odd, roster(), 'p1').rows.map((r) => r.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('shows kills, deaths and แต้มเกรียน straight from the stats', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), 'p1');
    expect(v.rows[0]).toMatchObject({ kills: 2, deaths: 0, trollPoints: 5 });
    expect(v.rows[2]).toMatchObject({ kills: 0, deaths: 1, trollPoints: 0 });
  });

  it('marks our own row', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), 'p1');
    expect(v.rows.filter((r) => r.isSelf).map((r) => r.id)).toEqual(['p1']);
  });

  it('headline: "you won" for us, the winner by name for someone else', () => {
    expect(toEndView(exampleServerMessages.roundEndWin, roster(), 'p2')).toMatchObject({
      headline: 'คุณชนะ!',
      youWon: true,
      winner: 'p2',
      reason: 'รอดคนสุดท้าย',
    });
    expect(toEndView(exampleServerMessages.roundEndWin, roster(), 'p1')).toMatchObject({
      headline: 'Bob ชนะ',
      youWon: false,
    });
  });

  it('a draw (winner null) says เสมอ with the reason, for both kinds of draw', () => {
    expect(toEndView(exampleServerMessages.roundEndDraw, roster(), 'p1')).toMatchObject({
      headline: 'เสมอ',
      winner: null,
      youWon: false,
      reason: 'ตายพร้อมกันทั้งหมด',
    });
    expect(toEndView(exampleServerMessages.roundEndTimeout, roster(), 'p1')).toMatchObject({
      headline: 'เสมอ',
      reason: 'หมดเวลา',
    });
  });

  it('titles come as the server sent them, with the Thai name and the holders by name', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), 'p3');
    expect(v.titles.map((t) => [t.title, t.label, t.holders.map((h) => h.name), t.value])).toEqual([
      ['spreader', 'ผู้แพร่เชื้อ', ['Bob'], 2],
      ['selfKiller', 'ฆ่าตัวเองเก่ง', ['Cat'], 1],
      ['troll', 'ตัวตึงสายเกรียน', ['Bob'], 5],
    ]);
    expect(v.titles[1]?.holders[0]?.isSelf).toBe(true);
  });

  it('a title that several players tied on lists all of them', () => {
    const v = toEndView(exampleServerMessages.roundEndDraw, roster(), 'p1');
    expect(v.titles).toHaveLength(1);
    expect(v.titles[0]?.holders.map((h) => h.id)).toEqual(['p1', 'p2']);
  });

  it('shows no title line when the server sent none (a value of 0 is never sent)', () => {
    expect(toEndView(exampleServerMessages.roundEndTimeout, roster(), 'p1').titles).toEqual([]);
  });

  it('units: แต้ม for the troll title, ครั้ง for counts', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), 'p1');
    expect(v.titles.map((t) => t.unit)).toEqual(['ครั้ง', 'ครั้ง', 'แต้ม']);
  });

  it('falls back to the id when the roster has no name', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, new Roster(), 'p1');
    expect(v.rows[0]?.name).toBe('p2');
    expect(v.headline).toBe('p2 ชนะ');
  });

  it('works before we know who we are (no welcome yet): nobody is "you"', () => {
    const v = toEndView(exampleServerMessages.roundEndWin, roster(), undefined);
    expect(v.youWon).toBe(false);
    expect(v.rows.some((r) => r.isSelf)).toBe(false);
  });
});

describe('toRematchView', () => {
  const NOW = 1_739_000_000_000;

  it('nobody pressed: no countdown (deadline 0), nobody ready', () => {
    expect(toRematchView({ ready: [], deadline: 0 }, roster(), 'p1', NOW)).toEqual({
      readyNames: [],
      readyCount: 0,
      total: 3,
      selfReady: false,
      secondsLeft: undefined,
    });
    expect(toRematchView(undefined, roster(), 'p1', NOW).secondsLeft).toBeUndefined();
  });

  it('lists who is ready in the server order and whether we are one of them', () => {
    const v = toRematchView({ ready: ['p3', 'p1'], deadline: NOW + 9000 }, roster(), 'p1', NOW);
    expect(v).toMatchObject({
      readyNames: ['Cat', 'มิ้นท์'],
      readyCount: 2,
      total: 3,
      selfReady: true,
      secondsLeft: 9,
    });
    expect(
      toRematchView({ ready: ['p3'], deadline: NOW + 9000 }, roster(), 'p1', NOW).selfReady,
    ).toBe(false);
  });

  it('rounds the countdown up so it never shows 0 before the time is up', () => {
    const at = (ms: number) =>
      toRematchView({ ready: ['p1'], deadline: NOW + ms }, roster(), 'p1', NOW).secondsLeft;
    expect(at(14_001)).toBe(15);
    expect(at(1)).toBe(1);
    expect(at(1000)).toBe(1);
    expect(at(0)).toBe(0);
  });

  it('is clamped to 0..15 s: a past deadline reads 0, one far ahead (device clock behind) reads 15', () => {
    const at = (ms: number) =>
      toRematchView({ ready: ['p1'], deadline: NOW + ms }, roster(), 'p1', NOW).secondsLeft;
    expect(at(-5000)).toBe(0);
    expect(at(10 * 60_000)).toBe(REMATCH_WINDOW_MS / 1000);
  });

  it('counts the whole room as the total, never fewer than the ready list', () => {
    expect(toRematchView({ ready: ['p1'], deadline: 0 }, new Roster(), 'p1', NOW).total).toBe(1);
  });

  it('not knowing who we are is not being ready', () => {
    expect(
      toRematchView({ ready: ['p1'], deadline: NOW }, roster(), undefined, NOW).selfReady,
    ).toBe(false);
  });
});

describe('rematch texts', () => {
  const view = (over: Partial<RematchView> = {}): RematchView => ({
    readyNames: [],
    readyCount: 0,
    total: 3,
    selfReady: false,
    secondsLeft: undefined,
    ...over,
  });

  it('explains the rule while nobody is ready', () => {
    expect(rematchStatusText(view())).toBe('รอบใหม่เริ่มเมื่อทุกคนกดพร้อม หรือครบ 15 วินาทีหลังมีคนกดคนแรก');
  });

  it('says who is ready and how many of the room', () => {
    expect(rematchStatusText(view({ readyNames: ['Bob', 'Cat'], readyCount: 2 }))).toBe(
      'พร้อมแล้ว 2/3: Bob, Cat',
    );
  });

  it('countdown: nothing before the first press, seconds while it runs, "starting" at 0', () => {
    expect(rematchCountdownText(undefined)).toBeUndefined();
    expect(rematchCountdownText(12)).toBe('เริ่มรอบใหม่ใน 12 วินาที');
    expect(rematchCountdownText(0)).toBe('กำลังเริ่มรอบใหม่…');
  });

  it('the button is locked once the server counts us ready, or briefly after our press', () => {
    expect(rematchButtonLocked(false, undefined, 10_000)).toBe(false);
    expect(rematchButtonLocked(true, undefined, 10_000)).toBe(true);
    expect(rematchButtonLocked(false, 10_000, 10_000 + REMATCH_ECHO_TIMEOUT_MS - 1)).toBe(true);
  });

  it('a press the server never answered gives the button back after the timeout', () => {
    expect(rematchButtonLocked(false, 10_000, 10_000 + REMATCH_ECHO_TIMEOUT_MS)).toBe(false);
    // ...unless the server did answer
    expect(rematchButtonLocked(true, 10_000, 10_000 + REMATCH_ECHO_TIMEOUT_MS * 5)).toBe(true);
  });
});
