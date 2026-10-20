import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, tileAt } from './board';
import {
  exampleClientMessages,
  exampleGrid,
  exampleServerMessages,
  exampleSnapshot,
} from './fixtures';
import { ClientMessage, KillCause, ServerMessage, TITLE_LABELS, TitleId } from './messages';
import { parseClientMessage, parseServerMessage } from './parse';

describe('valid messages', () => {
  it.each(Object.entries(exampleClientMessages))('client %s', (_name, msg) => {
    expect(parseClientMessage(msg)).toEqual({ ok: true, data: msg });
    expect(parseClientMessage(JSON.stringify(msg))).toEqual({ ok: true, data: msg });
  });

  it.each(Object.entries(exampleServerMessages))('server %s', (_name, msg) => {
    expect(parseServerMessage(msg)).toEqual({ ok: true, data: msg });
    expect(parseServerMessage(JSON.stringify(msg))).toEqual({ ok: true, data: msg });
  });

  it('example grid is 13×11 with walls on the border and clear spawns', () => {
    const grid = exampleGrid();
    expect(grid).toHaveLength(GRID_WIDTH * GRID_HEIGHT);
    expect(tileAt(grid, 0, 0)).toBe('#');
    expect(tileAt(grid, 1, 1)).toBe('.');
    expect(tileAt(grid, 2, 2)).toBe('#');
    expect(tileAt(grid, 3, 1)).toBe('x');
    expect(tileAt(grid, 13, 0)).toBeUndefined();
  });
});

describe('invalid messages', () => {
  const join = exampleClientMessages.join;
  const bad = (raw: unknown) => {
    const r = parseClientMessage(raw);
    return r.ok ? 'ok' : r.error.code;
  };

  it('field missing', () => {
    const { nickname: _, ...noNick } = join;
    expect(bad(noNick)).toBe('BAD_MESSAGE');
    const { seq: __, ...noSeq } = exampleClientMessages.input;
    expect(bad(noSeq)).toBe('BAD_MESSAGE');
  });

  it('wrong type', () => {
    expect(bad({ ...exampleClientMessages.input, seq: '42' })).toBe('BAD_MESSAGE');
    expect(bad({ ...exampleClientMessages.input, seq: 1.5 })).toBe('BAD_MESSAGE');
    expect(bad({ ...exampleClientMessages.input, bomb: 'yes' })).toBe('BAD_MESSAGE');
    expect(bad({ ...exampleClientMessages.input, dir: 'diagonal' })).toBe('BAD_MESSAGE');
    expect(bad({ ...join, room: 'ABC 123' })).toBe('BAD_MESSAGE');
    expect(bad({ ...join, nickname: '   ' })).toBe('INVALID_NICKNAME');
    expect(bad({ ...join, nickname: 7 })).toBe('BAD_MESSAGE');
  });

  it('unknown t', () => {
    expect(bad({ v: 1, t: 'teleport' })).toBe('BAD_MESSAGE');
    expect(bad({ v: 1 })).toBe('BAD_MESSAGE');
    // server-only messages are not accepted from a client
    expect(bad(exampleServerMessages.snapshot)).toBe('BAD_MESSAGE');
  });

  it('version mismatch is reported separately', () => {
    expect(bad({ ...join, v: 0 })).toBe('VERSION_MISMATCH');
    expect(bad({ ...join, v: 2 })).toBe('VERSION_MISMATCH');
    const { v: _, ...noVersion } = join;
    expect(bad(noVersion)).toBe('VERSION_MISMATCH');
    const r = parseServerMessage({ ...exampleServerMessages.pong, v: 99 });
    expect(r.ok ? 'ok' : r.error.code).toBe('VERSION_MISMATCH');
  });

  it('garbage never throws', () => {
    for (const raw of [
      '',
      '{',
      'null',
      '[]',
      '42',
      '"hi"',
      null,
      undefined,
      7,
      [],
      'x'.repeat(5000),
    ]) {
      expect(() => parseClientMessage(raw)).not.toThrow();
      expect(bad(raw)).toBe('BAD_MESSAGE');
    }
  });

  it('error message names the bad field', () => {
    const r = parseClientMessage({ ...exampleClientMessages.input, seq: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/^seq: /);
  });

  it('server: off-board coordinates, too many players, bad grid', () => {
    const s = exampleSnapshot;
    const code = (raw: unknown) => {
      const r = parseServerMessage(raw);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ ...s, bombs: [{ x: 13, y: 0, fuse: 1 }] })).toBe('BAD_MESSAGE');
    expect(code({ ...s, players: [...s.players, { ...s.players[0], id: 'p1' }] })).toBe(
      'BAD_MESSAGE',
    );
    expect(code({ ...exampleServerMessages.welcome, grid: '###' })).toBe('BAD_MESSAGE');
    expect(code({ ...exampleServerMessages.boxDestroyed, kind: 'meteor' })).toBe('BAD_MESSAGE');
    expect(code({ ...exampleServerMessages.error, code: 'OOPS' })).toBe('BAD_MESSAGE');
    const end = exampleServerMessages.roundEndWin;
    expect(code({ ...end, reason: 'rage-quit' })).toBe('BAD_MESSAGE');
    expect(code({ ...end, winner: 'p9' })).toBe('BAD_MESSAGE');
    const { winner: _w, ...noWinner } = end;
    expect(code(noWinner)).toBe('BAD_MESSAGE'); // draw must say `winner: null`, not omit it
  });
});

describe('kill and round summary (BE-41)', () => {
  const code = (raw: unknown) => {
    const r = parseServerMessage(raw);
    return r.ok ? 'ok' : r.error.code;
  };
  const kill = exampleServerMessages.killBomb;
  const end = exampleServerMessages.roundEndWin;

  it('kill: killer may be null (credit to someone who left, D33) but victim and cause are required', () => {
    expect(code(exampleServerMessages.killDeparted)).toBe('ok');
    expect(code({ ...kill, victim: null })).toBe('BAD_MESSAGE');
    const { cause: _c, ...noCause } = kill;
    expect(code(noCause)).toBe('BAD_MESSAGE');
    const { killer: _k, ...noKiller } = kill;
    expect(code(noKiller)).toBe('BAD_MESSAGE'); // "nobody" is `killer: null`, never omitted
    expect(code({ ...kill, cause: 'meteor' })).toBe('BAD_MESSAGE');
    expect(code({ ...kill, killer: 'p9' })).toBe('BAD_MESSAGE');
  });

  it('every kill cause of the credit table can be sent (ghost and kick are reserved for BE-46 / BE-45)', () => {
    expect([...KillCause.options].sort()).toEqual(['bomb', 'curse', 'ghost', 'kick', 'self']);
    for (const cause of KillCause.options) expect(code({ ...kill, cause })).toBe('ok');
  });

  it('roundEnd carries the table and the titles, and refuses a half-filled one', () => {
    const { stats: _s, ...noStats } = end;
    expect(code(noStats)).toBe('BAD_MESSAGE');
    const { titles: _t, ...noTitles } = end;
    expect(code(noTitles)).toBe('BAD_MESSAGE');
    expect(code({ ...end, stats: [{ ...end.stats[0], trollPoints: -1 }] })).toBe('BAD_MESSAGE');
    expect(code({ ...end, stats: [{ ...end.stats[0], kills: 1.5 }] })).toBe('BAD_MESSAGE');
    expect(code({ ...end, titles: [{ title: 'king', players: ['p1'], value: 1 }] })).toBe(
      'BAD_MESSAGE',
    );
    // a title nobody holds, or holds with value 0, is never sent
    expect(code({ ...end, titles: [{ title: 'troll', players: [], value: 3 }] })).toBe(
      'BAD_MESSAGE',
    );
    expect(code({ ...end, titles: [{ title: 'troll', players: ['p1'], value: 0 }] })).toBe(
      'BAD_MESSAGE',
    );
  });

  it('stats use the D1 column names of CAR-3799 (camelCase)', () => {
    expect(Object.keys(end.stats[0] ?? {}).sort()).toEqual(
      ['curseKills', 'deaths', 'id', 'kills', 'selfKills', 'transfers', 'trollPoints'].sort(),
    );
  });

  it('every title has a Thai label', () => {
    expect(Object.keys(TITLE_LABELS).sort()).toEqual([...TitleId.options].sort());
    expect(TITLE_LABELS.troll).toBe('ตัวตึงสายเกรียน');
  });

  it('a 4-player roundEnd with every title is far below the server message limit', () => {
    const full = {
      ...end,
      stats: ['p1', 'p2', 'p3', 'p4'].map((id) => ({
        id,
        kills: 99,
        deaths: 99,
        selfKills: 99,
        curseKills: 99,
        transfers: 99,
        trollPoints: 999,
      })),
      titles: TitleId.options.map((title) => ({
        title,
        players: ['p1', 'p2', 'p3', 'p4'],
        value: 999,
      })),
    };
    expect(code(full)).toBe('ok');
    expect(JSON.stringify(full).length).toBeLessThan(2048);
  });
});

describe('server authority', () => {
  /** Anything that describes where a player is, whether they live, or how the game went. */
  const FORBIDDEN =
    /^(x|y|pos|position|alive|dead|hp|life|lives|health|score|kills?|winner|win|result|tick|state|players|bombs|flames|items|curse|teleport)$/i;

  it.each(ClientMessage.options.map((o) => [o.shape.t.value, o] as const))(
    'client %s has no position / life / result field',
    (_t, schema) => {
      const fields = Object.keys(schema.shape);
      expect(fields.filter((f) => FORBIDDEN.test(f))).toEqual([]);
    },
  );

  it('client messages reject extra fields (cannot smuggle a position)', () => {
    const r = parseClientMessage({ ...exampleClientMessages.input, x: 3, y: 5, alive: true });
    expect(r.ok).toBe(false);
  });

  it('server messages are a closed set', () => {
    const kinds = ServerMessage.options.map((o) => ('shape' in o ? o.shape.t.value : 'event'));
    expect(kinds.sort()).toEqual(['error', 'event', 'pong', 'snapshot', 'welcome']);
  });
});

describe('size', () => {
  it('4-player snapshot is at most 2KB as JSON', () => {
    const json = JSON.stringify(exampleSnapshot);
    // ASCII only, so string length === UTF-8 bytes (TextEncoder is not in this package's lib)
    expect(json).toMatch(/^[\x20-\x7e]*$/);
    const bytes = json.length;
    expect(exampleSnapshot.players).toHaveLength(4);
    expect(bytes).toBeLessThanOrEqual(2048);
  });
});
