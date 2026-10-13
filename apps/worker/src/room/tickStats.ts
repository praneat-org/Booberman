/** Rolling window of tick durations (ms) with a percentile read-out. */
export class TickStats {
  private readonly samples: number[] = [];
  private next = 0;
  total = 0;

  constructor(private readonly windowSize = 200) {}

  record(ms: number): void {
    if (this.samples.length < this.windowSize) this.samples.push(ms);
    else this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.windowSize;
    this.total++;
  }

  /** Nearest-rank percentile over the window; 0 when empty. */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
  }

  summary() {
    return {
      ticks: this.total,
      window: this.samples.length,
      p50: round3(this.percentile(50)),
      p99: round3(this.percentile(99)),
      max: round3(this.percentile(100)),
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.next = 0;
    this.total = 0;
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
