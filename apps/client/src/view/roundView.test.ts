import { exampleGrid, exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import type { SnapshotMessage } from '../net/Transport';
import { applyBoardEvent, applyWelcome } from './boardEvents';
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
});
