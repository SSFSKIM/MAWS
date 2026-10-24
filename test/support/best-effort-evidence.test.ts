import { afterEach, expect, test, vi } from 'vitest';
import { collectBestEffortEvidence } from '../../e2e/support/best-effort-evidence';

const TIMEOUT = 100;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The same reverse-order cleanup shape as side.spec.ts: evidence runs before the app and scratch disposals.
async function teardown(capture: () => Promise<void>, disposed: string[]) {
  const cleanups = [
    () => { disposed.push('scratch'); },
    () => { disposed.push('maws'); },
    capture,
  ];
  for (const cleanup of cleanups.reverse()) await cleanup();
}

test('a rejected capture neither skips other evidence nor prevents normal cleanup', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const captured: string[] = [];
  const disposed: string[] = [];

  await teardown(() => collectBestEffortEvidence({
    trace: async () => { throw new Error('context closed'); },
    geometry: async () => { captured.push('geometry'); },
    screenshot: async () => { captured.push('screenshot'); },
  }, TIMEOUT), disposed);

  expect(captured).toEqual(['geometry', 'screenshot']);
  expect(disposed).toEqual(['maws', 'scratch']);
  expect(vi.getTimerCount()).toBe(0);
});

test('a stalled capture releases normal cleanup at its deadline and handles a late rejection', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const disposed: string[] = [];
  const captured: string[] = [];
  let rejectCapture!: (error: Error) => void;
  const stalled = new Promise<void>((_, reject) => { rejectCapture = reject; });
  const pending = teardown(() => collectBestEffortEvidence({
    geometry: () => stalled,
    screenshot: async () => { captured.push('screenshot'); },
  }, TIMEOUT), disposed);

  await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
  expect(disposed).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(disposed).toEqual(['maws', 'scratch']);
  expect(captured).toEqual(['screenshot']);
  await pending;

  rejectCapture(new Error('page closed by cleanup'));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('successful evidence finishes before normal cleanup without leaving a deadline timer', async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  await teardown(() => collectBestEffortEvidence({
    trace: async () => { events.push('trace'); },
    screenshot: async () => { events.push('screenshot'); },
  }, TIMEOUT), events);

  expect(events).toEqual(['trace', 'screenshot', 'maws', 'scratch']);
  expect(vi.getTimerCount()).toBe(0);
});
