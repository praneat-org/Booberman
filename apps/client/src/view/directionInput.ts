import type { InputDir, TransportInput } from '../net/Transport';

export type HeldDir = Exclude<InputDir, 'none'>;

/** Which direction keys are down; the most recently pressed one wins. */
export class DirectionTracker {
  private held: HeldDir[] = [];

  press(dir: HeldDir): void {
    this.held = this.held.filter((d) => d !== dir);
    this.held.push(dir);
  }

  release(dir: HeldDir): void {
    this.held = this.held.filter((d) => d !== dir);
  }

  /** Blur / tab hidden: forget everything so we send `none` (D27). */
  clear(): void {
    this.held = [];
  }

  current(): InputDir {
    return this.held[this.held.length - 1] ?? 'none';
  }
}

/**
 * D27: send an `input` only when the held direction changes or the bomb is pressed —
 * the server remembers the direction until it gets `none`. `seq` starts at 1 and only grows.
 */
export class InputSender {
  private seq = 0;
  private lastDir: InputDir = 'none';

  constructor(private readonly send: (input: TransportInput) => void) {}

  /**
   * A new connection (reconnect, FE-22): the server starts it with no direction held, whatever we sent on
   * the old socket, so the held direction has to go out again on the next `update`.
   */
  resync(): void {
    this.lastDir = 'none';
  }

  update(dir: InputDir, bomb: boolean): boolean {
    if (dir === this.lastDir && !bomb) return false;
    this.lastDir = dir;
    this.seq += 1;
    this.send({ seq: this.seq, dir, bomb });
    return true;
  }
}
