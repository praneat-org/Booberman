import { exampleGrid, exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { SnapshotMessage } from '../net/Transport';
import { applyBoardEvent, applyWelcome } from './boardEvents';
import { toHudView } from './hudView';
import { RoundView } from './roundView';

const pl = (x: number, teleport = false): PlayerState => ({
  id: 'p1',
  x,
  y: 1,
  alive: true,
  curse: 0,
  teleport,
});
const snap = (tick: number, p: PlayerState): SnapshotMessage => ({
  ...exampleServerMessages.snapshot,
  tick,
  players: [p],
});
const send = (r: RoundView, tick: number, p: PlayerState) =>
  r.applySnapshot(snap(tick, p), tick * 50);

describe('RoundView interpolation', () => {
  it('draws nothing until frame() has a snapshot, then the interpolated position', () => {
    const r = new RoundView();
    send(r, 10, pl(1));
    expect(r.drawable('p1').players).toHaveLength(0);
    send(r, 11, pl(1.1));
    send(r, 12, pl(1.2));
    send(r, 13, pl(1.3));
    r.frame(13 * 50 + 25);
    expect(r.drawable('p1').players[0]?.view.px).toBeCloseTo(1.15 * 16);
  });

  it('walking is read from the interpolated motion, a teleport is not a walk', () => {
    const r = new RoundView(0);
    send(r, 10, pl(1));
    send(r, 11, pl(1.1));
    r.frame(500);
    r.frame(525);
    expect(r.playerAnims.get('p1')?.moving).toBe(true);
    send(r, 12, pl(11, true));
    r.frame(600);
    expect(r.playerAnims.get('p1')?.moving).toBe(false);
  });

  it('a distance snap with no server flag is not a walk either', () => {
    const r = new RoundView(0);
    send(r, 10, pl(1));
    send(r, 11, pl(1.1));
    r.frame(500);
    r.frame(525);
    expect(r.playerAnims.get('p1')?.moving).toBe(true);
    send(r, 12, pl(8));
    send(r, 13, pl(8));
    r.frame(650);
    expect(r.playerAnims.get('p1')?.moving).toBe(false);
  });

  it('welcome and roundStart empty the buffer; lower ticks of the next round are accepted', () => {
    for (const reset of [
      (r: RoundView) => applyWelcome({ grid: exampleGrid() }, r),
      (r: RoundView) => applyBoardEvent(exampleServerMessages.roundStart, r),
    ]) {
      const r = new RoundView(0);
      send(r, 100, pl(1));
      send(r, 101, pl(1.1));
      r.frame(5050);
      expect(r.buffer.size).toBeGreaterThan(0);
      reset(r);
      expect(r.buffer.size).toBe(0);
      expect(r.renderTick).toBeUndefined();
      expect(r.latest).toBeUndefined();
      send(r, 1, pl(7));
      r.frame(50);
      expect(r.drawable('p1').players[0]?.view.px).toBe(7 * 16);
    }
  });

  it('welcome clears buffer AND roster; roundStart clears the buffer but keeps the roster', () => {
    const fill = (r: RoundView) => {
      r.roster.join('p1', 'mint');
      send(r, 100, pl(1));
      send(r, 101, pl(1.1));
      r.frame(5050);
    };
    const a = new RoundView(0);
    fill(a);
    applyBoardEvent(exampleServerMessages.roundStart, a);
    expect(a.buffer.size).toBe(0);
    expect(a.latest).toBeUndefined();
    expect(a.roster.nameOf('p1')).toBe('mint');
    const b = new RoundView(0);
    fill(b);
    applyWelcome({ grid: exampleGrid() }, b);
    expect(b.buffer.size).toBe(0);
    expect(b.latest).toBeUndefined();
    expect(b.roster.nameOf('p1')).toBeUndefined();
  });

  it('the HUD reads the interpolated sample: curse and alive flow through, nothing before the first frame', () => {
    const r = new RoundView(0);
    r.roster.join('p1', 'mint');
    expect(toHudView(r.latest, r.roster, 'p1').cards).toHaveLength(0);
    send(r, 10, { ...pl(1), curse: 40 });
    send(r, 11, { ...pl(1.1), curse: 40 });
    r.frame(525);
    const card = toHudView(r.latest, r.roster, 'p1').cards[0];
    expect(card?.status).toBe('cursed');
    expect(card?.curseSeconds).toBe(2);
    expect(card?.name).toBe('mint');
  });
});
