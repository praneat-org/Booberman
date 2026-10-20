import { GRID_HEIGHT, GRID_WIDTH, SnapshotMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { curseSourceOf, effectiveDir, stepCurses } from './curse';
import { nextRandom } from './prng';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState } from './state';
import type {
  Dir,
  Flame,
  GameConfig,
  GameState,
  Item,
  PlayerId,
  PlayerInput,
  PlayerSim,
} from './types';
import { DEPARTED } from './types';

const CFG = DEFAULT_CONFIG;

/** Same picture boards as bombs.test.ts: `#` wall, `x` box, `.` floor, `A`-`D` = p1-p4. */
function board(rows: string[], extra: Partial<GameState> = {}): GameState {
  const found: [PlayerId, number, number][] = [];
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const row = (y === 0 ? '' : (rows[y - 1] ?? '')).padEnd(GRID_WIDTH, '#');
    for (let x = 0; x < GRID_WIDTH; x++) {
      const c = row[x] ?? '#';
      const idx = 'ABCD'.indexOf(c);
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

const inp = (dir: Dir, bomb = false, seq = 1): PlayerInput => ({ dir, bomb, seq });
const ins = (o: Partial<Record<PlayerId, PlayerInput>>) =>
  new Map(Object.entries(o) as [PlayerId, PlayerInput][]);
const tick = (s: GameState, o: Partial<Record<PlayerId, PlayerInput>> = {}, cfg = CFG) =>
  simulate(s, ins(o), cfg);
const run = (s: GameState, n: number, cfg = CFG) => {
  let cur = s;
  for (let i = 0; i < n; i++) cur = simulate(cur, ins({}), cfg).state;
  return cur;
};
const get = (s: GameState, id: PlayerId): PlayerSim => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};
const item = (x: number, y: number, by: PlayerId, kind: Item['kind'] = 'curse'): Item => ({
  x,
  y,
  kind,
  droppedBy: by,
  droppedBySession: Number(by.slice(1)),
});
/** Replace one player's fields. */
const edit = (s: GameState, id: PlayerId, patch: Partial<PlayerSim>): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});
/** `id` is cursed with `left` ticks by `by` (null = own box). */
const curse = (s: GameState, id: PlayerId, left: number, by: PlayerId | null, cooldown = 0) =>
  edit(s, id, {
    curse: left,
    cursedBy: by,
    cursedBySession: by ? Number(by.slice(1)) : null,
    curseCooldown: cooldown,
  });

describe('curse item drops', () => {
  const always: GameConfig = { ...CFG, itemDropChance: 1 };

  it('about curseItemShare (60%) of dropped items are a curse, the rest kick', () => {
    let curses = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const base = board(['#...........#', '#xxxxxxxxxxx#'], { rngSeed: seed * 7919 });
      const bombs = Array.from({ length: 11 }, (_, i) => ({
        x: 1 + i,
        y: 1,
        ownerId: 'p1' as PlayerId,
        ownerSession: 1,
        fuse: 1,
      }));
      const { state } = tick({ ...base, bombs }, {}, always);
      total += state.items.length;
      curses += state.items.filter((i) => i.kind === 'curse').length;
      expect(state.items.every((i) => i.kind === 'curse' || i.kind === CFG.otherItemKind)).toBe(
        true,
      );
    }
    expect(total).toBe(440);
    expect(curses / total).toBeGreaterThan(CFG.curseItemShare - 0.1);
    expect(curses / total).toBeLessThan(CFG.curseItemShare + 0.1);
  });

  it('the kind comes from the seeded PRNG: same state, same drops', () => {
    const s = board(['#x.A.x#'], {
      bombs: [{ x: 3, y: 1, ownerId: 'p1', ownerSession: 1, fuse: 1 }],
    });
    const first = tick(s, {}, always);
    expect(tick(s, {}, always)).toEqual(first);
    // two boxes break, each with a drop roll and a kind roll: 4 draws, all stored back in the state
    let seed = s.rngSeed;
    for (let i = 0; i < 4; i++) seed = nextRandom(seed)[1];
    expect(first.state.items).toHaveLength(2);
    expect(first.state.rngSeed).toBe(seed);
  });

  it('remembers the session of whoever broke the box', () => {
    const s = board(['#.xA..#'], {
      bombs: [{ x: 3, y: 1, ownerId: 'p1', ownerSession: 77, fuse: 1 }],
    });
    const { state } = tick(s, {}, { ...always, curseItemShare: 1 });
    expect(state.items).toEqual([
      { x: 2, y: 1, kind: 'curse', droppedBy: 'p1', droppedBySession: 77 },
    ]);
  });
});

describe('picking up a curse', () => {
  it('walking onto the item curses you for curseTicks, credited to whoever broke the box', () => {
    const s = board(['#A..B#'], { items: [item(2, 1, 'p2')] });
    let cur = s;
    for (let i = 0; i < 4 && cur.items.length > 0; i++)
      cur = tick(cur, { p1: inp('right', false, i + 1) }).state;
    // picked up halfway across: x = 1.5 already counts as the item tile (Math.round, as for bombs)
    expect(cur.tick).toBe(2);
    expect(get(cur, 'p1')).toMatchObject({
      curse: CFG.curseTicks,
      cursedBy: 'p2',
      cursedBySession: 2,
      curseCooldown: 0,
    });
    expect(cur.items).toEqual([]);
    expect(toSnapshot(cur).players[0]?.curse).toBe(CFG.curseTicks);
  });

  it('an item from the player own box sets cursedBy to null', () => {
    const s = board(['#A..#'], { items: [item(1, 1, 'p1')] });
    const { state } = tick(s);
    expect(get(state, 'p1')).toMatchObject({
      curse: CFG.curseTicks,
      cursedBy: null,
      cursedBySession: null,
    });
    expect(curseSourceOf(state.players, get(state, 'p1'))).toBeNull();
  });

  it('a box broken by someone who has since left credits nobody (D33)', () => {
    const s = board(['#A..#'], {
      items: [{ x: 1, y: 1, kind: 'curse', droppedBy: 'p2', droppedBySession: 9 }],
    });
    const p1 = get(tick(s).state, 'p1');
    expect(p1.cursedBy).toBe(DEPARTED);
    expect(curseSourceOf([p1], p1)).toBe(DEPARTED);
  });

  it('a slot taken over by a new join does not inherit the credit (D33)', () => {
    const s = curse(board(['#A..B#']), 'p1', 100, 'p2');
    const p1 = get(s, 'p1');
    expect(curseSourceOf(s.players, p1)).toBe('p2');
    const replaced = s.players.map((p) => (p.id === 'p2' ? { ...p, session: 42 } : p));
    expect(curseSourceOf(replaced, p1)).toBe(DEPARTED);
  });

  it('a kick item is used up with no effect', () => {
    const s = board(['#A..#'], { items: [item(1, 1, 'p2', 'kick')] });
    const { state } = tick(s);
    expect(state.items).toEqual([]);
    expect(get(state, 'p1').curse).toBe(0);
  });

  it('an already cursed player walks over curse items without taking them', () => {
    const s = curse(board(['#A..#'], { items: [item(1, 1, 'p2')] }), 'p1', 50, 'p3');
    const { state } = tick(s);
    expect(state.items).toHaveLength(1);
    expect(get(state, 'p1')).toMatchObject({ curse: 49, cursedBy: 'p3' });
  });

  it('two players on one item: the lower id gets it', () => {
    const s = board(['#AB.#'], { items: [item(1, 1, 'p3')] });
    const s2 = edit(s, 'p2', { x: 1, y: 1 });
    const { state } = tick(s2);
    expect(get(state, 'p1').curse).toBe(CFG.curseTicks);
    expect(get(state, 'p2').curse).toBe(0);
  });

  it('a dead player cannot pick one up', () => {
    const s = edit(board(['#A..B#'], { items: [item(1, 1, 'p2')] }), 'p1', { alive: false });
    const { state } = tick(s);
    expect(state.items).toHaveLength(1);
    expect(get(state, 'p1').curse).toBe(0);
  });
});

describe('reverse controls (server side)', () => {
  const open = ['#.....#', '#.....#', '#..A..#', '#.....#', '#.....#'];

  it.each([
    ['left', 'right'],
    ['right', 'left'],
    ['up', 'down'],
    ['down', 'up'],
  ] as const)('holding %s walks %s', (held, walked) => {
    const s = curse(board(open), 'p1', 100, 'p2');
    const start = get(s, 'p1');
    const end = get(run(tick(s, { p1: inp(held) }).state, CFG.walkTicksPerTile - 1), 'p1');
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[walked] as [
      number,
      number,
    ];
    expect({ x: end.x, y: end.y }).toEqual({ x: start.x + dx, y: start.y + dy });
  });

  it('none stays none, and an uncursed player is not reversed', () => {
    expect(effectiveDir({ ...get(board(open), 'p1'), curse: 5, heldDir: 'none' })).toBe('none');
    const s = board(open);
    const end = get(run(tick(s, { p1: inp('left') }).state, 3), 'p1');
    expect(end.x).toBe(get(s, 'p1').x - 1);
  });

  it('the stored heldDir is what is pressed: when the curse ends a held key walks the normal way', () => {
    // 2 ticks of curse left, key held left the whole time
    let s = curse(board(open), 'p1', 2, 'p2');
    s = tick(s, { p1: inp('left') }).state; // curse 1: starts walking right
    expect(get(s, 'p1').heldDir).toBe('left');
    expect(get(s, 'p1').walkDir).toBe('right');
    s = run(s, CFG.walkTicksPerTile - 1); // finishes the step on the right, curse already over
    expect(get(s, 'p1')).toMatchObject({ curse: 0, x: 4 });
    // the next step starts from the held key, no new input: now to the left
    expect(get(run(s, 1), 'p1').x).toBe(4 - CFG.playerSpeed);
  });

  it('a step already started finishes in its own direction when the curse arrives', () => {
    let s = board(open);
    s = tick(s, { p1: inp('right') }).state; // walking right
    s = curse(s, 'p1', 100, 'p2');
    s = run(s, CFG.walkTicksPerTile - 1);
    expect(get(s, 'p1')).toMatchObject({ x: 4, y: 3 });
  });

  it('lasts exactly curseTicks ticks of reversed walking', () => {
    let s = board(['#A..#'], { items: [item(1, 1, 'p2')] });
    s = tick(s).state; // picks up at the end of this tick
    const at = s.tick;
    expect(get(s, 'p1').curse).toBe(CFG.curseTicks);
    let reversed = 0;
    while (get(s, 'p1').curse > 0) {
      if (effectiveDir({ ...get(s, 'p1'), heldDir: 'left' }) === 'right') reversed++;
      s = run(s, 1);
    }
    expect(reversed).toBe(CFG.curseTicks);
    expect(s.tick - at).toBe(CFG.curseTicks);
    expect(get(s, 'p1')).toMatchObject({ curse: 0, cursedBy: null, cursedBySession: null });
  });
});

describe('curse timer', () => {
  it('runs out: curse, cursedBy and cooldown are all cleared', () => {
    let s = curse(board(['#A..B#']), 'p1', 3, 'p2', 2);
    s = run(s, 2);
    expect(get(s, 'p1')).toMatchObject({ curse: 1, cursedBy: 'p2' });
    s = run(s, 1);
    expect(get(s, 'p1')).toMatchObject({
      curse: 0,
      cursedBy: null,
      cursedBySession: null,
      curseCooldown: 0,
    });
    expect(toSnapshot(s).players[0]?.curse).toBe(0);
  });
});

describe('transfer on contact', () => {
  const together = () => board(['#A.B#']);
  const meet = (s: GameState) => edit(s, 'p2', { x: get(s, 'p1').x, y: get(s, 'p1').y });

  it('moves the curse to the player touched: cursedBy = sender, sender is clean', () => {
    const s = meet(curse(together(), 'p1', 120, 'p3'));
    const { state } = tick(s);
    expect(get(state, 'p1')).toMatchObject({
      curse: 0,
      cursedBy: null,
      cursedBySession: null,
      stats: expect.objectContaining({ transfers: 1, trollPoints: 1 }),
    });
    expect(get(state, 'p2')).toMatchObject({
      curse: 119, // what was left after this tick
      cursedBy: 'p1',
      cursedBySession: 1,
      curseCooldown: CFG.curseTransferCooldownTicks,
      stats: expect.objectContaining({ transfers: 0, trollPoints: 0 }),
    });
  });

  it('the receiver gets at least curseMinTicksAfterTransfer', () => {
    const s = meet(curse(together(), 'p1', 30, 'p3'));
    expect(get(tick(s).state, 'p2').curse).toBe(CFG.curseMinTicksAfterTransfer);
  });

  it('walking into someone counts (two players crossing in a corridor)', () => {
    let s = curse(board(['#A..B#']), 'p1', 100, 'p3');
    s = edit(s, 'p2', { x: 4, y: 1 });
    for (let i = 0; i < 12 && get(s, 'p1').curse > 0; i++)
      s = tick(s, { p1: inp('right', false, i + 1), p2: inp('left', false, i + 1) }).state;
    expect(get(s, 'p1').curse).toBe(0);
    expect(get(s, 'p2')).toMatchObject({ cursedBy: 'p1' });
  });

  it('players on different tiles do not touch', () => {
    const s = curse(board(['#A.B#']), 'p1', 100, 'p3');
    expect(get(tick(s).state, 'p2').curse).toBe(0);
  });

  it('cooldown: the receiver cannot hand it straight back, exactly curseTransferCooldownTicks later it can', () => {
    let s = meet(curse(together(), 'p1', 150, 'p3'));
    s = tick(s).state;
    const sentAt = s.tick;
    expect(get(s, 'p2').cursedBy).toBe('p1');
    for (let t = 1; t < CFG.curseTransferCooldownTicks; t++) {
      s = run(s, 1);
      expect(get(s, 'p2').curse).toBeGreaterThan(0); // still has it
      expect(get(s, 'p1').curse).toBe(0);
    }
    s = run(s, 1);
    expect(s.tick - sentAt).toBe(CFG.curseTransferCooldownTicks);
    expect(get(s, 'p1')).toMatchObject({ cursedBy: 'p2' }); // handed back
    expect(get(s, 'p2')).toMatchObject({ curse: 0, stats: { transfers: 1 } });
  });

  it('cooldown only blocks the sender: a third player can be cursed straight away', () => {
    let s = curse(board(['#A.BC#']), 'p2', 100, 'p1', 15);
    s = edit(s, 'p1', { x: 3, y: 1 });
    s = edit(s, 'p3', { x: 3, y: 1 });
    const { state } = tick(s);
    expect(get(state, 'p2').curse).toBe(0);
    expect(get(state, 'p3')).toMatchObject({ cursedBy: 'p2' });
    expect(get(state, 'p1').curse).toBe(0);
  });

  it('with the sender blocked the curse goes to the next player on the tile', () => {
    let s = curse(board(['#A.BC#']), 'p2', 100, 'p1', 15);
    s = edit(edit(s, 'p1', { x: 3, y: 1 }), 'p3', { x: 3, y: 1 });
    expect(get(tick(s).state, 'p3').cursedBy).toBe('p2');
  });

  it('only one hop per tick, even with three on a tile', () => {
    let s = curse(board(['#ABC#']), 'p1', 100, 'p4');
    s = edit(edit(s, 'p2', { x: 1, y: 1 }), 'p3', { x: 1, y: 1 });
    const { state } = tick(s);
    expect(get(state, 'p2').curse).toBeGreaterThan(0); // lowest id
    expect(get(state, 'p3').curse).toBe(0); // not passed on within the same tick
  });

  it('two cursed players reaching one clean player: the lower id sends, the other keeps theirs', () => {
    let s = curse(curse(board(['#ABC#']), 'p1', 100, 'p4'), 'p2', 90, 'p4');
    s = edit(edit(s, 'p2', { x: 1, y: 1 }), 'p3', { x: 1, y: 1 });
    const { state } = tick(s);
    expect(get(state, 'p3')).toMatchObject({ cursedBy: 'p1' });
    expect(get(state, 'p1').curse).toBe(0);
    expect(get(state, 'p2')).toMatchObject({ curse: 89, cursedBy: 'p4' });
  });

  it('two cursed players touching each other changes nothing', () => {
    const s = meet(curse(curse(together(), 'p1', 100, 'p3'), 'p2', 60, 'p4'));
    const { state } = tick(s);
    expect(get(state, 'p1')).toMatchObject({ curse: 99, cursedBy: 'p3', stats: { transfers: 0 } });
    expect(get(state, 'p2')).toMatchObject({ curse: 59, cursedBy: 'p4', stats: { transfers: 0 } });
  });

  it('a curse that runs out this tick is not passed on', () => {
    const s = meet(curse(together(), 'p1', 1, 'p3'));
    const { state } = tick(s);
    expect(get(state, 'p1').curse).toBe(0);
    expect(get(state, 'p2').curse).toBe(0);
    expect(get(state, 'p1').stats.transfers).toBe(0);
  });

  it('a fresh pickup is not passed on in the same tick', () => {
    const s = meet(edit(board(['#A.B#'], { items: [item(1, 1, 'p3')] }), 'p1', {}));
    const { state } = tick(s);
    expect(get(state, 'p1').curse).toBe(CFG.curseTicks);
    expect(get(state, 'p2').curse).toBe(0);
    // next tick it does move
    expect(get(tick(state).state, 'p2').cursedBy).toBe('p1');
  });

  it('dead players neither give nor get a curse', () => {
    const s = meet(curse(together(), 'p1', 100, 'p3'));
    expect(get(tick(edit(s, 'p2', { alive: false })).state, 'p2').curse).toBe(0);
    expect(get(tick(edit(s, 'p2', { alive: false })).state, 'p1').curse).toBe(99);
    const dead = edit(s, 'p1', { alive: false });
    expect(get(tick(dead).state, 'p2').curse).toBe(0);
  });
});

describe('death while cursed (for kill attribution, BE-41)', () => {
  const flame = (x: number, y: number, ownerId: PlayerId): Flame => ({
    x,
    y,
    ownerId,
    ownerSession: Number(ownerId.slice(1)),
    ttl: 5,
  });

  it('the dead keep the curse source frozen, snapshots show 0, killedBy is still the flame owner', () => {
    const s = curse(board(['#A.B#'], { flames: [flame(1, 1, 'p1')] }), 'p1', 100, 'p2');
    const { state } = tick(s);
    const p1 = get(state, 'p1');
    expect(p1).toMatchObject({ alive: false, killedBy: 'p1', curse: 100, cursedBy: 'p2' });
    expect(curseSourceOf(state.players, p1)).toBe('p2');
    expect(toSnapshot(state).players[0]?.curse).toBe(0);
    // frozen: it does not age, and nobody can take it
    const later = run(state, 10);
    expect(get(later, 'p1').curse).toBe(100);
  });

  it('dying in the same tick as a touch: no transfer from the dead', () => {
    let s = curse(board(['#A.B#'], { flames: [flame(1, 1, 'p3')] }), 'p1', 100, 'p4');
    s = edit(s, 'p2', { x: 1, y: 1 });
    const { state } = tick(s);
    expect(get(state, 'p1').alive).toBe(false);
    expect(get(state, 'p2').alive).toBe(false);
    expect(get(state, 'p2').curse).toBe(0);
  });
});

describe('curseBlocksBombing flag', () => {
  const s0 = curse(board(['#A.B#']), 'p1', 100, 'p2');
  const blocking: GameConfig = { ...CFG, curseBlocksBombing: true };

  it('off by default: a cursed player can still bomb', () => {
    expect(CFG.curseBlocksBombing).toBe(false);
    expect(tick(s0, { p1: inp('none', true) }).state.bombs).toHaveLength(1);
  });

  it('on: a cursed player cannot place a bomb, an uncursed one can', () => {
    expect(tick(s0, { p1: inp('none', true) }, blocking).state.bombs).toHaveLength(0);
    expect(tick(s0, { p2: inp('none', true) }, blocking).state.bombs).toHaveLength(1);
  });

  it('on: bombing works again once the curse is gone', () => {
    const s = curse(board(['#A.B#']), 'p1', 1, 'p2');
    const after = tick(s, {}, blocking).state;
    expect(tick(after, { p1: inp('none', true) }, blocking).state.bombs).toHaveLength(1);
  });
});

describe('snapshot and purity', () => {
  it('the snapshot carries the ticks left per player and stays valid', () => {
    const s = curse(board(['#A.B#']), 'p1', 77, 'p2');
    const snap = toSnapshot(s, 'p1');
    expect(snap.players.map((p) => p.curse)).toEqual([77, 0]);
    expect(SnapshotMessage.safeParse(snap).success).toBe(true);
  });

  it('stepCurses does not mutate its inputs', () => {
    const s = edit(curse(board(['#ABC#'], { items: [item(1, 1, 'p3')] }), 'p1', 50, 'p4'), 'p2', {
      x: 1,
      y: 1,
    });
    const frozen = structuredClone(s);
    stepCurses(s.players, s.items, CFG);
    expect(s).toEqual(frozen);
  });

  it('is deterministic over 500 ticks of random play with curses and bombs (4 players)', () => {
    const play = () => {
      let rng = 12345;
      const roll = () => {
        const [v, n] = nextRandom(rng);
        rng = n;
        return v;
      };
      const dirs: Dir[] = ['up', 'down', 'left', 'right', 'none'];
      const base = board(['#A.....B#', '#.......#', '#.......#', '#C.....D#']);
      let s: GameState = {
        ...curse(base, 'p1', 100, 'p2'),
        contested: false, // deaths must not end the run early
        items: [item(3, 2, 'p3'), item(5, 2, 'p4'), item(4, 3, 'p1'), item(2, 3, 'p2')],
      };
      const cfg: GameConfig = { ...CFG, itemDropChance: 1, roundTicks: 10_000 };
      let seen = 0;
      for (let i = 0; i < 500; i++) {
        const o: Partial<Record<PlayerId, PlayerInput>> = {};
        for (const p of s.players)
          o[p.id] = inp(dirs[Math.floor(roll() * 5)] as Dir, roll() < 0.15, i + 1);
        s = simulate(s, ins(o), cfg).state;
        seen += s.players.filter((p) => p.curse > 0).length;
      }
      return { s, seen };
    };
    const a = play();
    expect(a).toEqual(play());
    expect(a.seen).toBeGreaterThan(0); // the run really involved curses
  });
});
