// Fake timeouts that Testing Library's async wrapper, and so every userEvent call, can wait through. The wrapper drains
// React's work with a `setTimeout(0)` and moves fake time on only when it finds a `jest` global, which vitest does not
// define: under vitest's fake timers alone a userEvent call never resolves. Only the timeouts are faked, since React's
// awaited `act` waits on a real macrotask. Pair with `realTimeouts` in an afterEach.
import { vi } from 'vitest';

export function fakeTimeouts(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
}

export function realTimeouts(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
