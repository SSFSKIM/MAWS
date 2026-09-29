// Frame and long-task sampling for the harness's metrics(): a requestAnimationFrame loop records every frame interval
// and a PerformanceObserver records long tasks, both from the last start() on.

export class FrameMetrics {
  frameIntervals: number[] = [];
  longTasks: { start: number; duration: number }[] = [];
  private frame: number | null = null;
  private observer: PerformanceObserver | null = null;

  start(): void {
    this.stop();
    this.frameIntervals = [];
    this.longTasks = [];
    let last: number | null = null;
    const loop = (now: number) => {
      if (last !== null) this.frameIntervals.push(now - last);
      last = now;
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) this.longTasks.push({ start: entry.startTime, duration: entry.duration });
    });
    this.observer.observe({ type: 'longtask' });
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.observer?.disconnect();
    this.observer = null;
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
