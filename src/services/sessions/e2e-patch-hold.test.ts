// The e2e's hold on a Tools choice's intent write (./e2e-patch-hold.ts): off outside MAWS_E2E or without a hold file
// named; on, a write of `mawsTools` waits while the hold file exists, bounded, and any other write goes on.
import { describe, expect, it } from 'vitest';
import { FULL_MAWS_TOOL_SET } from '@shared/maws/tool-set';
import { INTENT_PATCH_HOLD_MAX_MS, intentPatchHoldFor } from './e2e-patch-hold';

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

const ENV = { MAWS_E2E: '1', MAWS_E2E_INTENT_PATCH_HOLD: '/h' };

describe('intentPatchHoldFor: the e2e hold on a Tools choice being written', () => {
  it('is no hold outside MAWS_E2E or with no hold file named', () => {
    const { deps } = harness([]);
    expect(intentPatchHoldFor({ MAWS_E2E_INTENT_PATCH_HOLD: '/h' }, deps)).toBeUndefined();
    expect(intentPatchHoldFor({ MAWS_E2E: '1' }, deps)).toBeUndefined();
  });

  it('holds a write of mawsTools until the hold file is gone, and no other write', async () => {
    const { calls, deps } = harness([true, true, false]);
    const hold = intentPatchHoldFor(ENV, deps)!;
    await hold({ model: 'haiku' });
    expect(calls).toEqual([]);
    await hold({ mawsTools: FULL_MAWS_TOOL_SET });
    expect(calls).toEqual(['exists /h', 'sleep 100', 'exists /h', 'sleep 100', 'exists /h']);
  });

  it('lets the write go after INTENT_PATCH_HOLD_MAX_MS whatever the file', async () => {
    const { calls, deps } = harness(Array.from({ length: 10_000 }, () => true));
    await intentPatchHoldFor(ENV, deps)!({ mawsTools: FULL_MAWS_TOOL_SET });
    expect(calls.filter((call) => call.startsWith('sleep'))).toHaveLength(INTENT_PATCH_HOLD_MAX_MS / 100);
  });
});
