import { describe, expect, it } from 'vitest';
import { nextRandom } from './prng';

describe('nextRandom (mulberry32)', () => {
  it('is pure: same seed → same value and next seed', () => {
    expect(nextRandom(1234)).toEqual(nextRandom(1234));
  });

  it('returns a value in [0, 1) and a uint32 next seed', () => {
    let seed = 7;
    for (let i = 0; i < 1000; i++) {
      const [value, next] = nextRandom(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Number.isInteger(next)).toBe(true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(0xffffffff);
      seed = next;
    }
  });

  it('different seeds give different sequences', () => {
    const run = (s: number) => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [v, n] = nextRandom(s);
        out.push(v);
        s = n;
      }
      return out;
    };
    expect(run(1)).not.toEqual(run(2));
  });

  it('matches the reference mulberry32 sequence (pinned)', () => {
    let seed = 1;
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      const [v, n] = nextRandom(seed);
      out.push(Math.round(v * 1e6) / 1e6);
      seed = n;
    }
    expect(out).toEqual([0.627074, 0.002736, 0.527447]);
  });
});
