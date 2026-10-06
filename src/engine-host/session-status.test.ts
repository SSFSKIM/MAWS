// E8 M1 (D-13): a successful reload_plugins answer replaces the status's plugins, so the "Loaded in this session" list
// and the panel's count follow a reload without waiting for the next turn's system/init. The answer's items carry init's
// four fields (pass3/e8-plugins-reload seq 31 against seq 26); its errors are only a count, so the init's stay.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import { ReloadPluginsResponseSchema } from '@shared/wire/control';
import { SessionStatusTracker } from './session-status';

const ROOT = resolve(__dirname, '../..');
const fixtureRow = (seq: number) =>
  readFileSync(resolve(ROOT, 'spikes/protocol-probe/fixtures/pass3/e8-plugins-reload.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { seq: number; frame: Record<string, unknown> })
    .find((row) => row.seq === seq)!.frame;

const spec = LaunchSpecSchema.parse({
  appSessionId: 'app-status', cwd: '/tmp/r', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
});

describe('SessionStatusTracker.applyReload', () => {
  it('replaces the plugins with the reload answer’s, as init would list them, and keeps the init’s errors and warnings', () => {
    const tracker = new SessionStatusTracker(spec, () => {});
    tracker.observe({
      type: 'system', subtype: 'init',
      plugins: [{ name: 'old', path: '/p/old', source: 'old@m', version: '1.0.0' }],
      plugin_errors: [{ plugin: 'broken', type: 'manifest', message: 'bad json', path: '/p/broken' }],
      plugin_warnings: [{ plugin: 'old', type: 'shadowed', message: 'shadowed by user' }],
    }, '2026-10-06T02:52:07.000Z');
    const answer = ReloadPluginsResponseSchema.parse((fixtureRow(31).response as { response: unknown }).response);
    tracker.applyReload(answer);
    const status = tracker.snapshot();
    expect(status.plugins).toEqual([
      { name: 'e8-probe', path: '/tmp/e8-g0/run1/market/plugins/e8-probe', source: 'e8-probe@e8-scratch', version: '0.1.0' },
      { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin', version: null },
      { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin', version: null },
      { name: 'cc-plugin-plugin-authoring', path: 'builtin', source: 'cc-plugin-plugin-authoring@builtin', version: null },
    ]);
    // the init of the same process (seq 26's summary) lists the same plugins the same way
    expect(status.plugins.map((p) => p.name)).toEqual((fixtureRow(26).plugins as { name: string }[]).map((p) => p.name));
    expect(status.pluginErrors).toEqual([{ plugin: 'broken', type: 'manifest', message: 'bad json', path: '/p/broken' }]);
    expect(status.pluginWarnings).toEqual([{ plugin: 'old', type: 'shadowed', message: 'shadowed by user' }]);
  });
});
