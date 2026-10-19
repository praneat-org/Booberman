import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ServerMessage } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GameState } from '../src/game';
import type { RoomDO } from '../src/room/RoomDO';
import { join, v } from './helpers';

type Snapshot = Extract<ServerMessage, { t: 'snapshot' }>;
const isSnapshot = (m: ServerMessage): m is Snapshot => m.t === 'snapshot';

describe('reverse curse over a real WebSocket (BE-40)', () => {
  it('a curse item makes the server reverse the controls and the snapshot shows the ticks left', async () => {
    const a = await join('curse1', 'A');
    const b = await join('curse1', 'B');
    await b.next((m) => isSnapshot(m) && m.players.length === 2);

    // a curse item from p2's box lies on p1's spawn tile
    await runInDurableObject(env.ROOM.get(env.ROOM.idFromName('curse1')), (r: RoomDO) => {
      const holder = r as unknown as { state?: GameState };
      if (!holder.state) throw new Error('no game state yet');
      holder.state = {
        ...holder.state,
        items: [{ x: 1, y: 1, kind: 'curse', droppedBy: 'p2', droppedBySession: 2 }],
      };
    });

    // p1 holds LEFT (into the border wall): uncursed that goes nowhere, cursed it walks right
    a.send({ v, t: 'input', seq: 1, dir: 'left', bomb: false });
    const moved = await a.next((m) => isSnapshot(m) && (m.players[0]?.x ?? 0) > 1.4, 3000);
    if (!isSnapshot(moved)) throw new Error('unreachable');
    const [p1, p2] = moved.players;
    expect(p1?.id).toBe('p1');
    expect(p1?.curse).toBeGreaterThan(0);
    expect(p1?.curse).toBeLessThanOrEqual(DEFAULT_CONFIG.curseTicks);
    expect(p2?.curse).toBe(0);
    expect(moved.items).toEqual([]);

    // the number goes down tick by tick
    const later = await a.next((m) => isSnapshot(m) && m.tick > moved.tick + 5);
    if (!isSnapshot(later)) throw new Error('unreachable');
    expect(later.players[0]?.curse).toBeLessThan(p1?.curse ?? 0);
    a.close();
    b.close();
  });
});
