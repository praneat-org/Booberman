import { describe, expect, it } from 'vitest';
import { appTitle } from './title';

describe('appTitle', () => {
  it('shows the protocol version', () => {
    expect(appTitle(3)).toBe('Booberman · protocol v3');
  });
});
