import { type GameEvent, GRID_WIDTH, PROTOCOL_VERSION } from '@booberman/protocol';
import { attributeKill, type Kill, scoreKills } from './attribution';
import { isWalkable } from './board';
import { resolveExplosions } from './bombs';
import { DEFAULT_CONFIG } from './config';
import { effectiveDir, stepCurses } from './curse';
import { VECTORS } from './dirs';
import { kickBombs, slideBombs } from './kick';
import { checkRoundEnd } from './round';
import { summarizeRound } from './summary';
import type {
  Bomb,
  Dir,
  GameConfig,
  GameState,
  PlayerId,
  PlayerInput,
  PlayerSim,
  StepResult,
} from './types';
import { DEPARTED } from './types';

export { DEFAULT_CONFIG };

const tileKey = (x: number, y: number) => y * GRID_WIDTH + x;

/** The tile a (possibly mid-step) player counts as standing on: the nearest one. */
const tileOf = (p: PlayerSim): readonly [number, number] => [Math.round(p.x), Math.round(p.y)];

/** Tile the step in direction `dir` ends on, given where the player is now. */
function stepTarget(x: number, y: number, dir: Dir): readonly [number, number] {
  const [dx, dy] = VECTORS[dir];
  return [
    dx > 0 ? Math.ceil(x) : dx < 0 ? Math.floor(x) : x,
    dy > 0 ? Math.ceil(y) : dy < 0 ? Math.floor(y) : y,
  ];
}

/** Move up to `speed` tiles toward (tx, ty); snaps onto the tile when it is reached. */
function advance(p: PlayerSim, dir: Dir, tx: number, ty: number, speed: number): PlayerSim {
  const [dx, dy] = VECTORS[dir];
  const x = dx === 0 ? p.x : dx > 0 ? Math.min(p.x + speed, tx) : Math.max(p.x - speed, tx);
  const y = dy === 0 ? p.y : dy > 0 ? Math.min(p.y + speed, ty) : Math.max(p.y - speed, ty);
  const arrived = x === tx && y === ty;
  return { ...p, x, y, walkDir: arrived ? 'none' : dir };
}

/**
 * Players walk one tile at a time (`walkTicksPerTile` ticks per tile). A step
 * in progress always finishes; a new step starts from a tile centre, in the
 * direction the player is holding (D27), and only if the next tile is floor
 * without a bomb. Leaving a bomb tile is always fine, entering one is not
 * (so you can step off your own bomb but not back onto it). Other players never block.
 */
function walk(p: PlayerSim, grid: string, bombTiles: ReadonlySet<number>, cfg: GameConfig) {
  const midStep = p.walkDir !== undefined && p.walkDir !== 'none';
  if (midStep) {
    const [tx, ty] = stepTarget(p.x, p.y, p.walkDir ?? 'none');
    return advance(p, p.walkDir ?? 'none', tx, ty, cfg.playerSpeed);
  }
  const dir = effectiveDir(p); // the curse reverses it here, on the server
  if (dir === 'none') return p;
  const [dx, dy] = VECTORS[dir];
  const tx = p.x + dx;
  const ty = p.y + dy;
  if (!isWalkable(grid, tx, ty) || bombTiles.has(tileKey(tx, ty))) return p;
  return advance(p, dir, tx, ty, cfg.playerSpeed);
}

function step(
  p: PlayerSim,
  input: PlayerInput | undefined,
  grid: string,
  bombTiles: ReadonlySet<number>,
  cfg: GameConfig,
): PlayerSim {
  const ackSeq = input ? Math.max(p.ackSeq, input.seq) : p.ackSeq;
  if (!p.alive) return { ...p, ackSeq };
  // D27: any input sets the held direction; no input keeps the old one.
  const held = input ? { ...p, heldDir: input.dir } : p;
  return { ...walk(held, grid, bombTiles, cfg), ackSeq };
}

/** Bombs dropped this tick: on the nearest tile, at most `maxBombs` per owner, one per tile. */
function placeBombs(
  players: readonly PlayerSim[],
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  bombs: readonly Bomb[],
  cfg: GameConfig,
): Bomb[] {
  const out = [...bombs];
  for (const p of players) {
    if (!p.alive || !inputs.get(p.id)?.bomb) continue;
    if (cfg.curseBlocksBombing && p.curse > 0) continue;
    const [x, y] = tileOf(p);
    const mine = out.filter((b) => b.ownerSession === p.session).length;
    if (mine >= cfg.maxBombs || out.some((b) => b.x === x && b.y === y)) continue;
    out.push({ x, y, ownerId: p.id, ownerSession: p.session, fuse: cfg.bombFuseTicks });
  }
  return out;
}

/**
 * Anyone on a burning tile dies; the credit goes to the owner of the first flame on that tile.
 * The owner is found by session among the players still in the room: if it is not there any
 * more (left, possibly replaced in the same slot) nobody gets the kill (D33).
 */
function creditOf(players: readonly PlayerSim[], fire: GameState['flames'][number]) {
  return players.find((q) => q.session === fire.ownerSession)?.id ?? DEPARTED;
}

function applyDeaths(
  players: readonly PlayerSim[],
  flames: GameState['flames'],
  cfg: GameConfig,
): { players: PlayerSim[]; kills: Kill[] } {
  const kills: Kill[] = [];
  const next = players.map((p) => {
    if (!p.alive) return p;
    const [x, y] = tileOf(p);
    const fire = flames.find((f) => f.x === x && f.y === y);
    if (!fire) return p;
    const owner = creditOf(players, fire);
    // players in id order, so the kills (and their events) come out in id order too
    kills.push(attributeKill(players, p, { owner, kind: fire.kind ?? 'bomb' }));
    return {
      ...p,
      alive: false,
      heldDir: 'none' as const,
      walkDir: 'none' as const,
      killedBy: owner,
    };
  });
  return { players: scoreKills(next, kills, cfg), kills };
}

/**
 * One 50 ms tick, in a fixed order: age bombs and flames -> walk -> kick + slide bombs (kick.ts) -> place bombs ->
 * explode due bombs and their chain (boxes break, items drop) -> deaths (credit and counters:
 * attribution.ts, one `kill` event each) -> curses (age, pick up, pass on by contact; curse.ts) -> round end
 * (last survivor / all dead / time limit; D32 in the PR; elimination needs `contested`). After the end the state is frozen.
 * Pure: never mutates `state` or `inputs`; the result does not depend on Map iteration
 * order (players are stepped in id order, state keeps them sorted).
 */
export function simulate(
  state: GameState,
  inputs: ReadonlyMap<PlayerId, PlayerInput>,
  cfg: GameConfig = DEFAULT_CONFIG,
): StepResult {
  // a finished round stays as it ended until the server starts a new one (`startRound`)
  if (state.result) return { state: { ...state, tick: state.tick + 1 }, events: [] };

  const bombTiles = new Set(state.bombs.map((b) => tileKey(b.x, b.y)));
  // A bomb placed this tick keeps its full fuse: only bombs that already existed count down.
  const counting = state.bombs.map((b) => ({ ...b, fuse: b.fuse - 1 }));
  const burning = state.flames.map((f) => ({ ...f, ttl: f.ttl - 1 })).filter((f) => f.ttl > 0);

  const walked = state.players.map((p) => step(p, inputs.get(p.id), state.grid, bombTiles, cfg));
  const blast = resolveExplosions(
    {
      grid: state.grid,
      // kicks and slides come after walking (positions are final) and before new bombs and blasts
      bombs: placeBombs(
        walked,
        inputs,
        slideBombs(walked, kickBombs(walked, counting, state.grid), state.grid, cfg),
        cfg,
      ),
      flames: burning,
      items: state.items,
      rngSeed: state.rngSeed,
    },
    cfg,
  );

  const tick = state.tick + 1;
  const deaths = applyDeaths(walked, blast.flames, cfg);
  const cursed = stepCurses(deaths.players, blast.items, cfg);
  const players = cursed.players;
  // sticky: judged on the players this tick started with, before anyone can leave again
  const contested = state.contested || state.players.length >= 2;
  const result = checkRoundEnd(players, tick, cfg, contested);
  // order inside a tick: what broke, who died, then (always last) how the round ended
  const events: GameEvent[] = [
    ...blast.events,
    ...deaths.kills.map(
      (k): GameEvent => ({ v: PROTOCOL_VERSION, t: 'event', kind: 'kill', ...k }),
    ),
  ];
  if (result) {
    events.push({
      v: PROTOCOL_VERSION,
      t: 'event',
      kind: 'roundEnd',
      ...result,
      ...summarizeRound(players),
    });
  }

  return {
    state: {
      ...state,
      tick,
      contested,
      rngSeed: blast.rngSeed,
      grid: blast.grid,
      players,
      bombs: blast.bombs,
      flames: blast.flames,
      items: cursed.items,
      ...(result && { result }),
    },
    events,
  };
}
