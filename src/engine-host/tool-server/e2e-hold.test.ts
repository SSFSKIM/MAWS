// The e2e's hold on a `maws` tool call (./e2e-hold.ts): off outside MAWS_E2E or without a hold file named; on, the call
// waits while the hold file exists, bounded.
import { describe, expect, it } from 'vitest';
import { TOOL_HOLD_MAX_MS, toolHoldFor } from './e2e-hold';

function harness(present: boolean[]) {
  const calls: string[] = [];
  let now = 0;
  const deps = {
    exists: (path: string) => {
      calls.push(`exists ${path}`);
      return present.shift() ?? false;
    },
    sleep: async (ms: number) => {
      calls.push(`sleep ${ms}`);
      now += ms;
    },
    now: () => now,
  };
  return { calls, deps };
}

describe('toolHoldFor: the e2e hold on a maws tool call', () => {
  it('is no hold outside MAWS_E2E or with no hold file named', () => {
    const { deps } = harness([]);
    expect(toolHoldFor({ MAWS_E2E_TOOL_HOLD: '/h' }, deps)).toBeUndefined();
    expect(toolHoldFor({ MAWS_E2E: '1' }, deps)).toBeUndefined();
  });

  it('settles once the hold file is gone', async () => {
    const { calls, deps } = harness([true, true, false]);
    await toolHoldFor({ MAWS_E2E: '1', MAWS_E2E_TOOL_HOLD: '/h' }, deps)!();
    expect(calls).toEqual(['exists /h', 'sleep 100', 'exists /h', 'sleep 100', 'exists /h']);
  });

  it('settles at once when no hold file is there', async () => {
    const { calls, deps } = harness([false]);
    await toolHoldFor({ MAWS_E2E: '1', MAWS_E2E_TOOL_HOLD: '/h' }, deps)!();
    expect(calls).toEqual(['exists /h']);
  });

  it('gives up after its bound, so a scene that never lifts it cannot hold a call forever', async () => {
    const { calls, deps } = harness(Array.from({ length: 10_000 }, () => true));
    await toolHoldFor({ MAWS_E2E: '1', MAWS_E2E_TOOL_HOLD: '/h' }, deps)!();
    expect(calls.filter((call) => call.startsWith('sleep')).length).toBe(TOOL_HOLD_MAX_MS / 100);
  });
});
