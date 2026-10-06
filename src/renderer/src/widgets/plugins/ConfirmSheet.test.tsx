// E8 M2: the confirm sheet's words for every action and scope — the argument list it shows is `commandLine()`'s, the
// files are `writesOf()`'s — and its guards: Cancel runs nothing, and Enter alone never destroys.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandLine, PLUGINS_ACTIONS, PLUGINS_SCOPES, writesOf, type PluginsAction, type PluginsScope } from '@shared/plugins/cli';
import { ConfirmSheet, type ManageEnv } from './ConfirmSheet';
import { requestFor, SCOPED, type PluginsRequest } from './present';

const ENV: ManageEnv = { cwd: '/work/app', engine: { state: 'ready', env: { binary: '/opt/claude/2.1.290', configHome: '/tmp/home', globalConfig: '/Users/me/.claude.json' } }, readySessions: 2 };

const requestOf = (action: PluginsAction): PluginsRequest => {
  switch (action) {
    case 'marketplace-add':
      return requestFor(action, { source: 'owner/repo' }, null);
    case 'marketplace-update':
    case 'marketplace-remove':
      return requestFor(action, { name: 'e8-scratch' }, 'directory');
    default:
      return requestFor(action, { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null);
  }
};

afterEach(cleanup);

const argvShown = () => JSON.parse(screen.getByRole('dialog').querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];

// Every action at every scope its sheet offers (the marketplace verbs at the CLI's default, user).
const CASES: [PluginsAction, PluginsScope][] = PLUGINS_ACTIONS.flatMap((action) => (SCOPED.has(action) ? PLUGINS_SCOPES : (['user'] as const)).map((scope): [PluginsAction, PluginsScope] => [action, scope]));

describe('the confirm sheet', () => {
  it.each(CASES)('shows commandLine()’s argument list and writesOf()’s files: %s at %s scope', (action, scope) => {
    const request = requestOf(action);
    render(<ConfirmSheet request={request} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    if (SCOPED.has(action)) fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: scope[0].toUpperCase() + scope.slice(1) }));
    const input = SCOPED.has(action) ? { ...request.input, scope } : request.input;
    expect(argvShown()).toEqual(commandLine(action, input as never));
    expect(argvShown()).not.toContain('-y');
    const writes = within(screen.getByRole('list', { name: "The engine's CLI writes:" })).getAllByRole('listitem');
    expect(writes).toHaveLength(1 + writesOf(action, scope, request.source).others.length);
    expect(writes[0].textContent).toBe(scope === 'user' ? '/tmp/home/settings.json' : `/work/app/${writesOf(action, scope, null).settings}`);
  });

  it('Cancel closes without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmSheet request={requestOf('install')} declared={null} env={ENV} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits a non-destructive change on Enter, and a destructive one only after I understand', () => {
    const onConfirm = vi.fn();
    render(<ConfirmSheet request={requestOf('enable')} declared={null} env={ENV} onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onConfirm).toHaveBeenCalledWith(requestFor('enable', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null));
    cleanup();
    onConfirm.mockClear();
    render(<ConfirmSheet request={requestOf('marketplace-remove')} declared={null} env={ENV} onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('the second sheet shows the declared command, keeps the scope the request ran at, and says Run it', () => {
    const onConfirm = vi.fn();
    const sha = 'a'.repeat(64);
    const request = requestFor('install', { plugin: 'p@m', scope: 'local', acceptCommand: sha }, null);
    render(<ConfirmSheet request={request} declared={{ sha256: sha, command: 'npx helper' }} env={ENV} onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByRole('dialog').querySelector('[data-plugins-declared]')!.textContent).toBe('npx helper');
    expect(within(screen.getByRole('dialog')).queryByRole('radio')).toBeNull();
    expect(argvShown()).toEqual(['plugin', 'install', 'p@m', '--scope', 'local', '--accept-command', sha, '--json']);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run it' }));
    expect(onConfirm).toHaveBeenCalledWith(request);
  });
});
