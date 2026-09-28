// What the `#probe` page measures per workload (C9 Interfaces *Harness*): bytes and wall time (MB/s), frame
// intervals from requestAnimationFrame, long tasks, input echo latency and the heap. The pure summaries are tested;
// the samplers wrap the browser APIs. No throughput or frame figure is accepted unless the received byte count equals
// the workload's expected PTY byte count (Decision Log, W2/W3 correction).
import type { RendererKind } from '../../terminal/renderer';

export interface FrameSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  over33ms: number;
  over50ms: number;
}

export interface SampleSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface LongTaskSummary {
  count: number;
  totalMs: number;
  max: number;
}

export interface WidthResult {
  text: string;
  expected: number;
  reported: number | null; // the column the emulator reported minus one; null when no reply was parsed
}

// The PTY byte counts of a flood: what the tty emitted (`bytes`), the program's own bytes (`outputBytes`, everything
// but the carriage returns ONLCR adds), and the line feeds. macOS's tty duplicates a `\r` when its output queue fills
// mid-translation (observed on `seq`: +1 to +80 bytes per 20 MB run, every extra byte a CR), so `bytes` may exceed the
// expected count by a few carriage returns while `outputBytes` and `lineFeeds` are exact.
export interface ByteCounts {
  bytes: number;
  outputBytes: number;
  lineFeeds: number;
}

export interface Metrics {
  renderer: RendererKind;
  workload: string;
  phase: 'm1' | 'm2-gate';
  expectedBytes: number | null;
  bytes: number;
  outputBytes?: number;
  lineFeeds?: number;
  extraCarriageReturns?: number;
  seconds: number;
  mbps?: number;
  frames?: FrameSummary;
  longTasks?: LongTaskSummary;
  lastLine: string;
  lineCount: number;
  heapMB?: number;
  blockedInputEvents: number; // physical wheel, key and touch events cancelled while the run was measured
  latency?: SampleSummary;
  widths?: WidthResult[];
  // M2 gate: the binary stream's flow control seen from the page
  pausedSeen?: boolean; // `pty.list` reported the pty paused at least once during the run
  acks?: number; // `pty.ack` commands the page sent
  error?: string;
}

// Nearest-rank percentile; null for no samples.
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export function summarizeSamples(samples: readonly number[]): SampleSummary {
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples.length ? Math.max(...samples) : null,
  };
}

export function summarizeFrames(timestamps: readonly number[]): FrameSummary {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i]! - timestamps[i - 1]!);
  return {
    ...summarizeSamples(intervals),
    over33ms: intervals.filter((ms) => ms > 33).length,
    over50ms: intervals.filter((ms) => ms > 50).length,
  };
}

// A flood is complete when the program's bytes and its line feeds both match exactly; the only surplus allowed is
// the tty's duplicated carriage returns.
export function byteCountError(expected: ByteCounts, received: ByteCounts): string | null {
  if (received.outputBytes !== expected.outputBytes) return `byte count mismatch: expected ${expected.outputBytes} output bytes, received ${received.outputBytes}`;
  if (received.lineFeeds !== expected.lineFeeds) return `line feed count mismatch: expected ${expected.lineFeeds}, received ${received.lineFeeds}`;
  if (received.bytes < expected.bytes) return `byte count mismatch: expected ${expected.bytes}, received ${received.bytes}`;
  return null;
}

// Counts line feeds and carriage returns in a chunk of the binary stream (a UTF-8 continuation byte is never 10 or
// 13, so a byte scan is exact; the count is what the tty's ONLCR makes of the program's line feeds).
export function countLineEndings(data: Uint8Array): { lineFeeds: number; carriageReturns: number } {
  let lineFeeds = 0;
  let carriageReturns = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 10) lineFeeds++;
    else if (c === 13) carriageReturns++;
  }
  return { lineFeeds, carriageReturns };
}

// rAF timestamps while a run is in flight.
export class FrameSampler {
  private timestamps: number[] = [];
  private handle: number | null = null;

  start(): void {
    this.timestamps = [];
    const tick = (now: number) => {
      this.timestamps.push(now);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): number[] {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
    return this.timestamps;
  }
}

// Long tasks (≥ 50 ms on the main thread) while a run is in flight; the observer is a no-op where unsupported.
export function observeLongTasks(): { stop(): LongTaskSummary } {
  const durations: number[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    observer = null;
  }
  return {
    stop() {
      observer?.disconnect();
      return { count: durations.length, totalMs: Math.round(durations.reduce((a, b) => a + b, 0)), max: durations.length ? Math.max(...durations) : 0 };
    },
  };
}

// Chromium's non-standard `performance.memory`, when exposed.
export function heapMB(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1048576) : undefined;
}
