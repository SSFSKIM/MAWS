import { describe, expect, it } from 'vitest';
import { byteCountError, percentile, summarizeFrames, summarizeSamples } from './metrics';

describe('terminal probe metrics', () => {
  it('takes nearest-rank percentiles of a sample set', () => {
    const samples = [5, 1, 4, 2, 3];
    expect(percentile(samples, 50)).toBe(3);
    expect(percentile(samples, 95)).toBe(5);
    expect(percentile(samples, 0)).toBe(1);
    expect(percentile([], 50)).toBeNull();
  });

  it('summarises frame intervals from rAF timestamps', () => {
    const frames = summarizeFrames([0, 16, 32, 72, 88, 148]);
    expect(frames).toEqual({ count: 5, p50: 16, p95: 60, max: 60, over33ms: 2, over50ms: 1 });
    expect(summarizeFrames([0])).toEqual({ count: 0, p50: null, p95: null, max: null, over33ms: 0, over50ms: 0 });
  });

  it('summarises latency samples', () => {
    expect(summarizeSamples([10, 20, 30, 40])).toEqual({ count: 4, p50: 20, p95: 40, max: 40 });
  });

  it('accepts a throughput figure only when the received byte count equals the expected count', () => {
    expect(byteCountError(100, 100)).toBeNull();
    expect(byteCountError(100, 99)).toBe('byte count mismatch: expected 100, received 99');
  });
});
