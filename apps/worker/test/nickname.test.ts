import { describe, expect, it } from 'vitest';
import { connect, isEvent, join, v } from './helpers';

/** BE-35: the server re-checks the nickname with the shared rules and never trusts the client. */
describe('nickname check on join', () => {
  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['13 characters', 'a'.repeat(13)],
    ['emoji', 'bob😀'],
    ['space in the middle', 'two words'],
    ['symbols', 'a-b!'],
  ])('%s → INVALID_NICKNAME and the socket is closed', async (_name, nickname) => {
    const c = await connect('nickbad');
    c.send({ v, t: 'join', room: 'nickbad', nickname });
    const err = await c.next((m) => m.t === 'error');
    expect(err).toMatchObject({ code: 'INVALID_NICKNAME' });
    if (err.t === 'error') expect(JSON.stringify(err)).not.toMatch(/stack| at /);
    await expect.poll(() => c.closed?.code).toBe(4002);
    expect(c.received.some((m) => m.t === 'welcome')).toBe(false);
  });

  it('a rejected nickname does not take a slot', async () => {
    const bad = await connect('nickslot');
    bad.send({ v, t: 'join', room: 'nickslot', nickname: '😀' });
    await bad.next((m) => m.t === 'error');
    const a = await join('nickslot', 'A');
    expect(a.playerId).toBe('p1');
    a.close();
  });

  it('valid names (Thai, underscore, 12 chars) join, trimmed, and others see the trimmed name', async () => {
    const a = await join('nickok', 'มิ้นท์');
    const b = await connect('nickok');
    b.send({ v, t: 'join', room: 'nickok', nickname: '  a_1  ' });
    await b.next((m) => m.t === 'welcome');
    expect(await a.next(isEvent('playerJoined'))).toMatchObject({
      playerId: 'p2',
      nickname: 'a_1',
    });
    const c = await join('nickok', 'x'.repeat(12));
    expect(c.playerId).toBe('p3');
    a.close();
    b.close();
    c.close();
  });
});
