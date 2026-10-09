// `/plugins` over the fixture-backed widget backend (C11) with the E8 plugin CLI stood in by scripted answers: the
// three CLI reads, the operations' receipts, and `plugins.operation` / `plugins.changed` emitted by the test as the
// engine host would emit them. Nothing here runs a CLI or touches a config home.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, MawsBridge } from '@shared/ipc/schema';
import type { InstalledPlugin, PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { commandLine } from '@shared/plugins/cli';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { PluginsWidget } from './PluginsWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
const HOME = '/tmp/e8-scratch/claude-config';
const BINARY = '/Users/me/.local/share/claude/versions/2.1.290';
const GLOBAL = '/Users/me/.claude.json'; // beside ~/.claude when no CLAUDE_CONFIG_DIR: used verbatim, never derived from HOME
const SHA = 'e'.repeat(64);
let backend: WidgetBackend;
let cwd: string;
let emit: (name: EventName, payload: unknown) => void;
let installed: InstalledPlugin[];
let opSeq: number;

const plugin = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => {
  const [name, marketplace] = id.split('@');
  return { id, name, marketplace, version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: `${HOME}/plugins/cache/${marketplace}/${name}/0.1.0`, errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over };
};

// The plugin CLI's answers as the engine host gives them, and its events delivered to the widget's listeners.
function standIn() {
  installed = [plugin('e8-probe@e8-scratch')];
  opSeq = 0;
  backend.script('plugins.env', () => ({ binary: BINARY, binaryError: null, configHome: HOME, globalConfig: GLOBAL }));
  backend.script('plugins.list', () => ({ plugins: installed }));
  backend.script('marketplaces.list', () => ({ marketplaces: [{ name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-scratch/market', installLocation: '/tmp/e8-scratch/market' }] }));
  backend.script('plugins.available', () => ({
    plugins: [
      { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'The probe', version: '0.1.0', source: null, installCount: null },
      { pluginId: 'e8-other@e8-scratch', name: 'e8-other', marketplaceName: 'e8-scratch', description: 'Another', version: null, source: null, installCount: null },
      { pluginId: 'review@anthropic-plugin-directory', name: 'review', marketplaceName: 'anthropic-plugin-directory', description: 'Code review', version: '1.0.0', source: null, installCount: null },
    ],
  }));
  for (const command of ['plugins.install', 'plugins.update', 'plugins.uninstall', 'plugins.enable', 'plugins.disable', 'marketplaces.add', 'marketplaces.update', 'marketplaces.remove'] as const) backend.script(command, () => ({ opId: `pop-${++opSeq}` }));
  backend.script('plugins.cancel', () => ({ cancelled: true }));
  const base = backend.bridge();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge: MawsBridge = {
    ...base,
    on(name, listener) {
      if (!name.startsWith('plugins.')) return base.on(name, listener);
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => void set.delete(entry);
    },
  };
  emit = (name, payload) => listeners.get(name)?.forEach((listener) => listener(payload));
  window.maws = bridge;
}

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  cwd = backend.status(ID).cwd;
  standIn();
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PluginsWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );

const invoked = (command: string) => backend.calls.filter((c) => c.command === command).map((c) => c.input);
const section = (name: string) => document.querySelector<HTMLElement>(`[data-plugins-section="${name}"]`)!;
const row = (id: string) => section('installed').querySelector<HTMLElement>(`[data-plugin-row="${id}"]`)!;
const sheet = () => screen.getByRole('dialog');
const argvShown = () => JSON.parse(sheet().querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];
// Every sheet reads plugins.env again on opening and names its command once that read answered.
const resolved = () => waitFor(() => expect(sheet().querySelector('[data-plugins-argv]')).toBeTruthy());
const event = (over: Partial<PluginsOperationEvent> & Pick<PluginsOperationEvent, 'opId' | 'phase'>): PluginsOperationEvent => ({ action: 'install', target: 'e8-probe@e8-scratch', ...over });
const ready = async () => {
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
  mount();
  await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
  await waitFor(() => expect(section('marketplaces').querySelector('[data-marketplace-row="e8-scratch"]')).toBeTruthy());
};

describe('plugins widget: loaded in this session and the reloads', () => {
  it('lists what a ready process loaded once the installed plugins are read, with no caption', async () => {
    await ready();
    expect(within(screen.getByRole('list', { name: 'Loaded plugins' })).getAllByRole('listitem')).toHaveLength(11);
    expect(screen.queryByText(/last reported/)).toBeNull();
    expect(invoked('plugins.list')).toEqual([{ cwd }]);
    expect(invoked('marketplaces.list')).toEqual([{ cwd }]);
  });

  it('Reload plugins shows Working… from the receipt, then the reload summarised', async () => {
    backend.holdOperations(true);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }));
    await waitFor(() => expect(screen.getByText('Working…')).toBeTruthy());
    expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toHaveProperty('disabled', true);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(screen.getByText('Reloaded · 52 commands · 5 agents · 11 plugins · 0 errors')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toHaveProperty('disabled', false);
  });

  it('Reload skills runs reload_skills and says how many skills the engine now offers', async () => {
    backend.script('session.reloadSkills', () => {
      setTimeout(() => backend.emitOperation({ appSessionId: ID, opId: 'op-skills', command: 'session.reloadSkills', late: false, outcome: { ok: true, value: { skills: [{ name: 'e8-probe:e8-hello' }, { name: 'review' }] } } }), 0);
      return { opId: 'op-skills' };
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }));
    await waitFor(() => expect(screen.getByText('Reloaded · 2 skills')).toBeTruthy());
  });

  it('shows a failed reload in red in its words with the list as it was, and a late success corrects it to Applied after all', async () => {
    backend.scriptOutcome('session.reloadPlugins', () => ({ ok: false, error: { code: 'timeout', message: 'reload_plugins unanswered after 60 s', engineCode: null } }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }));
    await waitFor(() => expect(screen.getByText('reload_plugins unanswered after 60 s · timeout').className).toContain('text-danger'));
    expect(within(screen.getByRole('list', { name: 'Loaded plugins' })).getAllByRole('listitem')).toHaveLength(11);
    act(() => backend.emitOperation({ appSessionId: ID, opId: 'op-1', command: 'session.reloadPlugins', late: true, outcome: { ok: true, value: { commands: [], agents: [], plugins: [], mcpServers: [], error_count: 0 } } }));
    await waitFor(() => expect(screen.getByText('Applied after all')).toBeTruthy());
  });

  it('refuses a reload the host would not start as the transport branch, asking nothing of the engine', async () => {
    backend.script('session.reloadPlugins', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'the host did not answer' });
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }));
    await waitFor(() => expect(screen.getByText('The engine did not answer · showing the last value it reported')).toBeTruthy());
  });

  it('keeps an exited session’s last list, offers no reload, and still manages plugins through the CLI', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]) });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(within(screen.getByRole('list', { name: 'Loaded plugins' })).getAllByRole('listitem')).toHaveLength(11);
    expect(screen.getByText('The session is not running · the plugins it last reported')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    expect(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false);
  });

  it('frames the CLI’s refusal of the installed-plugins read as the widget’s error', async () => {
    backend.script('plugins.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'Path does not exist: /nope' });
    });
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Path does not exist: /nope'));
  });
});

describe('plugins widget: management', () => {
  it('lists installed plugins and marketplaces, and reads the catalogue only when Available opens', async () => {
    await ready();
    expect(row('e8-probe@e8-scratch').textContent).toContain('user · enabled · e8-scratch');
    expect(section('marketplaces').querySelector('[data-marketplace-row="e8-scratch"]')!.textContent).toContain('/tmp/e8-scratch/market');
    expect(invoked('plugins.available')).toEqual([]);
    fireEvent.click(within(section('available')).getByText('Available'));
    await waitFor(() => expect(within(section('available')).getByText('e8-scratch · 2 plugins')).toBeTruthy());
    expect(invoked('plugins.available')).toEqual([{ cwd }]);
    fireEvent.change(within(section('available')).getByRole('textbox', { name: 'Filter available plugins' }), { target: { value: 'review' } });
    expect(within(section('available')).getByRole('list', { name: 'Available in anthropic-plugin-directory' })).toBeTruthy();
    expect(within(section('available')).queryByText('e8-scratch · 2 plugins')).toBeNull();
    // a change rereads the lists, and the catalogue only while its section is open
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.available')).toHaveLength(2));
    expect(invoked('plugins.list')).toHaveLength(2);
    expect(invoked('marketplaces.list')).toHaveLength(2);
    fireEvent.click(within(section('available')).getByText('Available'));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(3));
    expect(invoked('plugins.available')).toHaveLength(2);
  });

  it('Cancel on the confirm sheet runs nothing; a confirmed install runs the argument list the sheet showed, at the scope chosen', async () => {
    await ready();
    fireEvent.click(within(section('available')).getByText('Available'));
    await waitFor(() => expect(within(section('available')).getByText('e8-scratch · 2 plugins')).toBeTruthy());
    fireEvent.click(within(section('available')).getByText('e8-scratch · 2 plugins'));
    const other = await waitFor(() => section('available').querySelector<HTMLElement>('[data-plugin-row="e8-other@e8-scratch"]')!);

    fireEvent.click(within(other).getByRole('button', { name: 'Install…' }));
    expect(sheet().getAttribute('data-plugins-sheet')).toBe('install');
    expect(within(sheet()).getByRole('heading', { name: 'Install e8-other@e8-scratch?' })).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invoked('plugins.install')).toEqual([]);

    fireEvent.click(within(other).getByRole('button', { name: 'Install…' }));
    await resolved();
    expect(argvShown()).toEqual(commandLine('install', { plugin: 'e8-other@e8-scratch', scope: 'user' }));
    expect(within(sheet()).getByText('2.1.290 plugin install e8-other@e8-scratch --scope user --json')).toBeTruthy();
    expect(within(sheet()).getByText(`${HOME}/settings.json`)).toBeTruthy();
    expect(within(sheet()).getByText(`and keeps its own records in ${GLOBAL}`)).toBeTruthy();
    expect(within(sheet()).getByText('Reloads plugins in 1 running session')).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Project' }));
    expect(argvShown()).toEqual(commandLine('install', { plugin: 'e8-other@e8-scratch', scope: 'project' }));
    expect(within(sheet()).getByText(`${cwd}/.claude/settings.json`)).toBeTruthy();
    expect(within(sheet()).getByText(`In ${cwd}`)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-other@e8-scratch', scope: 'project' }]));
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(within(other).getByRole('status').textContent).toBe('Working…'));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'started' })));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'output', line: 'Cloning e8-other…' })));
    expect(within(other).getByRole('status').textContent).toBe('Cloning e8-other…');
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'reloading' })));
    expect(within(other).getByRole('status').textContent).toBe('Reloading running sessions…');
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Successfully installed plugin: e8-other@e8-scratch (scope: project)' } }, reload: { sessions: [{ appSessionId: ID, outcome: 'reflected', error: null }] } })),
    );
    expect(within(other).getByRole('status').textContent).toBe('Successfully installed plugin: e8-other@e8-scratch (scope: project) · Reloaded in 1 session · reflected');
  });

  it('the switch asks first and stands where the next read puts it, never where the outcome suggests', async () => {
    await ready();
    const toggle = () => within(row('e8-probe@e8-scratch')).getByRole('switch', { name: 'Enabled: e8-probe@e8-scratch' });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle());
    await resolved();
    expect(within(sheet()).getByRole('heading', { name: 'Disable e8-probe@e8-scratch?' })).toBeTruthy();
    expect(argvShown()).toEqual(['plugin', 'disable', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(invoked('plugins.disable')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
    // the CLI says it disabled the plugin, but the read that follows still lists it enabled: the switch stays on
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(2));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'disable', phase: 'done', outcome: { ok: true, result: { message: 'Successfully disabled plugin: e8-probe (scope: user)' } }, reload: { sessions: [] } })));
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    // the next read lists it disabled: the switch moves with it
    installed = [plugin('e8-probe@e8-scratch', { enabled: false })];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
    expect(row('e8-probe@e8-scratch').textContent).toContain('user · disabled · e8-scratch');
  });

  it('a marketplace-declared command opens a second sheet whose Run it reruns with --accept-command only', async () => {
    await ready();
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.update')).toHaveLength(1));
    const shownCommand = { sha256: SHA, command: 'npx fetch-helper', kind: 'command-source' };
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'update', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message: 'This plugin runs a command its marketplace declares', failureCode: 'command_source_refused', shownCommand } } })));
    await waitFor(() => expect(within(sheet()).getByRole('heading', { name: 'Run the command e8-probe@e8-scratch declares?' })).toBeTruthy());
    await resolved();
    expect(sheet().querySelector('[data-plugins-declared]')!.textContent).toBe('npx fetch-helper');
    expect(argvShown()).toEqual(['plugin', 'update', 'e8-probe@e8-scratch', '--scope', 'user', '--accept-command', SHA, '--json']);
    // beneath the modal sheet, the row says why the CLI stopped
    expect(row('e8-probe@e8-scratch').querySelector('[role="status"]')!.textContent).toBe('This plugin runs a command its marketplace declares · command_source_refused');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Run it' }));
    await waitFor(() => expect(invoked('plugins.update')).toHaveLength(2));
    expect(invoked('plugins.update')[1]).toEqual({ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user', acceptCommand: SHA });
    expect(JSON.stringify(backend.calls)).not.toContain('"-y"');
  });

  it('an uninstall asks for the acknowledgement, and its result outlives the row the change removed', async () => {
    await ready();
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Uninstall…' }));
    await resolved();
    const confirm = within(sheet()).getByRole('button', { name: 'Uninstall' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.submit(confirm.closest('form')!); // Enter alone never destroys
    expect(invoked('plugins.uninstall')).toEqual([]);
    expect(within(sheet()).getByText(`${HOME}/plugins/data/e8-probe@e8-scratch/`)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(confirm);
    await waitFor(() => expect(invoked('plugins.uninstall')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
    installed = [];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(section('installed').querySelector('[data-plugin-row]')).toBeNull());
    expect(within(section('installed')).getByText('No plugins installed')).toBeTruthy();
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: e8-probe (scope: user)' } }, reload: { sessions: [{ appSessionId: ID, outcome: 'not_reflected', error: null }] } })),
    );
    const gone = section('installed').querySelector<HTMLElement>('[data-plugin-result="e8-probe@e8-scratch"]')!;
    expect(within(gone).getByRole('status').textContent).toBe(
      `Successfully uninstalled plugin: e8-probe (scope: user) · Reloaded in 1 session · not reflected in ${ID} · a project setting may override it`,
    );
    // Reload again runs reload_plugins for this session
    fireEvent.click(within(gone).getByRole('button', { name: 'Reload again' }));
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1));
  });

  it('adds a chosen folder as a marketplace and shows the engine’s failure in red with its code', async () => {
    backend.script('layout.pickFiles', () => ({ files: [{ path: '/tmp/e8-does-not-exist', name: 'e8-does-not-exist', bytes: 0, mediaType: 'inode/directory', data: null }] }));
    await ready();
    fireEvent.click(within(section('marketplaces')).getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(within(section('marketplaces')).getByRole('textbox', { name: 'Add marketplace' })).toHaveProperty('value', '/tmp/e8-does-not-exist'));
    expect(invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: null, multiple: false }]);
    fireEvent.click(within(section('marketplaces')).getByRole('button', { name: 'Add…' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'add', '/tmp/e8-does-not-exist', '--json']);
    expect(within(sheet()).getByText('Nothing to reload: an added marketplace loads no plugin')).toBeTruthy();
    expect(within(sheet()).queryByRole('radio')).toBeNull();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(invoked('marketplaces.add')).toEqual([{ cwd, binary: BINARY, source: '/tmp/e8-does-not-exist' }]));
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', action: 'marketplace-add', target: '/tmp/e8-does-not-exist', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message: 'Path does not exist: /tmp/e8-does-not-exist', failureCode: 'invalid_source', shownCommand: null } } })),
    );
    const line = within(section('marketplaces')).getByRole('status');
    expect(line.textContent).toBe('Path does not exist: /tmp/e8-does-not-exist · invalid_source');
    expect(line.className).toContain('text-danger');
  });

  it('an install whose plugin left the catalogue keeps the engine’s failure under Available after the row leaves (M3: the widgets gate)', async () => {
    await ready();
    fireEvent.click(within(section('available')).getByText('Available'));
    fireEvent.click(await waitFor(() => within(section('available')).getByText('e8-scratch · 2 plugins')));
    const other = await waitFor(() => section('available').querySelector<HTMLElement>('[data-plugin-row="e8-other@e8-scratch"]')!);
    fireEvent.click(within(other).getByRole('button', { name: 'Install…' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(invoked('plugins.install')).toHaveLength(1));
    // the catalogue read again after the CLI ended no longer offers it (a folder marketplace is read in place)
    backend.script('plugins.available', () => ({ plugins: [{ pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'The probe', version: '0.1.0', source: null, installCount: null }] }));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(within(section('available')).getByText('e8-scratch · 1 plugin')).toBeTruthy());
    expect(section('available').querySelector('[data-plugin-row="e8-other@e8-scratch"]')).toBeNull();
    const message = 'Plugin "e8-other" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.';
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message, failureCode: 'not_found', shownCommand: null } } })));
    const gone = section('available').querySelector<HTMLElement>('[data-plugin-result="e8-other@e8-scratch"]')!;
    expect(gone).toBeTruthy();
    const line = within(gone).getByRole('status');
    expect(line.textContent).toBe(`${message} · not_found`);
    expect(line.className).toContain('text-danger');
  });

  it('refreshes and removes a marketplace through its sheet, the removal behind the acknowledgement', async () => {
    await ready();
    const market = () => section('marketplaces').querySelector<HTMLElement>('[data-marketplace-row="e8-scratch"]')!;
    fireEvent.click(within(market()).getByRole('button', { name: 'Refresh' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'update', 'e8-scratch', '--json']);
    expect(within(sheet()).getByText(`${HOME}/plugins/known_marketplaces.json`)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(invoked('marketplaces.update')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'marketplace-update', target: 'e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Validating local marketplace\nSuccessfully updated marketplace: e8-scratch' } }, reload: { sessions: [] } })));
    expect(within(market()).getByRole('status').textContent).toBe('Validating local marketplace\nSuccessfully updated marketplace: e8-scratch · No running session to reload');
    fireEvent.click(within(market()).getByRole('button', { name: 'Remove…' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'remove', 'e8-scratch', '--json']);
    expect(within(sheet()).getByRole('button', { name: 'Remove' })).toHaveProperty('disabled', true);
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoked('marketplaces.remove')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
  });

  it('Stop asks the host to cancel the running CLI', async () => {
    await ready();
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Stop' })).toBeTruthy());
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(invoked('plugins.cancel')).toEqual([{ opId: 'pop-1' }]));
  });
});

// M2 review: the sheet never confirms against a guessed engine; one id at two scopes is two rows; a change during an
// in-flight listing is read again after it.
describe('plugins widget: review fixes', () => {
  const deferred = <T,>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('while plugins.env is pending the sheet says Resolving the engine… and cannot be confirmed', async () => {
    backend.script('plugins.env', () => new Promise(() => {})); // never answers
    await ready();
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    expect(within(sheet()).getByText('Resolving the engine…')).toBeTruthy();
    expect(sheet().querySelector('[data-plugins-argv]')).toBeNull(); // no command against a guessed binary
    const confirm = within(sheet()).getByRole('button', { name: 'Update' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.submit(confirm.closest('form')!);
    expect(invoked('plugins.update')).toEqual([]);
  });

  it('when plugins.env fails the sheet shows the refusal and never enables', async () => {
    backend.script('plugins.env', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'engine binary missing at /nope/claude' });
    });
    await ready();
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(within(sheet()).getByRole('alert').textContent).toBe('engine binary missing at /nope/claude'));
    const confirm = within(sheet()).getByRole('button', { name: 'Update' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.submit(confirm.closest('form')!);
    expect(invoked('plugins.update')).toEqual([]);
  });

  it('an answer with no binary is unresolved: the probe’s refusal, no command, no submit; the next sheet reads again and recovers', async () => {
    const REFUSAL = "Claude Code is not installed: nothing at /Users/me/.local/bin/claude and no claude on your login shell's PATH. Install it, or choose a binary in Settings › Engine.";
    let installedEngine = false;
    backend.script('plugins.env', () => (installedEngine ? { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: GLOBAL } : { binary: null, binaryError: REFUSAL, configHome: HOME, globalConfig: GLOBAL }));
    await ready();
    await waitFor(() => expect(invoked('plugins.env')).toHaveLength(1));
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(within(sheet()).getByRole('alert').textContent).toBe(REFUSAL));
    expect(invoked('plugins.env')).toHaveLength(2); // the opening read it again
    expect(sheet().querySelector('[data-plugins-argv]')).toBeNull();
    expect(within(sheet()).queryByRole('list', { name: "The engine's CLI writes:" })).toBeNull();
    const confirm = within(sheet()).getByRole('button', { name: 'Update' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.submit(confirm.closest('form')!);
    expect(invoked('plugins.update')).toEqual([]);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the owner installed the engine meanwhile: the next sheet's read finds it
    installedEngine = true;
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(argvShown()).toEqual(['plugin', 'update', 'e8-probe@e8-scratch', '--scope', 'user', '--json']));
    expect(within(sheet()).getByText('2.1.290 plugin update e8-probe@e8-scratch --scope user --json')).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.update')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
  });

  it('one id installed at two scopes is two rows: an action busies only its own, and removing one leaves the other', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: cwd })];
    await ready();
    const rows = () => [...section('installed').querySelectorAll<HTMLElement>('[data-plugin-row="e8-probe@e8-scratch"]')];
    const at = (scope: string) => section('installed').querySelector<HTMLElement>(`[data-plugin-row="e8-probe@e8-scratch"][data-plugin-scope="${scope}"]`)!;
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(at('project')).getByRole('button', { name: 'Uninstall…' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'uninstall', 'e8-probe@e8-scratch', '--scope', 'project', '--json']);
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(within(at('project')).getByRole('status').textContent).toBe('Working…'));
    expect(within(at('project')).getByRole('button', { name: 'Update' })).toHaveProperty('disabled', true);
    expect(within(at('user')).getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false);
    expect(within(at('user')).queryByRole('status')).toBeNull();
    installed = [plugin('e8-probe@e8-scratch')];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(at('user')).toBeTruthy();
    expect(within(at('user')).queryByRole('status')).toBeNull(); // the user-scope row holds no word of the removal
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: e8-probe (scope: project)' } }, reload: { sessions: [] } })));
    const gone = section('installed').querySelector<HTMLElement>('[data-plugin-result="e8-probe@e8-scratch"]')!;
    expect(gone.getAttribute('data-plugin-scope')).toBe('project');
    expect(within(gone).getByRole('status').textContent).toBe('Successfully uninstalled plugin: e8-probe (scope: project) · No running session to reload');
    expect(within(at('user')).queryByRole('status')).toBeNull();
  });

  it('a change that arrives while a listing is in flight is read again once that listing settles', async () => {
    await ready();
    const toggle = () => within(row('e8-probe@e8-scratch')).getByRole('switch', { name: 'Enabled: e8-probe@e8-scratch' });
    const stale = deferred<{ plugins: InstalledPlugin[] }>();
    let reads = 1;
    backend.script('plugins.list', () => (++reads === 2 ? stale.promise : { plugins: installed }));
    act(() => emit('plugins.changed', {})); // a first change: read 2 starts and hangs
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(2));
    installed = [plugin('e8-probe@e8-scratch', { enabled: false })];
    act(() => emit('plugins.changed', {})); // a second change while read 2 is in flight
    act(() => stale.resolve({ plugins: [plugin('e8-probe@e8-scratch')] })); // read 2 answers the state before the change
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(3));
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'));
  });
});

describe('plugins widget: whole-branch review fixes', () => {
  const OTHER = '/opt/claude/versions/2.1.300'; // the binary Settings › Engine chose after the widget first read plugins.env

  it('every sheet reads plugins.env again and waits for the answer; the confirmed change names the binary the sheet showed', async () => {
    let held: ((value: unknown) => void) | null = null;
    let holding = false;
    backend.script('plugins.env', () => (holding ? new Promise((resolve) => (held = resolve)) : { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: GLOBAL }));
    await ready();
    await waitFor(() => expect(invoked('plugins.env')).toHaveLength(1)); // the opening read answered
    const before = invoked('plugins.env').length;
    holding = true; // the next read waits
    fireEvent.click(within(row('e8-probe@e8-scratch')).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.env')).toHaveLength(before + 1));
    expect(within(sheet()).getByText('Resolving the engine…')).toBeTruthy(); // not the answer read before
    expect(sheet().querySelector('[data-plugins-argv]')).toBeNull();
    await waitFor(() => expect(held).not.toBeNull());
    act(() => held!({ binary: OTHER, binaryError: null, configHome: HOME, globalConfig: GLOBAL }));
    await waitFor(() => expect(within(sheet()).getByText('2.1.300 plugin update e8-probe@e8-scratch --scope user --json')).toBeTruthy());
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.update')).toEqual([{ cwd, binary: OTHER, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
  });

  it('an installation of another project is read-only here: its row names the project and offers no switch, Update or Uninstall', async () => {
    // `plugin list` from this project reports another project's installation with this project's enabled state, so no
    // action is offered for it (E8 whole-branch review, round two)
    installed = [plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/other', enabled: false }), plugin('e8-tools@e8-scratch', { scope: 'project', projectPath: cwd })];
    await ready();
    const elsewhere = row('e8-probe@e8-scratch');
    expect(elsewhere.textContent).toContain('In /work/other · manage it from a session there');
    expect(elsewhere.textContent).not.toContain('disabled'); // the state this listing reports for it is not its own
    expect(within(elsewhere).queryByRole('switch')).toBeNull();
    expect(within(elsewhere).queryByRole('button')).toBeNull();
    // this project's own installation keeps its actions and needs no naming
    const own = row('e8-tools@e8-scratch');
    expect(own.textContent).not.toContain('In ');
    expect(within(own).getByRole('switch', { name: 'Enabled: e8-tools@e8-scratch' })).toBeTruthy();
    fireEvent.click(within(own).getByRole('button', { name: 'Uninstall…' }));
    await waitFor(() => expect(argvShown()).toEqual(['plugin', 'uninstall', 'e8-tools@e8-scratch', '--scope', 'project', '--json']));
    expect(within(sheet()).getByText(`In ${cwd}`)).toBeTruthy();
  });

  it('removing a marketplace names the installed plugins it uninstalls and the files that writes, behind the acknowledgement', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-tools@e8-scratch', { scope: 'project', projectPath: '/work/other' }), plugin('review@anthropic-plugin-directory')];
    await ready();
    const market = section('marketplaces').querySelector<HTMLElement>('[data-marketplace-row="e8-scratch"]')!;
    fireEvent.click(within(market).getByRole('button', { name: 'Remove…' }));
    await waitFor(() => expect(argvShown()).toEqual(['plugin', 'marketplace', 'remove', 'e8-scratch', '--json']));
    expect(within(sheet()).getByText('Also uninstalls 2 plugins: e8-probe@e8-scratch (user), e8-tools@e8-scratch (project, /work/other)')).toBeTruthy();
    const writes = within(within(sheet()).getByRole('list', { name: "The engine's CLI writes:" })).getAllByRole('listitem').map((item) => item.textContent);
    expect(writes).toEqual([
      `${HOME}/settings.json`,
      `${HOME}/plugins/known_marketplaces.json`,
      `${HOME}/plugins/installed_plugins.json`,
      `${HOME}/plugins/cache/e8-scratch/`,
      `${HOME}/plugins/data/e8-probe@e8-scratch/`,
      `${HOME}/plugins/data/e8-tools@e8-scratch/`,
      '/work/other/.claude/settings.json',
      '/work/other/.claude/settings.local.json',
      `${cwd}/.claude/settings.json`,
      `${cwd}/.claude/settings.local.json`,
    ]);
    expect(within(sheet()).getByText('and any enable or disable override for them in these settings files')).toBeTruthy();
    const confirm = within(sheet()).getByRole('button', { name: 'Remove' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(confirm);
    await waitFor(() => expect(invoked('marketplaces.remove')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
  });
});
