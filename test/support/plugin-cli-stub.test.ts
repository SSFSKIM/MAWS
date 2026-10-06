// The plugin CLI stub (E8 execution document, M3): the shapes it prints are the ones the engine host's parser reads
// (`cli-result.ts`, written from G0's probe), so the `widgets` e2e drives the product's own parsing; its mutations move
// its state as the engine's registry would; its errors are the engine's words; it never takes `-y`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { availableOf, installedOf, marketplacesOf, mutationOutcome } from '../../src/engine-host/plugins/cli-result';
import { commandLine } from '../../src/shared/plugins/cli';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';
import { runPluginCli, scratchMarketplace, stubCalls, writePluginCliStub, type StubState } from './plugin-cli-stub';

const SHA = 'a'.repeat(64);
const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-plugin-stub-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const base = (): StubState => ({
  marketplaces: [{ name: 'e8-scratch', source: 'directory', path: '/tmp/e8/market', plugins: [{ name: 'e8-probe', version: '0.1.0', description: 'One skill and one command, for the probe' }] }],
  installed: [],
  fail: {},
});
const ctx = { cwd: '/tmp/e8/project', configHome: '/tmp/e8/config' };
const run = (argv: string[], state: StubState) => runPluginCli(argv, state, ctx);

describe('the plugin CLI stub', () => {
  it('lists in the shapes the host parses', () => {
    const state = base();
    state.installed.push({ id: 'e8-probe@e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null });
    const installed = run(['plugin', 'list', '--json'], state);
    expect(installed.code).toBe(0);
    expect(installedOf(installed.stdout)).toEqual([
      { id: 'e8-probe@e8-scratch', name: 'e8-probe', marketplace: 'e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/tmp/e8/config/plugins/cache/e8-scratch/e8-probe/0.1.0', errors: [], notes: [] },
    ]);
    expect(marketplacesOf(run(['plugin', 'marketplace', 'list', '--json'], state).stdout)).toEqual([{ name: 'e8-scratch', source: 'directory', locator: '/tmp/e8/market', installLocation: '/tmp/e8/market' }]);
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], state).stdout)).toEqual([]); // the engine leaves out what is installed
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], base()).stdout)).toEqual([
      { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'One skill and one command, for the probe', version: '0.1.0' },
    ]);
  });

  it('installs, disables, enables, updates and uninstalls as the engine words it, at the scope asked', () => {
    let state = base();
    const step = (argv: string[]) => {
      const out = run(argv, state);
      state = out.state;
      return { ...out, outcome: mutationOutcome(out) };
    };
    const install = step(commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'user' }));
    expect(install.outcome).toEqual({ ok: true, result: { command: 'install', outcome: 'ok', plugin: 'e8-probe@e8-scratch', pluginId: 'e8-probe@e8-scratch', scope: 'user', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' } });
    expect(step(commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'project' })).outcome).toMatchObject({ ok: true, result: { scope: 'project' } });
    expect(state.installed.map((p) => [p.scope, p.projectPath])).toEqual([['user', null], ['project', '/tmp/e8/project']]);

    expect(step(commandLine('disable', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: true, result: { message: 'Successfully disabled plugin: e8-probe (scope: user)' } });
    const again = step(commandLine('disable', { plugin: 'e8-probe@e8-scratch', scope: 'user' }));
    expect(again.code).toBe(1);
    expect(again.outcome).toMatchObject({ ok: false, error: { code: 'cli_failed', message: 'Plugin "e8-probe@e8-scratch" is already disabled', failureCode: 'already_in_goal_state' } });
    expect(step(commandLine('enable', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: true, result: { message: 'Successfully enabled plugin: e8-probe (scope: user)' } });

    expect(step(commandLine('update', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: true, result: { message: 'e8-probe is already at the latest version (0.1.0).', updateOutcome: 'up_to_date', oldVersion: '0.1.0', newVersion: '0.1.0' } });
    state.marketplaces[0].plugins[0].version = '0.2.0';
    expect(step(commandLine('update', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: true, result: { message: 'Plugin "e8-probe" updated from 0.1.0 to 0.2.0 for scope user. Restart to apply changes.', updateOutcome: 'updated', oldVersion: '0.1.0', newVersion: '0.2.0' } });
    expect(state.installed[0].version).toBe('0.2.0');

    expect(step(commandLine('uninstall', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: true, result: { keptData: false, message: 'Successfully uninstalled plugin: e8-probe (scope: user)' } });
    expect(step(commandLine('uninstall', { plugin: 'e8-probe@e8-scratch', scope: 'user' })).outcome).toMatchObject({ ok: false, error: { failureCode: 'not_installed', message: 'Plugin "e8-probe@e8-scratch" not found in installed plugins' } });
    expect(state.installed.map((p) => p.scope)).toEqual(['project']);
  });

  it('answers an unknown plugin with the engine’s not_found words', () => {
    const out = run(commandLine('install', { plugin: 'nope@e8-scratch', scope: 'user' }), base());
    expect(out.code).toBe(1);
    expect(mutationOutcome(out)).toEqual({
      ok: false,
      error: { code: 'cli_failed', message: 'Plugin "nope" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.', failureCode: 'not_found', shownCommand: null },
    });
    expect(out.stderr).toContain('✘ Failed to install plugin "nope@e8-scratch"');
  });

  it('adds a folder, an owner/repo and a URL; refreshes and removes; a missing folder is invalid_source', () => {
    const root = scratch();
    const market = scratchMarketplace(join(root, 'other-market'), { name: 'e8-other', plugins: [{ name: 'e8-extra', version: '1.0.0', description: 'Another plugin' }] });
    let state = base();
    const step = (argv: string[]) => {
      const out = run(argv, state);
      state = out.state;
      return mutationOutcome(out);
    };
    expect(step(commandLine('marketplace-add', { source: market }))).toMatchObject({ ok: true, result: { marketplace: 'e8-other', message: 'Successfully added marketplace: e8-other (declared in user settings)' } });
    expect(step(commandLine('marketplace-add', { source: market }))).toMatchObject({ ok: true, result: { message: "Marketplace 'e8-other' already on disk — declared in user settings" } });
    expect(step(commandLine('marketplace-add', { source: 'acme/tools' }))).toMatchObject({ ok: true, result: { marketplace: 'tools' } });
    expect(step(commandLine('marketplace-add', { source: 'https://example.com/acme/more.git' }))).toMatchObject({ ok: true, result: { marketplace: 'more' } });
    expect(marketplacesOf(run(['plugin', 'marketplace', 'list', '--json'], state).stdout)).toEqual([
      { name: 'e8-scratch', source: 'directory', locator: '/tmp/e8/market', installLocation: '/tmp/e8/market' },
      { name: 'e8-other', source: 'directory', locator: market, installLocation: market },
      { name: 'tools', source: 'github', locator: 'acme/tools', installLocation: '/tmp/e8/config/plugins/marketplaces/tools' },
      { name: 'more', source: 'git', locator: 'https://example.com/acme/more.git', installLocation: '/tmp/e8/config/plugins/marketplaces/more' },
    ]);
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], state).stdout).map((p) => p.pluginId)).toEqual(['e8-probe@e8-scratch', 'e8-extra@e8-other']);
    expect(step(commandLine('marketplace-add', { source: join(root, 'missing') }))).toMatchObject({ ok: false, error: { message: `Path does not exist: ${join(root, 'missing')}`, failureCode: 'invalid_source' } });
    expect(step(commandLine('marketplace-update', { name: 'e8-scratch' }))).toMatchObject({ ok: true, result: { message: 'Validating local marketplace\nSuccessfully updated marketplace: e8-scratch' } });
    expect(step(commandLine('marketplace-remove', { name: 'tools' }))).toMatchObject({ ok: true, result: { message: 'Successfully removed marketplace: tools' } });
    expect(step(commandLine('marketplace-remove', { name: 'tools' }))).toMatchObject({ ok: false, error: { message: "Marketplace 'tools' not found", failureCode: 'not_configured' } });
  });

  it('installs the dependencies a plugin declares with it, and a marketplace removal uninstalls what was installed from it', () => {
    let state = base();
    state.marketplaces[0].plugins.push({ name: 'e8-deps', version: '1.0.0', description: 'Needs e8-base', dependencies: ['e8-base'] }, { name: 'e8-base', version: '2.0.0', description: 'A dependency' });
    state.marketplaces.push({ name: 'other', source: 'github', repo: 'acme/other', plugins: [{ name: 'x', version: '1.0.0', description: null }] });
    const step = (argv: string[]) => {
      const out = run(argv, state);
      state = out.state;
      return mutationOutcome(out);
    };
    expect(step(commandLine('install', { plugin: 'e8-deps@e8-scratch', scope: 'user' }))).toMatchObject({ ok: true, result: { message: 'Successfully installed plugin: e8-deps@e8-scratch (scope: user)' } });
    expect(state.installed.map((p) => [p.id, p.version, p.scope, p.enabled])).toEqual([
      ['e8-deps@e8-scratch', '1.0.0', 'user', true],
      ['e8-base@e8-scratch', '2.0.0', 'user', true],
    ]);
    step(commandLine('install', { plugin: 'x@other', scope: 'user' }));
    expect(step(commandLine('marketplace-remove', { name: 'e8-scratch' }))).toMatchObject({ ok: true, result: { message: 'Successfully removed marketplace: e8-scratch' } });
    expect(state.installed.map((p) => p.id)).toEqual(['x@other']);
  });

  it('installs a dependency from another marketplace, named name@marketplace, from that marketplace', () => {
    const state = base();
    state.marketplaces[0].plugins.push({ name: 'e8-cross', version: '0.1.0', description: null, dependencies: ['dep@review-deps'] });
    state.marketplaces.push({ name: 'review-deps', source: 'github', repo: 'acme/review-deps', plugins: [{ name: 'dep', version: '1.0.0', description: null }] });
    const out = run(commandLine('install', { plugin: 'e8-cross@e8-scratch', scope: 'user' }), state);
    expect(mutationOutcome(out)).toMatchObject({ ok: true });
    expect(out.state.installed.map((p) => [p.id, p.version])).toEqual([
      ['e8-cross@e8-scratch', '0.1.0'],
      ['dep@review-deps', '1.0.0'],
    ]);
  });

  it('fails on demand through the fail map; a shownCommand failure passes only with its --accept-command', () => {
    const state = base();
    state.fail.install = { failureCode: 'command_source_refused', message: 'This plugin runs a command its marketplace declares', shownCommand: { sha256: SHA, command: ['node', 'setup.js'] } };
    const refused = run(commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'user' }), state);
    expect(mutationOutcome(refused)).toMatchObject({ ok: false, error: { failureCode: 'command_source_refused', shownCommand: { sha256: SHA, command: ['node', 'setup.js'] } } });
    expect(mutationOutcome(run(commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'user', acceptCommand: 'b'.repeat(64) }), state))).toMatchObject({ ok: false });
    expect(mutationOutcome(run(commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'user', acceptCommand: SHA }), state))).toMatchObject({ ok: true });
  });

  it('refuses -y and any option it does not know, as an argument error with no result line', () => {
    const out = run(['plugin', 'install', 'e8-probe@e8-scratch', '-y', '--json'], base());
    expect(out.code).toBe(1);
    expect(mutationOutcome(out)).toEqual({ ok: false, error: { code: 'no_result', message: "error: unknown option '-y'", failureCode: null, shownCommand: null } });
  });

  it('runs as the engine binary: answers --version, logs every argv, keeps its state beside itself', () => {
    const userData = scratch();
    mkdirSync(join(userData, 'project'));
    const stub = writePluginCliStub(userData, base());
    expect(execFileSync(stub.bin, ['--version'], { encoding: 'utf8' }).trim()).toBe(`${FIXTURE_ENGINE_VERSION} (Claude Code)`);
    const line = execFileSync(stub.bin, ['plugin', 'install', 'e8-probe@e8-scratch', '--json'], { encoding: 'utf8', cwd: join(userData, 'project'), env: { ...process.env, CLAUDE_CONFIG_DIR: join(userData, 'claude-config') } });
    expect(JSON.parse(line.trim())).toMatchObject({ outcome: 'ok', pluginId: 'e8-probe@e8-scratch' });
    expect(stub.state().installed).toMatchObject([{ id: 'e8-probe@e8-scratch', scope: 'user' }]);
    expect(stubCalls(stub)).toEqual([['--version'], ['plugin', 'install', 'e8-probe@e8-scratch', '--json']]);
    expect(() => execFileSync(stub.bin, ['mcp', 'list'], { stdio: 'pipe' })).toThrow(/refusing/);
    writeFileSync(stub.stateFile, JSON.stringify({ ...base(), installed: [] }));
    expect(JSON.parse(readFileSync(stub.stateFile, 'utf8')).installed).toEqual([]);
  });
});
