// E8 M2: the plugin-management presenters — the sheet's argument list and write manifest (both from M1's shared
// module, so the sheet cannot drift from the runner), the reload words, and a row's operation line in the engine's words.
import { describe, expect, it } from 'vitest';
import { commandLine, mcpCommandLine, PLUGINS_ACTIONS, PLUGINS_SCOPES, writesOf, type PluginsAction } from '@shared/plugins/cli';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { argvOf, commandWords, declaredOf, shownRequestOf, dependencyWords, operationWords, overridesWords, requestFor, sourceKindOfTyped, thenWords, uninstallsWords, writesWords, type PluginOpState, type PluginsRequest } from './present';

const HOME = '/tmp/scratch/claude-config';
const CWD = '/work/app';
const SHA = 'e'.repeat(64);

const sample = (action: PluginsAction, scope: (typeof PLUGINS_SCOPES)[number]): PluginsRequest => {
  switch (action) {
    case 'install':
    case 'update':
    case 'uninstall':
    case 'enable':
    case 'disable':
      return requestFor(action, { plugin: 'e8-probe@e8-scratch', scope }, null);
    case 'marketplace-add':
      return requestFor(action, { source: '/tmp/market' }, 'directory');
    case 'marketplace-update':
      return requestFor(action, { name: 'e8-scratch' }, 'github');
    case 'marketplace-remove':
      return requestFor(action, { name: 'e8-scratch' }, 'directory');
  }
};

describe('the sheet’s command and writes', () => {
  it('shows commandLine()’s argument list for every action and scope, after the binary’s basename', () => {
    for (const action of PLUGINS_ACTIONS)
      for (const scope of PLUGINS_SCOPES) {
        const request = sample(action, scope);
        expect(argvOf(request), `${action} ${scope}`).toEqual(commandLine(request.action as PluginsAction, request.input as never));
      }
    const install = requestFor('install', { plugin: 'e8-probe@e8-scratch', scope: 'project' }, null);
    expect(commandWords('/Users/me/.local/share/claude/versions/2.1.290', argvOf(install))).toBe('2.1.290 plugin install e8-probe@e8-scratch --scope project --json');
    expect(commandWords('/opt/bin/claude', ['plugin', 'marketplace', 'add', '/Users/me/My Market', '--json'])).toBe("claude plugin marketplace add '/Users/me/My Market' --json");
  });

  it('names writesOf()’s files under the config home or the project, the known segments filled', () => {
    for (const action of PLUGINS_ACTIONS)
      for (const scope of PLUGINS_SCOPES) {
        const request = sample(action, scope);
        const manifest = writesOf(action, 'scope' in request.input && request.input.scope ? request.input.scope : 'user', request.source);
        expect(writesWords(request, { configHome: HOME, cwd: CWD }), `${action} ${scope}`).toHaveLength(1 + manifest.others.length);
      }
    expect(writesWords(requestFor('install', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null), { configHome: HOME, cwd: CWD })).toEqual([
      `${HOME}/settings.json`,
      `${HOME}/plugins/installed_plugins.json`,
      `${HOME}/plugins/cache/e8-scratch/e8-probe/<version>/`,
      `${HOME}/plugins/cache/<any-marketplace>/<dependency>/`,
    ]);
    expect(writesWords(requestFor('uninstall', { plugin: 'e8-probe@e8-scratch', scope: 'local' }, null), { configHome: HOME, cwd: CWD })).toEqual([
      `${CWD}/.claude/settings.local.json`,
      `${HOME}/plugins/installed_plugins.json`,
      `${HOME}/plugins/cache/e8-scratch/e8-probe/<version>/`,
      `${HOME}/plugins/data/e8-probe@e8-scratch/`,
    ]);
    expect(writesWords(requestFor('enable', { plugin: 'e8-probe@e8-scratch', scope: 'project' }, null), { configHome: HOME, cwd: CWD })).toEqual([`${CWD}/.claude/settings.json`]);
    expect(writesWords(requestFor('marketplace-add', { source: 'owner/repo' }, null), { configHome: HOME, cwd: CWD })).toEqual([`${HOME}/settings.json`, `${HOME}/plugins/known_marketplaces.json`, `${HOME}/plugins/marketplaces/<name>/`]);
    expect(writesWords(requestFor('marketplace-update', { name: 'e8-scratch' }, 'github'), { configHome: HOME, cwd: CWD })).toEqual([`${HOME}/settings.json`, `${HOME}/plugins/known_marketplaces.json`, `${HOME}/plugins/marketplaces/e8-scratch/`]);
    expect(writesWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory'), { configHome: HOME, cwd: CWD })).toEqual([`${HOME}/settings.json`, `${HOME}/plugins/known_marketplaces.json`]);
  });

  it('announces the dependency caches an install or update may write, in words beside the placeholder path', () => {
    expect(writesWords(requestFor('install', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null), { configHome: HOME, cwd: CWD })).toContain(`${HOME}/plugins/cache/<any-marketplace>/<dependency>/`);
    expect(dependencyWords('install')).toBe('and the cache directories of any dependencies the marketplace declares, from this or an allowlisted marketplace, each enabled in the settings file above');
    expect(dependencyWords('update')).toBe(dependencyWords('install'));
    for (const action of PLUGINS_ACTIONS.filter((a) => a !== 'install' && a !== 'update')) expect(dependencyWords(action), action).toBeNull();
  });

  it('a marketplace removal names the plugins it uninstalls and every file that writes, overrides at any scope included, each once', () => {
    const uninstalls = [
      { id: 'e8-probe@e8-scratch', scope: 'user', projectPath: null },
      { id: 'e8-tools@e8-scratch', scope: 'project', projectPath: '/work/other' },
      { id: 'e8-extra@e8-scratch', scope: 'local', projectPath: CWD },
    ];
    const remove = requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory', { uninstalls });
    expect(writesWords(remove, { configHome: HOME, cwd: CWD })).toEqual([
      `${HOME}/settings.json`,
      `${HOME}/plugins/known_marketplaces.json`,
      `${HOME}/plugins/installed_plugins.json`,
      `${HOME}/plugins/cache/e8-scratch/`,
      `${HOME}/plugins/data/e8-probe@e8-scratch/`,
      `${HOME}/plugins/data/e8-tools@e8-scratch/`,
      `${HOME}/plugins/data/e8-extra@e8-scratch/`,
      '/work/other/.claude/settings.json',
      '/work/other/.claude/settings.local.json',
      `${CWD}/.claude/settings.json`,
      `${CWD}/.claude/settings.local.json`,
    ]);
    expect(overridesWords(remove)).toBe('and any enable or disable override for them in these settings files');
    expect(overridesWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory', { uninstalls: [] }))).toBeNull();
    expect(overridesWords(requestFor('uninstall', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null))).toBeNull();
    // a user-scoped plugin alone still names the session's project files, where a narrower override may sit
    expect(writesWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory', { uninstalls: uninstalls.slice(0, 1) }), { configHome: HOME, cwd: CWD }).slice(-2)).toEqual([`${CWD}/.claude/settings.json`, `${CWD}/.claude/settings.local.json`]);
    expect(uninstallsWords(remove)).toBe('Also uninstalls 3 plugins: e8-probe@e8-scratch (user), e8-tools@e8-scratch (project, /work/other), e8-extra@e8-scratch (local, /work/app)');
    expect(uninstallsWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory', { uninstalls: uninstalls.slice(0, 1) }))).toBe('Also uninstalls 1 plugin: e8-probe@e8-scratch (user)');
    expect(uninstallsWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory', { uninstalls: [] }))).toBeNull();
    expect(uninstallsWords(requestFor('marketplace-remove', { name: 'e8-scratch' }, 'directory'))).toBeNull();
  });

  it('reads a typed folder as a directory source and leaves every other source unknown (the clone directory announced)', () => {
    expect(sourceKindOfTyped('/tmp/market')).toBe('directory');
    expect(sourceKindOfTyped('~/market')).toBe('directory');
    expect(sourceKindOfTyped('./market')).toBe('directory');
    expect(sourceKindOfTyped('owner/repo')).toBeNull();
    expect(sourceKindOfTyped('https://example.com/m.git')).toBeNull();
  });

  // the word cut (P720): nothing said when no session will reload, nor for an added marketplace
  it('says what follows: the reload of the running sessions, and nothing when none reloads', () => {
    expect(thenWords('install', 1)).toBe('Reloads plugins in 1 running session');
    expect(thenWords('marketplace-remove', 3)).toBe('Reloads plugins in 3 running sessions');
    expect(thenWords('disable', 0)).toBeNull();
    expect(thenWords('marketplace-add', 2)).toBeNull();
  });
});

const done = (over: Partial<PluginsOperationEvent>): PluginOpState => ({ phase: 'done', event: { opId: 'op-1', action: 'install', target: 'e8-probe@e8-scratch', phase: 'done', ...over } });
const ok = (result: Record<string, unknown>) => ({ ok: true as const, result });
const title = (id: string) => ({ 'app-a': 'Alpha', 'app-b': 'Beta' })[id] ?? id;

describe('a row’s operation line', () => {
  it('shows Working… from the receipt, the CLI’s last progress line while it runs, then the reload', () => {
    expect(operationWords({ phase: 'idle' }, title, 'user')).toBeNull();
    expect(operationWords({ phase: 'working', opId: null, line: null, reloading: false }, title, 'user')).toEqual({ text: 'Working…', failed: false, reloadAgain: false });
    expect(operationWords({ phase: 'working', opId: 'op-1', line: 'Cloning into …', reloading: false }, title, 'user')?.text).toBe('Cloning into …');
    expect(operationWords({ phase: 'working', opId: 'op-1', line: 'Cloning into …', reloading: true }, title, 'user')?.text).toBe('Reloading running sessions…');
    expect(operationWords({ phase: 'unsent', error: 'The engine host is not running' }, title, 'user')).toEqual({ text: 'The engine host is not running', failed: true, reloadAgain: false });
  });

  // the word cut (P731): a success is the engine's message and the version change, with only a session that fell short
  it('words a success as the engine’s message alone where every session reflected it', () => {
    const installed = ok({ command: 'install', outcome: 'ok', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' });
    expect(operationWords(done({ outcome: installed, reload: { sessions: [{ appSessionId: 'app-a' as AppSessionId, outcome: 'reflected', error: null }] } }), title, 'user')).toEqual({
      text: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)',
      failed: false,
      reloadAgain: false,
    });
    expect(operationWords(done({ outcome: installed, reload: { sessions: [] } }), title, 'user')?.text).toBe('Successfully installed plugin: e8-probe@e8-scratch (scope: user)');
    // a reflected session beside one with no expectation (another directory under project scope) says nothing more
    expect(operationWords(done({ outcome: installed, reload: { sessions: [{ appSessionId: 'app-a' as AppSessionId, outcome: 'reflected', error: null }, { appSessionId: 'app-b' as AppSessionId, outcome: 'no_expectation', error: null }] } }), title, 'project')?.text).toBe(
      'Successfully installed plugin: e8-probe@e8-scratch (scope: user)',
    );
    // marketplace add reloads nothing and carries no reload report
    expect(operationWords(done({ action: 'marketplace-add', outcome: ok({ message: 'Successfully added marketplace: e8-scratch (declared in user settings)' }) }), title, 'user')?.text).toBe('Successfully added marketplace: e8-scratch (declared in user settings)');
  });

  it('names a session that did not reflect the change or failed to reload, and offers Reload again', () => {
    const outcome = ok({ message: 'Successfully disabled plugin: e8-probe (scope: user)' });
    const sessions = [
      { appSessionId: 'app-a' as AppSessionId, outcome: 'not_reflected' as const, error: null },
      { appSessionId: 'app-b' as AppSessionId, outcome: 'failed' as const, error: 'reload_plugins unanswered after 60 s' },
    ];
    expect(operationWords(done({ action: 'disable', outcome, reload: { sessions } }), title, 'user')).toEqual({
      text: 'Successfully disabled plugin: e8-probe (scope: user) · not reflected in Alpha · a project setting may override it · failed in Beta · reload_plugins unanswered after 60 s',
      failed: false,
      reloadAgain: true,
    });
    expect(operationWords(done({ action: 'disable', outcome, reload: { sessions: [sessions[0]] } }), title, 'local')?.text).toBe('Successfully disabled plugin: e8-probe (scope: user) · not reflected in Alpha');
  });

  it('reports an update’s version change and a failure as the engine’s message and code', () => {
    expect(operationWords(done({ action: 'update', outcome: ok({ message: 'Updated e8-probe', oldVersion: '0.1.0', newVersion: '0.2.0' }), reload: { sessions: [] } }), title, 'user')?.text).toBe('Updated e8-probe · 0.1.0 → 0.2.0');
    expect(operationWords(done({ action: 'update', outcome: ok({ message: 'e8-probe is already at the latest version (0.1.0).', oldVersion: '0.1.0', newVersion: '0.1.0' }), reload: { sessions: [] } }), title, 'user')?.text).toBe(
      'e8-probe is already at the latest version (0.1.0).',
    );
    const notFound = { ok: false as const, error: { code: 'cli_failed' as const, message: 'Plugin "nope" not found in marketplace "e8-scratch".', failureCode: 'not_found', shownCommand: null } };
    expect(operationWords(done({ outcome: notFound }), title, 'user')).toEqual({ text: 'Plugin "nope" not found in marketplace "e8-scratch". · not_found', failed: true, reloadAgain: false });
    const timedOut = { ok: false as const, error: { code: 'timeout' as const, message: 'the CLI ran for 10 minutes', failureCode: null, shownCommand: null } };
    expect(operationWords(done({ outcome: timedOut }), title, 'user')?.text).toBe('the CLI ran for 10 minutes · timeout');
    const overflowed = { ok: false as const, error: { code: 'output_overflow' as const, message: 'the CLI printed more than 8 MiB (8388700 bytes) and was stopped', failureCode: null, shownCommand: null } };
    expect(operationWords(done({ outcome: overflowed }), title, 'user')).toEqual({ text: 'the CLI printed more than 8 MiB (8388700 bytes) and was stopped · output_overflow', failed: true, reloadAgain: false });
  });
});

describe('a marketplace-declared command', () => {
  const refused = (failureCode: string, shownCommand: Record<string, unknown> | null): PluginsOperationEvent => ({
    opId: 'op-1', action: 'install', target: 'p@m', phase: 'done',
    outcome: { ok: false, error: { code: 'cli_failed', message: 'needs confirmation', failureCode, shownCommand } },
  });
  it('is offered for acceptance only for install and update with a sha256 the CLI reported', () => {
    expect(declaredOf(refused('command_source_refused', { sha256: SHA, command: 'npx fetch-helper', kind: 'command-source' }), 'install')).toEqual({ sha256: SHA, command: 'npx fetch-helper' });
    expect(declaredOf(refused('entry_helper_unconfirmed', { sha256: SHA, command: ['node', 'helper.js'] }), 'update')).toEqual({ sha256: SHA, command: 'node helper.js' });
    expect(declaredOf(refused('command_source_refused', { sha256: SHA, command: 'x' }), 'marketplace-add')).toBeNull();
    expect(declaredOf(refused('command_source_refused', { sha256: 'not-a-hash', command: 'x' }), 'install')).toBeNull();
    expect(declaredOf(refused('not_found', null), 'install')).toBeNull();
    expect(declaredOf(null, 'install')).toBeNull();
  });
});


// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, §A, §D): an MCP action's command is the
// shown line, the same as today's for every request but a custom add, whose value slots read •••.
describe('a connector’s command, and the request a window keeps', () => {
  const custom = requestFor('mcp-add', { name: 'files-probe', scope: 'local', entry: { type: 'stdio', command: '/opt/probe', args: ['--root', 'value-one'], env: [{ name: 'MODE', value: 'value-two' }, { name: 'LEVEL', value: '' }] } }, null);

  it('today’s line for Discover’s add and for a removal', () => {
    const remote = requestFor('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'sse', scope: 'project' }, null);
    expect(argvOf(remote)).toEqual(['mcp', 'add', '--transport', 'sse', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'project']);
    expect(argvOf(remote)).toEqual(mcpCommandLine('mcp-add', remote.input as never));
    const removal = requestFor('mcp-remove', { name: 'linear', scope: 'user' }, null);
    expect(argvOf(removal)).toEqual(['mcp', 'remove', 'linear', '--scope', 'user']);
  });

  it('a custom add: ••• in every value slot, empty ones too; an argument is a public field, shown as typed', () => {
    const argv = argvOf(custom);
    expect(argv).toEqual(['mcp', 'add-json', 'files-probe', '{"type":"stdio","command":"/opt/probe","args":["--root","value-one"],"env":{"MODE":"•••","LEVEL":"•••"}}', '--scope', 'local']);
    expect(argv.join(' ')).not.toContain('value-two');
  });

  it('a custom add is kept with ••• in every slot; every other request is kept as it is', () => {
    const kept = shownRequestOf({ ...custom, folder: '/work/files-lab' });
    expect(kept.input).toEqual({ name: 'files-probe', scope: 'local', entry: { type: 'stdio', command: '/opt/probe', args: ['--root', 'value-one'], env: [{ name: 'MODE', value: '•••' }, { name: 'LEVEL', value: '•••' }] } });
    expect(kept.folder).toBe('/work/files-lab');
    const remote = requestFor('mcp-add', { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' }, null);
    expect(shownRequestOf(remote)).toBe(remote);
    const install = requestFor('install', { plugin: 'e8-probe@e8-scratch' }, null);
    expect(shownRequestOf(install)).toBe(install);
  });
});
