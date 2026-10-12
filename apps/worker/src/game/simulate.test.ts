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

describe('simulate: walking', () => {
  it('moves playerSpeed tiles per tick in the pressed direction', () => {
    const s0 = createInitialState(1, ['p1']);
    const { state } = simulate(s0, inputs({ p1: input('right') }));
    expect(pos(state, 'p1')).toEqual({ x: 1 + DEFAULT_CONFIG.playerSpeed, y: 1 });
    expect(state.tick).toBe(1);
  });

  it('dir none / no input keeps the player still', () => {
    const s0 = createInitialState(1, ['p1']);
    expect(pos(simulate(s0, inputs({ p1: input('none') })).state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(pos(simulate(s0, inputs({})).state, 'p1')).toEqual({ x: 1, y: 1 });
  });

  it('stops at every board edge', () => {
    for (const [dir, expected] of [
      ['left', { x: 0, y: 1 }],
      ['up', { x: 1, y: 0 }],
      ['right', { x: GRID_WIDTH - 1, y: 1 }],
      ['down', { x: 1, y: GRID_HEIGHT - 1 }],
    ] as const) {
      let s = createInitialState(1, ['p1']);
      for (let i = 0; i < 200; i++) s = simulate(s, inputs({ p1: input(dir, i + 1) })).state;
      expect(pos(s, 'p1')).toEqual(expected);
    }
  });

  it('dead players do not move', () => {
    const s0 = createInitialState(1, ['p1']);
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
