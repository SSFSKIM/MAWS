import { describe, expect, it } from 'vitest';
import { HIGH_WATERMARK, INITIAL_FLOW, LOW_WATERMARK, stepFlow, type Flow } from './flow';

const KiB = 1024;
const flow = (total: number, acked: number, mode: Flow['mode'] = 'flowing'): Flow => ({ total, acked, mode });

// The transition table of Interfaces "PTY host internals", pinned without a pty.
describe('pty host flow control pauses and resumes', () => {
  it('starts flowing with nothing emitted or acknowledged', () => {
    expect(INITIAL_FLOW).toEqual({ total: 0, acked: 0, mode: 'flowing' });
  });

  it('keeps flowing while unacknowledged bytes stay below the high watermark', () => {
    expect(stepFlow(flow(0, 0), { kind: 'data', bytes: HIGH_WATERMARK - 1 })).toEqual({
      flow: flow(HIGH_WATERMARK - 1, 0),
      effect: null,
      clamped: false,
    });
  });

  it('pauses when a chunk brings unacknowledged bytes to 256 KiB', () => {
    expect(HIGH_WATERMARK).toBe(256 * KiB);
    const step = stepFlow(flow(HIGH_WATERMARK - 10, 0), { kind: 'data', bytes: 10 });
    expect(step).toEqual({ flow: flow(HIGH_WATERMARK, 0, 'paused'), effect: 'pause', clamped: false });
    // measured against the acknowledged offset, not against zero
    expect(stepFlow(flow(300 * KiB, 100 * KiB), { kind: 'data', bytes: 60 * KiB }).effect).toBe('pause');
    expect(stepFlow(flow(300 * KiB, 100 * KiB), { kind: 'data', bytes: 50 * KiB }).effect).toBe(null);
  });

  it('counts chunks node-pty had already read while paused, without pausing again', () => {
    expect(stepFlow(flow(HIGH_WATERMARK, 0, 'paused'), { kind: 'data', bytes: 4096 })).toEqual({
      flow: flow(HIGH_WATERMARK + 4096, 0, 'paused'),
      effect: null,
      clamped: false,
    });
  });

  it('resumes when an ack leaves 64 KiB or less unacknowledged, and stays paused otherwise', () => {
    expect(LOW_WATERMARK).toBe(64 * KiB);
    const paused = flow(300 * KiB, 0, 'paused');
    expect(stepFlow(paused, { kind: 'ack', offset: 236 * KiB })).toEqual({ flow: flow(300 * KiB, 236 * KiB), effect: 'resume', clamped: false });
    expect(stepFlow(paused, { kind: 'ack', offset: 235 * KiB })).toEqual({ flow: flow(300 * KiB, 235 * KiB, 'paused'), effect: null, clamped: false });
  });

  it('never moves the acknowledged offset backwards', () => {
    expect(stepFlow(flow(100, 80), { kind: 'ack', offset: 50 }).flow).toEqual(flow(100, 80));
    expect(stepFlow(flow(300 * KiB, 250 * KiB, 'paused'), { kind: 'ack', offset: 10 }).effect).toBe('resume');
  });

  it('records an ack while flowing without any effect', () => {
    expect(stepFlow(flow(100, 0), { kind: 'ack', offset: 60 })).toEqual({ flow: flow(100, 60), effect: null, clamped: false });
  });

  it('clamps an ack above the total and says so', () => {
    expect(stepFlow(flow(100, 0), { kind: 'ack', offset: 500 })).toEqual({ flow: flow(100, 100), effect: null, clamped: true });
    expect(stepFlow(flow(300 * KiB, 0, 'paused'), { kind: 'ack', offset: 400 * KiB })).toEqual({
      flow: flow(300 * KiB, 300 * KiB),
      effect: 'resume',
      clamped: true,
    });
  });

  it('attach acknowledges everything emitted and resumes a paused pty', () => {
    expect(stepFlow(flow(300 * KiB, 10, 'paused'), { kind: 'attach' })).toEqual({ flow: flow(300 * KiB, 300 * KiB), effect: 'resume', clamped: false });
    expect(stepFlow(flow(100, 10), { kind: 'attach' })).toEqual({ flow: flow(100, 100), effect: null, clamped: false });
  });
});
