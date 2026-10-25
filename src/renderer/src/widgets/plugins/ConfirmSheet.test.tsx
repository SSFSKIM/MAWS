// E8 M2: the confirm sheet's words for every action and scope — the argument list it shows is `commandLine()`'s, the
// files are `writesOf()`'s — and its guards: Cancel runs nothing, and Enter alone never destroys.
// The owner's ruling of 2026-10-25 (the Discover spec): the commands and the files they write sit behind Details,
// closed at every opening; the second sheet, whose command is the decision, shows it with no disclosure.
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

const detailsButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Details' });
// Opens Details when it is closed: the commands and the files are inside it.
const openDetails = () => {
  if (detailsButton().getAttribute('aria-expanded') === 'false') fireEvent.click(detailsButton());
};
const argvShown = () => JSON.parse(screen.getByRole('dialog').querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];

const hookedInstall = (present: boolean) =>
  requestFor('install', { plugin: 'hooked@maws-test', scope: 'user' }, null, {
    catalog: { name: 'hooked', marketplace: { name: 'maws-test', source: '/tmp/maws-test', present }, skills: null, contents: ['hooks'], runsCode: 'Includes components that run code on your computer: hooks.', alsoListedBy: [] },
  });

// Every action at every scope its sheet offers (the marketplace verbs at the CLI's default, user).
const CASES: [PluginsAction, PluginsScope][] = PLUGINS_ACTIONS.flatMap((action) => (SCOPED.has(action) ? PLUGINS_SCOPES : (['user'] as const)).map((scope): [PluginsAction, PluginsScope] => [action, scope]));

describe('the confirm sheet', () => {
  it.each(CASES)('shows commandLine()’s argument list and writesOf()’s files: %s at %s scope', (action, scope) => {
    const request = requestOf(action);
    render(<ConfirmSheet request={request} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    if (SCOPED.has(action)) fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: scope[0].toUpperCase() + scope.slice(1) }));
    openDetails();
    const input = SCOPED.has(action) ? { ...request.input, scope } : request.input;
    expect(argvShown()).toEqual(commandLine(action, input as never));
    expect(argvShown()).not.toContain('-y');
    const writes = within(screen.getByRole('list', { name: "The engine's CLI writes:" })).getAllByRole('listitem');
    expect(writes).toHaveLength(1 + writesOf(action, scope, request.source).others.length);
    expect(writes[0].textContent).toBe(scope === 'user' ? '/tmp/home/settings.json' : `/work/app/${writesOf(action, scope, null).settings}`);
  });

  it('opens with the commands and the files behind a closed Details, what installs and the scope in view; Details shows both steps and the files', () => {
    render(<ConfirmSheet request={hookedInstall(false)} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    const sheet = screen.getByRole('dialog');
    // closed: no command, no file
    expect(detailsButton().getAttribute('aria-expanded')).toBe('false');
    expect(detailsButton().hasAttribute('aria-controls')).toBe(false); // nothing to control while closed: the region is not rendered
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    expect(sheet.querySelector('[data-plugins-add-argv]')).toBeNull();
    expect(within(sheet).queryByRole('list', { name: "The engine's CLI writes:" })).toBeNull();
    expect(sheet.textContent).not.toContain('plugin install');
    expect(sheet.textContent).not.toContain('/tmp/home/settings.json');
    // in view: what installs, what comes with it, the runs-code warning, the scope
    expect(sheet.querySelector('[data-catalog-summary]')!.textContent).toBe('Adds the marketplace maws-test (user) and installs hooked');
    expect(sheet.querySelector('[data-catalog-contents]')!.textContent).toBe('Comes with: hooks');
    expect(within(sheet).getByRole('note').textContent).toBe('Includes components that run code on your computer: hooks.');
    expect((within(sheet).getByRole('radio', { name: 'User' }) as HTMLInputElement).checked).toBe(true);
    // keyboard-reachable: a native button in the tab order
    detailsButton().focus();
    expect(document.activeElement).toBe(detailsButton());
    // opened: the exact commands, add first, and every file both steps write
    fireEvent.click(detailsButton());
    expect(detailsButton().getAttribute('aria-expanded')).toBe('true');
    const region = within(sheet).getByRole('region', { name: 'Details' });
    expect(detailsButton().getAttribute('aria-controls')).toBe(region.id);
    const codes = Array.from(region.querySelectorAll('code')).map((code) => code.textContent);
    expect(codes).toEqual(['2.1.290 plugin marketplace add /tmp/maws-test --scope user --json', '2.1.290 plugin install hooked@maws-test --scope user --json']);
    const writes = within(within(region).getByRole('list', { name: "The engine's CLI writes:" })).getAllByRole('listitem').map((item) => item.textContent);
    expect(writes[0]).toBe('/tmp/home/settings.json');
    expect(writes.length).toBeGreaterThan(1);
    expect(region.textContent).toContain('/Users/me/.claude.json');
    // closed again
    fireEvent.click(detailsButton());
    expect(detailsButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('a present marketplace’s install: one command behind Details', () => {
    render(<ConfirmSheet request={hookedInstall(true)} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    const sheet = screen.getByRole('dialog');
    expect(sheet.querySelector('[data-catalog-summary]')!.textContent).toBe('Installs hooked from maws-test');
    expect(sheet.querySelector('[data-plugins-argv]')).toBeNull();
    openDetails();
    expect(sheet.querySelector('[data-plugins-add-argv]')).toBeNull();
    expect(argvShown()).toEqual(['plugin', 'install', 'hooked@maws-test', '--scope', 'user', '--json']);
  });

  it('offers no Details until the engine is resolved, and says why', () => {
    render(<ConfirmSheet request={hookedInstall(false)} declared={null} env={{ ...ENV, engine: { state: 'error', error: 'no engine' } }} onConfirm={() => {}} onClose={() => {}} />);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Details' })).toBeNull();
    expect(within(sheet).getByRole('alert').textContent).toBe('no engine');
  });

  it('with no scope to choose, a scope the request carries stays in view outside Details; none is invented', () => {
    // the Discover recovery's Remove marketplace runs at the scope the marketplace was added at
    render(<ConfirmSheet request={requestFor('marketplace-remove', { name: 'maws-test', scope: 'project' }, 'directory')} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    let sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByRole('radio')).toBeNull();
    expect(detailsButton().getAttribute('aria-expanded')).toBe('false');
    expect(sheet.querySelector('[data-plugins-scope]')!.textContent).toBe('Scope: Project');
    cleanup();
    // Manage marketplaces' removal names no scope: the sheet does not either
    render(<ConfirmSheet request={requestOf('marketplace-remove')} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    sheet = screen.getByRole('dialog');
    expect(sheet.querySelector('[data-plugins-scope]')).toBeNull();
    cleanup();
    // a scoped action has its selector and no fixed line
    render(<ConfirmSheet request={requestOf('install')} declared={null} env={ENV} onConfirm={() => {}} onClose={() => {}} />);
    sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('radio', { name: 'User' })).toBeTruthy();
    expect(sheet.querySelector('[data-plugins-scope]')).toBeNull();
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
    expect(onConfirm).toHaveBeenCalledWith(requestFor('enable', { plugin: 'e8-probe@e8-scratch', scope: 'user' }, null), '/opt/claude/2.1.290'); // with the binary it named
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
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Details' })).toBeNull(); // the command is the decision: in view, no disclosure
    expect(screen.getByRole('dialog').querySelector('[data-plugins-scope]')!.textContent).toBe('Scope: Local'); // the scope it reruns at, with no selector
    expect(argvShown()).toEqual(['plugin', 'install', 'p@m', '--scope', 'local', '--accept-command', sha, '--json']);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run it' }));
    expect(onConfirm).toHaveBeenCalledWith(request, '/opt/claude/2.1.290');
  });
});
