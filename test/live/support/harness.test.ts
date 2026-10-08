// The shared live harness's offline parts (E11 W-E): the gate's skip path, the scratch repositories' trust merged into
// the scratch home, the init's plugin list, the A-15 check over synthetic readings. Spawns no engine and reads no owner
// file.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { checkA15, initPlugins, journalInitPlugins, openGate, scratchRepo, type LiveGate } from './harness';

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
    const g = { userData: home, home, bin: '/unused', version: '2.1.283', a15Before: [], scratch: [home] } satisfies LiveGate;
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
    expect(g.scratch, 'each repository joins the run’s own scratch (the A-15 check’s roots)').toEqual([home, first, second]);
  });

  it('checks A-15 against the run’s own scratch: another owner session’s key is recorded, a key of the run’s fails', () => {
    const g = { userData: '/private/tmp/maws-u-live-a', home: '/private/tmp/maws-u-config-a', bin: '/unused', version: '2.1.283', a15Before: ['/private/tmp/cua-accept'], scratch: ['/private/tmp/maws-u-config-a', '/private/tmp/maws-u-live-a', '/private/tmp/maws-u-repo-a'] } satisfies LiveGate;
    const lines: string[] = [];
    checkA15(g, ['/private/tmp/cua-accept'], (line) => lines.push(line));
    checkA15(g, ['/private/tmp/cua-accept', '/tmp/another-session'], (line) => lines.push(line));
    checkA15(g, [], (line) => lines.push(line));
    expect(lines).toEqual([
      'A-15 after: 1 keys (identical)',
      'A-15 after: 2 keys (added ["/tmp/another-session"], removed []; none the sitting’s own (recorded, not a breach))',
      'A-15 after: 0 keys (added [], removed ["/private/tmp/cua-accept"]; none the sitting’s own (recorded, not a breach))',
    ]);
    expect(() => checkA15(g, ['/private/tmp/cua-accept', '/tmp/maws-u-repo-a'], () => {})).toThrow(/A-15/);
    expect(() => checkA15({ ...g, a15Before: ['/private/tmp/cua-accept', '/private/tmp/maws-u-live-a/sub'] }, ['/private/tmp/cua-accept'], () => {})).toThrow(/A-15/);
  });

  it("reads the plugin list of the session's first init, null before one", () => {
    const init = (plugins: { name: string; source: string }[]) => ({ kind: 'session.init', plugins }) as unknown as SessionEvent;
    expect(initPlugins([])).toBeNull();
    expect(initPlugins([init([{ name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin' }]), init([])])).toEqual([{ name: 'cc-plugin-telemetry', source: 'cc-plugin-telemetry@builtin' }]);
  });

  it("reads the plugin list of the journal's first init with each plugin's path, null before one", () => {
    const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at: '2026-10-07T00:00:00.000Z', frame });
    const init = (plugins?: unknown[]) => ({ type: 'system', subtype: 'init', ...(plugins && { plugins }) });
    const plugins = [{ name: 'e8-probe', path: '/tmp/run/market/plugins/e8-probe', source: 'e8-probe@e8-scratch', version: '0.1.0' }];
    expect(journalInitPlugins([row(1, 'out', { type: 'control_request' })])).toBeNull();
    expect(journalInitPlugins([row(1, 'out', init([])), row(2, 'in', { type: 'system', subtype: 'status' }), row(3, 'in', init(plugins)), row(4, 'in', init([]))])).toEqual(plugins);
    expect(journalInitPlugins([row(1, 'in', init())])).toEqual([]);
  });
});
