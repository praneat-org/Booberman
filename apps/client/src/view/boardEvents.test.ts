import { exampleGrid, exampleServerMessages, type PlayerState } from '@booberman/protocol';
import { describe, expect, it } from 'vitest';
import { applyBoardEvent, applyWelcome } from './boardEvents';
import { BoxField } from './boardView';
import { PlayerAnimTracker } from './playerAnim';

const p = (x: number, y: number, alive = true): PlayerState => ({
  id: 'p1',
  x,
  y,
  alive,
  curse: 0,
  teleport: false,
});

describe('board events and the animation tracker', () => {
  it('roundStart clears the tracker: no one-tick walk from the corpse to the spawn', () => {
    const boxes = new BoxField(exampleGrid());
    const anims = new PlayerAnimTracker();
    anims.update([p(5, 5, false)], 10); // corpse of the last round
    applyBoardEvent(exampleServerMessages.roundStart, boxes, anims);
    const first = anims.update([p(1, 1)], 11).get('p1');
    expect(first).toMatchObject({ moving: false, phase: 'alive', facing: 'down' });
  });

  it('roundStart still resets the boxes; boxDestroyed does not touch the tracker', () => {
    const boxes = new BoxField(exampleGrid());
    const anims = new PlayerAnimTracker();
    anims.update([p(1, 1)], 1);
    applyBoardEvent({ ...exampleServerMessages.boxDestroyed, x: 3, y: 1 }, boxes, anims);
    expect(boxes.has(3, 1)).toBe(false);
    expect(anims.update([p(1.25, 1)], 2).get('p1')?.moving).toBe(true);
    applyBoardEvent(exampleServerMessages.roundStart, boxes, anims);
    expect(boxes.has(3, 1)).toBe(true);
  });

  it('welcome (also a new board) clears the tracker too', () => {
    const boxes = new BoxField();
    const anims = new PlayerAnimTracker();
    anims.update([p(5, 5)], 1);
    applyWelcome({ grid: exampleGrid() }, boxes, anims);
    expect(anims.update([p(1, 1)], 2).get('p1')?.moving).toBe(false);
  });
});
