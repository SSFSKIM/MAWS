// `daemon.e2eSeam` (M5b fix round 2; D11): the e2e's seams that live with the spine, which runs in `mawsd` on the daemon
// shape: the scenario's manual clock and the library's held refreshes. Refused unless `mawsd` was started under
// MAWS_E2E=1 (its own reading at start; daemon.test.ts holds the daemon to it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runE2eSeam } from './e2e-seam';

const seams = globalThis as { __maws_scenario?: { advanceTo(ms: number): void; now(): number }; __maws_library?: { holdRefreshes(): Promise<void> } };
afterEach(() => {
  delete seams.__maws_scenario;
  delete seams.__maws_library;
});

describe('daemon.e2eSeam', () => {
  it('plays the scenario to a time and holds the library’s refreshes, under MAWS_E2E=1', async () => {
    const advanceTo = vi.fn();
    let held = false;
    seams.__maws_scenario = { advanceTo, now: () => 0 };
    seams.__maws_library = { holdRefreshes: async () => void (held = true) };
    await runE2eSeam({ seam: 'scenario.advanceTo', ms: 3000 }, true);
    expect(advanceTo).toHaveBeenCalledWith(3000);
    await runE2eSeam({ seam: 'library.holdRefreshes' }, true);
    expect(held).toBe(true);
  });

  it('says what is missing: no scenario clock, no library seam', async () => {
    await expect(runE2eSeam({ seam: 'scenario.advanceTo', ms: 1 }, true)).rejects.toThrow('no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual');
    await expect(runE2eSeam({ seam: 'library.holdRefreshes' }, true)).rejects.toThrow('no library seam: the spine’s library is not running');
  });

  it('is refused outside the e2e', async () => {
    const advanceTo = vi.fn();
    seams.__maws_scenario = { advanceTo, now: () => 0 };
    await expect(runE2eSeam({ seam: 'scenario.advanceTo', ms: 1 }, false)).rejects.toThrow('daemon.e2eSeam is refused: mawsd was not started under MAWS_E2E=1');
    expect(advanceTo).not.toHaveBeenCalled();
  });
});
