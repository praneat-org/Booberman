import type { PlayerId } from '@booberman/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockTransport, type MockTransportOptions } from '../net/MockTransport';
import { applyBoardEvent, applyWelcome } from './boardEvents';
import { toHudView } from './hudView';
import { RoundView } from './roundView';

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The whole join path of FE-29, the way GameScene wires it: transport → applyWelcome /
 * applyBoardEvent → roster → HUD cards. No Phaser, so it runs in node.
 */
function join(options: MockTransportOptions, nickname: string, runMs: number) {
  const transport = new MockTransport(options);
  const round = new RoundView(0);
  let selfId: PlayerId | undefined;
  transport.onWelcome((msg) => {
    selfId = msg.playerId;
    applyWelcome(msg, round, nickname);
  });
  transport.onEvent((msg) => applyBoardEvent(msg, round));
  transport.onSnapshot((msg) => {
    round.applySnapshot(msg, Date.now());
    round.frame(Date.now());
  });
  transport.connect();
  vi.advanceTimersByTime(runMs);
  transport.disconnect();
  return toHudView(round.latest, round.roster, selfId).cards;
}

describe('HUD names after joining (FE-29)', () => {
  it('without latency: every card has a name, ours is the nickname we joined with', () => {
    vi.useFakeTimers();
    const cards = join({ bots: 3, seed: 1 }, 'Hi', 400);
    expect(cards.map((c) => [c.id, c.name, c.isSelf])).toEqual([
      ['p1', 'Hi', true],
      ['p2', 'bot1', false],
      ['p3', 'bot2', false],
      ['p4', 'bot3', false],
    ]);
  });

  it('with latency 150 / jitter 50, 40 seeds: no card ever shows an id', () => {
    for (let seed = 1; seed <= 40; seed++) {
      vi.useFakeTimers();
      // a clock running ahead of the timers is what swapped welcome and playerJoined (see the
      // MockTransport order test); it must not matter any more
      let skew = 0;
      const cards = join(
        { bots: 3, seed, latencyMs: 150, jitterMs: 50, clock: () => Date.now() + skew++ },
        'มิ้นท์',
        900,
      );
      vi.useRealTimers();
      expect(
        cards.map((c) => [c.id, c.name]),
        `seed ${seed}`,
      ).toEqual([
        ['p1', 'มิ้นท์'],
        ['p2', 'bot1'],
        ['p3', 'bot2'],
        ['p4', 'bot3'],
      ]);
    }
  });
});
