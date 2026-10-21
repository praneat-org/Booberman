import { GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import { isGhostTile, nearestRimTile } from './ghost';
import { simulate } from './simulate';
import { toSnapshot } from './snapshot';
import { createInitialState } from './state';
import type { Dir, GameState, PlayerId, PlayerInput, PlayerSim } from './types';

const cfg = GAME_CONFIG;
const input = (dir: Dir, bomb = false): PlayerInput => ({ dir, bomb, seq: 1 });
const inputs = (o: Partial<Record<PlayerId, PlayerInput>>) =>
  new Map(Object.entries(o) as [PlayerId, PlayerInput][]);
const get = (s: GameState, id: PlayerId): PlayerSim => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};

/** Open arena (border walls only), p1 dead on (3,3) with no ghost yet, p2 alive at (6,5), p3 alive at (9,8). */
const arena = (): GameState => {
  const s = createInitialState(1, ['p1', 'p2', 'p3']);
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++)
    for (let x = 0; x < GRID_WIDTH; x++)
      grid += x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1 ? '#' : '.';
  const at = (id: PlayerId, x: number, y: number, extra: Partial<PlayerSim> = {}) =>
    ({ ...get(s, id), x, y, ...extra }) as PlayerSim;
  return {
    ...s,
    grid,
    players: [at('p1', 3, 3, { alive: false }), at('p2', 6, 5), at('p3', 9, 8)],
  };
};

/** The arena one tick later: p1 has just become a ghost. */
const ghostArena = (): GameState => simulate(arena(), inputs({})).state;

const idle = (s: GameState, ticks: number, i = inputs({}), c = cfg): GameState => {
  let cur = s;
  for (let t = 0; t < ticks; t++) cur = simulate(cur, i, c).state;
  return cur;
};

describe('rim geometry', () => {
  it('the rim is the outer ring without corners', () => {
    expect(isGhostTile(5, 0)).toBe(true);
    expect(isGhostTile(0, 5)).toBe(true);
    expect(isGhostTile(12, 9)).toBe(true);
    expect(isGhostTile(5, 10)).toBe(true);
    for (const [x, y] of [
      [0, 0],
      [12, 0],
      [0, 10],
      [12, 10],
      [5, 5],
      [1, 1],
      [-1, 5],
      [13, 5],
    ] as const)
      expect(isGhostTile(x, y)).toBe(false);
  });

  it('picks the rim tile nearest the death tile; a corner death goes to a neighbour tile', () => {
    expect(nearestRimTile(3, 3)).toEqual([3, 0]);
    expect(nearestRimTile(11, 5)).toEqual([12, 5]);
    expect(nearestRimTile(1, 1)).toEqual([1, 0]);
    expect(nearestRimTile(6, 9)).toEqual([6, 10]);
  });
});

describe('becoming a ghost', () => {
  it('dying puts the player on the rim with teleport true for exactly that tick', () => {
    const s1 = ghostArena();
    const g = get(s1, 'p1');
    expect([g.x, g.y]).toEqual([3, 0]);
    expect(toSnapshot(s1).players[0]).toMatchObject({
      id: 'p1',
      alive: false,
      teleport: true,
      ghost: true,
      throwCooldown: cfg.ghostFirstThrowTicks,
    });
    const s2 = simulate(s1, inputs({})).state;
    expect(toSnapshot(s2).players[0]).toMatchObject({ teleport: false, throwCooldown: 99 });
    expect(toSnapshot(s2).players[1]?.ghost).toBeUndefined();
  });

  it('a player killed by fire this tick becomes a ghost the same tick', () => {
    const s = arena();
    const live = { ...get(s, 'p2'), x: 6, y: 5 };
    const s0: GameState = {
      ...s,
      players: [get(s, 'p1'), live, get(s, 'p3')],
      flames: [{ x: 6, y: 5, ownerId: 'p3', ownerSession: get(s, 'p3').session, ttl: 5 }],
    };
    const { state } = simulate(s0, inputs({}));
    expect(get(state, 'p2').alive).toBe(false);
    expect(get(state, 'p2').ghost?.teleport).toBe(true);
    expect(isGhostTile(get(state, 'p2').x, get(state, 'p2').y)).toBe(true);
  });
});

describe('ghost walking', () => {
  it('moves one rim tile per 3 ticks along the edge and ignores directions into the board', () => {
    let s = ghostArena();
    s = idle(s, 1, inputs({ p1: input('right') }));
    expect(get(s, 'p1').x).toBe(4);
    s = idle(s, 2, inputs({ p1: input('right') }));
    expect(get(s, 'p1').x).toBe(4);
    s = idle(s, 1, inputs({ p1: input('right') }));
    expect(get(s, 'p1').x).toBe(5);
    s = idle(s, 12, inputs({ p1: input('down') }));
    expect([get(s, 'p1').x, get(s, 'p1').y]).toEqual([5, 0]);
  });

  it('never leaves the rim: stops before the corner, turns the other way along the side', () => {
    let s = idle(ghostArena(), 80, inputs({ p1: input('left') }));
    expect([get(s, 'p1').x, get(s, 'p1').y]).toEqual([1, 0]);
    s = idle(s, 20, inputs({ p1: input('up') }));
    expect([get(s, 'p1').x, get(s, 'p1').y]).toEqual([1, 0]);
    s = idle(s, 20, inputs({ p1: input('right') }));
    expect(get(s, 'p1').x).toBeGreaterThan(1);
    expect(get(s, 'p1').y).toBe(0);
  });

  it('keeps walking the held direction without new input (D27) and stops on none', () => {
    let s = idle(ghostArena(), 1, inputs({ p1: input('right') }));
    s = idle(s, 6);
    expect(get(s, 'p1').x).toBe(6);
    s = idle(s, 1, inputs({ p1: input('none') }));
    s = idle(s, 9);
    expect(get(s, 'p1').x).toBe(6);
  });
});

describe('ghost throw', () => {
  /** Ghost on the top rim at x, cooldown over; survivors set by the caller. */
  const ready = (x: number, survivors: [number, number][]): GameState => {
    const s = ghostArena();
    const [a, b] = survivors;
    const live = (p: PlayerSim, pos: [number, number] | undefined) =>
      pos ? { ...p, x: pos[0], y: pos[1] } : p;
    return {
      ...s,
      players: [
        { ...get(s, 'p1'), x, y: 0, ghost: { moveCd: 0, throwCd: 0, teleport: false } },
        live(get(s, 'p2'), a),
        live(get(s, 'p3'), b),
      ],
    };
  };

  it('lands on the free tile in the line 1-5 tiles in that is nearest a survivor', () => {
    // ghost at x=5 throws down column 5 (rows 1-5); survivor at (5,4) -> lands on (5,4)
    const { state, events } = simulate(
      ready(5, [
        [5, 4],
        [11, 9],
      ]),
      inputs({ p1: input('none', true) }),
    );
    const bomb = state.bombs[0];
    expect(bomb).toMatchObject({
      x: 5,
      y: 4,
      ownerId: 'p1',
      fuse: cfg.ghostBombFuseTicks,
      kind: 'ghost',
    });
    expect(state.bombs).toHaveLength(1);
    expect(events).toEqual([]);
    expect(toSnapshot(state).bombs[0]).toEqual({
      x: 5,
      y: 4,
      fuse: cfg.ghostBombFuseTicks,
      ghost: true,
    });
    expect(get(state, 'p1').ghost?.throwCd).toBe(cfg.ghostThrowCooldownTicks);
  });

  it('never lands farther than 5 tiles in; the survivor out of range pulls it to the far end', () => {
    const { state } = simulate(
      ready(5, [
        [5, 9],
        [11, 9],
      ]),
      inputs({ p1: input('none', true) }),
    );
    expect(state.bombs[0]).toMatchObject({ x: 5, y: 5 });
  });

  it('a side rim throws across: left rim lands in row y, right rim goes leftwards', () => {
    const s = ready(5, [
      [3, 4],
      [11, 9],
    ]);
    const left = {
      ...s,
      players: s.players.map((p) => (p.id === 'p1' ? { ...p, x: 0, y: 4 } : p)),
    };
    expect(simulate(left, inputs({ p1: input('none', true) })).state.bombs[0]).toMatchObject({
      x: 3,
      y: 4,
    });
    const right = {
      ...s,
      players: s.players.map((p) => (p.id === 'p1' ? { ...p, x: 12, y: 9 } : p)),
    };
    expect(simulate(right, inputs({ p1: input('none', true) })).state.bombs[0]).toMatchObject({
      x: 11,
      y: 9,
    });
  });

  it('skips tiles that are not free floor (box, bomb) and throws nothing if none is left', () => {
    const s = ready(5, [
      [5, 2],
      [11, 9],
    ]);
    const boxed = [...s.grid];
    boxed[2 * GRID_WIDTH + 5] = 'x';
    const withBox = { ...s, grid: boxed.join('') };
    expect(simulate(withBox, inputs({ p1: input('none', true) })).state.bombs[0]).toMatchObject({
      x: 5,
      y: 1,
    });
    const walls = [...s.grid];
    for (let y = 1; y <= 5; y++) walls[y * GRID_WIDTH + 5] = '#';
    const none = simulate(
      { ...s, grid: walls.join('') },
      inputs({ p1: input('none', true) }),
    ).state;
    expect(none.bombs).toHaveLength(0);
    expect(get(none, 'p1').ghost?.throwCd).toBe(0); // no throw -> no cooldown spent
  });

  it('does nothing with no survivor', () => {
    const s = ready(5, []);
    const alone: GameState = {
      ...s,
      contested: false,
      players: s.players.filter((p) => p.id === 'p1'),
    };
    expect(simulate(alone, inputs({ p1: input('none', true) })).state.bombs).toHaveLength(0);
  });

  it('first throw only after 100 ticks, then every 200', () => {
    const slow = { ...cfg, ghostBombFuseTicks: 100000 }; // keep the bombs (and the round) alive
    let s = ghostArena();
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, x: 6 } : p)) };
    const press = inputs({ p1: input('none', true) });
    const count = (g: GameState) => g.bombs.filter((b) => b.kind === 'ghost').length;
    const early = idle(s, cfg.ghostFirstThrowTicks - 1, press, slow);
    expect(count(early)).toBe(0);
    const first = simulate(early, press, slow).state;
    expect(count(first)).toBe(1);
    const mid = idle(first, cfg.ghostThrowCooldownTicks - 1, press, slow);
    expect(count(mid)).toBe(1);
    expect(count(simulate(mid, press, slow).state)).toBe(2);
  });
});

describe('ghost bomb effects', () => {
  const thrown = (): GameState => {
    const s0 = ghostArena();
    const s = {
      ...s0,
      players: s0.players.map((p) =>
        p.id === 'p1'
          ? { ...p, x: 6, y: 0, ghost: { moveCd: 0, throwCd: 0, teleport: false } }
          : p.id === 'p2'
            ? { ...p, x: 6, y: 4 }
            : p,
      ),
    };
    return simulate(s, inputs({ p1: input('none', true) })).state;
  };

  it('explodes 30 ticks after the throw with radius 1 and kills with cause ghost: +3 to the owner', () => {
    let s = thrown();
    expect(s.bombs[0]).toMatchObject({ x: 6, y: 4 });
    const kills: unknown[] = [];
    for (let t = 0; t < cfg.ghostBombFuseTicks; t++) {
      // the survivor stands still on the bomb tile
      const r = simulate(s, inputs({}));
      s = r.state;
      for (const e of r.events) if (e.kind === 'kill') kills.push(e);
    }
    expect(kills).toMatchObject([{ victim: 'p2', killer: 'p1', cause: 'ghost' }]);
    const p1 = get(s, 'p1');
    expect(p1.stats).toMatchObject({ kills: 1, ghostKills: 1, trollPoints: cfg.trollPoints.ghost });
    expect(cfg.trollPoints.ghost).toBe(3);
    // radius 1: p3 far away unharmed; flame only on the cross around (6,4)
    expect(get(s, 'p3').alive).toBe(true);
    expect(s.flames.every((f) => Math.abs(f.x - 6) + Math.abs(f.y - 4) <= 1)).toBe(true);
    expect(s.flames.length).toBe(5);
  });

  it('a ghost is not hurt by fire, cannot pick up items, and a curse from it still credits the sender', () => {
    const s = ghostArena();
    const g = get(s, 'p1');
    const onFire: GameState = {
      ...s,
      flames: [{ x: g.x, y: g.y, ownerId: 'p2', ownerSession: get(s, 'p2').session, ttl: 5 }],
      items: [{ x: g.x, y: g.y, kind: 'curse', droppedBy: 'p2', droppedBySession: 2 }],
    };
    const next = simulate(onFire, inputs({})).state;
    expect(get(next, 'p1').curse).toBe(0);
    expect(get(next, 'p1').stats.deaths).toBe(0);
    expect(next.items).toHaveLength(1);
  });

  it('does not count in the win condition: the last living player wins even with ghosts around', () => {
    const s = ghostArena();
    const oneDown: GameState = {
      ...s,
      players: s.players.map((p) => (p.id === 'p3' ? { ...p, alive: false } : p)),
    };
    const r = simulate(oneDown, inputs({}));
    expect(r.events.find((e) => e.kind === 'roundEnd')).toMatchObject({
      winner: 'p2',
      reason: 'lastAlive',
    });
  });

  it('a ghost bomb chains a normal bomb: the credit stays with the ghost', () => {
    let s = thrown();
    s = { ...s, bombs: [...s.bombs, { x: 6, y: 5, ownerId: 'p3', ownerSession: 3, fuse: 99 }] };
    const kills: { killer: string | null; cause: string }[] = [];
    for (let t = 0; t < cfg.ghostBombFuseTicks; t++) {
      const r = simulate(s, inputs({}));
      s = r.state;
      for (const e of r.events) if (e.kind === 'kill') kills.push(e);
    }
    expect(s.bombs).toHaveLength(0);
    expect(kills).toEqual([
      { victim: 'p2', killer: 'p1', cause: 'ghost', v: 1, t: 'event', kind: 'kill' },
    ]);
  });
});

describe('ghost determinism', () => {
  it('same inputs give the same state', () => {
    const run = () => {
      let s = ghostArena();
      for (let t = 0; t < 300; t++)
        s = simulate(s, inputs({ p1: input(t % 40 < 20 ? 'right' : 'left', t % 50 === 0) })).state;
      return s;
    };
    expect(run()).toEqual(run());
  });
});
