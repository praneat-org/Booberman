import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ServerMessage } from '@booberman/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../src/game';
import type { RoomDO } from '../src/room/RoomDO';
import { begin, type Client, join, v } from './helpers';

type Event<K extends string> = Extract<ServerMessage, { t: 'event'; kind: K }>;
const roundEnd = (m: ServerMessage): m is Event<'roundEnd'> =>
  m.t === 'event' && m.kind === 'roundEnd';
const roundStart = (m: ServerMessage): m is Event<'roundStart'> =>
  m.t === 'event' && m.kind === 'roundStart';
const stubFor = (room: string) => env.ROOM.get(env.ROOM.idFromName(room));

const editState = (room: string, edit: (s: GameState) => Partial<GameState>) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => {
    const holder = r as unknown as { state?: GameState };
    if (!holder.state) throw new Error('no game state yet');
    holder.state = { ...holder.state, ...edit(holder.state) };
  });

/** Swap the DB binding the room sees (the rest of env stays real). */
const useDb = (room: string, db: Partial<D1Database>) =>
  runInDurableObject(stubFor(room), (r: RoomDO) => {
    const holder = r as unknown as { env: Cloudflare.Env };
    holder.env = new Proxy(holder.env, {
      get: (target, key, receiver) => (key === 'DB' ? db : Reflect.get(target, key, receiver)),
    });
  });

/** p1 at (1,1), p2 at (11,1): a bomb of p1 at (10,1) burns x8..x12 → only p2 is in the fire. */
const bombNextToP2: Partial<GameState> = {
  bombs: [{ x: 10, y: 1, ownerId: 'p1', ownerSession: 1, fuse: 1 }],
};

const twoPlayers = async (room: string, nickA = 'A', nickB = 'B') => {
  const a = await join(room, nickA);
  const b = await join(room, nickB);
  await begin(room, a, b);
  await b.next((m) => m.t === 'snapshot' && m.players.length === 2);
  return [a, b] as const;
};
const closeAll = (...clients: Client[]) => {
  for (const c of clients) c.close();
};

type MatchRow = {
  id: string;
  room_id: string;
  seed: number;
  started_at: number;
  ended_at: number;
  end_reason: string;
  winner_nick: string | null;
};
type PlayerRow = {
  nickname: string;
  kills: number;
  deaths: number;
  self_kills: number;
  curse_kills: number;
  transfers: number;
  troll_points: number;
  is_winner: number;
};
const matchesOf = async (room: string) =>
  (await env.DB.prepare('SELECT * FROM matches WHERE room_id = ?').bind(room).all<MatchRow>())
    .results;
const playersOf = async (matchId: string) =>
  (
    await env.DB.prepare('SELECT * FROM match_players WHERE match_id = ? ORDER BY nickname')
      .bind(matchId)
      .all<PlayerRow>()
  ).results;

afterEach(() => vi.restoreAllMocks());

describe('the end of a round is written to D1 (BE-42)', () => {
  it('one row in matches + one per player in match_players', async () => {
    const before = Date.now();
    const [a, b] = await twoPlayers('d1win', 'Ann', 'Bob');
    const welcome = (await a.next((m) => m.t === 'welcome')) as Extract<
      ServerMessage,
      { t: 'welcome' }
    >;
    await editState('d1win', () => bombNextToP2);
    await a.next(roundEnd);

    const [match, ...rest] = await vi.waitFor(async () => {
      const rows = await matchesOf('d1win');
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(rest).toEqual([]);
    expect(match).toMatchObject({
      room_id: 'd1win',
      seed: welcome.seed,
      end_reason: 'last_alive',
      winner_nick: 'Ann',
    });
    expect(match?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(match?.started_at).toBeGreaterThanOrEqual(before);
    expect(match?.ended_at).toBeGreaterThanOrEqual(match?.started_at ?? Infinity);
    expect(match?.ended_at).toBeLessThanOrEqual(Date.now());

    expect(await playersOf(match?.id ?? '')).toEqual([
      {
        match_id: match?.id,
        nickname: 'Ann',
        kills: 1,
        deaths: 0,
        self_kills: 0,
        curse_kills: 0,
        transfers: 0,
        troll_points: 1,
        is_winner: 1,
      },
      {
        match_id: match?.id,
        nickname: 'Bob',
        kills: 0,
        deaths: 1,
        self_kills: 0,
        curse_kills: 0,
        transfers: 0,
        troll_points: 0,
        is_winner: 0,
      },
    ]);
    // written once: the frozen end screen ticks on but does not write again
    await new Promise((r) => setTimeout(r, 300));
    expect(await matchesOf('d1win')).toHaveLength(1);
    closeAll(a, b);
  });

  it('time limit: a draw is stored with end_reason time_up and no winner', async () => {
    const [a, b] = await twoPlayers('d1draw');
    await editState('d1draw', () => ({ tick: 2990 }));
    await a.next(roundEnd, 3000);
    const [match] = await vi.waitFor(async () => {
      const rows = await matchesOf('d1draw');
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(match).toMatchObject({ end_reason: 'time_up', winner_nick: null });
    expect((await playersOf(match?.id ?? '')).map((p) => p.is_winner)).toEqual([0, 0]);
    closeAll(a, b);
  });

  it('two players with the same nickname: both rows are kept', async () => {
    const [a, b] = await twoPlayers('d1dup', 'Same', 'Same');
    await editState('d1dup', () => bombNextToP2);
    await a.next(roundEnd);
    const [match] = await vi.waitFor(async () => {
      const rows = await matchesOf('d1dup');
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(match?.winner_nick).toBe('Same');
    expect((await playersOf(match?.id ?? '')).map((p) => [p.nickname, p.is_winner])).toEqual([
      ['Same', 1],
      ['Same#2', 0],
    ]);
    closeAll(a, b);
  });

  it('each round writes its own match: a rematch round adds a second row', async () => {
    const [a, b] = await twoPlayers('d1two');
    await editState('d1two', () => bombNextToP2);
    await a.next(roundEnd);
    a.send({ v, t: 'rematch' });
    b.send({ v, t: 'rematch' });
    await a.next(roundStart);
    await editState('d1two', () => ({ tick: 2990 }));
    await vi.waitFor(async () => expect(await matchesOf('d1two')).toHaveLength(2), {
      timeout: 4000,
    });
    const rows = await matchesOf('d1two');
    expect(rows.map((r) => r.end_reason).sort()).toEqual(['last_alive', 'time_up']);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    closeAll(a, b);
  });
});

describe('D1 trouble never reaches the game (D12)', () => {
  it('batch rejects: the error is logged, the end screen is up and the next round starts', async () => {
    const [a, b] = await twoPlayers('d1fail');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    await useDb('d1fail', {
      prepare: env.DB.prepare.bind(env.DB),
      batch: () => {
        calls++;
        return Promise.reject(new Error('D1_DOWN'));
      },
    });
    await editState('d1fail', () => bombNextToP2);

    expect(await a.next(roundEnd)).toMatchObject({ winner: 'p1' });
    await vi.waitFor(() => expect(log.mock.calls.flat().join('\n')).toContain('match-save'));
    expect(log.mock.calls.flat().join('\n')).toContain('D1_DOWN');
    expect(calls).toBe(1);
    expect(await matchesOf('d1fail')).toEqual([]);

    // the room is fine: both press play again and a new round starts
    a.send({ v, t: 'rematch' });
    b.send({ v, t: 'rematch' });
    expect(await a.next(roundStart)).toMatchObject({ kind: 'roundStart' });
    closeAll(a, b);
  });

  it('building the statements throws: same, the tick survives', async () => {
    const [a, b] = await twoPlayers('d1throw');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useDb('d1throw', {
      prepare: () => {
        throw new Error('PREPARE_BROKE');
      },
    });
    await editState('d1throw', () => bombNextToP2);
    await a.next(roundEnd);
    await vi.waitFor(() => expect(log.mock.calls.flat().join('\n')).toContain('PREPARE_BROKE'));
    // no tick-failed: the throw did not escape into the loop
    expect(log.mock.calls.flat().join('\n')).not.toContain('tick-failed');
    a.send({ v, t: 'rematch' });
    b.send({ v, t: 'rematch' });
    await a.next(roundStart);
    closeAll(a, b);
  });

  it('batch never settles: ticks, end screen and the next round do not wait for it', async () => {
    const [a, b] = await twoPlayers('d1hang');
    await useDb('d1hang', {
      prepare: env.DB.prepare.bind(env.DB),
      batch: () => new Promise(() => {}),
    });
    await editState('d1hang', () => bombNextToP2);
    await a.next(roundEnd);

    // snapshots keep coming while the write hangs
    const seen = a.received.filter((m) => m.t === 'snapshot').length;
    await new Promise((r) => setTimeout(r, 300));
    expect(a.received.filter((m) => m.t === 'snapshot').length).toBeGreaterThan(seen + 3);

    a.send({ v, t: 'rematch' });
    b.send({ v, t: 'rematch' });
    expect(await a.next(roundStart)).toMatchObject({ kind: 'roundStart' });
    closeAll(a, b);
  });
});
