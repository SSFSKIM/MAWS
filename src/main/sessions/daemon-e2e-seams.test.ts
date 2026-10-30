// The e2e's spine seams on the daemon shape (M5b fix round 2; D11): main relays them to `mawsd`, where the spine runs, so
// a spec's `app.evaluate` reads the same globals on both shapes.
import { afterEach, describe, expect, it } from 'vitest';
import { installDaemonE2eSeams } from './daemon-e2e-seams';

const seams = globalThis as { __maws_scenario?: { advanceTo(ms: number): Promise<void> }; __maws_library?: { holdRefreshes(): Promise<void> } };
afterEach(() => {
  delete seams.__maws_scenario;
  delete seams.__maws_library;
});

function machine(answer: { ok: true } | { ok: false; message: string } = { ok: true }) {
  const asked: unknown[] = [];
  const hosts = {
    dispatch: async (owner: string, name: string, input: unknown) => {
      asked.push([owner, name, input]);
      return answer.ok ? { ok: true as const, value: undefined } : { ok: false as const, error: { code: 'internal', message: answer.message } };
    },
  };
  return { hosts: hosts as never, asked };
}

describe('the daemon shape’s e2e seams', () => {
  it('relays the scenario clock and the library’s held refreshes to mawsd under MAWS_E2E=1, and removes them at stop', async () => {
    const m = machine();
    const stop = installDaemonE2eSeams(m.hosts, { MAWS_E2E: '1' });
    await seams.__maws_scenario!.advanceTo(3000);
    await seams.__maws_library!.holdRefreshes();
    expect(m.asked).toEqual([
      ['machine', 'daemon.e2eSeam', { seam: 'scenario.advanceTo', ms: 3000 }],
      ['machine', 'daemon.e2eSeam', { seam: 'library.holdRefreshes' }],
    ]);
    stop();
    expect(seams.__maws_scenario).toBeUndefined();
    expect(seams.__maws_library).toBeUndefined();
  });

  it('rejects with mawsd’s answer', async () => {
    installDaemonE2eSeams(machine({ ok: false, message: 'no scenario clock: mawsd is not in launch mode scenario with MAWS_SCENARIO_CLOCK=manual' }).hosts, { MAWS_E2E: '1' });
    await expect(seams.__maws_scenario!.advanceTo(1)).rejects.toThrow('no scenario clock');
  });

  it('installs nothing outside the e2e', () => {
    installDaemonE2eSeams(machine().hosts, {})();
    expect(seams.__maws_scenario).toBeUndefined();
    expect(seams.__maws_library).toBeUndefined();
  });
});
