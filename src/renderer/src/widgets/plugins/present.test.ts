// E8 M2: the plugin-management presenters — the sheet's argument list and write manifest (both from M1's shared
// module, so the sheet cannot drift from the runner), the reload words, and a row's operation line in the engine's words.
import { describe, expect, it } from 'vitest';
import { commandLine, PLUGINS_ACTIONS, PLUGINS_SCOPES, writesOf, type PluginsAction } from '@shared/plugins/cli';
import type { AvailablePlugin, PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { argvOf, availableGroups, commandWords, declaredOf, operationWords, requestFor, sourceKindOfTyped, thenWords, writesWords, type PluginOpState, type PluginsRequest } from './present';

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
        expect(argvOf(request), `${action} ${scope}`).toEqual(commandLine(request.action, request.input as never));
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

  it('reads a typed folder as a directory source and leaves every other source unknown (the clone directory announced)', () => {
    expect(sourceKindOfTyped('/tmp/market')).toBe('directory');
    expect(sourceKindOfTyped('~/market')).toBe('directory');
    expect(sourceKindOfTyped('./market')).toBe('directory');
    expect(sourceKindOfTyped('owner/repo')).toBeNull();
    expect(sourceKindOfTyped('https://example.com/m.git')).toBeNull();
  });

  it('says what follows: the reload of the running sessions, or that an added marketplace loads nothing', () => {
    expect(thenWords('install', 1)).toBe('Reloads plugins in 1 running session');
    expect(thenWords('marketplace-remove', 3)).toBe('Reloads plugins in 3 running sessions');
    expect(thenWords('disable', 0)).toBe('No running session to reload');
    expect(thenWords('marketplace-add', 2)).toBe('Nothing to reload: an added marketplace loads no plugin');
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

  it('words a success as the engine’s message with the reload summarised', () => {
    const installed = ok({ command: 'install', outcome: 'ok', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' });
    expect(operationWords(done({ outcome: installed, reload: { sessions: [{ appSessionId: 'app-a', outcome: 'reflected', error: null }] } }), title, 'user')).toEqual({
      text: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user) · Reloaded in 1 session · reflected',
      failed: false,
      reloadAgain: false,
    });
    expect(operationWords(done({ outcome: installed, reload: { sessions: [] } }), title, 'user')?.text).toBe('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · No running session to reload');
    // a reflected session beside one with no expectation (another directory under project scope) still reads reflected
    expect(operationWords(done({ outcome: installed, reload: { sessions: [{ appSessionId: 'app-a', outcome: 'reflected', error: null }, { appSessionId: 'app-b', outcome: 'no_expectation', error: null }] } }), title, 'project')?.text).toBe(
      'Successfully installed plugin: e8-probe@e8-scratch (scope: user) · Reloaded in 2 sessions · reflected',
    );
    // marketplace add reloads nothing and carries no reload report
    expect(operationWords(done({ action: 'marketplace-add', outcome: ok({ message: 'Successfully added marketplace: e8-scratch (declared in user settings)' }) }), title, 'user')?.text).toBe('Successfully added marketplace: e8-scratch (declared in user settings)');
  });

  it('names a session that did not reflect the change or failed to reload, and offers Reload again', () => {
    const outcome = ok({ message: 'Successfully disabled plugin: e8-probe (scope: user)' });
    const sessions = [
      { appSessionId: 'app-a', outcome: 'not_reflected' as const, error: null },
      { appSessionId: 'app-b', outcome: 'failed' as const, error: 'reload_plugins unanswered after 60 s' },
    ];
    expect(operationWords(done({ action: 'disable', outcome, reload: { sessions } }), title, 'user')).toEqual({
      text: 'Successfully disabled plugin: e8-probe (scope: user) · Reloaded in 1 session · not reflected in Alpha · a project setting may override it · failed in Beta · reload_plugins unanswered after 60 s',
      failed: false,
      reloadAgain: true,
    });
    expect(operationWords(done({ action: 'disable', outcome, reload: { sessions: [sessions[0]] } }), title, 'local')?.text).toBe('Successfully disabled plugin: e8-probe (scope: user) · Reloaded in 1 session · not reflected in Alpha');
  });

  it('reports an update’s version change and a failure as the engine’s message and code', () => {
    expect(operationWords(done({ action: 'update', outcome: ok({ message: 'Updated e8-probe', oldVersion: '0.1.0', newVersion: '0.2.0' }), reload: { sessions: [] } }), title, 'user')?.text).toBe('Updated e8-probe · 0.1.0 → 0.2.0 · No running session to reload');
    expect(operationWords(done({ action: 'update', outcome: ok({ message: 'e8-probe is already at the latest version (0.1.0).', oldVersion: '0.1.0', newVersion: '0.1.0' }), reload: { sessions: [] } }), title, 'user')?.text).toBe(
      'e8-probe is already at the latest version (0.1.0). · No running session to reload',
    );
    const notFound = { ok: false as const, error: { code: 'cli_failed' as const, message: 'Plugin "nope" not found in marketplace "e8-scratch".', failureCode: 'not_found', shownCommand: null } };
    expect(operationWords(done({ outcome: notFound }), title, 'user')).toEqual({ text: 'Plugin "nope" not found in marketplace "e8-scratch". · not_found', failed: true, reloadAgain: false });
    const timedOut = { ok: false as const, error: { code: 'timeout' as const, message: 'the CLI ran for 10 minutes', failureCode: null, shownCommand: null } };
    expect(operationWords(done({ outcome: timedOut }), title, 'user')?.text).toBe('the CLI ran for 10 minutes · timeout');
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

describe('the available catalogue', () => {
  const plugin = (name: string, marketplaceName: string, description: string | null = null): AvailablePlugin => ({ pluginId: `${name}@${marketplaceName}`, name, marketplaceName, description, version: null });
  const all = [plugin('zeta', 'anthropic-plugin-directory', 'Code review'), plugin('e8-probe', 'e8-scratch', 'The probe'), plugin('alpha', 'anthropic-plugin-directory')];
  it('groups by marketplace in name order and filters by name, id or description', () => {
    expect(availableGroups(all, '').map((g) => [g.marketplace, g.plugins.map((p) => p.name)])).toEqual([
      ['anthropic-plugin-directory', ['alpha', 'zeta']],
      ['e8-scratch', ['e8-probe']],
    ]);
    expect(availableGroups(all, 'REVIEW').map((g) => [g.marketplace, g.plugins.map((p) => p.name)])).toEqual([['anthropic-plugin-directory', ['zeta']]]);
    expect(availableGroups(all, 'e8-scratch').map((g) => g.marketplace)).toEqual(['e8-scratch']);
    expect(availableGroups(all, 'nothing')).toEqual([]);
  });
});
