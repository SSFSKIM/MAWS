import { vi } from 'vitest';

type Method = 'log' | 'warn' | 'error';

/**
 * Captures the diagnostics a test expects on `console[method]`, those whose first argument matches `expected`, for the
 * test to assert on; any other line still reaches the console, so an unexpected diagnostic stays visible. Restored by
 * `vi.restoreAllMocks()`.
 */
export function captureConsole(method: Method, expected: RegExp): { lines(): string[] } {
  const original = console[method].bind(console);
  const captured: string[] = [];
  vi.spyOn(console, method).mockImplementation((first?: unknown, ...rest: unknown[]) => {
    if (typeof first === 'string' && expected.test(first)) captured.push(first);
    else original(first, ...rest);
  });
  return { lines: () => [...captured] };
}
