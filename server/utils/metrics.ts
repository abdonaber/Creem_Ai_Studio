/**
 * Lightweight in-memory metrics abstraction for operational observability
 * Provides rates, counters, and latency percentiles without heavy external dependencies.
 */
class MetricsRegistry {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  public increment(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  public recordDuration(name: string, durationMs: number): void {
    const values = this.histograms.get(name) || [];
    values.push(durationMs);
    // Keep last 200 samples in circular fashion
    if (values.length > 200) {
      values.shift();
    }
    this.histograms.set(name, values);
  }

  public getSnapshot(): Record<string, unknown> {
    const metrics: Record<string, unknown> = {};

    for (const [key, val] of this.counters.entries()) {
      metrics[key] = val;
    }

    for (const [key, values] of this.histograms.entries()) {
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / values.length);
      const sorted = [...values].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];

      metrics[`${key}_avg_ms`] = avg;
      metrics[`${key}_p95_ms`] = p95;
      metrics[`${key}_count`] = values.length;
    }

    return {
      timestamp: new Date().toISOString(),
      metrics,
    };
  }
}

export const metrics = new MetricsRegistry();
