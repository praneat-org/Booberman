import { GRID_HEIGHT, GRID_WIDTH, SnapshotMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState } from './state';
import type { Bomb, Dir, Flame, GameConfig, GameState, PlayerId, PlayerInput } from './types';
import { DEPARTED } from './types';

/**
 * Small boards from pictures: `#` wall, `x` box, `.` floor, `A`-`D` = p1-p4 standing on floor.
 * The first picture row is y=1 (y=0 is the border); everything outside the picture is wall.
 */
function board(rows: string[], extra: Partial<GameState> = {}): GameState {
  const letters = 'ABCD';
  const found: [PlayerId, number, number][] = [];
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row = (y === 0 ? '' : (rows[y - 1] ?? '')).padEnd(GRID_WIDTH, '#');
    for (let x = 0; x < GRID_WIDTH; x++) {
      const c = row[x] ?? '#';
      const idx = letters.indexOf(c);
      if (idx >= 0) {
        found.push([`p${idx + 1}` as PlayerId, x, y]);
        grid += '.';
      } else grid += c;
    }
  }
  const base = createInitialState(
    1,
    found.map(([id]) => id),
  );
  const players = base.players.map((p) => {
    const at = found.find(([id]) => id === p.id);
    return at ? { ...p, x: at[1], y: at[2] } : p;
  });
  return { ...base, grid, players, ...extra };
}

const bomb = (
  x: number,
  y: number,
  ownerId: PlayerId,
  fuse = DEFAULT_CONFIG.bombFuseTicks,
): Bomb => ({
  x,
  y,
  ownerId,
  ownerSession: Number(ownerId.slice(1)),
  fuse,
});
/** Explodes on the very next tick. */
const due = (x: number, y: number, ownerId: PlayerId) => bomb(x, y, ownerId, 1);
const flame = (
  x: number,
  y: number,
  ownerId: PlayerId,
  ttl = DEFAULT_CONFIG.flameTicks,
): Flame => ({
  x,
  y,
  ownerId,
  ownerSession: Number(ownerId.slice(1)),
  ttl,
});

const inp = (dir: Dir, bombKey = false, seq = 1): PlayerInput => ({ dir, bomb: bombKey, seq });
const ins = (o: Partial<Record<PlayerId, PlayerInput>>) =>
  new Map(Object.entries(o) as [PlayerId, PlayerInput][]);
const tick = (s: GameState, o: Partial<Record<PlayerId, PlayerInput>> = {}, cfg?: GameConfig) =>
  simulate(s, ins(o), cfg);
const run = (s: GameState, n: number) => {
  let cur = s;
  for (let i = 0; i < n; i++) cur = simulate(cur, ins({})).state;
  return cur;
};
const player = (s: GameState, id: PlayerId) => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};
const flameTiles = (s: GameState) => [...new Set(s.flames.map((f) => `${f.x},${f.y}`))].sort();
const tilesOf =
  (...xs: number[]) =>
  (y: number) =>
    xs.map((x) => `${x},${y}`).sort();

describe('placing bombs', () => {
  it('drops a bomb on the tile the player stands on, with their ownerId', () => {
    const s = board(['#A..#']);
    const { state } = tick(s, { p1: inp('none', true) });
    expect(state.bombs).toEqual([bomb(1, 1, 'p1')]);
    expect(toSnapshot(state, 'p1').bombs).toEqual([
      { x: 1, y: 1, fuse: DEFAULT_CONFIG.bombFuseTicks },
    ]);
  });

  it('explodes exactly bombFuseTicks ticks after it was placed', () => {
    let s = tick(board(['#A..#']), { p1: inp('none', true) }).state;
    for (let i = 1; i < DEFAULT_CONFIG.bombFuseTicks; i++) {
      s = run(s, 1);
      expect(s.bombs).toHaveLength(1);
      expect(s.flames).toHaveLength(0);
    }
    s = run(s, 1);
    expect(s.bombs).toHaveLength(0);
    expect(s.flames.length).toBeGreaterThan(0);
  });

  it('allows at most maxBombs per player', () => {
    const s = board(['#A....#'], { bombs: [bomb(3, 1, 'p1'), bomb(4, 1, 'p1')] });
    expect(tick(s, { p1: inp('none', true) }).state.bombs).toHaveLength(DEFAULT_CONFIG.maxBombs);
    // someone else's bombs do not count against p1
    const other = board(['#A....#'], { bombs: [bomb(3, 1, 'p2'), bomb(4, 1, 'p2')] });
    expect(tick(other, { p1: inp('none', true) }).state.bombs).toHaveLength(3);
  });

  it('placing while standing on a bomb does not stack a second one', () => {
    const s = board(['#A..#'], { bombs: [bomb(1, 1, 'p1')] });
    expect(tick(s, { p1: inp('none', true) }).state.bombs).toHaveLength(1);
  });

  it('two players placing on the same tile in one tick make one bomb (lowest id wins)', () => {
    const s = board(['#A..#']);
    const withB = { ...s, players: [...s.players, { ...player(s, 'p1'), id: 'p2' as const }] };
    const { state } = tick(withB, { p1: inp('none', true), p2: inp('none', true) });
    expect(state.bombs).toEqual([bomb(1, 1, 'p1')]);
  });

  it('dead players cannot place bombs', () => {
    const s = board(['#A..#']);
    const dead = { ...s, players: s.players.map((p) => ({ ...p, alive: false })) };
    expect(tick(dead, { p1: inp('none', true) }).state.bombs).toHaveLength(0);
  });

  it('a bomb is placed once per press (D27: bomb is not held)', () => {
    let s = tick(board(['#A....#']), { p1: inp('none', true, 1) }).state;
    s = run(s, 5);
    expect(s.bombs).toHaveLength(1);
  });
});

describe('walking with bombs', () => {
  it('can walk off your own bomb, but not back onto it', () => {
    let s = tick(board(['#A...#']), { p1: inp('none', true, 1) }).state;
    // walk right off the bomb tile (a full step takes walkTicksPerTile ticks)
    s = tick(s, { p1: inp('right', false, 2) }).state;
    s = tick(s, { p1: inp('none', false, 3) }).state; // release: the step still finishes
    s = run(s, DEFAULT_CONFIG.walkTicksPerTile - 2);
    expect(player(s, 'p1')).toMatchObject({ x: 2, y: 1 });
    // now the bomb tile is blocked
    s = tick(s, { p1: inp('left', false, 4) }).state;
    s = run(s, DEFAULT_CONFIG.walkTicksPerTile * 2);
    expect(player(s, 'p1')).toMatchObject({ x: 2, y: 1 });
    expect(s.bombs).toHaveLength(1);
  });

  it('a bomb blocks other players too', () => {
    const s = board(['#.B..#'], { bombs: [bomb(1, 1, 'p1')] });
    const { state } = tick(s, { p2: inp('left') });
    // p2 stands at x=2, the bomb tile is x=1
    expect(player(state, 'p2')).toMatchObject({ x: 2, y: 1 });
  });

  it('a step already started onto a tile that gets a bomb still finishes', () => {
    const s = board(['#A..#']);
    let cur = tick(s, { p1: inp('right') }).state;
    cur = { ...cur, bombs: [bomb(2, 1, 'p2')] };
    cur = tick(cur, { p1: inp('none', false, 2) }).state;
    cur = run(cur, DEFAULT_CONFIG.walkTicksPerTile - 2);
    expect(player(cur, 'p1')).toMatchObject({ x: 2, y: 1 });
  });
});

describe('flames', () => {
  it('spread radius tiles in four directions', () => {
    const rows = ['#.....#', '#.....#', '#..A..#', '#.....#', '#.....#'];
    const s = board(rows, { bombs: [due(3, 3, 'p1')] });
    const { state } = tick(s);
    const expected = new Set(['3,3']);
    for (let r = 1; r <= DEFAULT_CONFIG.bombRadius; r++) {
      expected.add(`${3 + r},3`);
      expected.add(`${3 - r},3`);
      expected.add(`3,${3 + r}`);
      expected.add(`3,${3 - r}`);
    }
    expect(new Set(flameTiles(state))).toEqual(expected);
  });

  it('stop at a wall and do not pass it', () => {
    const s = board(['#.#.B.#.#'], { bombs: [due(4, 1, 'p1')] });
    // wait: `B` is a player letter; the bomb sits at x=4. Wall at x=2 and x=6.
    const { state } = tick(s);
    expect(flameTiles(state)).toEqual(tilesOf(3, 4, 5)(1));
  });

  it('stop at a box: the box breaks (event), the flame does not pass it', () => {
    const s = board(['#..x.Ax.#'], { bombs: [due(5, 1, 'p1')] });
    const { state, events } = tick(s);
    expect(flameTiles(state)).toEqual(tilesOf(3, 4, 5, 6)(1));
    expect(state.grid[1 * GRID_WIDTH + 3]).toBe('.');
    expect(state.grid[1 * GRID_WIDTH + 6]).toBe('.');
    const broken = events.filter((e) => e.kind === 'boxDestroyed');
    expect(broken).toHaveLength(2);
    expect(broken).toMatchObject([
      { x: 3, y: 1 },
      { x: 6, y: 1 },
    ]);
  });

  it('a box behind another box is untouched', () => {
    const s = board(['#.xxA..#'], { bombs: [due(4, 1, 'p1')] });
    const { state } = tick(s);
    expect(state.grid[1 * GRID_WIDTH + 3]).toBe('.');
    expect(state.grid[1 * GRID_WIDTH + 2]).toBe('x');
  });

  it('last flameTicks ticks, then disappear', () => {
    let s = tick(board(['#..B..#'], { bombs: [due(3, 1, 'p1')] })).state;
    expect(s.flames.length).toBeGreaterThan(0);
    for (let i = 1; i < DEFAULT_CONFIG.flameTicks; i++) {
      s = run(s, 1);
      expect(s.flames.length, `tick ${i}`).toBeGreaterThan(0);
    }
    s = run(s, 1);
    expect(s.flames).toHaveLength(0);
    expect(toSnapshot(s).flames).toEqual([]);
  });

  it('are listed once per tile in the snapshot even when two bombs overlap', () => {
    const s = board(['#.......#'], { bombs: [due(2, 1, 'p1'), due(6, 1, 'p2')] });
    const { state } = tick(s);
    expect(state.flames.length).toBeGreaterThan(flameTiles(state).length);
    const snap = toSnapshot(state);
    expect(SnapshotMessage.safeParse(snap).success).toBe(true);
    expect(snap.flames).toHaveLength(flameTiles(state).length);
  });
});

describe('chain reaction', () => {
  // bombs at 1, 3, 5: each one is inside the radius of the next
  const chain = (): GameState =>
    board(['#A.....D#'], {
      bombs: [due(1, 1, 'p1'), bomb(3, 1, 'p2'), bomb(5, 1, 'p2')],
    });

  it('three bombs go off in the same tick', () => {
    const { state } = tick(chain());
    expect(state.bombs).toHaveLength(0);
    expect(flameTiles(state)).toEqual(tilesOf(1, 2, 3, 4, 5, 6, 7)(1));
  });

  it('every flame knows the owner of the first bomb of the chain', () => {
    const { state } = tick(chain());
    expect(new Set(state.flames.map((f) => f.ownerId))).toEqual(new Set(['p1']));
  });

  it('the kill goes to the chain starter, even for a player only the last bomb reaches', () => {
    const { state } = tick(chain());
    const d = player(state, 'p4');
    expect(d).toMatchObject({ alive: false, killedBy: 'p1' });
  });

  it('a bomb behind a box is not set off', () => {
    const s = board(['#.B.xD.#'], { bombs: [due(2, 1, 'p1'), bomb(5, 1, 'p2')] });
    const { state } = tick(s);
    expect(state.bombs).toEqual([bomb(5, 1, 'p2', 40 - 1)]);
  });

  it('a bomb on a tile that is already burning goes off at once, credited to that flame', () => {
    const s = board(['#.....#'], {
      flames: [flame(3, 1, 'p2', 5)],
      bombs: [bomb(3, 1, 'p1')],
    });
    const { state } = tick(s);
    expect(state.bombs).toHaveLength(0);
    const fresh = state.flames.filter((f) => f.ttl === DEFAULT_CONFIG.flameTicks);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new Set(fresh.map((f) => f.ownerId))).toEqual(new Set(['p2']));
  });

  it('geometry does not depend on bomb order', () => {
    const a = tick(chain()).state;
    const rev = chain();
    const b = tick({ ...rev, bombs: [...rev.bombs].reverse() }).state;
    expect(flameTiles(b)).toEqual(flameTiles(a));
  });
});

describe('death', () => {
  it('standing in a flame kills at once and records the killer', () => {
    const s = board(['#.A.B.#'], { bombs: [due(2, 1, 'p1')] });
    const { state } = tick(s);
    // B is at x=4 -> inside radius 2 of the bomb at x=2? 2 tiles away: yes
    expect(player(state, 'p1')).toMatchObject({ alive: false, killedBy: 'p1' }); // A = p1 (suicide)
    expect(player(state, 'p2')).toMatchObject({ alive: false, killedBy: 'p1' });
  });

  it('players outside the flame survive', () => {
    const s = board(['#.A....B#'], { bombs: [due(2, 1, 'p1')] });
    const { state } = tick(s);
    expect(player(state, 'p2')).toMatchObject({ alive: true });
    expect(player(state, 'p2').killedBy).toBeUndefined();
  });

  it('a player who walks into a lingering flame dies and the flame owner gets the kill', () => {
    const s = board(['#B..A..#'], { flames: [flame(3, 1, 'p2', 5)] });
    let cur = tick(s, { p1: inp('left') }).state;
    for (let i = 0; i < 3 * DEFAULT_CONFIG.walkTicksPerTile && player(cur, 'p1').alive; i++) {
      cur = run(cur, 1);
    }
    // A (p1) started at x=4 walking left into the flame at x=3
    expect(player(cur, 'p1')).toMatchObject({ alive: false, killedBy: 'p2' });
  });

  it('players dying in the same tick all die (simultaneous deaths)', () => {
    const s = board(['#AB.CD#'], { bombs: [due(3, 1, 'p1')] });
    const { state } = tick(s);
    expect(state.players.map((p) => p.alive)).toEqual([false, false, false, false]);
  });

  it('a dead player stops where they died and ignores held direction', () => {
    const s = board(['#.A.B.#'], { bombs: [due(2, 1, 'p1')] });
    let cur = tick(s, { p1: inp('right') }).state;
    expect(player(cur, 'p1').alive).toBe(false);
    const { x } = player(cur, 'p1');
    cur = run(cur, 10);
    expect(player(cur, 'p1').x).toBe(x);
  });

  it('where two flames cross, the kill goes to the first flame on that tile', () => {
    const s = board(['#A...BC.#'], {
      bombs: [due(1, 1, 'p1'), due(5, 1, 'p2')],
    });
    // tile 3 is reached by both; C (p3) stands at 6 (only p2 reaches)
    const both = { ...s, players: s.players.map((p) => ({ ...p, x: 3 })) };
    const { state } = tick(both);
    expect(player(state, 'p3')).toMatchObject({ alive: false, killedBy: 'p1' });
  });
});

describe('boxes and items', () => {
  const always: GameConfig = { ...DEFAULT_CONFIG, itemDropChance: 1, curseItemShare: 1 };
  const never: GameConfig = { ...DEFAULT_CONFIG, itemDropChance: 0 };

  it('a destroyed box drops an item when the roll is under itemDropChance', () => {
    const s = board(['#.xA..#'], { bombs: [due(3, 1, 'p1')] });
    const { state } = tick(s, {}, always);
    expect(state.items).toEqual([
      { x: 2, y: 1, kind: 'curse', droppedBy: 'p1', droppedBySession: 1 },
    ]);
    expect(toSnapshot(state).items).toEqual([{ x: 2, y: 1, kind: 'curse' }]);
  });

  it('no item when the roll is over the chance', () => {
    const s = board(['#.xA..#'], { bombs: [due(3, 1, 'p1')] });
    expect(tick(s, {}, never).state.items).toEqual([]);
  });

  it('remembers who broke the box, also through a chain', () => {
    const s = board(['#x.A.B.x#'], { bombs: [due(3, 1, 'p1'), bomb(5, 1, 'p2')] });
    const { state } = tick(s, {}, always);
    expect(state.items.map((i) => i.droppedBy)).toEqual(['p1', 'p1']);
  });

  it('draws one random number per broken box, in tile order, and keeps the PRNG in the state', () => {
    const s = board(['#x.A.x#'], { bombs: [due(3, 1, 'p1')] });
    const a = tick(s);
    const b = tick(s);
    expect(a).toEqual(b);
    expect(a.state.rngSeed).not.toBe(s.rngSeed);
    // no box, no draw
    const quiet = board(['#..A..#'], { bombs: [due(3, 1, 'p1')] });
    expect(tick(quiet).state.rngSeed).toBe(quiet.rngSeed);
  });

  it('about itemDropChance of boxes drop over many boxes (default 35%)', () => {
    const rows = ['#...........#', '#xxxxxxxxxxx#'];
    let drops = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const base = board(rows, { rngSeed: seed * 7919 });
      // a bomb in every floor tile of the top row breaks the whole box row below it
      const bombs = Array.from({ length: 11 }, (_, i) => due(1 + i, 1, 'p1'));
      const { state } = tick({ ...base, bombs });
      total += 11;
      drops += state.items.length;
    }
    expect(drops / total).toBeGreaterThan(DEFAULT_CONFIG.itemDropChance - 0.1);
    expect(drops / total).toBeLessThan(DEFAULT_CONFIG.itemDropChance + 0.1);
  });
});

describe('purity with bombs', () => {
  it('does not mutate the state it was given', () => {
    const s = board(['#A..x.B#'], { bombs: [due(1, 1, 'p1')], flames: [flame(5, 1, 'p2')] });
    const frozen = structuredClone(s);
    simulate(s, ins({ p1: inp('right', true) }));
    expect(s).toEqual(frozen);
  });
});

describe('bombs of a player who left (D33)', () => {
  /** A bomb whose owner joined as p2 with session 2 and has since left. */
  const stale = (x: number, y: number, fuse = DEFAULT_CONFIG.bombFuseTicks): Bomb => ({
    ...bomb(x, y, 'p2', fuse),
    ownerSession: 2,
  });
  /** The same board with p2 replaced by a newcomer in the slot (a new join = a new session). */
  const rejoin = (s: GameState, id: PlayerId, session: number): GameState => ({
    ...s,
    players: s.players.map((p) => (p.id === id ? { ...p, session } : p)),
  });

  it('keeps going off on time, hurting people and breaking boxes', () => {
    const s = rejoin(board(['#.B.x...#'], { bombs: [stale(3, 1, 1)] }), 'p2', 7);
    const { state, events } = tick(s);
    expect(state.bombs).toHaveLength(0);
    expect(state.flames.length).toBeGreaterThan(0);
    expect(events.map((e) => e.t === 'event' && e.kind)).toContain('boxDestroyed');
  });

  it('does not count against the newcomer: a full maxBombs can be placed at once', () => {
    let s = rejoin(board(['#.B.....#'], { bombs: [stale(6, 1), stale(7, 1)] }), 'p2', 7);
    s = tick(s, { p2: inp('right', true) }).state;
    for (let i = 0; i < DEFAULT_CONFIG.walkTicksPerTile; i++) s = tick(s, {}).state;
    s = tick(s, { p2: inp('none', true, 2) }).state;
    expect(s.bombs.filter((b) => b.ownerSession === 7)).toHaveLength(DEFAULT_CONFIG.maxBombs);
    expect(s.bombs).toHaveLength(DEFAULT_CONFIG.maxBombs + 2);
    // ... and the cap still holds for the newcomer's own bombs
    const capped = tick(s, { p2: inp('none', true, 3) }).state;
    expect(capped.bombs).toHaveLength(s.bombs.length);
  });

  it('a kill from it is credited to nobody, not to the newcomer in the same slot', () => {
    const s = rejoin(board(['#A.B..#'], { bombs: [stale(2, 1, 1)] }), 'p2', 7);
    const { state } = tick(s);
    expect(player(state, 'p1')).toMatchObject({ alive: false, killedBy: DEPARTED });
    expect(player(state, 'p2')).toMatchObject({ alive: false, killedBy: DEPARTED });
    expect(player(state, 'p2').killedBy).not.toBe('p2');
  });

  it('a chain started by a departed bomb counts for nobody, even where a living owner’s bomb is hit', () => {
    // stale bomb at 1 sets off p3's bomb at 3, whose flames reach p1 standing at 5
    const s = rejoin(board(['#.....#'], { bombs: [stale(1, 1, 1), bomb(3, 1, 'p3')] }), 'p2', 7);
    const withP1 = { ...s, players: createInitialState(1, ['p1', 'p2', 'p3']).players };
    const placed = {
      ...withP1,
      players: withP1.players.map((p) =>
        p.id === 'p1'
          ? { ...p, x: 5, y: 1 }
          : p.id === 'p2'
            ? { ...p, session: 7, x: 11, y: 1 }
            : p,
      ),
    };
    const { state } = tick(placed);
    expect(state.flames.every((f) => f.ownerSession === 2)).toBe(true);
    expect(player(state, 'p1')).toMatchObject({ alive: false, killedBy: DEPARTED });
  });

  it('a chain started by a living player that passes through a departed bomb still counts for them', () => {
    const s = rejoin(
      board(['#A.....D#'], { bombs: [due(1, 1, 'p1'), stale(3, 1), bomb(5, 1, 'p3')] }),
      'p2',
      7,
    );
    const { state } = tick(s);
    expect(player(state, 'p4')).toMatchObject({ alive: false, killedBy: 'p1' });
  });

  it('suicide by a living player is unchanged', () => {
    const { state } = tick(board(['#A..#'], { bombs: [due(1, 1, 'p1')] }));
    expect(player(state, 'p1')).toMatchObject({ alive: false, killedBy: 'p1' });
  });

  it('replays exactly with players leaving and rejoining', () => {
    const DIRS: Dir[] = ['up', 'down', 'left', 'right', 'none'];
    const play = () => {
      let state = createInitialState(9, ['p1', 'p2', 'p3']);
      const events: unknown[] = [];
      for (let t = 0; t < 400; t++) {
        // p2 leaves at t=60 and is replaced at t=61 by a new join (session 10)
        if (t === 60) state = { ...state, players: state.players.filter((p) => p.id !== 'p2') };
        if (t === 61) {
          const fresh = createInitialState(9, ['p2'], new Map([['p2', 10]])).players;
          state = {
            ...state,
            players: [...state.players, ...fresh].sort((a, b) => a.id.localeCompare(b.id)),
          };
        }
        const inputs = new Map<PlayerId, PlayerInput>();
        for (const [i, id] of (['p1', 'p2', 'p3'] as const).entries()) {
          inputs.set(id, {
            dir: DIRS[(t * 7 + i * 3 + (t >> 3)) % DIRS.length] ?? 'none',
            bomb: (t + i * 5) % 9 === 0,
            seq: t + 1,
          });
        }
        const res = simulate(state, inputs);
        state = res.state;
        events.push(...res.events);
      }
      return { state, events };
    };
    expect(play()).toEqual(play());
  });
});
