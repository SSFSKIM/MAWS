// E8 M1: the CLI's `--json` answers as the runner reads them, in the shapes G0's probe recorded on 2.1.290
// (`docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`) and SPEC 30 §25.3a describes.
import { describe, expect, it } from 'vitest';
import { availableOf, installedOf, listing, marketplacesOf, mutationOutcome } from './cli-result';

const INSTALLED = '{"command":"install","outcome":"ok","plugin":"e8-probe@e8-scratch","pluginId":"e8-probe@e8-scratch","scope":"user","message":"Successfully installed plugin: e8-probe@e8-scratch (scope: user)"}';
const NOT_FOUND = '{"command":"install","outcome":"failed","plugin":"nope@e8-scratch","scope":"user","message":"Plugin \\"nope\\" not found in marketplace \\"e8-scratch\\". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.","failureCode":"not_found"}';
const SHOWN = { sha256: 'f'.repeat(64), command: 'npx some-helper --fetch', kind: 'command-source' };

describe('mutationOutcome', () => {
  it('takes the last stdout line that parses as the result, after any progress lines', () => {
    expect(mutationOutcome({ stdout: `Cloning repository…\n${INSTALLED}\n`, stderr: '', code: 0 })).toEqual({ ok: true, result: JSON.parse(INSTALLED) });
    const update = '{"command":"marketplace-update","outcome":"ok","marketplace":"e8-scratch","message":"Validating local marketplace\\nSuccessfully updated marketplace: e8-scratch"}';
    expect(mutationOutcome({ stdout: `${update}\n`, stderr: '', code: 0 })).toEqual({ ok: true, result: JSON.parse(update) });
  });

  it('answers a failed result with the engine’s own message and failureCode', () => {
    expect(mutationOutcome({ stdout: `${NOT_FOUND}\n`, stderr: '', code: 1 })).toEqual({
      ok: false,
      error: { code: 'cli_failed', message: 'Plugin "nope" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.', failureCode: 'not_found', shownCommand: null },
    });
    const noop = '{"command":"disable","outcome":"failed","plugin":"e8-probe@e8-scratch","message":"Plugin \\"e8-probe@e8-scratch\\" is already disabled","failureCode":"already_in_goal_state","alreadyInGoalState":true}';
    expect(mutationOutcome({ stdout: noop, stderr: '', code: 1 })).toMatchObject({ ok: false, error: { code: 'cli_failed', failureCode: 'already_in_goal_state' } });
  });

  it('carries shownCommand verbatim for the four codes that show a marketplace-declared command, and only for those', () => {
    for (const failureCode of ['command_source_refused', 'command_source_declined', 'entry_helper_unconfirmed', 'entry_helper_declined']) {
      const line = JSON.stringify({ command: 'install', outcome: 'failed', message: 'needs confirmation', failureCode, shownCommand: SHOWN });
      expect(mutationOutcome({ stdout: line, stderr: '', code: 1 }), failureCode).toEqual({ ok: false, error: { code: 'cli_failed', message: 'needs confirmation', failureCode, shownCommand: SHOWN } });
    }
    const other = JSON.stringify({ command: 'install', outcome: 'failed', message: 'x', failureCode: 'not_found', shownCommand: SHOWN });
    expect(mutationOutcome({ stdout: other, stderr: '', code: 1 })).toMatchObject({ ok: false, error: { shownCommand: null } });
  });

  it('fails no_result with stderr’s last non-empty line when the CLI printed no result (an argument error)', () => {
    expect(mutationOutcome({ stdout: '', stderr: 'error: unknown option \'--bogus\'\n\n', code: 1 })).toEqual({ ok: false, error: { code: 'no_result', message: "error: unknown option '--bogus'", failureCode: null, shownCommand: null } });
    expect(mutationOutcome({ stdout: '{"not":"a result"}\n', stderr: '', code: 1 })).toEqual({ ok: false, error: { code: 'no_result', message: 'the CLI exited 1 without a result', failureCode: null, shownCommand: null } });
    expect(mutationOutcome({ stdout: '', stderr: '', code: null })).toMatchObject({ ok: false, error: { code: 'no_result', message: 'the CLI ended without a result' } });
  });
});

describe('the reads', () => {
  it('reduces plugin list rows to the widget’s fields', () => {
    const stdout = JSON.stringify(
      [
        { id: 'e8-probe@e8-scratch', version: '0.1.0', scope: 'user', enabled: true, installPath: '/c/e8-probe/0.1.0', readFromFolder: '/m/plugins/e8-probe', installedAt: 'x', projectEnabled: false },
        { id: 'p@m', version: 'unknown', scope: 'project', enabled: false, installPath: '', projectPath: '/r', errors: ['broken manifest'], notes: ['shadowed'], errorDetails: [{ type: 'manifest' }] },
        { id: 'loose', version: '1', scope: 'session', enabled: true, installPath: '/l' },
      ],
      null,
      2,
    );
    expect(installedOf(stdout)).toEqual([
      { id: 'e8-probe@e8-scratch', name: 'e8-probe', marketplace: 'e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/c/e8-probe/0.1.0', errors: [], notes: [] },
      { id: 'p@m', name: 'p', marketplace: 'm', version: 'unknown', scope: 'project', enabled: false, projectPath: '/r', installPath: '', errors: ['broken manifest'], notes: ['shadowed'] },
      { id: 'loose', name: 'loose', marketplace: '', version: '1', scope: 'session', enabled: true, projectPath: null, installPath: '/l', errors: [], notes: [] },
    ]);
    expect(installedOf('[]')).toEqual([]);
  });

  it('reduces list --available to five fields per plugin', () => {
    const stdout = JSON.stringify({
      installed: [],
      available: [
        { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', description: 'One skill and one command, for the probe', marketplaceName: 'e8-scratch', source: './plugins/e8-probe' },
        { pluginId: 'figma@anthropic-plugin-directory', name: 'figma', description: 'Figma', marketplaceName: 'anthropic-plugin-directory', version: '2.2.108', source: { source: 'url', url: 'https://x' }, installCount: 9 },
      ],
    });
    expect(availableOf(stdout)).toEqual([
      { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'One skill and one command, for the probe', version: null },
      { pluginId: 'figma@anthropic-plugin-directory', name: 'figma', marketplaceName: 'anthropic-plugin-directory', description: 'Figma', version: '2.2.108' },
    ]);
  });

  it('reduces marketplace list rows to name, source kind, locator and install location', () => {
    const stdout = JSON.stringify([
      { name: 'e8-scratch', source: 'directory', path: '/tmp/e8-g0/run1/market', installLocation: '/tmp/e8-g0/run1/market' },
      { name: 'gh', source: 'github', repo: 'owner/repo', ref: 'main', installLocation: '/c/plugins/marketplaces/gh' },
      { name: 'u', source: 'url', url: 'https://example.com/m.json', installLocation: '/c/plugins/marketplaces/u' },
      { name: 'org', source: 'claudeai', marketplaceId: 'mk', organizationUuid: 'o', status: 'ok' },
    ]);
    expect(marketplacesOf(stdout)).toEqual([
      { name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-g0/run1/market', installLocation: '/tmp/e8-g0/run1/market' },
      { name: 'gh', source: 'github', locator: 'owner/repo', installLocation: '/c/plugins/marketplaces/gh' },
      { name: 'u', source: 'url', locator: 'https://example.com/m.json', installLocation: '/c/plugins/marketplaces/u' },
      { name: 'org', source: 'claudeai', locator: null, installLocation: null },
    ]);
  });

  it('answers a listing only from a CLI that exited 0, else with its own last words', () => {
    expect(listing({ stdout: '[]', stderr: '', code: 0 }, installedOf)).toEqual([]);
    expect(() => listing({ stdout: '', stderr: 'Error: settings.json is not valid JSON\n', code: 1 }, installedOf)).toThrow('Error: settings.json is not valid JSON');
    expect(() => listing({ stdout: '', stderr: '', code: 2 }, installedOf)).toThrow('the CLI exited 2 without a listing');
  });

  it('refuses an answer that is not the documented document, naming what it read', () => {
    expect(() => installedOf('not json')).toThrow(/plugin list --json/);
    expect(() => installedOf('{"installed":[]}')).toThrow(/plugin list --json/);
    expect(() => availableOf('[]')).toThrow(/--available/);
    expect(() => marketplacesOf('{}')).toThrow(/marketplace list --json/);
  });
});
