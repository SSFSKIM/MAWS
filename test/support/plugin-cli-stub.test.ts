// The plugin CLI stub (E8 execution document, M3): the shapes it prints are the ones the engine host's parser reads
// (`cli-result.ts`, written from G0's probe), so the `widgets` e2e drives the product's own parsing; its mutations move
// its state as the engine's registry would; its errors are the engine's words; it never takes `-y`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { availableOf, installedOf, marketplacesOf, mutationOutcome, pluginRowsOf } from '../../src/engine-host/plugins/cli-result';
import { readManifestView } from '../../src/engine-host/plugins/manifest';
import { commandLine } from '../../src/shared/plugins/cli';
import { FIXTURE_ENGINE_VERSION } from './engine-pin';
import { materialisePluginCli, ownerShapedState, runPluginCli, scratchMarketplace, stubCalls, writePluginCliStub, type StubState } from './plugin-cli-stub';

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
  it('lists in the shapes the host parses', async () => {
    const state = base();
    state.installed.push({ id: 'e8-probe@e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null });
    const installed = run(['plugin', 'list', '--json'], state);
    expect(installed.code).toBe(0);
    expect(await installedOf(pluginRowsOf(installed.stdout), ctx.cwd)).toEqual([
      { id: 'e8-probe@e8-scratch', name: 'e8-probe', marketplace: 'e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/tmp/e8/config/plugins/cache/e8-scratch/e8-probe/0.1.0', errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false },
    ]);
    expect(marketplacesOf(run(['plugin', 'marketplace', 'list', '--json'], state).stdout)).toEqual([{ name: 'e8-scratch', source: 'directory', locator: '/tmp/e8/market', ref: null, installLocation: '/tmp/e8/market' }]);
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], state).stdout)).toEqual([]); // the engine leaves out what is installed
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], base()).stdout)).toEqual([
      { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'One skill and one command, for the probe', version: '0.1.0', source: './plugins/e8-probe', installCount: null },
    ]);
  });

  // P2-B start (2026-10-09)
  it('records the times of an install and an update, and lists projectEnabled from the directory it runs in (P2-B)', () => {
    let state = base();
    const at = (now: string, argv: string[], cwd = ctx.cwd) => {
      const out = runPluginCli(argv, state, { ...ctx, cwd, now });
      state = out.state;
      return out;
    };
    at('2026-10-01T00:00:00.000Z', commandLine('install', { plugin: 'e8-probe@e8-scratch', scope: 'project' }));
    state.marketplaces[0].plugins[0].version = '0.2.0';
    at('2026-10-05T00:00:00.000Z', commandLine('update', { plugin: 'e8-probe@e8-scratch', scope: 'project' }));
    const rows = pluginRowsOf(at('2026-10-06T00:00:00.000Z', ['plugin', 'list', '--json']).stdout);
    expect(rows).toMatchObject([{ installedAt: '2026-10-01T00:00:00.000Z', lastUpdated: '2026-10-05T00:00:00.000Z', projectEnabled: true, projectPath: ctx.cwd }]);
    expect(pluginRowsOf(at('2026-10-06T00:00:00.000Z', ['plugin', 'list', '--json'], '/tmp/e8/other').stdout)).toMatchObject([{ projectEnabled: false }]);
  });

  it('lists an entry’s source, and an install count only for a marketplace the engine’s catalog counts (P2-B)', () => {
    const state = base();
    state.marketplaces.push({ name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official', countsInstalls: true, plugins: [{ name: 'frontend-design', version: null, description: 'Design', installCount: 1_290_640 }, { name: 'quiet', version: null, description: null }] });
    state.marketplaces.push({ name: 'third', source: 'github', repo: 'acme/third', plugins: [{ name: 'x', version: '1.0.0', description: null, installCount: 5, source: { source: 'url', url: 'https://example.com/x.git' } }] });
    expect(availableOf(run(['plugin', 'list', '--json', '--available'], state).stdout).map((p) => [p.pluginId, p.source, p.installCount])).toEqual([
      ['e8-probe@e8-scratch', './plugins/e8-probe', null],
      ['frontend-design@claude-plugins-official', './plugins/frontend-design', 1_290_640],
      ['quiet@claude-plugins-official', './plugins/quiet', null],
      ['x@third', { kind: 'url', url: 'https://example.com/x.git', repo: null, path: null, ref: null }, null],
    ]);
  });

  it('lists the branch or tag a repository marketplace is pinned to, as the engine does: only when it has one (P2-B)', () => {
    const state = base();
    state.marketplaces.push({ name: 'pinned', source: 'github', repo: 'acme/pinned', ref: 'v2', plugins: [] }, { name: 'tip', source: 'git', url: 'https://example.com/tip.git', plugins: [] });
    const printed = JSON.parse(run(['plugin', 'marketplace', 'list', '--json'], state).stdout) as Record<string, unknown>[];
    expect(printed.map((m) => m.ref)).toEqual([undefined, 'v2', undefined]);
    expect(marketplacesOf(JSON.stringify(printed)).map((m) => [m.name, m.ref])).toEqual([['e8-scratch', null], ['pinned', 'v2'], ['tip', null]]);
  });

  it('writes each installation’s tree and each cloned marketplace’s catalogue inside CLAUDE_CONFIG_DIR, which the manifest reader reads (P2-B)', async () => {
    const root = scratch();
    const configHome = join(root, 'claude-config');
    const state = base();
    state.marketplaces.push({ name: 'gh', source: 'github', repo: 'acme/gh', plugins: [{ name: 'tool', version: '2.0.0', description: 'A tool', author: 'Acme' }, { name: 'ts-lsp', version: '1.0.0', description: 'TypeScript', manifest: false, lspServers: { typescript: { command: 'typescript-language-server', extensionToLanguage: { '.ts': 'typescript' } } } }] });
    state.installed.push({ id: 'tool@gh', version: '2.0.0', scope: 'user', enabled: true, projectPath: null }, { id: 'ts-lsp@gh', version: '1.0.0', scope: 'user', enabled: true, projectPath: null });
    const local = { cwd: join(root, 'project'), configHome };
    materialisePluginCli(state, local, { CLAUDE_CONFIG_DIR: configHome });
    const rows = pluginRowsOf(runPluginCli(['plugin', 'list', '--json'], state, local).stdout);
    const [location] = marketplacesOf(runPluginCli(['plugin', 'marketplace', 'list', '--json'], state, local).stdout).filter((m) => m.name === 'gh').map((m) => m.installLocation);
    expect(existsSync(join(location!, '.claude-plugin', 'marketplace.json'))).toBe(true);

    const tool = await readManifestView({ kind: 'installation', id: 'tool@gh', scope: 'user', projectPath: null }, { root: rows[0].installPath, marketplaceRoot: location, entryName: 'tool' });
    expect(tool).toMatchObject({ state: 'read', name: 'tool', version: '2.0.0', author: 'Acme', problems: [] });
    expect(tool.components).toMatchObject({ commands: [{ name: 'tool-hello' }], skills: [{ name: 'tool-skill' }], agents: [{ name: 'tool-helper' }], hooks: [{ event: 'PostToolUse', matcher: 'Write' }], mcpServers: [{ name: 'tool-server', transport: 'stdio' }] });
    expect(JSON.stringify(tool)).not.toContain('stub-secret'); // the tree's MCP argument and environment values
    expect(JSON.stringify(tool)).not.toContain('stub-hook-command');
    const lsp = await readManifestView({ kind: 'installation', id: 'ts-lsp@gh', scope: 'user', projectPath: null }, { root: rows[1].installPath, marketplaceRoot: location, entryName: 'ts-lsp' });
    expect(lsp).toMatchObject({ state: 'read', description: 'TypeScript', components: { lspServers: [{ name: 'typescript' }], commands: [] } });
    const available = await readManifestView({ kind: 'available', pluginId: 'tool@gh' }, { root: null, marketplaceRoot: location, entryName: 'tool' });
    expect(available.components.skills).toEqual([{ name: 'tool-skill', description: 'The skill tool brings' }]);
  });

  it('writes nothing without an explicit CLAUDE_CONFIG_DIR, and never into $HOME/.claude (P2-B)', () => {
    // a scratch HOME stands in for the owner's: the test itself must never risk a write into the real ~/.claude
    const home = scratch();
    const state = base();
    state.marketplaces.push({ name: 'gh', source: 'github', repo: 'acme/gh', plugins: [{ name: 'tool', version: '2.0.0', description: null }] });
    state.installed.push({ id: 'tool@gh', version: '2.0.0', scope: 'user', enabled: true, projectPath: null });
    const owned = join(home, '.claude');
    materialisePluginCli(state, { cwd: home, configHome: owned }, { HOME: home });
    materialisePluginCli(state, { cwd: home, configHome: owned }, { HOME: home, CLAUDE_CONFIG_DIR: owned });
    materialisePluginCli(state, { cwd: home, configHome: join(owned, 'nested') }, { HOME: home, CLAUDE_CONFIG_DIR: join(owned, 'nested') });
    materialisePluginCli(state, { cwd: home, configHome: 'relative' }, { HOME: home, CLAUDE_CONFIG_DIR: 'relative' });
    expect(existsSync(owned)).toBe(false);
    const scratchHome = join(home, 'scratch-config');
    materialisePluginCli(state, { cwd: home, configHome: scratchHome }, { HOME: home, CLAUDE_CONFIG_DIR: scratchHome });
    expect(existsSync(join(scratchHome, 'plugins', 'cache', 'gh', 'tool', '2.0.0', '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('the owner-shaped registry: 29 plugins, 130 installations over 50 projects, 10 unknown versions, four with no plugin.json (P2-B)', async () => {
    const project = '/tmp/p2b/project';
    const state = ownerShapedState(project, '/tmp/p2b/elsewhere', new Date('2026-10-09T12:00:00Z'));
    const rows = pluginRowsOf(run(['plugin', 'list', '--json'], state).stdout);
    expect(new Set(rows.map((r) => r.id)).size).toBe(29);
    expect(rows).toHaveLength(130);
    const scopes = rows.reduce<Record<string, number>>((n, r) => ({ ...n, [r.scope]: (n[r.scope] ?? 0) + 1 }), {});
    expect(scopes).toEqual({ project: 71, local: 46, user: 13 });
    expect(new Set(rows.flatMap((r) => (r.projectPath ? [r.projectPath] : []))).size).toBe(50);
    expect(rows.filter((r) => r.version === 'unknown')).toHaveLength(10);
    expect(rows.filter((r) => r.id === 'doperpowers@doperpowers')).toHaveLength(47);
    expect(rows.filter((r) => r.id === 'supabase@claude-plugins-official')).toHaveLength(46);
    expect(rows.filter((r) => r.id === 'supabase@claude-plugins-official' && r.projectPath === project)).toEqual([]); // other projects only
    expect(state.marketplaces.flatMap((m) => m.plugins).filter((p) => p.manifest === false).map((p) => p.name)).toEqual(['pyright-lsp', 'rust-analyzer-lsp', 'swift-lsp', 'typescript-lsp']);
    expect(rows.every((r) => r.installedAt !== null && r.lastUpdated !== null)).toBe(true);
  });
  // P2-B end

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
      { name: 'e8-scratch', source: 'directory', locator: '/tmp/e8/market', ref: null, installLocation: '/tmp/e8/market' },
      { name: 'e8-other', source: 'directory', locator: market, ref: null, installLocation: market },
      { name: 'tools', source: 'github', locator: 'acme/tools', ref: null, installLocation: '/tmp/e8/config/plugins/marketplaces/tools' },
      { name: 'more', source: 'git', locator: 'https://example.com/acme/more.git', ref: null, installLocation: '/tmp/e8/config/plugins/marketplaces/more' },
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
