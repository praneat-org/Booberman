import { describe, expect, it, vi } from 'vitest';
import { fetchLeaderboard } from './leaderboardApi';

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });
const fetchOf = (res: Response | Error) =>
  vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

const entries = [{ rank: 1, nickname: 'mint', value: 5, matches: 7 }];
const err = { status: 'error' };

describe('fetchLeaderboard', () => {
  it('GETs with ?by= and returns the rows', async () => {
    const f = fetchOf(json({ by: 'kills', entries }));
    expect(await fetchLeaderboard('kills', f)).toEqual({ status: 'ok', by: 'kills', entries });
    expect(f).toHaveBeenCalledWith('/api/leaderboard?by=kills', expect.anything());
  });

  it('keeps an empty list as ok', async () => {
    expect(await fetchLeaderboard('wins', fetchOf(json({ by: 'wins', entries: [] })))).toEqual({
      status: 'ok',
      by: 'wins',
      entries: [],
    });
  });

  it('turns http errors, bad bodies, wrong tab and network failures into error', async () => {
    const bad = fetchOf(json({ error: 'BAD_BY' }, { status: 400 }));
    expect(await fetchLeaderboard('wins', bad)).toEqual(err);
    const junk = fetchOf(json({ by: 'wins', entries: [{ rank: 0 }] }));
    expect(await fetchLeaderboard('wins', junk)).toEqual(err);
    expect(await fetchLeaderboard('wins', fetchOf(json({ by: 'kills', entries })))).toEqual(err);
    expect(await fetchLeaderboard('wins', fetchOf(new Error('offline')))).toEqual(err);
  });
});
