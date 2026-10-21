import { PROTOCOL_VERSION, type ServerMessage } from '@booberman/protocol';
import type { GameState, PlayerId } from './types';

export type SnapshotMessage = Extract<ServerMessage, { t: 'snapshot' }>;

/** D16: positions go out with 2 decimals so the busiest snapshot stays under 2KB. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A tile burning from two bombs is still one tile for the client. */
function uniqueTiles(flames: GameState['flames']): [x: number, y: number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const f of flames) {
    const k = `${f.x},${f.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([f.x, f.y]);
  }
  return out;
}

/**
 * Full room state for one tick. `ackSeq` is per client, so pass the viewer
 * (RoomDO calls this once per socket, or once with no viewer for a shared body).
 */
export function toSnapshot(state: GameState, viewer?: PlayerId): SnapshotMessage {
  const me = state.players.find((p) => p.id === viewer);
  return {
    v: PROTOCOL_VERSION,
    t: 'snapshot',
    tick: state.tick,
    ackSeq: me?.ackSeq ?? 0,
    players: state.players.map((p) => ({
      id: p.id,
      x: round2(p.x),
      y: round2(p.y),
      alive: p.alive,
      curse: p.alive ? p.curse : 0,
      teleport: p.ghost?.teleport ?? false,
      ...(p.ghost && { ghost: true, throwCooldown: p.ghost.throwCd }),
      ...(p.alive && p.hasKick && { kick: true }),
    })),
    // bombs stay on whole tiles even when sliding (D16): `slide` tells the client which way it is going
    bombs: state.bombs.map((b) => ({
      x: b.x,
      y: b.y,
      fuse: b.fuse,
      ...(b.kind && { ghost: true }),
      ...(b.slide && { slide: b.slide }),
    })),
    flames: uniqueTiles(state.flames),
    items: state.items.map((i) => ({ x: i.x, y: i.y, kind: i.kind })),
  };
}
