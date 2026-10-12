import { describe, expect, it } from 'vitest';
import { GRID_HEIGHT, GRID_WIDTH, tileAt } from './board';
import {
  exampleClientMessages,
  exampleGrid,
  exampleServerMessages,
  exampleSnapshot,
} from './fixtures';
import { ClientMessage, ServerMessage } from './messages';
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
    expect(bad({ ...join, nickname: '   ' })).toBe('BAD_MESSAGE');
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
