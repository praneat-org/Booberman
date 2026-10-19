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

describe('roster (HUD nicknames)', () => {
  const joined = (id: 'p1' | 'p2', nickname: string) =>
    ({ ...exampleServerMessages.playerJoined, playerId: id, nickname }) as const;

  it('joins and leaves update the roster without touching the board', () => {
    const round = newRound();
    expect(applyBoardEvent(joined('p1', 'a'), round)).toBe(false);
    applyBoardEvent(joined('p2', 'b'), round);
    applyBoardEvent({ ...exampleServerMessages.playerLeft, playerId: 'p2' }, round);
    expect(round.roster.nameOf('p1')).toBe('a');
    expect(round.roster.nameOf('p2')).toBeUndefined();
  });

  it('roundStart keeps the room (no joins are replayed), welcome starts a fresh roster', () => {
    const round = newRound();
    applyBoardEvent(joined('p1', 'a'), round);
    applyBoardEvent(exampleServerMessages.roundStart, round);
    expect(round.roster.nameOf('p1')).toBe('a');
    applyWelcome({ grid: exampleGrid() }, round);
    expect(round.roster.nameOf('p1')).toBeUndefined();
  });

  it('roundStart drops the old snapshot, so the HUD shows no stale cards or time', () => {
    const round = newRound();
    feed(round, busy(100, [p(1, 1)]));
    expect(round.latest).toBeDefined();
    applyBoardEvent(exampleServerMessages.roundStart, round);
    expect(round.latest).toBeUndefined();
  });
});

describe('sounds follow the round view (FE-18)', () => {
  /** Like `feed`, but returns the sounds that frame called for. */
  const hear = (round: RoundView, snap: Snapshot) => {
    round.applySnapshot(snap, snap.tick * 50);
    return round.frame(snap.tick * 50);
  };
  const quiet = (tick: number, players: PlayerState[] = [p(1, 1)]): Snapshot => ({
    ...exampleServerMessages.snapshot,
    tick,
    players,
    bombs: [],
    flames: [],
    items: [],
  });

  it('frame() returns the sounds of the snapshot just drawn', () => {
    const round = newRound();
    expect(hear(round, quiet(1))).toEqual([]);
    expect(hear(round, { ...quiet(2), bombs: [{ x: 3, y: 3, fuse: 40 }] })).toEqual(['bombPlace']);
    expect(hear(round, { ...quiet(3), flames: [[3, 3]] })).toEqual(['explode']);
  });

  it('roundEnd with a winner plays win when the snapshot after the newest received is drawn', () => {
    const round = newRound();
    hear(round, quiet(10));
    expect(applyBoardEvent(exampleServerMessages.roundEndWin, round)).toBe(false);
    expect(round.frame(10 * 50)).toEqual([]);
    expect(hear(round, quiet(11))).toEqual(['win']);
    expect(hear(round, quiet(12))).toEqual([]);
  });

  it('a draw makes no win sound', () => {
    for (const draw of [
      exampleServerMessages.roundEndDraw,
      exampleServerMessages.roundEndTimeout,
    ]) {
      const round = newRound();
      hear(round, quiet(10));
      applyBoardEvent(draw, round);
      expect(hear(round, quiet(11))).toEqual([]);
    }
  });

  it('roundStart and welcome reset the tracker: the old round vanishing is not heard, a waiting win is dropped', () => {
    for (const reset of [
      (r: RoundView) => applyBoardEvent(exampleServerMessages.roundStart, r),
      (r: RoundView) => applyWelcome({ grid: exampleGrid() }, r),
    ]) {
      const round = newRound();
      hear(round, {
        ...quiet(10),
        bombs: [{ x: 3, y: 3, fuse: 5 }],
        items: [{ x: 5, y: 1, kind: 'curse' }],
      });
      applyBoardEvent(exampleServerMessages.roundEndWin, round);
      reset(round);
      // a snapshot that, next to the old round's, would read as an explosion + a pickup + a win
      expect(hear(round, { ...quiet(11), flames: [[3, 3]] })).toEqual([]);
      expect(hear(round, quiet(12))).toEqual([]);
    }
  });
});
