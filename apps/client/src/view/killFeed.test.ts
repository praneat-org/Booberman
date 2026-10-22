import { exampleServerMessages } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { Roster } from './hudView';
import {
  cssColor,
  DEPARTED_NAME,
  KILL_FEED_MAX_LINES,
  KILL_FEED_TTL_MS,
  KillFeed,
  toKillLine,
} from './killFeed';

const roster = () => {
  const r = new Roster();
  r.join('p1', 'มิ้นท์');
  r.join('p2', 'Bob');
  r.join('p3', 'Cat');
  return r;
};

const kill = (
  killer: 'p1' | 'p2' | 'p3' | null,
  victim: 'p1' | 'p2' | 'p3',
  cause: 'bomb' | 'curse' | 'self' | 'kick' | 'ghost',
) => ({ ...exampleServerMessages.killBomb, killer, victim, cause });

describe('toKillLine', () => {
  it('names both players and the cause: "killer → victim (cause)"', () => {
    const line = toKillLine(kill('p1', 'p2', 'bomb'), roster(), 100, 1);
    expect(line).toMatchObject({
      killerName: 'มิ้นท์',
      victimName: 'Bob',
      cause: 'bomb',
      label: 'ระเบิด',
      self: false,
      at: 100,
    });
    expect(line.text).toBe('มิ้นท์ → Bob (ระเบิด)');
  });

  it('has a word for every cause the server can send', () => {
    const text = (cause: 'bomb' | 'curse' | 'kick' | 'ghost') =>
      toKillLine(kill('p1', 'p2', cause), roster(), 0, 1).text;
    expect(text('curse')).toBe('มิ้นท์ → Bob (คำสาป)');
    expect(text('kick')).toBe('มิ้นท์ → Bob (เตะ)');
    expect(text('ghost')).toBe('มิ้นท์ → Bob (ผี)');
  });

  it('a self-kill has no arrow: "victim ฆ่าตัวเอง"', () => {
    const line = toKillLine(kill('p2', 'p2', 'self'), roster(), 0, 1);
    expect(line.self).toBe(true);
    expect(line.text).toBe('Bob ฆ่าตัวเอง');
  });

  it('credit that went to somebody who left (killer null, D33) is named as such, not as a player', () => {
    const line = toKillLine(kill(null, 'p2', 'bomb'), roster(), 0, 1);
    expect(line.killerName).toBeNull();
    expect(line.killerColor).toBeUndefined();
    expect(line.text).toBe(`${DEPARTED_NAME} → Bob (ระเบิด)`);
  });

  it('falls back to the id until playerJoined names the player', () => {
    const line = toKillLine(kill('p3', 'p2', 'bomb'), new Roster(), 0, 1);
    expect(line.text).toBe('p3 → p2 (ระเบิด)');
  });

  it('keeps the name it was written with when the player leaves afterwards', () => {
    const r = roster();
    const feed = new KillFeed();
    feed.push(kill('p1', 'p2', 'bomb'), r, 0);
    r.leave('p1');
    expect(feed.visible(10)[0]?.text).toBe('มิ้นท์ → Bob (ระเบิด)');
  });
});

describe('KillFeed', () => {
  it('shows lines oldest first and drops each one after the TTL', () => {
    const feed = new KillFeed();
    feed.push(kill('p1', 'p2', 'bomb'), roster(), 0);
    feed.push(kill('p3', 'p1', 'curse'), roster(), 2000);
    expect(feed.visible(2500).map((l) => l.victimName)).toEqual(['Bob', 'มิ้นท์']);
    expect(feed.visible(KILL_FEED_TTL_MS - 1)).toHaveLength(2);
    expect(feed.visible(KILL_FEED_TTL_MS).map((l) => l.victimName)).toEqual(['มิ้นท์']);
    expect(feed.visible(2000 + KILL_FEED_TTL_MS)).toEqual([]);
  });

  it('shows only the newest few lines', () => {
    const feed = new KillFeed();
    for (let i = 0; i < KILL_FEED_MAX_LINES + 3; i++) {
      feed.push(kill('p1', 'p2', 'bomb'), roster(), i);
    }
    const ids = feed.visible(10).map((l) => l.id);
    expect(ids).toHaveLength(KILL_FEED_MAX_LINES);
    expect(ids.at(-1)).toBe(KILL_FEED_MAX_LINES + 3);
  });

  it('gives every line its own id so the overlay can tell lines apart', () => {
    const feed = new KillFeed();
    feed.push(kill('p1', 'p2', 'bomb'), roster(), 0);
    feed.push(kill('p1', 'p2', 'bomb'), roster(), 0);
    const ids = feed.visible(1).map((l) => l.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('clear() empties the corner', () => {
    const feed = new KillFeed();
    feed.push(kill('p1', 'p2', 'bomb'), roster(), 0);
    feed.clear();
    expect(feed.visible(1)).toEqual([]);
  });

  it('does not grow without bound', () => {
    const feed = new KillFeed();
    for (let i = 0; i < 1000; i++) feed.push(kill('p1', 'p2', 'bomb'), roster(), i);
    expect((feed as unknown as { lines: unknown[] }).lines.length).toBeLessThanOrEqual(16);
  });
});

describe('cssColor', () => {
  it('pads to six hex digits', () => {
    expect(cssColor(0xff8080)).toBe('#ff8080');
    expect(cssColor(0x0000ff)).toBe('#0000ff');
    expect(cssColor(0)).toBe('#000000');
  });
});
