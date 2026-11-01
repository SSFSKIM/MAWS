// `daemon.e2eSeam` (M5b fix round 2; D11): the e2e's seams that live with the spine, which runs in `mawsd` on the daemon
// shape: the scenario's manual clock and the library's held refreshes. Refused unless `mawsd` was started under
// MAWS_E2E=1 (its own reading at start; daemon.test.ts holds the daemon to it).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { e2eResources, runE2eSeam, writeE2eResources } from './e2e-seam';

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

// P5 O17 M8 (Decisions, e2e:daemon-idle): what an idle `mawsd` holds, read from outside by the e2e (SIGUSR2 under
// MAWS_E2E=1, src/mawsd/index.ts): its active resources and the modules it has loaded, so the scene can say no session
// listener, no deferred chunk and no new timer
describe('the e2e resource report', () => {
  it('names the active resources, a timer among them while one is armed, and the loaded modules by file name', () => {
    const before = e2eResources();
    expect(before.modules.length).toBeGreaterThan(0);
    expect(before.modules.every((name) => !name.includes('/'))).toBe(true);
    const timer = setTimeout(() => {}, 60_000);
    try {
      const armed = e2eResources();
      expect(armed.resources.filter((kind) => kind === 'Timeout').length).toBe(before.resources.filter((kind) => kind === 'Timeout').length + 1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('is written whole to its file, replacing the last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-e2e-res-'));
    try {
      const file = join(dir, 'e2e-resources.json');
      writeFileSync(file, 'stale');
      writeE2eResources(file);
      const read = JSON.parse(readFileSync(file, 'utf8')) as ReturnType<typeof e2eResources> & { at: string };
      expect(read).toMatchObject({ resources: expect.any(Array), modules: expect.any(Array), at: expect.any(String) });
      expect(readdirSync(dir)).toEqual(['e2e-resources.json']); // no temp file left beside it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
