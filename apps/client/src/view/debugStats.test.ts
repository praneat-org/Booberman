import { describe, expect, it } from 'vitest';
import { debugEnabled, formatDebug, PingTracker } from './debugStats';

describe('debug stats', () => {
  it('?debug=1 only', () => {
    expect(debugEnabled('?debug=1')).toBe(true);
    expect(debugEnabled('?mock=1&debug=1')).toBe(true);
    expect(debugEnabled('?debug=0')).toBe(false);
    expect(debugEnabled('')).toBe(false);
  });

  it('ping = time of the pong minus the ts we sent', () => {
    const t = new PingTracker();
    expect(t.pingMs).toBeUndefined();
    t.record(1000, 1160);
    expect(t.pingMs).toBe(160);
    t.record(5000, 4000); // a pong from the future (clock reset): ignored
    expect(t.pingMs).toBe(160);
    t.reset();
    expect(t.pingMs).toBeUndefined();
  });

  it('formats ping, buffer size, latest tick; dashes before the first value', () => {
    expect(formatDebug({ pingMs: 160, buffered: 4, latestTick: 812, renderTick: 810.46 })).toBe(
      'ping 160 ms\nbuffer 4\ntick 812\nrender 810.5',
    );
    expect(
      formatDebug({ pingMs: undefined, buffered: 0, latestTick: undefined, renderTick: undefined }),
    ).toBe('ping - ms\nbuffer 0\ntick -\nrender -');
  });
});
