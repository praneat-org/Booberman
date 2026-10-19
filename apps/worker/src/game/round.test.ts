import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState, startRound } from './state';
import type { Bomb, GameState, PlayerId, PlayerInput } from './types';

/** One picture row = y 1; `A`-`D` = p1-p4 on floor; everything else is wall (see simulate.test). */
function board(row: string, extra: Partial<GameState> = {}): GameState {
  const found: [PlayerId, number][] = [];
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const c = y === 1 ? (row[x] ?? '#') : '#';
      const idx = 'ABCD'.indexOf(c);
      if (idx >= 0) found.push([`p${idx + 1}` as PlayerId, x]);
      grid += idx >= 0 ? '.' : c;
    }
  }
  const base = createInitialState(
    1,
    found.map(([id]) => id),
  );
  const players = base.players.map((p) => ({
    ...p,
    x: found.find(([id]) => id === p.id)?.[1] ?? 1,
    y: 1,
  }));
  return { ...base, grid, players, ...extra };
}

const due = (x: number, ownerId: PlayerId): Bomb => ({
  x,
  y: 1,
  ownerId,
  ownerSession: Number(ownerId.slice(1)),
  fuse: 1,
});
const none = new Map<PlayerId, PlayerInput>();
const roundEnds = (events: { kind: string }[]) => events.filter((e) => e.kind === 'roundEnd');

describe('win / draw', () => {
  it('one survivor wins (reason lastAlive)', () => {
    // bomb at x4 reaches x2..x6: p2 at x5 burns, p1 at x1 is outside
    const s = board('#A...B.#', { bombs: [due(4, 'p1')] });
    const { state, events } = simulate(s, none);
    expect(state.players.map((p) => p.alive)).toEqual([true, false]);
    expect(roundEnds(events)).toEqual([
      { v: 1, t: 'event', kind: 'roundEnd', winner: 'p1', reason: 'lastAlive' },
    ]);
    expect(state.result).toEqual({ winner: 'p1', reason: 'lastAlive' });
  });

  it('everyone dying on the same tick is a draw (reason allDead)', () => {
    const s = board('#A.B..#', { bombs: [due(2, 'p1')] }); // reaches x1..x4: both die
    const { state, events } = simulate(s, none);
    expect(state.players.every((p) => !p.alive)).toBe(true);
    expect(roundEnds(events)).toEqual([
      { v: 1, t: 'event', kind: 'roundEnd', winner: null, reason: 'allDead' },
    ]);
    expect(state.result).toEqual({ winner: null, reason: 'allDead' });
  });

  it('with three players, two dying together still leaves a winner', () => {
    const s = board('#A.B..C#', { bombs: [due(2, 'p1')] });
    const { state } = simulate(s, none);
    expect(state.result).toEqual({ winner: 'p3', reason: 'lastAlive' });
  });

  it('with three players, all three dying together is a draw', () => {
    const s = board('#ABC...#', { bombs: [due(2, 'p1')] }); // x1..x4 burn
    expect(simulate(s, none).state.result).toEqual({ winner: null, reason: 'allDead' });
  });

  it('the round keeps going while two or more are alive', () => {
    const s = board('#A...B.#');
    const { state, events } = simulate(s, none);
    expect(state.result).toBeUndefined();
    expect(roundEnds(events)).toHaveLength(0);
  });

  it('a lone player is not "the last survivor": no round end by elimination', () => {
    let s = board('#A.....#');
    for (let i = 0; i < 5; i++) s = simulate(s, none).state;
    expect(s.result).toBeUndefined();
  });

  it('roundEnd comes after the other events of the tick', () => {
    // bomb at x3 reaches x1..x5: the box at x5 breaks and both players burn
    const s = board('#A.B.x.#', { bombs: [due(3, 'p1')] });
    const { events } = simulate(s, none);
    expect(events.at(-1)).toMatchObject({ kind: 'roundEnd' });
    expect(events.some((e) => e.kind === 'boxDestroyed')).toBe(true);
  });
});

/** What `RoomDO.leave()` does to the state: the player is gone at once, nothing else changes. */
const leave = (s: GameState, id: PlayerId): GameState => ({
  ...s,
  players: s.players.filter((p) => p.id !== id),
});

describe('a player leaving mid-round (contested, D32 item 1)', () => {
  it('1v1, both alive, one leaves: the other is the last survivor on the next tick', () => {
    const { state } = simulate(board('#A...B.#'), none); // a tick with both in: contested
    expect(state.contested).toBe(true);
    expect(state.result).toBeUndefined();
    const next = simulate(leave(state, 'p2'), none);
    expect(roundEnds(next.events)).toEqual([
      { v: 1, t: 'event', kind: 'roundEnd', winner: 'p1', reason: 'lastAlive' },
    ]);
    expect(next.state.result).toEqual({ winner: 'p1', reason: 'lastAlive' });
  });

  it('3 players, one already dead, a survivor leaves: the other survivor wins (same as 1v1)', () => {
    const s = board('#A..B..C#');
    const dead = {
      ...s,
      players: s.players.map((p) => (p.id === 'p3' ? { ...p, alive: false } : p)),
    };
    const { state } = simulate(dead, none);
    expect(state.result).toBeUndefined();
    const next = simulate(leave(state, 'p2'), none);
    expect(next.state.result).toEqual({ winner: 'p1', reason: 'lastAlive' });
  });

  it('playing alone from the start never ends by elimination, only at the time limit', () => {
    let s = board('#A.....#');
    expect(s.contested).toBe(false);
    for (let i = 0; i < 50; i++) s = simulate(s, none).state;
    expect(s.contested).toBe(false);
    expect(s.result).toBeUndefined();
    const end = simulate({ ...s, tick: DEFAULT_CONFIG.roundTicks - 1 }, none);
    expect(end.state.result).toEqual({ winner: null, reason: 'timeout' });
  });

  it('a 1v1 whose rival leaves right away (before any tick with both) is still a solo round', () => {
    const s = leave(board('#A...B.#', { contested: false }), 'p2'); // flag only flips inside simulate
    const { state } = simulate(s, none);
    expect(state.result).toBeUndefined();
  });

  it('a rival joining a solo round makes it contested from the next tick, and it stays so', () => {
    let s = board('#A.....#');
    s = simulate(s, none).state;
    const both = board('#A...B.#');
    s = simulate({ ...s, players: both.players }, none).state;
    expect(s.contested).toBe(true);
    const next = simulate(leave(s, 'p2'), none);
    expect(next.state.result).toEqual({ winner: 'p1', reason: 'lastAlive' });
  });

  it('startRound resets it: contested follows the number of players it starts with', () => {
    expect(startRound(1, ['p1', 'p2']).state.contested).toBe(true);
    expect(startRound(1, ['p1']).state.contested).toBe(false);
    const ended = simulate(leave(simulate(board('#A...B.#'), none).state, 'p2'), none).state;
    expect(startRound(2, ['p1']).state.contested).toBe(false);
    expect(ended.contested).toBe(true);
  });

  it('is deterministic and does not mutate its input', () => {
    const s = simulate(board('#A...B.#'), none).state;
    const frozen = JSON.stringify(s);
    const a = simulate(leave(s, 'p2'), none);
    const b = simulate(leave(s, 'p2'), none);
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('time limit', () => {
  const alive2 = (tick: number) => board('#A.....B#', { tick });

  it('ends in a draw when the round clock runs out (3000 ticks by default)', () => {
    expect(DEFAULT_CONFIG.roundTicks).toBe(3000);
    const before = simulate(alive2(DEFAULT_CONFIG.roundTicks - 2), none);
    expect(before.state.tick).toBe(DEFAULT_CONFIG.roundTicks - 1);
    expect(before.state.result).toBeUndefined();

    const last = simulate(alive2(DEFAULT_CONFIG.roundTicks - 1), none);
    expect(last.state.tick).toBe(DEFAULT_CONFIG.roundTicks);
    expect(roundEnds(last.events)).toEqual([
      { v: 1, t: 'event', kind: 'roundEnd', winner: null, reason: 'timeout' },
    ]);
    expect(last.state.result).toEqual({ winner: null, reason: 'timeout' });
  });

  it('uses cfg.roundTicks, not a hardcoded number', () => {
    const cfg = { ...DEFAULT_CONFIG, roundTicks: 3 };
    let s = alive2(0);
    for (let i = 0; i < 2; i++) s = simulate(s, none, cfg).state;
    expect(s.result).toBeUndefined();
    s = simulate(s, none, cfg).state;
    expect(s.result?.reason).toBe('timeout');
  });

  it('a death on the very last tick beats the timeout', () => {
    const s = board('#A...B.#', { tick: DEFAULT_CONFIG.roundTicks - 1, bombs: [due(4, 'p1')] });
    expect(simulate(s, none).state.result).toEqual({ winner: 'p1', reason: 'lastAlive' });
  });

  it('a solo player also gets the timeout draw', () => {
    const s = board('#A.....#', { tick: DEFAULT_CONFIG.roundTicks - 1 });
    expect(simulate(s, none).state.result?.reason).toBe('timeout');
  });
});

describe('after the round is over', () => {
  const ended = () => simulate(board('#A...B.#', { bombs: [due(4, 'p1')] }), none).state;

  it('the game is frozen: no events, no walking, no bombs, only the tick counter moves', () => {
    const over = ended();
    const input = new Map<PlayerId, PlayerInput>([['p1', { dir: 'right', bomb: true, seq: 9 }]]);
    const next = simulate(over, input);
    expect(next.events).toEqual([]);
    expect(next.state).toEqual({ ...over, tick: over.tick + 1 });
  });

  it('no second roundEnd follows, even over many ticks', () => {
    let s = ended();
    let count = 0;
    for (let i = 0; i < 20; i++) {
      const r = simulate(s, none);
      count += roundEnds(r.events).length;
      s = r.state;
    }
    expect(count).toBe(0);
  });

  it('snapshots keep working', () => {
    expect(toSnapshot(ended(), 'p1').players).toHaveLength(2);
  });

  it('does not mutate the state it was given', () => {
    const s = board('#A...B.#', { bombs: [due(4, 'p1')] });
    const copy = structuredClone(s);
    simulate(s, none);
    expect(s).toEqual(copy);
  });
});

describe('startRound (D8)', () => {
  it('returns a fresh round and a roundStart event carrying the seed and the grid', () => {
    const { state, events } = startRound(1234, ['p2', 'p1']);
    expect(state.tick).toBe(0);
    expect(state.seed).toBe(1234);
    expect(state.result).toBeUndefined();
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(state.players.every((p) => p.alive)).toBe(true);
    expect(events).toEqual([
      { v: 1, t: 'event', kind: 'roundStart', seed: 1234, grid: state.grid },
    ]);
  });

  it('same seed gives the same board, a new seed gives a different one', () => {
    const a = startRound(1, ['p1']);
    expect(startRound(1, ['p1'])).toEqual(a);
    expect(startRound(2, ['p1']).state.grid).not.toBe(a.state.grid);
  });

  it('a new round can be played after an ended one (no leftovers)', () => {
    const over = simulate(board('#A...B.#', { bombs: [due(4, 'p1')] }), none).state;
    expect(over.result).toBeDefined();
    const { state } = startRound(7, ['p1', 'p2']);
    const next = simulate(state, none).state;
    expect(next.tick).toBe(1);
    expect(next.result).toBeUndefined();
    expect(next.bombs).toEqual([]);
  });

  it('the seed handed in is the seed the board comes from', () => {
    expect(startRound(55, ['p1']).state.grid).toBe(createInitialState(55, ['p1']).grid);
  });
});
