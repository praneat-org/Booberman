import { GRID_HEIGHT, GRID_WIDTH } from './board';
import type { ClientMessage, ServerMessage } from './messages';
import { PROTOCOL_VERSION } from './version';

/** Classic arena: walls on the border and every even/even tile, boxes elsewhere, spawn corners clear. */
export function exampleGrid(): string {
  const spawns = new Set([
    '1,1',
    '2,1',
    '1,2',
    '11,1',
    '10,1',
    '11,2',
    '1,9',
    '1,8',
    '2,9',
    '11,9',
    '10,9',
    '11,8',
  ]);
  let grid = '';
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const border = x === 0 || y === 0 || x === GRID_WIDTH - 1 || y === GRID_HEIGHT - 1;
      if (border || (x % 2 === 0 && y % 2 === 0)) grid += '#';
      else grid += spawns.has(`${x},${y}`) ? '.' : 'x';
    }
  }
  return grid;
}

const v = PROTOCOL_VERSION;

/** One valid example of every message — used by tests and by the client's MockTransport. */
export const exampleClientMessages = {
  join: { v, t: 'join', room: 'abc123', nickname: 'มิ้นท์' },
  input: { v, t: 'input', seq: 42, dir: 'left', bomb: false },
  ping: { v, t: 'ping', ts: 1739000000000 },
  rematch: { v, t: 'rematch' },
} as const satisfies Record<ClientMessage['t'], ClientMessage>;

/** A busy 4-player tick: every player, 4 bombs, a cross of flames, 3 items. */
export const exampleSnapshot = {
  v,
  t: 'snapshot',
  tick: 1280,
  ackSeq: 42,
  players: [
    { id: 'p1', x: 1, y: 1, alive: true, curse: 0, teleport: false },
    { id: 'p2', x: 3.4, y: 5, alive: true, curse: 120, teleport: false },
    { id: 'p3', x: 11, y: 9, alive: false, curse: 0, teleport: true },
    { id: 'p4', x: 9, y: 2.75, alive: true, curse: 0, teleport: false },
  ],
  bombs: [
    { x: 3, y: 4, fuse: 12 },
    { x: 7, y: 5, fuse: 40 },
    { x: 9, y: 3, fuse: 2 },
    { x: 5, y: 7, fuse: 25 },
  ],
  flames: [
    [5, 5],
    [5, 4],
    [5, 3],
    [5, 6],
    [5, 7],
    [4, 5],
    [3, 5],
    [6, 5],
    [7, 5],
  ],
  items: [
    { x: 2, y: 3, kind: 'curse' },
    { x: 8, y: 7, kind: 'curse' },
    { x: 10, y: 5, kind: 'kick' },
  ],
} as const satisfies ServerMessage;

export const exampleServerMessages = {
  welcome: { v, t: 'welcome', playerId: 'p2', seed: 4821, grid: exampleGrid() },
  snapshot: exampleSnapshot,
  playerJoined: { v, t: 'event', kind: 'playerJoined', playerId: 'p3', nickname: 'บอส' },
  playerLeft: { v, t: 'event', kind: 'playerLeft', playerId: 'p3' },
  boxDestroyed: { v, t: 'event', kind: 'boxDestroyed', x: 4, y: 3 },
  roundStart: { v, t: 'event', kind: 'roundStart', seed: 99, grid: exampleGrid() },
  rematchStatus: {
    v,
    t: 'event',
    kind: 'rematchStatus',
    ready: ['p1', 'p3'],
    deadline: 1739000015000,
  },
  error: { v, t: 'error', code: 'ROOM_FULL' },
  pong: { v, t: 'pong', ts: 1739000000000 },
} as const satisfies Record<string, ServerMessage>;
