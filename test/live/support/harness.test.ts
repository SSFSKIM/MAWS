// The shared live harness's offline parts (E11 W-E): the gate's skip path, the scratch repositories' trust merged into
// the scratch home, the init's plugin list. Spawns no engine and reads no owner file.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { initPlugins, openGate, scratchRepo, type LiveGate } from './harness';

vi.mock('../../support/engine-pin', () => ({ ENGINE_BIN: '/unused/offline-engine', ENGINE_VERSION: '2.1.283' }));

const made: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the shared live harness', () => {
  it('skips the run without MAWS_LIVE=1, before it asks the relay or makes a scratch', async () => {
    vi.stubEnv('MAWS_LIVE', undefined);
    const log = vi.fn();
    expect(await openGate('unit', log)).toEqual({ skip: 'live tests skipped: MAWS_LIVE is not 1' });
    expect(log).not.toHaveBeenCalled();
  });

  it('trusts each scratch repository in the scratch home, keeping the ones trusted before (E2’s copy overwrote them)', () => {
    const home = mkdtempSync(join(tmpdir(), 'maws-harness-home-'));
    made.push(home);
    const g = { userData: home, home, bin: '/unused', version: '2.1.283', a15Before: [] } satisfies LiveGate;
    const first = scratchRepo(g, 'unit');
    const second = scratchRepo(g, 'unit', (dir) => writeFileSync(join(dir, 'two.txt'), 'TWO\n'));
    made.push(first, second);
    expect(first.startsWith('/private/tmp/maws-unit-repo-') || first.startsWith('/tmp/maws-unit-repo-')).toBe(true);
    expect(existsSync(join(first, '.git'))).toBe(true);
    expect(readFileSync(join(second, 'two.txt'), 'utf8')).toBe('TWO\n');
    const state = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { hasCompletedOnboarding: boolean; projects: Record<string, unknown> };
    expect(state.hasCompletedOnboarding).toBe(true);
    expect(Object.keys(state.projects).sort()).toEqual([first, second].sort());
    expect(state.projects[second]).toEqual({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
  });

  it("reads the plugin list of the session's first init, null before one", () => {
    const init = (plugins: { name: string; source: string }[]) => ({ kind: 'session.init', plugins }) as unknown as SessionEvent;
    expect(initPlugins([])).toBeNull();
    expect(initPlugins([init([{ name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin' }]), init([])])).toEqual([{ name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin' }]);
  });
});
