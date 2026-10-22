import { describe, expect, it } from 'vitest';
import { reconnectingText, secondsLeft } from './reconnectView';

describe('secondsLeft', () => {
  it('rounds up so the last second reads 1, never 0, until the time is really up', () => {
    expect(secondsLeft(15_000, 0)).toBe(15);
    expect(secondsLeft(15_000, 14_001)).toBe(1);
    expect(secondsLeft(15_000, 14_999)).toBe(1);
    expect(secondsLeft(15_000, 15_000)).toBe(0);
  });

  it('is never negative', () => {
    expect(secondsLeft(15_000, 99_000)).toBe(0);
  });
});

describe('reconnectingText', () => {
  it('names the time left', () => {
    expect(reconnectingText(12)).toContain('12 วินาที');
  });
});
