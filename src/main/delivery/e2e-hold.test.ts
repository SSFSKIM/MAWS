// The e2e's hold on Send to's export phase (./e2e-hold.ts): off outside MAWS_E2E or without a hold file named; on, the
// export runs, then its answer waits while the hold file exists, bounded.
import { describe, expect, it } from 'vitest';
import { exportHeldFor, HOLD_MAX_MS } from './e2e-hold';

const exported = { path: '/p/artifacts/a/exports/1-md-x.md', revision: 1 };

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
  const exportArtifact = async (input: { artifactId: string }) => {
    calls.push(`export ${input.artifactId}`);
    return exported;
  };
  return { calls, deps, exportArtifact };
}

describe('exportHeldFor: the e2e hold on a send’s export phase', () => {
  it('is the export itself outside MAWS_E2E or with no hold file named', () => {
    const { deps, exportArtifact } = harness([]);
    expect(exportHeldFor(exportArtifact, { MAWS_E2E_DELIVERY_HOLD: '/h' }, deps)).toBe(exportArtifact);
    expect(exportHeldFor(exportArtifact, { MAWS_E2E: '1' }, deps)).toBe(exportArtifact);
  });

  it('exports first, then answers once the hold file is gone', async () => {
    const { calls, deps, exportArtifact } = harness([true, true, false]);
    const held = exportHeldFor(exportArtifact, { MAWS_E2E: '1', MAWS_E2E_DELIVERY_HOLD: '/h' }, deps);
    await expect(held({ artifactId: 'a' })).resolves.toBe(exported);
    expect(calls).toEqual(['export a', 'exists /h', 'sleep 100', 'exists /h', 'sleep 100', 'exists /h']);
  });

  it('answers at once when no hold file is there', async () => {
    const { calls, deps, exportArtifact } = harness([false]);
    await exportHeldFor(exportArtifact, { MAWS_E2E: '1', MAWS_E2E_DELIVERY_HOLD: '/h' }, deps)({ artifactId: 'a' });
    expect(calls).toEqual(['export a', 'exists /h']);
  });

  it('gives up the hold after its bound, so a scene that never lifts it cannot keep a send forever', async () => {
    const { calls, deps, exportArtifact } = harness(Array.from({ length: 10_000 }, () => true));
    await expect(exportHeldFor(exportArtifact, { MAWS_E2E: '1', MAWS_E2E_DELIVERY_HOLD: '/h' }, deps)({ artifactId: 'a' })).resolves.toBe(exported);
    expect(calls.filter((call) => call.startsWith('sleep')).length).toBe(HOLD_MAX_MS / 100);
  });
});
