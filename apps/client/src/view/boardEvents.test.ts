import {
  exampleGrid,
  exampleServerMessages,
  type PlayerState,
  type ServerMessage,
} from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { applyBoardEvent, applyWelcome } from './boardEvents';
import { RoundView } from './roundView';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;

const p = (x: number, y: number, alive = true): PlayerState => ({
  id: 'p1',
  x,
  y,
  alive,
  curse: 0,
  teleport: false,
});

/** A snapshot with one of everything, built from the protocol example. */
const busy = (tick: number, players: PlayerState[]): Snapshot => ({
  ...exampleServerMessages.snapshot,
  tick,
  players,
  bombs: [{ x: 3, y: 3, fuse: 10 }],
  flames: [[4, 3]],
  items: [{ x: 5, y: 1, kind: 'kick' }],
});

/** No interpolation delay: `feed` makes a snapshot the drawn one at once (tick n arrives at n * 50 ms). */
const feed = (round: RoundView, snap: Snapshot): void => {
  round.applySnapshot(snap, snap.tick * 50);
  round.frame(snap.tick * 50);
};

const newRound = () => {
  const round = new RoundView(0);
  round.reset(exampleGrid());
  return round;
};

describe('board events and the round view', () => {
  it('roundStart clears the tracker: no one-tick walk from the corpse to the spawn', () => {
    const round = newRound();
    feed(round, busy(10, [p(5, 5, false)]));
    applyBoardEvent(exampleServerMessages.roundStart, round);
    feed(round, busy(11, [p(1, 1)]));
    expect(round.playerAnims.get('p1')).toMatchObject({
      moving: false,
      phase: 'alive',
      facing: 'down',
    });
  });

  it('roundStart: nothing from the old round is drawable until the new snapshot', () => {
    const round = newRound();
    feed(round, busy(10, [p(5, 5)]));
    const before = round.drawable('p1');
    expect(before.bombs.length + before.flames.length + before.items.length).toBe(3);
    expect(before.players).toHaveLength(1);

    const replaced = applyBoardEvent(exampleServerMessages.roundStart, round);
    expect(replaced).toBe(true);
    expect(round.latest).toBeUndefined();
    expect(round.playerAnims.size).toBe(0);
    expect(round.drawable('p1')).toEqual({ bombs: [], flames: [], items: [], players: [] });
  });

  it('roundStart still resets the boxes; boxDestroyed keeps the snapshot and the tracker', () => {
    const round = newRound();
    feed(round, busy(1, [p(1, 1)]));
    const replaced = applyBoardEvent({ ...exampleServerMessages.boxDestroyed, x: 3, y: 1 }, round);
    expect(replaced).toBe(false);
    expect(round.boxes.has(3, 1)).toBe(false);
    expect(round.latest).toBeDefined();
    feed(round, busy(2, [p(1.25, 1)]));
    expect(round.playerAnims.get('p1')?.moving).toBe(true);
    applyBoardEvent(exampleServerMessages.roundStart, round);
    expect(round.boxes.has(3, 1)).toBe(true);
  });

  it('welcome (also a new board) resets everything too', () => {
    const round = new RoundView(0);
    feed(round, busy(1, [p(5, 5)]));
    applyWelcome({ grid: exampleGrid() }, round);
    expect(round.latest).toBeUndefined();
    expect(round.drawable('p1').players).toHaveLength(0);
    feed(round, busy(2, [p(1, 1)]));
    expect(round.playerAnims.get('p1')?.moving).toBe(false);
  });
});
