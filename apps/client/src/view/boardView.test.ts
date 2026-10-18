import { exampleGrid } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { BoxField, tileKey } from './boardView';

describe('BoxField', () => {
  it('reads boxes (and only boxes) from the grid', () => {
    const grid = exampleGrid();
    const field = new BoxField(grid);
    expect(field.list().length).toBe([...grid].filter((c) => c === 'x').length);
    expect(field.has(3, 1)).toBe(true);
    expect(field.has(1, 1)).toBe(false); // spawn, floor
    expect(field.has(0, 0)).toBe(false); // wall
  });

  it('boxDestroyed removes one box; a repeat is a no-op', () => {
    const field = new BoxField(exampleGrid());
    const before = field.list().length;
    expect(field.destroy(3, 1)).toBe(true);
    expect(field.destroy(3, 1)).toBe(false);
    expect(field.list().length).toBe(before - 1);
    expect(field.has(3, 1)).toBe(false);
  });

  it('reset (roundStart) replaces the whole board', () => {
    const field = new BoxField(exampleGrid());
    field.destroy(3, 1);
    field.reset(exampleGrid());
    expect(field.has(3, 1)).toBe(true);
  });

  it('tileKey is stable', () => {
    expect(tileKey(3, 4)).toBe('3,4');
  });
});
