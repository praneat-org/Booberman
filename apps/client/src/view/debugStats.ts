/** `?debug=1` switches the overlay on. */
export function debugEnabled(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

export interface DebugStats {
  pingMs: number | undefined;
  buffered: number;
  latestTick: number | undefined;
  renderTick: number | undefined;
}

/** Round trip of the latest `ping { ts }` → `pong { ts }` (D7); ignores a pong we never asked for. */
export class PingTracker {
  pingMs: number | undefined;

  record(ts: number, now: number): void {
    const rtt = now - ts;
    if (Number.isFinite(rtt) && rtt >= 0) this.pingMs = rtt;
  }

  reset(): void {
    this.pingMs = undefined;
  }
}

export function formatDebug(s: DebugStats): string {
  const n = (v: number | undefined, digits = 0) => (v === undefined ? '-' : v.toFixed(digits));
  return [
    `ping ${n(s.pingMs)} ms`,
    `buffer ${s.buffered}`,
    `tick ${n(s.latestTick)}`,
    `render ${n(s.renderTick, 1)}`,
  ].join('\n');
}
