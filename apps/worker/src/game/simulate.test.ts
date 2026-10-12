import { GRID_HEIGHT, GRID_WIDTH, SnapshotMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { nextRandom } from './prng';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState } from './state';
import type { Dir, GameState, PlayerId, PlayerInput } from './types';

const input = (dir: Dir, seq = 1): PlayerInput => ({ dir, bomb: false, seq });
const inputs = (o: Partial<Record<PlayerId, PlayerInput>>) =>
  new Map(Object.entries(o) as [PlayerId, PlayerInput][]);
const pos = (s: GameState, id: PlayerId) => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return { x: p.x, y: p.y };
};

describe('createInitialState', () => {
  it('places players on the spawn corners, sorted by id, tick 0', () => {
    const s = createInitialState(42, ['p3', 'p1']);
    expect(s.tick).toBe(0);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(pos(s, 'p1')).toEqual({ x: 1, y: 1 });
    expect(pos(s, 'p3')).toEqual({ x: 1, y: 9 });
    expect(s.players.every((p) => p.alive && p.curse === 0 && p.ackSeq === 0)).toBe(true);
  });
});

/** Open arena: border walls only, so walking tests are not tied to a random board. */
const openState = (ids: PlayerId[] = ['p1']): GameState => {
  const s = createInitialState(1, ids);
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++)
      grid += x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1 ? '#' : '.';
  return { ...s, grid };
};

const hold = (s: GameState, dir: Dir, ticks: number, id: PlayerId = 'p1'): GameState => {
  let cur = s;
  for (let i = 0; i < ticks; i++)
    cur = simulate(cur, inputs({ [id]: input(dir, cur.tick + 1) })).state;
  return cur;
};

describe('simulate: walking', () => {
  it('walks one tile in walkTicksPerTile ticks (4 ticks = 0.2 s)', () => {
    const s0 = openState();
    const { state } = simulate(s0, inputs({ p1: input('right') }));
    expect(pos(state, 'p1')).toEqual({ x: 1 + DEFAULT_CONFIG.playerSpeed, y: 1 });
    expect(state.tick).toBe(1);
    expect(pos(hold(s0, 'right', DEFAULT_CONFIG.walkTicksPerTile), 'p1')).toEqual({ x: 2, y: 1 });
  });

  it('a step already started finishes even if the key is released', () => {
    const mid = hold(openState(), 'right', 1);
    const end = hold(mid, 'none', DEFAULT_CONFIG.walkTicksPerTile - 1);
    expect(pos(end, 'p1')).toEqual({ x: 2, y: 1 });
    expect(pos(hold(end, 'none', 10), 'p1')).toEqual({ x: 2, y: 1 });
  });

  it('cannot change direction mid-step, only at the next tile', () => {
    const mid = hold(openState(), 'right', 1);
    const turned = hold(mid, 'down', DEFAULT_CONFIG.walkTicksPerTile - 1);
    expect(pos(turned, 'p1')).toEqual({ x: 2, y: 1 });
    expect(pos(hold(turned, 'down', DEFAULT_CONFIG.walkTicksPerTile), 'p1')).toEqual({
      x: 2,
      y: 2,
    });
  });

  it('dir none / no input keeps the player still', () => {
    const s0 = openState();
    expect(pos(simulate(s0, inputs({ p1: input('none') })).state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(pos(simulate(s0, inputs({})).state, 'p1')).toEqual({ x: 1, y: 1 });
  });

  it('stops at every board edge (border wall)', () => {
    for (const [dir, expected] of [
      ['left', { x: 1, y: 1 }],
      ['up', { x: 1, y: 1 }],
      ['right', { x: GRID_WIDTH - 2, y: 1 }],
      ['down', { x: 1, y: GRID_HEIGHT - 2 }],
    ] as const) {
      expect(pos(hold(openState(), dir, 200), 'p1')).toEqual(expected);
    }
  });

  it('stops in front of a wall', () => {
    const s0 = openState();
    const grid = s0.grid.split('');
    grid[1 * GRID_WIDTH + 4] = '#';
    const s = hold({ ...s0, grid: grid.join('') }, 'right', 100);
    expect(pos(s, 'p1')).toEqual({ x: 3, y: 1 });
  });

  it('stops in front of a box and does not break it', () => {
    const s0 = openState();
    const grid = s0.grid.split('');
    grid[1 * GRID_WIDTH + 3] = 'x';
    const s = hold({ ...s0, grid: grid.join('') }, 'right', 100);
    expect(pos(s, 'p1')).toEqual({ x: 2, y: 1 });
    expect(s.grid[1 * GRID_WIDTH + 3]).toBe('x');
  });

  it('walks through other players', () => {
    const s0 = openState(['p1', 'p2']);
    // put p2 on the tile p1 walks into
    const s: GameState = {
      ...s0,
      players: s0.players.map((p) => (p.id === 'p2' ? { ...p, x: 2, y: 1 } : p)),
    };
    const after = hold(s, 'right', DEFAULT_CONFIG.walkTicksPerTile * 2);
    expect(pos(after, 'p1')).toEqual({ x: 3, y: 1 });
    expect(pos(after, 'p2')).toEqual({ x: 2, y: 1 });
  });

  it('speed override still lands exactly on tiles', () => {
    let s = openState();
    const cfg = { ...DEFAULT_CONFIG, playerSpeed: 0.3 };
    for (let i = 0; i < 4; i++) s = simulate(s, inputs({ p1: input('right', i + 1) }), cfg).state;
    expect(pos(s, 'p1')).toEqual({ x: 2, y: 1 });
  });

  it('dead players do not move', () => {
    const s0 = openState();
    const dead: GameState = { ...s0, players: s0.players.map((p) => ({ ...p, alive: false })) };
    expect(pos(simulate(dead, inputs({ p1: input('right') })).state, 'p1')).toEqual({
      x: 1,
      y: 1,
    });
  });

  it('records the highest seq seen as ackSeq, never going backwards', () => {
    let s = createInitialState(1, ['p1']);
    s = simulate(s, inputs({ p1: input('none', 5) })).state;
    s = simulate(s, inputs({ p1: input('none', 3) })).state;
    expect(s.players[0]?.ackSeq).toBe(5);
  });

  it('ignores inputs for unknown players', () => {
    const s0 = createInitialState(1, ['p1']);
    expect(() => simulate(s0, inputs({ p2: input('left') }))).not.toThrow();
  });
});

describe('simulate: purity', () => {
  it('does not mutate its arguments', () => {
    const s0 = createInitialState(9, ['p1', 'p2']);
    const frozen = structuredClone(s0);
    const ins = inputs({ p1: input('right'), p2: input('up') });
    simulate(s0, ins);
    expect(s0).toEqual(frozen);
    expect(ins.size).toBe(2);
  });

  it('result does not depend on Map insertion order', () => {
    const s0 = createInitialState(9, ['p1', 'p2']);
    const a = simulate(s0, inputs({ p1: input('right'), p2: input('down') }));
    const b = simulate(s0, inputs({ p2: input('down'), p1: input('right') }));
    expect(a).toEqual(b);
  });
});

describe('determinism', () => {
  const DIRS: Dir[] = ['up', 'down', 'left', 'right', 'none'];
  const run = (seed: number, scriptSeed: number) => {
    let state = createInitialState(seed, ['p1', 'p2', 'p3', 'p4']);
    let script = scriptSeed;
    const events: unknown[] = [];
    for (let tick = 0; tick < 500; tick++) {
      const ins = new Map<PlayerId, PlayerInput>();
      for (const id of ['p1', 'p2', 'p3', 'p4'] as const) {
        let r: number;
        [r, script] = nextRandom(script);
        const dir = DIRS[Math.floor(r * DIRS.length)] ?? 'none';
        [r, script] = nextRandom(script);
        ins.set(id, { dir, bomb: r < 0.1, seq: tick + 1 });
      }
      const res = simulate(state, ins);
      state = res.state;
      events.push(...res.events);
    }
    return { state, events };
  };

  it('same seed + same inputs, 500 ticks, twice → deep-equal final state', () => {
    expect(run(123, 777)).toEqual(run(123, 777));
  });

  it('actually moves players (the test is not vacuous)', () => {
    const { state } = run(123, 777);
    expect(state.tick).toBe(500);
    // compare each player with its own spawn point, not with p1's
    const spawn = new Map(
      createInitialState(123, ['p1', 'p2', 'p3', 'p4']).players.map((p) => [p.id, p]),
    );
    const moved = state.players.filter((p) => {
      const s = spawn.get(p.id);
      return s !== undefined && (p.x !== s.x || p.y !== s.y);
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it('the PRNG state lives inside GameState and is seeded from the match seed', () => {
    expect(createInitialState(1, ['p1']).rngSeed).not.toBe(createInitialState(2, ['p1']).rngSeed);
  });
});

describe('toSnapshot', () => {
  it('produces a valid protocol snapshot with positions rounded to 2 decimals', () => {
    const s0 = createInitialState(1, ['p1', 'p2']);
    const s: GameState = {
      ...s0,
      players: s0.players.map((p) => ({ ...p, x: 3.123456789, y: 4.987654321 })),
    };
    const snap = toSnapshot(s, 'p1');
    expect(SnapshotMessage.safeParse(snap).success).toBe(true);
    expect(snap.players[0]).toMatchObject({ x: 3.12, y: 4.99 });
    expect(snap.tick).toBe(s.tick);
    expect(snap.bombs).toEqual([]);
    expect(snap.flames).toEqual([]);
    expect(snap.items).toEqual([]);
  });

  it('uses the requesting player ackSeq (0 for an unknown viewer)', () => {
    let s = createInitialState(1, ['p1', 'p2']);
    s = simulate(s, inputs({ p1: input('none', 7), p2: input('none', 2) })).state;
    expect(toSnapshot(s, 'p1').ackSeq).toBe(7);
    expect(toSnapshot(s, 'p2').ackSeq).toBe(2);
    expect(toSnapshot(s).ackSeq).toBe(0);
  });

  it('4 players mid-walk stay well under 2KB (D16)', () => {
    let s = createInitialState(1, ['p1', 'p2', 'p3', 'p4']);
    for (let i = 0; i < 37; i++) {
      s = simulate(
        s,
        inputs({ p1: input('right', i), p2: input('down', i), p3: input('up', i) }),
      ).state;
    }
    expect(JSON.stringify(toSnapshot(s, 'p1')).length).toBeLessThan(2048);
  });
});
