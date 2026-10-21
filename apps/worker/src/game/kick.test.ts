import { type GameEvent, GRID_HEIGHT, GRID_WIDTH, SnapshotMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState } from './state';
import type { Bomb, Dir, Flame, GameState, PlayerId, PlayerInput, PlayerSim } from './types';

const CFG = DEFAULT_CONFIG;

/** Pictures like in bombs.test.ts: `#` wall, `x` box, `.` floor, `A`-`D` = p1-p4. Row 1 is y = 1. */
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

const bomb = (x: number, y: number, ownerId: PlayerId, fuse = CFG.bombFuseTicks): Bomb => ({
  x,
  y,
  ownerId,
  ownerSession: Number(ownerId.slice(1)),
  fuse,
});
const get = (s: GameState, id: PlayerId): PlayerSim => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};
const withKick = (s: GameState, id: PlayerId): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? { ...p, hasKick: true } : p)),
});
const press = (dir: Dir, seq: number): PlayerInput => ({ dir, bomb: false, seq });

/** One tick; `inputs` for p1 only. */
const step = (s: GameState, input?: PlayerInput) =>
  simulate(s, new Map(input ? [['p1' as PlayerId, input]] : []), CFG);

/** p1 presses `dir` on the first tick, then lets go (the bomb is already sliding); `n` ticks in all. */
function kickAndWatch(s: GameState, dir: Dir, n: number) {
  let cur = s;
  const events: GameEvent[] = [];
  const bombX: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = step(cur, press(i === 0 ? dir : 'none', i + 1));
    cur = r.state;
    events.push(...r.events);
    bombX.push(cur.bombs[0]?.x ?? -1);
  }
  return { state: cur, events, bombX };
}

describe('picking up the kick item', () => {
  const item = {
    x: 1,
    y: 1,
    kind: 'kick' as const,
    droppedBy: 'p2' as PlayerId,
    droppedBySession: 2,
  };

  it('sets hasKick, uses the item up and shows `kick` in the snapshot', () => {
    const { state } = step(board(['#A..#'], { items: [item] }));
    expect(state.items).toEqual([]);
    expect(get(state, 'p1').hasKick).toBe(true);
    const snap = toSnapshot(state);
    expect(snap.players[0]).toMatchObject({ id: 'p1', kick: true });
    expect(SnapshotMessage.safeParse(snap).success).toBe(true);
  });

  it('a player without it has no `kick` field', () => {
    expect(toSnapshot(board(['#A..#'])).players[0]).not.toHaveProperty('kick');
  });

  it('a cursed player takes a kick item too', () => {
    const s = board(['#A..#'], { items: [item] });
    const cursed = { ...s, players: s.players.map((p) => ({ ...p, curse: 50 })) };
    expect(get(step(cursed).state, 'p1').hasKick).toBe(true);
  });

  it('a new round starts without it', () => {
    expect(createInitialState(1, ['p1']).players[0]?.hasKick).toBe(false);
  });
});

describe('kicking a bomb', () => {
  it('without the item a bomb stays where it is', () => {
    const s = board(['#A.....#'], { bombs: [bomb(2, 1, 'p2')] });
    const { state } = kickAndWatch(s, 'right', 6);
    expect(state.bombs[0]).toMatchObject({ x: 2, y: 1 });
    expect(state.bombs[0]?.slide).toBeUndefined();
  });

  it('the kicker does not move and the bomb hops 1 tile every 2 ticks until it meets a wall', () => {
    const s = withKick(board(['#A.....#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    const first = step(s, press('right', 1)).state;
    expect(get(first, 'p1')).toMatchObject({ x: 1, y: 1 });
    expect(first.bombs[0]).toMatchObject({ x: 3, slide: 'right', kickedBy: { id: 'p1' } });

    const { state, bombX } = kickAndWatch(s, 'right', 10);
    expect(bombX).toEqual([3, 3, 4, 4, 5, 5, 6, 6, 6, 6]);
    expect(state.bombs[0]?.slide).toBeUndefined();
    expect(state.bombs[0]?.kickedBy).toEqual({ id: 'p1', session: 1 });
    // the last hop (6 -> wall) is refused on tick 9 and the bomb stops for good
    expect(toSnapshot(state).bombs[0]).toEqual({ x: 6, y: 1, fuse: CFG.bombFuseTicks - 10 });
  });

  it('the snapshot says which way a sliding bomb goes, with whole-tile positions', () => {
    const s = withKick(board(['#A.....#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    const snap = toSnapshot(step(s, press('right', 1)).state);
    expect(snap.bombs).toEqual([{ x: 3, y: 1, fuse: CFG.bombFuseTicks - 1, slide: 'right' }]);
    expect(SnapshotMessage.safeParse(snap).success).toBe(true);
  });

  it('slides in every direction (down here)', () => {
    const s = withKick(
      board(['#A#', '#.#', '#.#', '#.#', '#.#'], { bombs: [bomb(1, 2, 'p2')] }),
      'p1',
    );
    const { state } = kickAndWatch(s, 'down', 9);
    expect(state.bombs[0]).toMatchObject({ x: 1, y: 5 });
  });

  it('stops in front of a box', () => {
    const s = withKick(board(['#A...x.#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    expect(kickAndWatch(s, 'right', 8).state.bombs[0]).toMatchObject({ x: 4 });
  });

  it('stops in front of another bomb', () => {
    const s = withKick(board(['#A....#'], { bombs: [bomb(2, 1, 'p2'), bomb(5, 1, 'p3')] }), 'p1');
    const { state } = kickAndWatch(s, 'right', 8);
    expect(state.bombs.map((b) => b.x)).toEqual([4, 5]);
  });

  it('stops in front of a player, who is not pushed', () => {
    const s = withKick(board(['#A...B.#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    const { state } = kickAndWatch(s, 'right', 8);
    expect(state.bombs[0]).toMatchObject({ x: 4 });
    expect(state.bombs[0]?.slide).toBeUndefined();
    expect(get(state, 'p2')).toMatchObject({ x: 5, y: 1 });
  });

  it('a dead player does not stop a bomb', () => {
    // p3 keeps the round going: with a single survivor the round would end and freeze
    const s = withKick(board(['#A...B.C#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    const dead = {
      ...s,
      players: s.players.map((p) => (p.id === 'p2' ? { ...p, alive: false } : p)),
    };
    expect(kickAndWatch(dead, 'right', 12).state.bombs[0]).toMatchObject({ x: 6 });
  });

  it('a kick with no room for the first hop does nothing', () => {
    const s = withKick(board(['#A.x..#'], { bombs: [bomb(2, 1, 'p2')] }), 'p1');
    const { state } = kickAndWatch(s, 'right', 2);
    expect(state.bombs[0]).toMatchObject({ x: 2 });
    expect(state.bombs[0]?.slide).toBeUndefined();
    expect(state.bombs[0]?.kickedBy).toBeUndefined();
  });

  it('a bomb that is already sliding cannot be kicked again', () => {
    const s = withKick(
      board(['#A.....#'], { bombs: [{ ...bomb(2, 1, 'p2'), slide: 'right', slideCd: 1 }] }),
      'p1',
    );
    expect(step(s, press('right', 1)).state.bombs[0]?.kickedBy).toBeUndefined();
  });

  it('the fuse keeps counting while it slides, and it explodes where it is when due', () => {
    const s = withKick(board(['#A.....#'], { bombs: [bomb(2, 1, 'p2', 4)] }), 'p1');
    const { state, bombX } = kickAndWatch(s, 'right', 4);
    expect(bombX.slice(0, 3)).toEqual([3, 3, 4]);
    expect(state.bombs).toEqual([]); // 4th tick: due, exploded at x = 4
    expect(state.flames.some((f) => f.x === 4 && f.y === 1)).toBe(true);
    expect(state.flames.every((f) => f.kind === 'kick' && f.ownerId === 'p1')).toBe(true);
  });
});

describe('sliding into fire', () => {
  it('a bomb that slides onto a burning tile goes off at once', () => {
    const fire: Flame = { x: 4, y: 1, ownerId: 'p3', ownerSession: 3, ttl: 10 };
    const s = withKick(board(['#A.....#'], { bombs: [bomb(2, 1, 'p2')], flames: [fire] }), 'p1');
    const { state, bombX } = kickAndWatch(s, 'right', 3);
    expect(bombX).toEqual([3, 3, -1]); // third tick: reached x = 4, burning, gone
    // credit follows the fire it ran into (chain rule), so no `kick` flames here
    expect(
      state.flames.filter((f) => f.ttl === CFG.flameTicks).every((f) => f.ownerId === 'p3'),
    ).toBe(true);
  });
});

describe('credit goes to the kicker', () => {
  // p1 kicks p2's bomb along the corridor and stands still. The bomb hops at ticks 1, 3, 5 to x = 5
  // and stops in front of p3 (x = 6); at tick 8 it explodes: flames 3..7 burn p3, p1 (x = 1) and
  // p2 (x = 8) are out of reach.
  const setup = (fuse: number) =>
    withKick(board(['#A....C.B#'], { bombs: [bomb(2, 1, 'p2', fuse)] }), 'p1');

  it('kill event cause kick, killer p1, +2 troll points and a kickKill', () => {
    const { state, events } = kickAndWatch(setup(8), 'right', 8);
    expect(get(state, 'p3').alive).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'kill', killer: 'p1', victim: 'p3', cause: 'kick' }),
    );
    expect(get(state, 'p1').stats).toMatchObject({
      kills: 1,
      kickKills: 1,
      trollPoints: CFG.trollPoints.kick,
    });
    expect(get(state, 'p3').killedBy).toBe('p1');
  });

  it('beats the owner: p2 (who placed it) gets nothing', () => {
    const { state } = kickAndWatch(setup(8), 'right', 8);
    expect(get(state, 'p2').stats.kills).toBe(0);
  });

  it('a kicker who has left the room counts for nobody (D33)', () => {
    let cur = kickAndWatch(setup(8), 'right', 3).state;
    cur = { ...cur, players: cur.players.filter((p) => p.id !== 'p1') };
    const events: GameEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const r = simulate(cur, new Map(), CFG);
      cur = r.state;
      events.push(...r.events);
    }
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'kill', killer: null, victim: 'p3', cause: 'kick' }),
    );
  });

  it('kicking your own bomb into yourself is a self-kill, not a kick kill', () => {
    // p1's own bomb goes to x = 3 (wall at 4), its flames (1..3) still reach p1 who stays at x = 1
    const s = withKick(board(['#A..#'], { bombs: [bomb(2, 1, 'p1', 5)] }), 'p1');
    const { events } = kickAndWatch(s, 'right', 5);
    expect(events.filter((e) => e.kind === 'kill')).toEqual([
      expect.objectContaining({ killer: 'p1', victim: 'p1', cause: 'self' }),
    ]);
  });

  it("a kicked ghost's bomb stays the ghost's: cause ghost, not kick (D35 order)", () => {
    // same corridor, but p2's bomb is a ghost bomb (radius 1): it stops at x = 5 and burns 4..6
    const s = withKick(
      board(['#A....C.B#'], { bombs: [{ ...bomb(2, 1, 'p2', 8), kind: 'ghost' }] }),
      'p1',
    );
    const { state, events } = kickAndWatch(s, 'right', 8);
    expect(get(state, 'p3').alive).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'kill', killer: 'p2', victim: 'p3', cause: 'ghost' }),
    );
    expect(get(state, 'p1').stats.kickKills).toBe(0);
  });

  it('a normal bomb is still credited to its owner as `bomb`', () => {
    const s = board(['#A.B#'], { bombs: [bomb(2, 1, 'p1', 1)] });
    const { events } = simulate(s, new Map(), CFG);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'kill', cause: 'bomb' }));
  });

  it('the kick credit travels down a chain (a normal bomb set off by a kicked one)', () => {
    // the kicked bomb stops at x = 5 and its flames (3..7) set off p3's bomb at 7 (fuse far from due),
    // whose flames (5..9) burn p2 at 8: the whole chain is the kicker's
    const s = withKick(
      board(['#A....C.B#'], { bombs: [bomb(2, 1, 'p2', 8), bomb(7, 1, 'p3', 40)] }),
      'p1',
    );
    const { state, events } = kickAndWatch(s, 'right', 8);
    expect(state.bombs).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'kill', killer: 'p1', victim: 'p2', cause: 'kick' }),
    );
  });
});
