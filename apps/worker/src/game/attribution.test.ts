import { type GameEvent, GRID_HEIGHT, GRID_WIDTH } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { attributeKill, type FlameOrigin, type Kill, scoreKills } from './attribution';
import { DEFAULT_CONFIG, simulate } from './simulate';
import { createInitialState } from './state';
import { summarizeRound } from './summary';
import type { Bomb, GameState, PlayerId, PlayerInput, PlayerSim } from './types';
import { DEPARTED } from './types';

const CFG = DEFAULT_CONFIG;

// ── helpers ─────────────────────────────────────────────────────────────────

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

const none = new Map<PlayerId, PlayerInput>();
const tick = (s: GameState) => simulate(s, none, CFG);
const get = (s: GameState, id: PlayerId): PlayerSim => {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};
const edit = (s: GameState, id: PlayerId, patch: Partial<PlayerSim>): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});
/** `id` carries a curse with `left` ticks that came from the player with this join session. */
const cursedBy = (s: GameState, id: PlayerId, left: number, by: PlayerId, session?: number) =>
  edit(s, id, {
    curse: left,
    cursedBy: by,
    cursedBySession: session ?? Number(by.slice(1)),
  });
const due = (x: number, y: number, ownerId: PlayerId): Bomb => ({
  x,
  y,
  ownerId,
  ownerSession: Number(ownerId.slice(1)),
  fuse: 1,
});
const kills = (events: GameEvent[]) => events.flatMap((e) => (e.kind === 'kill' ? [e] : []));
const killEvent = (killer: PlayerId | null, victim: PlayerId, cause: Kill['cause']) => ({
  v: 1,
  t: 'event',
  kind: 'kill',
  killer,
  victim,
  cause,
});

// ── the credit table (CAR-3798), row by row ─────────────────────────────────

describe('attributeKill: the credit table, first matching row wins', () => {
  const room = (): { players: readonly PlayerSim[]; v: PlayerSim } => {
    const players = createInitialState(1, ['p1', 'p2', 'p3']).players;
    return { players, v: players[1] as PlayerSim }; // victim = p2
  };
  const bombOf = (owner: PlayerId | typeof DEPARTED): FlameOrigin => ({ owner, kind: 'bomb' });

  it('row 1: a curse from somebody else -> the sender (curse), whoever lit the fire', () => {
    const { players, v } = room();
    const cursed = { ...v, curse: 50, cursedBy: 'p1' as const, cursedBySession: 1 };
    const all = players.map((p) => (p.id === 'p2' ? cursed : p));
    expect(attributeKill(all, cursed, bombOf('p3'))).toEqual({
      victim: 'p2',
      killer: 'p1',
      cause: 'curse',
    });
  });

  it('row 1 beats every other row: also over a ghost or a kicked bomb', () => {
    const { players, v } = room();
    const cursed = { ...v, curse: 50, cursedBy: 'p1' as const, cursedBySession: 1 };
    const all = players.map((p) => (p.id === 'p2' ? cursed : p));
    for (const kind of ['ghost', 'kick'] as const) {
      expect(attributeKill(all, cursed, { owner: 'p3', kind })).toMatchObject({
        killer: 'p1',
        cause: 'curse',
      });
    }
  });

  it('row 1 example: A curses B, B dies in B’s own bomb -> A gets it, not a self-kill of B', () => {
    const { players, v } = room();
    const cursed = { ...v, curse: 50, cursedBy: 'p1' as const, cursedBySession: 1 };
    const all = players.map((p) => (p.id === 'p2' ? cursed : p));
    expect(attributeKill(all, cursed, bombOf('p2'))).toEqual({
      victim: 'p2',
      killer: 'p1',
      cause: 'curse',
    });
  });

  it('row 1 does not apply once the curse is over, or when the curse came from the victim’s own box', () => {
    const { players, v } = room();
    const over = { ...v, curse: 0, cursedBy: 'p1' as const, cursedBySession: 1 };
    expect(attributeKill(players, over, bombOf('p3'))).toMatchObject({
      killer: 'p3',
      cause: 'bomb',
    });
    const ownBox = { ...v, curse: 50, cursedBy: null, cursedBySession: null };
    expect(attributeKill(players, ownBox, bombOf('p3'))).toMatchObject({
      killer: 'p3',
      cause: 'bomb',
    });
  });

  it('row 1 with a sender who has left the room: nobody gets it (D33), it is still a curse death', () => {
    const { players, v } = room();
    const cursed = { ...v, curse: 50, cursedBy: 'p1' as const, cursedBySession: 99 }; // session 99 is gone
    const all = players.map((p) => (p.id === 'p2' ? cursed : p));
    expect(attributeKill(all, cursed, bombOf('p3'))).toEqual({
      victim: 'p2',
      killer: null,
      cause: 'curse',
    });
  });

  it('row 1 with a newcomer in the sender’s old slot: the newcomer is not the sender', () => {
    const { players, v } = room();
    const cursed = { ...v, curse: 50, cursedBy: 'p1' as const, cursedBySession: 5 };
    // p1 left, someone new took the slot and has session 8
    const all = players.map((p) =>
      p.id === 'p2' ? cursed : p.id === 'p1' ? { ...p, session: 8 } : p,
    );
    expect(attributeKill(all, cursed, bombOf('p3'))).toMatchObject({
      killer: null,
      cause: 'curse',
    });
  });

  it('row 2 (stretch, BE-46): a ghost’s bomb -> the ghost', () => {
    const { players, v } = room();
    expect(attributeKill(players, v, { owner: 'p3', kind: 'ghost' })).toEqual({
      victim: 'p2',
      killer: 'p3',
      cause: 'ghost',
    });
  });

  it('row 3 (stretch, BE-45): a kicked bomb -> the one who kicked it', () => {
    const { players, v } = room();
    expect(attributeKill(players, v, { owner: 'p3', kind: 'kick' })).toEqual({
      victim: 'p2',
      killer: 'p3',
      cause: 'kick',
    });
  });

  it('row 4: a normal bomb -> its owner', () => {
    const { players, v } = room();
    expect(attributeKill(players, v, bombOf('p1'))).toEqual({
      victim: 'p2',
      killer: 'p1',
      cause: 'bomb',
    });
  });

  it('no row: the credit falls on the victim -> self-kill, for a normal bomb and for a kick', () => {
    const { players, v } = room();
    expect(attributeKill(players, v, bombOf('p2'))).toEqual({
      victim: 'p2',
      killer: 'p2',
      cause: 'self',
    });
    expect(attributeKill(players, v, { owner: 'p2', kind: 'kick' })).toEqual({
      victim: 'p2',
      killer: 'p2',
      cause: 'self',
    });
  });

  it('a bomb whose owner has left: nobody gets it (D33)', () => {
    const { players, v } = room();
    expect(attributeKill(players, v, bombOf(DEPARTED))).toEqual({
      victim: 'p2',
      killer: null,
      cause: 'bomb',
    });
  });
});

describe('scoreKills: counters and troll points per row', () => {
  const fresh = () => createInitialState(1, ['p1', 'p2', 'p3']).players;
  const stats = (players: readonly PlayerSim[], id: PlayerId) =>
    get({ players } as GameState, id).stats;
  const ZERO = {
    kills: 0,
    deaths: 0,
    selfKills: 0,
    curseKills: 0,
    kickKills: 0,
    ghostKills: 0,
    transfers: 0,
    trollPoints: 0,
  };

  it('the table of points is the one in CAR-3798: curse 3, ghost 3, kick 2, bomb 1, self 0, a pass 1', () => {
    expect(CFG.trollPoints).toEqual({ curse: 3, ghost: 3, kick: 2, bomb: 1, self: 0, transfer: 1 });
  });

  it.each([
    ['curse', 3, { curseKills: 1 }],
    ['ghost', 3, { ghostKills: 1 }],
    ['kick', 2, { kickKills: 1 }],
    ['bomb', 1, {}],
  ] as const)(
    '%s kill: killer +1 kill and %i troll points, victim +1 death',
    (cause, points, extra) => {
      const after = scoreKills(fresh(), [{ victim: 'p2', killer: 'p1', cause }], CFG);
      expect(stats(after, 'p1')).toEqual({ ...ZERO, kills: 1, trollPoints: points, ...extra });
      expect(stats(after, 'p2')).toEqual({ ...ZERO, deaths: 1 });
      expect(stats(after, 'p3')).toEqual(ZERO);
    },
  );

  it('self-kill: a death and a self-kill for the victim, no kill, no points', () => {
    const after = scoreKills(fresh(), [{ victim: 'p2', killer: 'p2', cause: 'self' }], CFG);
    expect(stats(after, 'p2')).toEqual({ ...ZERO, deaths: 1, selfKills: 1 });
    expect(stats(after, 'p1')).toEqual(ZERO);
  });

  it('credit to nobody: only the victim’s death is booked', () => {
    const after = scoreKills(fresh(), [{ victim: 'p2', killer: null, cause: 'bomb' }], CFG);
    expect(stats(after, 'p2')).toEqual({ ...ZERO, deaths: 1 });
    expect(
      after
        .filter((p) => p.id !== 'p2')
        .every((p) => p.stats.kills === 0 && p.stats.trollPoints === 0),
    ).toBe(true);
  });

  it('several kills add up, and the input is not mutated', () => {
    const before = fresh();
    const frozen = structuredClone(before);
    const after = scoreKills(
      before,
      [
        { victim: 'p2', killer: 'p1', cause: 'bomb' },
        { victim: 'p3', killer: 'p1', cause: 'curse' },
      ],
      CFG,
    );
    expect(stats(after, 'p1')).toEqual({ ...ZERO, kills: 2, curseKills: 1, trollPoints: 4 });
    expect(before).toEqual(frozen);
  });

  it('points come from the config, nothing is hardcoded', () => {
    const cfg = { ...CFG, trollPoints: { ...CFG.trollPoints, bomb: 7 } };
    const after = scoreKills(fresh(), [{ victim: 'p2', killer: 'p1', cause: 'bomb' }], cfg);
    expect(stats(after, 'p1').trollPoints).toBe(7);
  });
});

// ── through simulate(): events and counters on a real board ────────────────

describe('simulate: kill events and counters', () => {
  it('a normal bomb: kill { killer, victim, bomb }, killer +1 kill +1 point, victim +1 death', () => {
    // bomb of p1 at x4 reaches x2..x6: p2 at x5 burns, p1 at x1 is outside, p3 at x9 too
    const s = board(['#A...B...C.#'], { bombs: [due(4, 1, 'p1')] });
    const { state, events } = tick(s);
    expect(kills(events)).toEqual([killEvent('p1', 'p2', 'bomb')]);
    expect(get(state, 'p1').stats).toMatchObject({ kills: 1, trollPoints: 1, deaths: 0 });
    expect(get(state, 'p2').stats).toMatchObject({
      kills: 0,
      deaths: 1,
      selfKills: 0,
      trollPoints: 0,
    });
  });

  it('own bomb: kill { p1, p1, self }, a self-kill and no point', () => {
    const s = board(['#A....B...#'], { bombs: [due(2, 1, 'p1')] }); // reaches x1..x4; p2 at x6 is safe
    const { state, events } = tick(s);
    expect(kills(events)).toEqual([killEvent('p1', 'p1', 'self')]);
    expect(get(state, 'p1').stats).toMatchObject({
      kills: 0,
      deaths: 1,
      selfKills: 1,
      trollPoints: 0,
    });
  });

  it('AC example: A curses B by contact, then B dies in B’s own bomb -> the kill is A’s, a curse kill', () => {
    // p1 and p2 stand on the same tile (x2), p3 is far away; p1 carries a curse of its own box
    let s = board(['#.A....C...#', '#B.........#']);
    s = edit(s, 'p2', { x: 2, y: 1 });
    s = edit(s, 'p1', { curse: 120, cursedBy: null, cursedBySession: null });
    const passed = tick(s);
    expect(get(passed.state, 'p2')).toMatchObject({ curse: 119, cursedBy: 'p1' });
    expect(get(passed.state, 'p1').stats).toMatchObject({ transfers: 1, trollPoints: 1 });

    // A walks off; B stands on its own bomb that is about to go off
    const bombed = { ...edit(passed.state, 'p1', { x: 5 }), bombs: [due(2, 1, 'p2')] };
    const { state, events } = tick(bombed);
    expect(get(state, 'p2').killedBy).toBe('p2'); // the raw flame owner is still B ...
    expect(kills(events)).toContainEqual(killEvent('p1', 'p2', 'curse')); // ... the credit is A's
    expect(get(state, 'p1').stats).toMatchObject({
      kills: 1,
      curseKills: 1,
      transfers: 1,
      trollPoints: 1 + CFG.trollPoints.curse,
    });
    expect(get(state, 'p2').stats).toMatchObject({ deaths: 1, selfKills: 0, kills: 0 });
  });

  it('a curse that came from a box someone else broke is credited to the box breaker', () => {
    let s = board(['#A.B.....C.#']);
    s = cursedBy(s, 'p2', 100, 'p1'); // p1 broke the box p2 picked up
    s = { ...s, bombs: [due(5, 1, 'p3')] }; // p3's bomb reaches x3..x7: p2 at x3 burns
    const { events, state } = tick(s);
    expect(kills(events)).toEqual([killEvent('p1', 'p2', 'curse')]);
    expect(get(state, 'p1').stats).toMatchObject({ kills: 1, curseKills: 1, trollPoints: 3 });
    expect(get(state, 'p3').stats).toMatchObject({ kills: 0, trollPoints: 0 });
  });

  it('a curse from somebody who has left: killer null, nobody scores, the victim still dies', () => {
    let s = board(['#A.B.....C.#']);
    s = cursedBy(s, 'p2', 100, 'p1', 99); // the sender's session 99 is not in the room any more
    s = { ...s, bombs: [due(5, 1, 'p3')] };
    const { events, state } = tick(s);
    expect(kills(events)).toEqual([killEvent(null, 'p2', 'curse')]);
    expect(get(state, 'p2').stats).toMatchObject({ deaths: 1 });
    for (const p of state.players) expect(p.stats.kills + p.stats.trollPoints).toBe(0);
  });

  it('a bomb of somebody who has left: killer null, cause bomb (D33)', () => {
    let s = board(['#A.B.....C.#']);
    s = { ...s, bombs: [{ ...due(5, 1, 'p3'), ownerSession: 42 }] };
    const { events, state } = tick(s);
    expect(kills(events)).toEqual([killEvent(null, 'p2', 'bomb')]);
    for (const p of state.players) expect(p.stats.kills + p.stats.trollPoints).toBe(0);
  });

  it('a chain: the kill goes to the owner of the first bomb', () => {
    // p1's bomb at x3 reaches x1..x5 and sets off p3's bomb at x5, whose flames reach p2 at x7
    const s = board(['#A.....B.C.#'], {
      bombs: [due(3, 1, 'p1'), { ...due(5, 1, 'p3'), fuse: 30 }],
    });
    const { events } = tick(s);
    expect(kills(events)).toContainEqual(killEvent('p1', 'p2', 'bomb'));
    expect(kills(events).every((k) => k.killer !== 'p3')).toBe(true);
  });

  it('two deaths in one tick: one event each, in player id order', () => {
    const s = board(['#A.B...C.#'], { bombs: [due(2, 1, 'p1')] }); // reaches x1..x4: p1 and p2 burn
    const { events } = tick(s);
    expect(kills(events)).toEqual([killEvent('p1', 'p1', 'self'), killEvent('p1', 'p2', 'bomb')]);
  });

  it('inside one tick the events are: boxes, then kills, then roundEnd last', () => {
    const s = board(['#Ax..B.#'], { bombs: [due(4, 1, 'p1')] }); // x2..x6: breaks the box at 2... and p2 burns
    const { events } = tick(s);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('boxDestroyed');
    expect(kinds.indexOf('boxDestroyed')).toBeLessThan(kinds.indexOf('kill'));
    expect(kinds.at(-1)).toBe('roundEnd');
    expect(kinds.filter((k) => k === 'roundEnd')).toHaveLength(1);
  });

  it('a dead player standing in lingering flames is not booked again', () => {
    const s = board(['#A....B...C#'], { bombs: [due(2, 1, 'p1')] });
    const once = tick(s);
    expect(kills(once.events)).toHaveLength(1);
    expect(once.state.flames.some((f) => f.x === 1 && f.y === 1)).toBe(true); // still burning at p1
    const later = tick(once.state);
    expect(kills(later.events)).toEqual([]);
    expect(get(later.state, 'p1').stats).toEqual(get(once.state, 'p1').stats);
  });

  it('roundEnd carries the same table summarizeRound gives for the final players', () => {
    const s = board(['#A...B.#'], { bombs: [due(4, 1, 'p1')] });
    const { state, events } = tick(s);
    const end = events.find((e) => e.kind === 'roundEnd');
    expect(end).toMatchObject({
      winner: 'p1',
      reason: 'lastAlive',
      ...summarizeRound(state.players),
    });
  });

  it('is deterministic: the same state gives the same events and counters', () => {
    const s = board(['#A...B.#'], { bombs: [due(4, 1, 'p1')] });
    expect(tick(s)).toEqual(tick(s));
  });
});
