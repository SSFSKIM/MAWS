// `/plugins` over the fixture-backed widget backend (C11) with the E8 plugin CLI stood in by scripted answers: the
// three CLI reads, the manifest read (P2-B), the operations' receipts, and `plugins.operation` / `plugins.changed`
// emitted by the test as the engine host would emit them. Nothing here runs a CLI or touches a config home. P2-B M3:
// the library (My items' rows by plugin, the row overflow's Turn on or off, Update and Uninstall…, the loaded line);
// M5: Browse (its catalogue read on its click; cards, Install, the installed join) and the Add menu's two marketplace dialogs.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EventName, MawsBridge } from '@shared/ipc/schema';
import type { Availability } from '@shared/ipc/schema/session';
import type { InstalledPlugin, ManifestItemRef, PluginManifestView, PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { commandLine } from '@shared/plugins/cli';
import { digest, record } from '../../../../test/support/builders';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerFocusTarget } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import type { BuiltInModsState } from './plugins/builtin-mods';
import { useLibraryStore } from './plugins/library-store';
import { PluginsWidget } from './PluginsWidget';
import { useReadLoads } from './read';

// P2-C's `mods.list` stood in (X20): no rows unless a case gives some
const NO_MODS = (): BuiltInModsState => ({ read: { state: 'ready', rows: [] }, failure: null, setEnabled: async () => {}, setOverride: async () => {} });
const mods = vi.hoisted(() => ({ hook: null as unknown as BuiltInModsState }));
vi.mock('./plugins/builtin-mods', () => ({ useBuiltInMods: () => mods.hook }));

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

// What the host reads from a plugin's files (P2-B §5.5): e8-probe names its author and description.
const manifestOf = (key: ManifestItemRef): PluginManifestView => ({
  key,
  state: 'read',
  name: null,
  displayName: null,
  version: null,
  marketplaceVersion: null,
  description: key.kind === 'installation' && key.id === 'e8-probe@e8-scratch' ? 'One skill and one command, for the probe' : null,
  author: key.kind === 'installation' && key.id === 'e8-probe@e8-scratch' ? 'E8' : null,
  license: null,
  keywords: [],
  components: { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [{ name: 'e8-hello', description: null }] },
  partial: false,
  problems: [],
});

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
  backend.script('plugins.manifest', (input) => ({ manifests: (input as { items: ManifestItemRef[] }).items.map((key) => manifestOf(key)) }));
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
  mods.hook = NO_MODS();
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
  useReadLoads.setState({ loads: new Map() });
  useLibraryStore.setState(useLibraryStore.getInitialState());
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
const row = (id: string) => section('my-items').querySelector<HTMLElement>(`[data-plugin-row="${id}"]`)!;
const loadedLine = () => document.querySelector<HTMLElement>('[data-plugins-loaded]')!;
// The row's overflow (Desktop's ⋮): Turn on or off, Update, Uninstall…
const menu = (id: string, item: string) => {
  fireEvent.keyDown(within(row(id)).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};
const menuItems = (id: string) => {
  fireEvent.keyDown(within(row(id)).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
  fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
  return items;
};
const sheet = () => document.querySelector<HTMLElement>('[data-plugins-sheet]')!; // E8's confirm sheet, above a marketplace dialog when one is open
const argvShown = () => JSON.parse(sheet().querySelector('[data-plugins-argv]')!.getAttribute('data-plugins-argv')!) as string[];
// Every sheet reads plugins.env again on opening and names its command once that read answered.
const resolved = () => waitFor(() => expect(sheet().querySelector('[data-plugins-argv]')).toBeTruthy());
const event = (over: Partial<PluginsOperationEvent> & Pick<PluginsOperationEvent, 'opId' | 'phase'>): PluginsOperationEvent => ({ action: 'install', target: 'e8-probe@e8-scratch', ...over });
const ready = async () => {
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
  mount();
  await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
  await waitFor(() => expect(invoked('marketplaces.list').length).toBeGreaterThan(0));
  await act(async () => {}); // its answer drawn
};
// P2-B M5: Browse (its catalogue read on its click), its cards, the Add menu and the two marketplace dialogs.
const toBrowse = async () => {
  fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
  await waitFor(() => expect(section('browse').querySelector('[data-browse-card]')).toBeTruthy());
};
const card = (id: string) => section('browse').querySelector<HTMLElement>(`[data-browse-card="${id}"]`)!;
const openAdd = (item: 'Add marketplace' | 'Manage marketplaces') => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};
const addDialog = () => document.querySelector<HTMLElement>('[data-marketplaces-dialog="add"]')!;
const manageDialog = () => document.querySelector<HTMLElement>('[data-marketplaces-dialog="manage"]')!;
const marketRow = (name: string) => manageDialog().querySelector<HTMLElement>(`[data-marketplace-row="${name}"]`)!;
const marketMenu = (name: string, item: string) => {
  fireEvent.keyDown(within(marketRow(name)).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};
const marketItems = (name: string) => {
  fireEvent.keyDown(within(marketRow(name)).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
  const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
  fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
  return items;
};
// happy-dom has no layout: give Browse's scroller a viewport so the virtualised grid mounts its rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-browse-scroller') ? 600 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

describe('plugins widget: loaded in this session and the reloads', () => {
  it('says how many plugins a ready process loaded, now; its count shows them, credited, beside the installed rows', async () => {
    await ready();
    expect(loadedLine().textContent).toContain('11 plugins loaded in this session');
    expect(loadedLine().textContent).toContain('Loaded now');
    expect(invoked('plugins.list')).toEqual([{ cwd }]);
    expect(invoked('marketplaces.list')).toEqual([{ cwd }]);
    // the manifest request derives from the listing: the representative installation of each plugin
    await waitFor(() => expect(invoked('plugins.manifest')).toEqual([{ cwd, items: [{ kind: 'installation', id: 'e8-probe@e8-scratch', scope: 'user', projectPath: null }] }]));
    fireEvent.click(within(loadedLine()).getByRole('button', { name: '11 plugins loaded in this session' }));
    const list = screen.getByRole('list', { name: 'Loaded plugins' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(11); // none of them is a plugin the CLI lists here
    expect(within(list).getAllByText('Built into Claude Code')).toHaveLength(3);
    expect(within(list).getByText('Loaded from a folder')).toBeTruthy(); // the skills directory's chatgpt-advisor
    expect(row('e8-probe@e8-scratch')).toBeNull(); // installed, not loaded in this session
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
    expect(loadedLine().textContent).toContain('11 plugins loaded in this session');
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

  // P2-A (its §5.5 to §5.7): the line reads A's observed facts and availability; Refresh is A's
  const exited = (over: Parameters<typeof record>[1] = {}, availability: Availability = 'resumable') =>
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]), records: new Map([[ID, record(ID, { directory: cwd, ...over })]]), digests: new Map([[ID, digest(ID, { availability })]]) });
  const starts = () => backend.calls.map((c) => c.command).filter((command) => /^session\.(acquire|start|resume|launch)/.test(command));

  it('on an exited session starts nothing, offers no reload, lists the plugins it last reported as loaded last time, with Refresh, and still manages plugins through the CLI', async () => {
    exited();
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(loadedLine().getAttribute('data-loaded-freshness')).toBe('last');
    expect(loadedLine().textContent).toMatch(/^11 plugins loaded in this session·Loaded last time, [^·]+Refresh$/);
    expect(screen.queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    expect(screen.queryByText(/not running/)).toBeNull();
    expect(menuItems('e8-probe@e8-scratch')).toEqual(['Turn off', 'Update', 'Uninstall…']);
    fireEvent.click(within(loadedLine()).getByRole('button', { name: '11 plugins loaded in this session' }));
    expect(within(screen.getByRole('list', { name: 'Loaded plugins' })).getAllByRole('listitem')).toHaveLength(11);
    // opening /plugins acquires nothing (A's G5): no acquisition, start or launch of any kind
    expect(starts()).toEqual([]);
  });

  it('Refresh on an exited session acquires it for a read, then reloads its plugins: the line reads Loaded now', async () => {
    exited();
    backend.script('session.acquire', () => {
      setTimeout(() => act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) })), 0);
      return new Promise((resolve) => setTimeout(() => resolve({ status: 'ready', appSessionId: ID, launched: true, joined: false }), 5));
    });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    fireEvent.click(within(loadedLine()).getByRole('button', { name: 'Refresh' }));
    expect(loadedLine().textContent).toContain('Starting…');
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1));
    expect(invoked('session.acquire')).toEqual([{ appSessionId: ID, reason: 'read' }]);
    await waitFor(() => expect(loadedLine().textContent).toContain('Loaded now'));
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();
  });

  it('Refresh says a reload the host refused, and a reload that failed after the start, on the line', async () => {
    const acquireReady = () =>
      backend.script('session.acquire', () => {
        act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) }));
        return { status: 'ready', appSessionId: ID, launched: true, joined: false };
      });
    exited();
    acquireReady();
    const unscript = backend.script('session.reloadPlugins', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'the host did not answer' });
    });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    fireEvent.click(within(loadedLine()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(within(loadedLine()).getByRole('alert').textContent).toBe('The engine did not answer · showing the last value it reported'));
    cleanup();
    unscript();
    exited();
    acquireReady();
    backend.scriptOutcome('session.reloadPlugins', () => ({ ok: false, error: { code: 'timeout', message: 'reload_plugins unanswered after 60 s', engineCode: null } }));
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    fireEvent.click(within(loadedLine()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(within(loadedLine()).getByRole('alert').textContent).toBe('reload_plugins unanswered after 60 s · timeout'));
  });

  it('an acquisition that cannot be asked at all (main or the host unreachable) says so on the line, and reloads nothing', async () => {
    exited();
    backend.script('session.acquire', () => {
      throw new WidgetBackendError({ code: 'host_unavailable', message: 'the engine host is not running' });
    });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    fireEvent.click(within(loadedLine()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadedLine().textContent).toContain('the engine host is not running'));
    expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toEqual([]);
  });

  it('a session a terminal holds shows its last list read-only, the holder named and its actions in place of Refresh', async () => {
    exited({ holder: { kind: 'terminal', pid: 4711 } }, 'foreign_held');
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(loadedLine().textContent).toContain('11 plugins loaded in this session');
    expect(within(loadedLine()).getByText('Held by terminal · 4711')).toBeTruthy();
    expect(within(loadedLine()).getByRole('button', { name: 'Take over here' })).toBeTruthy();
    expect(within(loadedLine()).getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
    expect(within(loadedLine()).queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(starts()).toEqual([]);
  });

  it('a ready process that has not reported its plugins yet (a start with no turn), with nothing observed before, says Not observed yet in the line and the detail', async () => {
    // the engine reports no plugins until its first system/init: nothing was observed, so nothing reads as loaded now
    backend.script('session.observedFacts', () => null);
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'ready', plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null }]]) });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    await waitFor(() => expect(invoked('session.observedFacts')).toEqual([{ appSessionId: ID }]));
    expect(loadedLine().textContent).toContain('Not observed yet');
    expect(loadedLine().textContent).not.toContain('loaded in this session');
    expect(loadedLine().textContent).not.toContain('Loaded now');
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy(); // the process is ready: its reloads stay
    fireEvent.click(within(section('my-items')).getByRole('button', { name: 'View E8 probe' }));
    expect(document.querySelector('[data-plugin-fact="loaded"]')!.textContent).toBe('Not observed yet');
  });

  it('Show › Loaded in this session with nothing observed says it is unknown, never that nothing matches (scale review D scalpel-2#1)', async () => {
    backend.script('session.observedFacts', () => null);
    useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'loaded' } }));
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'ready', plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null }]]) });
    mount();
    await waitFor(() => expect(invoked('session.observedFacts')).toEqual([{ appSessionId: ID }]));
    const unknown = await waitFor(() => within(section('my-items')).getByText('What this session loaded is not observed yet.'));
    expect(within(section('my-items')).queryByText('Nothing matches these filters.')).toBeNull();
    fireEvent.click(within(unknown.closest<HTMLElement>('[role="status"]')!).getByRole('button', { name: 'Show all plugins' }));
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(useLibraryStore.getState().plugins.filter).toBe('all');
  });

  it('a ready process whose report lists only a problem still counts it, loaded now', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'ready', plugins: [], pluginErrors: [{ plugin: 'd', type: 'load', message: 'bad manifest', path: null }], pluginWarnings: [] }]]) });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(loadedLine().textContent).toContain('0 plugins loaded in this session');
    expect(loadedLine().textContent).toContain('Loaded now');
    expect(loadedLine().textContent).toContain('1 problem');
  });

  it('a session MAWS has never run reads Not observed yet with Refresh, and still lists its plugins from its directory', async () => {
    backend.script('session.observedFacts', () => null);
    useSessions.setState({ records: new Map([[ID, record(ID, { directory: cwd })]]), digests: new Map([[ID, digest(ID, { availability: 'resumable' })]]) });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    await waitFor(() => expect(invoked('session.observedFacts')).toEqual([{ appSessionId: ID }]));
    expect(loadedLine().textContent).toBe('Not observed yetRefresh');
    expect(screen.queryByText(/not running|loaded no plugins/)).toBeNull();
    expect(starts()).toEqual([]);
  });

  it('says it could not load the plugins in the CLI’s words, with Retry reading them again', async () => {
    let refuse = true;
    backend.script('plugins.list', () => {
      if (refuse) throw new WidgetBackendError({ code: 'internal', message: 'Path does not exist: /nope' });
      return { plugins: installed };
    });
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toContain("Couldn't load your plugins.");
    expect(alert.textContent).toContain('Path does not exist: /nope');
    refuse = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('plugins widget: management', () => {
  it('lists installed plugins; Browse reads the catalogue only on its click, never on opening, and rereads it on a change only while it shows', async () => {
    await ready();
    const probe = row('e8-probe@e8-scratch');
    expect(probe.getAttribute('data-plugin-scope')).toBe('user');
    expect(probe.closest('[data-plugins-group]')!.getAttribute('data-plugins-group')).toBe('added');
    expect(probe.textContent).toContain('E8 probe');
    expect(probe.textContent).toContain('0.1.0');
    await waitFor(() => expect(probe.textContent).toContain('by E8 · One skill and one command, for the probe'));
    expect(probe.textContent).not.toContain('Disabled');
    expect(screen.getByRole('radio', { name: 'My items' }).getAttribute('aria-checked')).toBe('true');
    expect(invoked('plugins.available')).toEqual([]); // never on opening /plugins
    await toBrowse();
    expect(invoked('plugins.available')).toEqual([{ cwd }]);
    // sections: Anthropic & Partners first, then each other marketplace; the installed e8-probe joined back in, Installed
    expect([...section('browse').querySelectorAll('[data-browse-section]')].map((s) => s.getAttribute('data-browse-section'))).toEqual(['anthropic', 'marketplace:e8-scratch']);
    expect(card('review@anthropic-plugin-directory').getAttribute('data-section')).toBe('anthropic');
    expect(within(card('e8-other@e8-scratch')).getByRole('button', { name: 'Install' })).toBeTruthy();
    expect(within(card('e8-other@e8-scratch')).getByText('from e8-scratch')).toBeTruthy();
    expect(within(card('e8-probe@e8-scratch')).queryByRole('button', { name: 'Install' })).toBeNull();
    expect(within(card('e8-probe@e8-scratch')).getByText('Installed')).toBeTruthy();
    expect(section('browse').querySelector('[data-install-count]')).toBeNull(); // no row carries a count
    // Browse's own search
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'review' } });
    expect([...section('browse').querySelectorAll('[data-browse-card]')].map((c) => c.getAttribute('data-browse-card'))).toEqual(['review@anthropic-plugin-directory']);
    // a change rereads the lists, and the catalogue while Browse shows
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.available')).toHaveLength(2));
    expect(invoked('plugins.list')).toHaveLength(2);
    expect(invoked('marketplaces.list')).toHaveLength(2);
    // on My items, the catalogue keeps its answer; the change it missed is read once Browse shows again
    fireEvent.click(screen.getByRole('radio', { name: 'My items' }));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(3));
    expect(invoked('plugins.available')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
    await waitFor(() => expect(invoked('plugins.available')).toHaveLength(3));
  });

  it('Cancel on the confirm sheet runs nothing; a card’s Install runs the argument list the sheet showed, at the scope chosen', async () => {
    await ready();
    await toBrowse();
    const other = () => card('e8-other@e8-scratch');

    fireEvent.click(within(other()).getByRole('button', { name: 'Install' }));
    expect(sheet().getAttribute('data-plugins-sheet')).toBe('install');
    expect(within(sheet()).getByRole('heading', { name: 'Install e8-other@e8-scratch?' })).toBeTruthy();
    expect(section('browse').querySelector('[data-browse-detail]')).toBeNull(); // Install keeps its own click
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invoked('plugins.install')).toEqual([]);

    fireEvent.click(within(other()).getByRole('button', { name: 'Install' }));
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

    await waitFor(() => expect(within(other()).getByRole('status').textContent).toBe('Working…'));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'started' })));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'output', line: 'Cloning e8-other…' })));
    expect(within(other()).getByRole('status').textContent).toBe('Cloning e8-other…');
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'reloading' })));
    expect(within(other()).getByRole('status').textContent).toBe('Reloading running sessions…');
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Successfully installed plugin: e8-other@e8-scratch (scope: project)' } }, reload: { sessions: [{ appSessionId: ID, outcome: 'reflected', error: null }] } })),
    );
    expect(within(other()).getByRole('status').textContent).toBe('Successfully installed plugin: e8-other@e8-scratch (scope: project) · Reloaded in 1 session · reflected');
    // the engine's listing leaves it out once installed; the installed identity's card keeps the result
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-other@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true })];
    backend.script('plugins.available', () => ({ plugins: [{ pluginId: 'review@anthropic-plugin-directory', name: 'review', marketplaceName: 'anthropic-plugin-directory', description: 'Code review', version: '1.0.0', source: null, installCount: null }] }));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(other().getAttribute('data-installed')).toBe('here'));
    expect(within(other()).getByRole('status').textContent).toBe('Successfully installed plugin: e8-other@e8-scratch (scope: project) · Reloaded in 1 session · reflected');
  });

  it('Turn off asks first, and the row stands where the next read puts it, never where the outcome suggests', async () => {
    await ready();
    const disabled = () => within(row('e8-probe@e8-scratch')).queryByText('Disabled') !== null;
    expect(disabled()).toBe(false);
    menu('e8-probe@e8-scratch', 'Turn off');
    await resolved();
    expect(within(sheet()).getByRole('heading', { name: 'Disable e8-probe@e8-scratch?' })).toBeTruthy();
    expect(argvShown()).toEqual(['plugin', 'disable', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(invoked('plugins.disable')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
    // the CLI says it disabled the plugin, but the read that follows still lists it enabled: the row says so
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(2));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'disable', phase: 'done', outcome: { ok: true, result: { message: 'Successfully disabled plugin: e8-probe (scope: user)' } }, reload: { sessions: [] } })));
    expect(disabled()).toBe(false);
    expect(menuItems('e8-probe@e8-scratch')[0]).toBe('Turn off');
    // the next read lists it disabled: the row moves with it
    installed = [plugin('e8-probe@e8-scratch', { enabled: false })];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(disabled()).toBe(true));
    expect(menuItems('e8-probe@e8-scratch')[0]).toBe('Turn on');
  });

  it('a marketplace-declared command opens a second sheet whose Run it reruns with --accept-command only', async () => {
    await ready();
    menu('e8-probe@e8-scratch', 'Update');
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
    menu('e8-probe@e8-scratch', 'Uninstall…');
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
    await waitFor(() => expect(section('my-items').querySelector('[data-plugin-row]')).toBeNull());
    expect(within(section('my-items')).getByText('Add your first plugins')).toBeTruthy();
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: e8-probe (scope: user)' } }, reload: { sessions: [{ appSessionId: ID, outcome: 'not_reflected', error: null }] } })),
    );
    const gone = section('my-items').querySelector<HTMLElement>('[data-plugin-result="e8-probe@e8-scratch"]')!;
    expect(within(gone).getByRole('status').textContent).toBe(
      `Successfully uninstalled plugin: e8-probe (scope: user) · Reloaded in 1 session · not reflected in ${ID} · a project setting may override it`,
    );
    // Reload again runs reload_plugins for this session
    fireEvent.click(within(gone).getByRole('button', { name: 'Reload again' }));
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1));
  });

  it('Add marketplace: Desktop’s trust warning and one Source field; a chosen folder, E8’s sheet, and the engine’s failure in red with its code', async () => {
    backend.script('layout.pickFiles', () => ({ files: [{ path: '/tmp/e8-does-not-exist', name: 'e8-does-not-exist', bytes: 0, mediaType: 'inode/directory', data: null }] }));
    await ready();
    openAdd('Add marketplace');
    const dialog = addDialog();
    expect(within(dialog).getByRole('heading', { name: 'Add marketplace' })).toBeTruthy();
    expect(within(dialog).getByRole('note').textContent).toContain('Make sure you trust a plugin before installing, updating, or using it.');
    const field = within(dialog).getByRole('textbox', { name: 'Source' });
    expect(field.getAttribute('placeholder')).toBe('owner/repo, URL or folder');
    expect(within(dialog).getByText('A GitHub owner/repo, a Git repository URL or a folder on this Mac.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true); // nothing typed
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(field).toHaveProperty('value', '/tmp/e8-does-not-exist'));
    expect(invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: null, multiple: false }]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'add', '/tmp/e8-does-not-exist', '--json']);
    expect(within(sheet()).getByText('Nothing to reload: an added marketplace loads no plugin')).toBeTruthy();
    expect(within(sheet()).queryByRole('radio')).toBeNull();
    expect(invoked('marketplaces.add')).toEqual([]); // nothing before the sheet's confirm
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(invoked('marketplaces.add')).toEqual([{ cwd, binary: BINARY, source: '/tmp/e8-does-not-exist' }]));
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', action: 'marketplace-add', target: '/tmp/e8-does-not-exist', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message: 'Path does not exist: /tmp/e8-does-not-exist', failureCode: 'invalid_source', shownCommand: null } } })),
    );
    const line = within(addDialog()).getByRole('status');
    expect(line.textContent).toBe('Path does not exist: /tmp/e8-does-not-exist · invalid_source');
    expect(line.className).toContain('text-danger');
    expect(within(addDialog()).getByRole('button', { name: 'Done' })).toBeTruthy(); // the dialog stays for another source
  });

  it('an install whose plugin left the catalogue keeps the engine’s failure above the grid after its card leaves (M3: the widgets gate)', async () => {
    await ready();
    await toBrowse();
    fireEvent.click(within(card('e8-other@e8-scratch')).getByRole('button', { name: 'Install' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(invoked('plugins.install')).toHaveLength(1));
    // the catalogue read again after the CLI ended no longer offers it (a folder marketplace is read in place)
    backend.script('plugins.available', () => ({ plugins: [{ pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'The probe', version: '0.1.0', source: null, installCount: null }] }));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(section('browse').querySelector('[data-browse-card="e8-other@e8-scratch"]')).toBeNull());
    const message = 'Plugin "e8-other" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.';
    act(() => emit('plugins.operation', event({ opId: 'pop-1', target: 'e8-other@e8-scratch', phase: 'done', outcome: { ok: false, error: { code: 'cli_failed', message, failureCode: 'not_found', shownCommand: null } } })));
    const gone = section('browse').querySelector<HTMLElement>('[data-plugin-result="e8-other@e8-scratch"]')!;
    expect(gone).toBeTruthy();
    const line = within(gone).getByRole('status');
    expect(line.textContent).toBe(`${message} · not_found`);
    expect(line.className).toContain('text-danger');
  });

  it('Manage marketplaces: Desktop’s copy, a row per marketplace with its source; Check for updates and Remove… through E8’s sheets; Done', async () => {
    await ready();
    openAdd('Manage marketplaces');
    await waitFor(() => expect(marketRow('e8-scratch')).toBeTruthy());
    const dialog = manageDialog();
    expect(within(dialog).getByRole('heading', { name: 'Manage marketplaces' })).toBeTruthy();
    expect(within(dialog).getByText('Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins.')).toBeTruthy();
    expect([...dialog.querySelectorAll('[data-marketplace-row]')].map((r) => r.getAttribute('data-marketplace-row'))).toEqual(['e8-scratch']); // never the built-in directory
    expect(marketRow('e8-scratch').textContent).toContain('/tmp/e8-scratch/market');
    expect(marketRow('e8-scratch').textContent).toContain('1 plugin installed');
    expect(marketItems('e8-scratch')).toEqual(['Check for updates', 'Remove…']);
    marketMenu('e8-scratch', 'Check for updates');
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'update', 'e8-scratch', '--json']);
    expect(within(sheet()).getByText(`${HOME}/plugins/known_marketplaces.json`)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(invoked('marketplaces.update')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'marketplace-update', target: 'e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Validating local marketplace\nSuccessfully updated marketplace: e8-scratch' } }, reload: { sessions: [] } })));
    expect(within(marketRow('e8-scratch')).getByRole('status').textContent).toBe('Validating local marketplace\nSuccessfully updated marketplace: e8-scratch · No running session to reload');
    marketMenu('e8-scratch', 'Remove…');
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'remove', 'e8-scratch', '--json']);
    expect(within(sheet()).getByText('Also uninstalls 1 plugin: e8-probe@e8-scratch (user)')).toBeTruthy();
    expect(within(sheet()).getByRole('button', { name: 'Remove' })).toHaveProperty('disabled', true);
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoked('marketplaces.remove')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
    // the marketplace leaves the next read; its result stays, and an empty list says so
    backend.script('marketplaces.list', () => ({ marketplaces: [] }));
    installed = [];
    act(() => emit('plugins.changed', {}));
    act(() => emit('plugins.operation', event({ opId: 'pop-2', action: 'marketplace-remove', target: 'e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Successfully removed marketplace: e8-scratch' } }, reload: { sessions: [] } })));
    await waitFor(() => expect(within(manageDialog()).getByText('No marketplaces added yet.')).toBeTruthy());
    expect(manageDialog().querySelector('[data-marketplace-result="e8-scratch"]')!.textContent).toContain('Successfully removed marketplace: e8-scratch');
    fireEvent.click(within(manageDialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.querySelector('[data-marketplaces-dialog]')).toBeNull());
  });

  it('Stop asks the host to cancel the running CLI', async () => {
    await ready();
    menu('e8-probe@e8-scratch', 'Update');
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
    menu('e8-probe@e8-scratch', 'Update');
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
    menu('e8-probe@e8-scratch', 'Update');
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
    menu('e8-probe@e8-scratch', 'Update');
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
    menu('e8-probe@e8-scratch', 'Update');
    await waitFor(() => expect(argvShown()).toEqual(['plugin', 'update', 'e8-probe@e8-scratch', '--scope', 'user', '--json']));
    expect(within(sheet()).getByText('2.1.290 plugin update e8-probe@e8-scratch --scope user --json')).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.update')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
  });

  it('one id installed at two scopes is one row acting on the installation here; removing it leaves the user’s, and its result stays beneath', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true })];
    await ready();
    const rows = () => [...section('my-items').querySelectorAll<HTMLElement>('[data-plugin-row="e8-probe@e8-scratch"]')];
    expect(rows()).toHaveLength(1);
    expect(row('e8-probe@e8-scratch').getAttribute('data-plugin-scope')).toBe('project');
    expect(row('e8-probe@e8-scratch').closest('[data-plugins-group]')!.getAttribute('data-plugins-group')).toBe('here');
    menu('e8-probe@e8-scratch', 'Uninstall…');
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'uninstall', 'e8-probe@e8-scratch', '--scope', 'project', '--json']);
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(within(row('e8-probe@e8-scratch')).getByRole('status').textContent).toBe('Working…'));
    installed = [plugin('e8-probe@e8-scratch')];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(row('e8-probe@e8-scratch').getAttribute('data-plugin-scope')).toBe('user'));
    expect(rows()).toHaveLength(1);
    expect(within(row('e8-probe@e8-scratch')).queryByRole('status')).toBeNull(); // the user's installation holds no word of the removal
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: e8-probe (scope: project)' } }, reload: { sessions: [] } })));
    const gone = section('my-items').querySelector<HTMLElement>('[data-plugin-result="e8-probe@e8-scratch"]')!;
    expect(gone.getAttribute('data-plugin-scope')).toBe('project');
    expect(within(gone).getByRole('status').textContent).toBe('Successfully uninstalled plugin: e8-probe (scope: project) · No running session to reload');
    expect(within(row('e8-probe@e8-scratch')).queryByRole('status')).toBeNull();
  });

  it('a change that arrives while a listing is in flight is read again once that listing settles', async () => {
    await ready();
    const disabled = () => within(row('e8-probe@e8-scratch')).queryByText('Disabled') !== null;
    const stale = deferred<{ plugins: InstalledPlugin[] }>();
    let reads = 1;
    backend.script('plugins.list', () => (++reads === 2 ? stale.promise : { plugins: installed }));
    act(() => emit('plugins.changed', {})); // a first change: read 2 starts and hangs
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(2));
    installed = [plugin('e8-probe@e8-scratch', { enabled: false })];
    act(() => emit('plugins.changed', {})); // a second change while read 2 is in flight
    act(() => stale.resolve({ plugins: [plugin('e8-probe@e8-scratch')] })); // read 2 answers the state before the change
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(3));
    await waitFor(() => expect(disabled()).toBe(true));
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
    menu('e8-probe@e8-scratch', 'Update');
    await waitFor(() => expect(invoked('plugins.env')).toHaveLength(before + 1));
    expect(within(sheet()).getByText('Resolving the engine…')).toBeTruthy(); // not the answer read before
    expect(sheet().querySelector('[data-plugins-argv]')).toBeNull();
    await waitFor(() => expect(held).not.toBeNull());
    act(() => held!({ binary: OTHER, binaryError: null, configHome: HOME, globalConfig: GLOBAL }));
    await waitFor(() => expect(within(sheet()).getByText('2.1.300 plugin update e8-probe@e8-scratch --scope user --json')).toBeTruthy());
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(invoked('plugins.update')).toEqual([{ cwd, binary: OTHER, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
  });

  it('a plugin installed only for another project is listed only under Other projects, read-only, naming the project', async () => {
    // `plugin list` from this project reports another project's installation with this project's enabled state, so no
    // action is offered for it (E8 whole-branch review, round two; P2-B §5.4)
    installed = [plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/other', enabled: false }), plugin('e8-tools@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true })];
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await waitFor(() => expect(row('e8-tools@e8-scratch')).toBeTruthy());
    expect(row('e8-probe@e8-scratch')).toBeNull();
    // Show › Other projects
    fireEvent.keyDown(screen.getByRole('button', { name: 'Show' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Other projects' }));
    const elsewhere = await waitFor(() => row('e8-probe@e8-scratch'));
    expect(elsewhere.textContent).toContain('In other · manage it from a session there');
    expect(elsewhere.outerHTML).not.toContain('/work/other'); // neither its words nor any attribute (a tooltip) names a path
    expect(within(elsewhere).queryByRole('button', { name: /^More actions for / })).toBeNull(); // read-only: only its detail opens
    expect(row('e8-tools@e8-scratch')).toBeNull();
    // this project's own installation keeps its actions and needs no naming
    act(() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'all' } })));
    const own = await waitFor(() => row('e8-tools@e8-scratch'));
    expect(own.textContent).not.toContain('manage it');
    menu('e8-tools@e8-scratch', 'Uninstall…');
    await waitFor(() => expect(argvShown()).toEqual(['plugin', 'uninstall', 'e8-tools@e8-scratch', '--scope', 'project', '--json']));
    expect(within(sheet()).getByText(`In ${cwd}`)).toBeTruthy();
  });

  it('removing a marketplace names the installed plugins it uninstalls and the files that writes, behind the acknowledgement', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-tools@e8-scratch', { scope: 'project', projectPath: '/work/other' }), plugin('review@anthropic-plugin-directory')];
    await ready();
    openAdd('Manage marketplaces');
    await waitFor(() => expect(marketRow('e8-scratch')).toBeTruthy());
    marketMenu('e8-scratch', 'Remove…');
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

// P2-B M3 (the execution document §5.4, §5.6, §5.12): My items' groups and words, the head's search, Show and Sort,
// and MAWS's built-in mods.
describe('plugins widget: the library', () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
  const OFFICIAL = { name: 'claude-plugins-official', source: 'github', locator: 'anthropics/claude-plugins-official', installLocation: '/cfg/plugins/marketplaces/claude-plugins-official', ref: null };
  const library = async () => {
    installed = [
      plugin('code-review@claude-plugins-official', { lastUpdated: ago(3), version: 'unknown' }),
      plugin('frontend-design@claude-plugins-official', { scope: 'project', projectPath: cwd, here: true, coversHere: true, lastUpdated: ago(20) }),
      plugin('supabase@claude-plugins-official', { scope: 'project', projectPath: '/work/other', enabled: false, lastUpdated: ago(1) }),
      plugin('e8-probe@e8-scratch', { lastUpdated: ago(30), version: 'a1b2c3d4e5f6' }),
      plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: `${cwd}-wt`, lastUpdated: ago(2) }),
    ];
    backend.script('marketplaces.list', () => ({ marketplaces: [OFFICIAL, { name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-scratch/market', installLocation: '/tmp/e8-scratch/market', ref: null }] }));
    await ready();
  };
  const groups = () => [...section('my-items').querySelectorAll<HTMLElement>('[data-plugins-group]')].map((g) => [g.getAttribute('data-plugins-group'), [...g.querySelectorAll('[data-plugin-row]')].map((r) => r.getAttribute('data-plugin-row'))]);

  it('lists each plugin once, grouped as Desktop groups them, with no path and no "unknown"', async () => {
    await library();
    expect(groups()).toEqual([
      ['here', ['frontend-design@claude-plugins-official']],
      ['anthropic', ['code-review@claude-plugins-official']],
      ['added', ['e8-probe@e8-scratch']],
    ]);
    expect(within(section('my-items')).getByText('In this project')).toBeTruthy();
    expect(within(section('my-items')).getByText('From Anthropic & Partners')).toBeTruthy();
    expect(within(section('my-items')).getByText('From marketplaces you added')).toBeTruthy();
    const text = section('my-items').textContent!;
    expect(text).not.toContain('unknown');
    expect(text).not.toContain(cwd);
    expect(text).not.toContain('/work/other');
    expect(row('code-review@claude-plugins-official').textContent).toContain('Code review');
    expect(row('code-review@claude-plugins-official').textContent).toContain('3 days ago');
    expect(within(row('code-review@claude-plugins-official')).getByText('New').getAttribute('title')).toBe('Added or updated in the last 14 days');
    expect(within(row('frontend-design@claude-plugins-official')).queryByText('New')).toBeNull(); // 20 days
    expect(row('e8-probe@e8-scratch').textContent).toContain('a1b2c3d4e5f6'); // a commit prefix is a version as it is
  });

  it('Name flattens the groups; Show filters; a search that finds nothing offers Reset filters', async () => {
    await library();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
    await waitFor(() => expect(groups()).toEqual([['all', ['code-review@claude-plugins-official', 'e8-probe@e8-scratch', 'frontend-design@claude-plugins-official']]]));
    expect(screen.getByRole('button', { name: 'Sort by' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'nothing like this' } });
    expect(within(section('my-items')).getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveProperty('value', '');
    await waitFor(() => expect(groups()[0][1]).toHaveLength(3));
  });

  it('Escape in a non-empty search clears it and keeps the widget; `/` focuses the search; the choices outlive the dialog', async () => {
    const close = vi.fn();
    const focusEditor = vi.fn();
    const off = registerFocusTarget(ID, { focusEditor, focusFrame: () => {}, insertText: () => {} });
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PluginsWidget appSessionId={ID} args="" close={close} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    const search = screen.getByRole('searchbox', { name: 'Search plugins' });
    fireEvent.keyDown(document.querySelector('[data-widget="plugins"]')!, { key: '/' });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'probe' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveProperty('value', '');
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledTimes(1);
    // search, Show and Sort are kept for the app run: a second open finds them as they were
    fireEvent.change(search, { target: { value: 'probe' } });
    view.unmount();
    mount();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveProperty('value', 'probe'));
    off();
  });

  it('ends with MAWS mods · Built in when P2-C’s mods.list answers rows, with a switch and no Uninstall; none, no section', async () => {
    await ready();
    expect(screen.queryByText('MAWS mods · Built in')).toBeNull();
    cleanup();
    const setEnabled = vi.fn(async () => {});
    mods.hook = { ...NO_MODS(), read: { state: 'ready', rows: [{ id: 'maws.to-human', name: 'To-human', description: 'Agents mark what is for you', version: 1, enabled: true, source: 'external-compatible-style', perSession: 'off' }] }, setEnabled };
    await ready();
    const section = screen.getByRole('region', { name: 'MAWS mods · Built in' });
    const mod = section.querySelector<HTMLElement>('[data-mod-row="maws.to-human"]')!;
    expect(mod.textContent).toContain('To-human');
    expect(mod.textContent).toContain('Built in');
    expect(mod.textContent).toContain('The output style gives the agent its instructions');
    expect((within(mod).getByRole('radio', { name: 'Off' }) as HTMLInputElement).checked).toBe(true);
    expect(within(mod).queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(mod.textContent).not.toContain('Uninstall');
    const groupsInOrder = [...section.parentElement!.querySelectorAll('[data-plugins-group]')].map((g) => g.getAttribute('data-plugins-group'));
    expect(groupsInOrder.at(-1)).toBe('builtIn');
    fireEvent.click(within(mod).getByRole('switch'));
    expect(setEnabled).toHaveBeenCalledWith('maws.to-human', false);
  });

  it('keeps MAWS mods · Built in when the engine CLI’s plugin read fails: the mods are MAWS’s, not the CLI’s', async () => {
    backend.script('plugins.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'Path does not exist: /nope' });
    });
    mods.hook = { ...NO_MODS(), read: { state: 'ready', rows: [{ id: 'maws.to-human', name: 'To-human', description: 'Agents mark what is for you', version: 1, enabled: true, source: 'maws-contract', perSession: 'inherit' }] } };
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain("Couldn't load your plugins."));
    expect(screen.getByRole('region', { name: 'MAWS mods · Built in' }).querySelector('[data-mod-row="maws.to-human"]')).toBeTruthy();
  });
  it('a plugin this project enables that a local override turns off reads Disabled and offers Turn on (U3 F1)', async () => {
    installed = [plugin('e8-tools@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true, projectEnabled: true, enabled: false }), plugin('e8-probe@e8-scratch')];
    await ready();
    const tools = row('e8-tools@e8-scratch');
    expect(within(tools).getByText('Disabled')).toBeTruthy();
    expect(menuItems('e8-tools@e8-scratch')).toEqual(['Turn on', 'Update', 'Uninstall…']);
  });

  it('a plugin managed from several other projects names them by count, its tooltip by basenames, never a path', async () => {
    installed = [plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/alpha', enabled: false }), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/srv/beta/', enabled: false })];
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await waitFor(() => expect(within(section('my-items')).getByText('In this project')).toBeTruthy());
    act(() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'otherProjects' } })));
    const elsewhere = await waitFor(() => row('e8-probe@e8-scratch'));
    const words = within(elsewhere).getByText('In 2 other projects · manage it from a session there');
    expect(words.getAttribute('title')).toBe('alpha\nbeta');
    expect(elsewhere.outerHTML).not.toMatch(/\/work\/alpha|\/srv\/beta/);
  });

  it('with every installation in another project, the default view keeps In this project and says it has none', async () => {
    installed = [plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/other', enabled: false })];
    useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
    mount();
    await waitFor(() => expect(within(section('my-items')).getByText('No plugins installed for this project yet.')).toBeTruthy());
    expect(within(section('my-items')).getByText('In this project')).toBeTruthy();
    expect(within(section('my-items')).queryByText('Nothing matches these filters.')).toBeNull();
    // a search that finds nothing is a no-match
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'nothing like this' } });
    expect(within(section('my-items')).getByText('Nothing matches these filters.')).toBeTruthy();
    expect(within(section('my-items')).queryByText('In this project')).toBeNull();
  });

  it('Loaded in this session searches and sorts its loaded-only rows, and shows only the shown plugins’ problems', async () => {
    useSessions.setState({
      engine: new Map([
        [
          ID,
          {
            ...backend.status(ID),
            plugins: [
              { name: 'zeta-tools', path: 'builtin', source: 'zeta-tools@builtin', version: null },
              { name: 'mid-thing', path: '/cfg/plugins/cache/far/mid-thing/1.0.0', source: 'mid-thing@far', version: '1.0.0' },
              { name: 'alpha-dir', path: '/Users/me/.claude/skills/alpha-dir', source: 'alpha-dir@skills-dir', version: null },
              { name: 'e8-probe', path: '/cfg/plugins/cache/e8-scratch/e8-probe/0.1.0', source: 'e8-probe@e8-scratch', version: '0.1.0' },
            ],
            pluginErrors: [{ plugin: 'zeta-tools', type: 'load', message: 'zeta failed', path: null }],
            pluginWarnings: [{ plugin: 'alpha-dir', type: 'manifest', message: 'alpha warned' }],
          },
        ],
      ]),
    });
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    fireEvent.click(within(loadedLine()).getByRole('button', { name: '4 plugins loaded in this session' }));
    const loadedRows = () => [...section('my-items').querySelectorAll('[data-loaded-row]')].map((r) => r.getAttribute('data-loaded-row'));
    const allRows = () => [...section('my-items').querySelectorAll('[data-plugin-row], [data-loaded-row]')].map((r) => r.getAttribute('data-plugin-row') ?? r.getAttribute('data-loaded-row'));
    const problemText = () => section('my-items').querySelector('[data-plugins-group="problems"]')?.textContent ?? '';
    // Last updated: the installed plugin in its group, then the loaded-only rows, which have no date, so the name decides
    // (Desktop's tie-breaker)
    expect(allRows()).toEqual(['e8-probe@e8-scratch', 'alpha-dir@skills-dir', 'mid-thing@far', 'zeta-tools@builtin']);
    expect(problemText()).toContain('zeta failed');
    expect(problemText()).toContain('alpha warned');
    // Name: one alphabetical list over the installed plugin and the loaded-only rows (P2-F L133)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
    expect(allRows()).toEqual(['alpha-dir@skills-dir', 'e8-probe@e8-scratch', 'mid-thing@far', 'zeta-tools@builtin']);
    expect(section('my-items').querySelectorAll('[data-plugins-group]:not([data-plugins-group="problems"])')).toHaveLength(1);
    const search = screen.getByRole('searchbox', { name: 'Search plugins' });
    fireEvent.change(search, { target: { value: 'ZETA' } });
    expect(loadedRows()).toEqual(['zeta-tools@builtin']);
    expect(problemText()).toContain('zeta failed');
    expect(problemText()).not.toContain('alpha warned');
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(loadedRows()).toEqual([]);
    expect(problemText()).toBe('');
    expect(within(section('my-items')).getByText('Nothing matches these filters.')).toBeTruthy();
  });

  it('a refused manifest read keeps the rows, says so with Retry, and the retry reads again', async () => {
    let refuse = true;
    backend.script('plugins.manifest', (input) => {
      if (refuse) throw new WidgetBackendError({ code: 'timeout', message: 'plugins.manifest unanswered after 10 s' });
      return { manifests: (input as { items: ManifestItemRef[] }).items.map((key) => manifestOf(key)) };
    });
    await ready();
    const notice = await waitFor(() => within(section('my-items')).getByText(/Couldn.t read your plugins. details/).closest<HTMLElement>('[role="status"]')!);
    expect(notice.textContent).toContain('plugins.manifest unanswered after 10 s');
    expect(row('e8-probe@e8-scratch').textContent).toContain('E8 probe');
    expect(row('e8-probe@e8-scratch').textContent).not.toContain('by E8');
    refuse = false;
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(row('e8-probe@e8-scratch').textContent).toContain('by E8'));
    expect(within(section('my-items')).queryByText(/Couldn.t read your plugins. details/)).toBeNull();
    expect(invoked('plugins.manifest')).toHaveLength(2);
  });
});

// P2-B M4 (the execution document §5.7): a row opens its detail in place of the list; the changes act at the chosen
// chip's scope through E8's sheets; Back returns to the list as it was.
describe('plugins widget: the detail', () => {
  const view = (id: string) => within(section('my-items')).getByRole('button', { name: `View ${displayed(id)}` });
  const displayed = (id: string) => ({ 'e8-probe@e8-scratch': 'E8 probe', 'e8-tools@e8-scratch': 'E8 tools' })[id] ?? id;
  const detail = () => document.querySelector<HTMLElement>('[data-plugin-detail]');
  const chips = () => within(detail()!).getAllByRole('radio').map((chip) => [chip.textContent, chip.getAttribute('aria-checked')]);
  const switchOf = () => within(detail()!).getByRole('switch', { name: 'Enable plugin' });

  it('a row’s click opens its detail in place of the list, without the list’s controls; Back returns with the search kept', async () => {
    await ready();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'probe' } });
    fireEvent.click(row('e8-probe@e8-scratch').querySelector('span')!); // anywhere on the row
    expect(detail()!.getAttribute('data-plugin-detail')).toBe('e8-probe@e8-scratch');
    expect(within(detail()!).getByRole('heading', { name: 'E8 probe' })).toBeTruthy();
    await waitFor(() => expect(detail()!.querySelector('h3 + p')!.textContent).toBe('by E8 · 0.1.0 · e8-scratch'));
    expect(section('my-items').closest('.hidden')).toBeTruthy(); // the list stays mounted, hidden
    expect(screen.queryByRole('searchbox', { name: 'Search plugins' })).toBeNull();
    expect(loadedLine().closest('.hidden')).toBeTruthy();
    expect(chips()).toEqual([['User', 'true']]);
    expect(within(detail()!).getByText('Enabled for this project')).toBeTruthy();
    // e8-probe is not among the 11 plugins this ready session loaded: say so, and offer the reload
    expect(document.querySelector('[data-plugin-fact="loaded"]')!.textContent).toBe('Not loaded in this sessionReload plugins');
    expect(within(detail()!).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Skills1']);
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Back to My items' }));
    expect(detail()).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveProperty('value', 'probe');
    expect(document.activeElement).toBe(view('e8-probe@e8-scratch'));
  });

  it('the switch, clicked on My items while its detail shows, returns to the list', async () => {
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    expect(detail()).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'My items' }));
    expect(detail()).toBeNull();
    expect(section('my-items').closest('.hidden')).toBeNull();
    expect(screen.getByRole('radio', { name: 'My items' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toBeTruthy();
  });

  it('loaded now when the session’s list has it', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), plugins: [{ name: 'e8-probe', path: '/cfg/e8-probe', source: 'e8-probe@e8-scratch', version: '0.1.0' }] }]]) });
    mount();
    fireEvent.click(await waitFor(() => view('e8-probe@e8-scratch')));
    expect(document.querySelector('[data-plugin-fact="loaded"]')!.textContent).toBe('Loaded in this session · Loaded now');
  });

  it('the chips: this project first and chosen, then the user’s; the switch, Update and Uninstall… act at the chosen chip’s scope', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true })];
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    expect(chips()).toEqual([
      ['This project', 'true'],
      ['User', 'false'],
    ]);
    expect(switchOf().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(switchOf());
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'disable', 'e8-probe@e8-scratch', '--scope', 'project', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(detail()!).getByRole('radio', { name: 'User' }));
    expect(detail()!.getAttribute('data-plugin-scope')).toBe('user');
    fireEvent.click(switchOf());
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'disable', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(invoked('plugins.disable')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
    await waitFor(() => expect(within(detail()!.querySelector<HTMLElement>('[data-plugin-op="user"]')!).getByRole('status').textContent).toBe('Working…'));
    expect(within(detail()!).getByRole('button', { name: 'Update' })).toHaveProperty('disabled', true); // busy at this scope
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'disable', phase: 'done', outcome: { ok: true, result: { message: 'Successfully disabled plugin: e8-probe (scope: user)' } }, reload: { sessions: [] } })));
    expect(within(detail()!.querySelector<HTMLElement>('[data-plugin-op="user"]')!).getByRole('status').textContent).toBe('Successfully disabled plugin: e8-probe (scope: user) · No running session to reload');
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Update' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'update', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(detail()!).getByRole('radio', { name: 'This project' }));
    fireEvent.keyDown(within(detail()!).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall…' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'uninstall', 'e8-probe@e8-scratch', '--scope', 'project', '--json']);
  });

  it('Update says On latest version until Check for updates pulls a newer marketplace entry, then offers it, the installation unchanged', async () => {
    let offered = '0.1.0'; // the marketplace entry's version, as the host reads it from the clone
    backend.script('plugins.manifest', (input) => ({ manifests: (input as { items: ManifestItemRef[] }).items.map((key) => ({ ...manifestOf(key), marketplaceVersion: offered })) }));
    await ready();
    const update = () => within(detail()!).getByRole('button', { name: 'Update' });
    fireEvent.click(view('e8-probe@e8-scratch'));
    await waitFor(() => expect(update().parentElement!.title).toBe('On latest version'));
    expect(update()).toHaveProperty('disabled', true);
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Back to My items' }));
    openAdd('Manage marketplaces');
    await waitFor(() => expect(marketRow('e8-scratch')).toBeTruthy());
    marketMenu('e8-scratch', 'Check for updates');
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(invoked('marketplaces.update')).toEqual([{ cwd, binary: BINARY, name: 'e8-scratch' }]));
    offered = '0.2.0';
    const reads = invoked('plugins.manifest').length;
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'marketplace-update', target: 'e8-scratch', phase: 'done', outcome: { ok: true, result: { message: 'Successfully updated marketplace: e8-scratch' } }, reload: { sessions: [] } })));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.manifest').length).toBeGreaterThan(reads)); // read again once the listings answered
    fireEvent.click(within(manageDialog()).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.querySelector('[data-marketplaces-dialog]')).toBeNull());
    fireEvent.click(view('e8-probe@e8-scratch'));
    await waitFor(() => expect(update().parentElement!.title).toBe('Update to 0.2.0'));
    expect(update()).toHaveProperty('disabled', false);
    expect(installed[0].lastUpdated).toBeNull(); // no reinstall: the listing's lastUpdated never moved
  });

  it('a chip not here or the user’s offers no change and says where the plugin is managed; other projects list read-only', async () => {
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work', coversHere: true }), plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/other' })];
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    expect(chips()).toEqual([
      ['User', 'true'],
      ['work', 'false'],
      ['1 other project', 'false'],
    ]);
    fireEvent.click(within(detail()!).getByRole('radio', { name: 'work' }));
    expect(switchOf()).toHaveProperty('disabled', true);
    expect(within(detail()!).getByRole('button', { name: 'Update' })).toHaveProperty('disabled', true);
    expect(within(detail()!).getByText('In work · manage it from a session there')).toBeTruthy();
    fireEvent.click(within(detail()!).getByRole('radio', { name: '1 other project' }));
    const others = within(detail()!).getByRole('list', { name: 'Other projects' });
    expect(others.textContent).toBe('other0.1.0manage it from a session there');
    expect(switchOf()).toHaveProperty('disabled', true);
    expect(invoked('plugins.disable')).toEqual([]);
  });

  it('other projects: counted by folder, each installation a row, named without a path in text or tooltip', async () => {
    installed = [
      plugin('e8-probe@e8-scratch'),
      plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/work/alpha/agent-x' }),
      plugin('e8-probe@e8-scratch', { scope: 'local', projectPath: '/work/alpha/agent-x' }),
      plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: '/srv/beta/agent-x' }),
    ];
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    fireEvent.click(within(detail()!).getByRole('radio', { name: '2 other projects' }));
    const others = within(detail()!).getByRole('list', { name: 'Other projects' });
    expect(within(others).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'alpha/agent-x0.1.0manage it from a session there',
      'alpha/agent-xonly you0.1.0manage it from a session there',
      'beta/agent-x0.1.0manage it from a session there',
    ]);
    expect(detail()!.outerHTML).not.toMatch(/\/work\/|\/srv\//); // neither words nor any attribute (a tooltip) holds a path
  });

  it('a refused read of a chosen chip’s files says so with the read’s words and Retry, keeping the controls and facts', async () => {
    let refuse = true;
    backend.script('plugins.manifest', (input) => {
      const items = (input as { items: ManifestItemRef[] }).items;
      if (refuse && items.some((key) => key.kind === 'installation' && key.scope === 'user')) throw new WidgetBackendError({ code: 'timeout', message: 'plugins.manifest unanswered after 10 s' });
      return { manifests: items.map((key) => manifestOf(key)) };
    });
    installed = [plugin('e8-probe@e8-scratch', { scope: 'project', projectPath: cwd, here: true, coversHere: true }), plugin('e8-probe@e8-scratch')];
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    await waitFor(() => expect(detail()!.querySelector('h3 + p')!.textContent).toContain('by E8')); // this project's, read with the list
    expect(within(detail()!).queryByText(/Couldn.t read this plugin.s details/)).toBeNull();
    // the user's installation is the detail's own read, refused
    fireEvent.click(within(detail()!).getByRole('radio', { name: 'User' }));
    const notice = await waitFor(() => within(detail()!).getByText(/Couldn.t read this plugin.s details/).closest<HTMLElement>('[role="status"]')!);
    expect(notice.textContent).toContain('plugins.manifest unanswered after 10 s');
    expect(switchOf()).toHaveProperty('disabled', false); // the listing's controls and facts stay
    expect(within(detail()!).getByRole('button', { name: 'Update' })).toBeTruthy();
    expect(within(detail()!).getByText('Enabled for this project')).toBeTruthy();
    expect(detail()!.querySelector('h3 + p')!.textContent).not.toContain('by E8');
    refuse = false;
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(detail()!.querySelector('h3 + p')!.textContent).toContain('by E8'));
    expect(within(detail()!).queryByText(/Couldn.t read this plugin.s details/)).toBeNull();
  });

  // P2-F W-V (L134): the notice keys on the plugin's own view, not on the read that carried every plugin's
  it('a plugin whose own files could not be read says so in its detail; another read in the same answer does not', async () => {
    backend.script('plugins.manifest', (input) => ({
      manifests: (input as { items: ManifestItemRef[] }).items.map((key) => (key.kind === 'installation' && key.id === 'e8-tools@e8-scratch' ? { ...manifestOf(key), state: 'unknown' as const } : manifestOf(key))),
    }));
    installed = [plugin('e8-probe@e8-scratch'), plugin('e8-tools@e8-scratch')];
    await ready();
    await waitFor(() => expect(row('e8-probe@e8-scratch').textContent).toContain('by E8'));
    fireEvent.click(view('e8-probe@e8-scratch'));
    expect(within(detail()!).queryByText(/Couldn.t read this plugin.s details/)).toBeNull();
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Back to My items' }));
    fireEvent.click(view('e8-tools@e8-scratch'));
    expect(within(detail()!).getByText(/Couldn.t read this plugin.s details/).closest('[role="status"]')).toBeTruthy();
  });

  it('Update names the marketplace’s newer version; an uninstall of the last installation returns to the list with its result', async () => {
    backend.script('plugins.manifest', (input) => ({ manifests: (input as { items: ManifestItemRef[] }).items.map((key) => ({ ...manifestOf(key), marketplaceVersion: '0.2.0' })) }));
    await ready();
    await waitFor(() => expect(row('e8-probe@e8-scratch').textContent).toContain('by E8'));
    fireEvent.click(view('e8-probe@e8-scratch'));
    expect(within(detail()!).getByRole('button', { name: 'Update' }).parentElement!.getAttribute('title')).toBe('Update to 0.2.0');
    fireEvent.keyDown(within(detail()!).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall…' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(invoked('plugins.uninstall')).toEqual([{ cwd, binary: BINARY, plugin: 'e8-probe@e8-scratch', scope: 'user' }]));
    installed = [];
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(detail()).toBeNull());
    act(() => emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: e8-probe (scope: user)' } }, reload: { sessions: [] } })));
    expect(within(section('my-items').querySelector<HTMLElement>('[data-plugin-result="e8-probe@e8-scratch"]')!).getByRole('status').textContent).toBe('Successfully uninstalled plugin: e8-probe (scope: user) · No running session to reload');
  });

  it('a change whose installed list then fails to read again says so in the detail, which shows the last list read (scale review D scalpel-1#1)', async () => {
    await ready();
    fireEvent.click(view('e8-probe@e8-scratch'));
    fireEvent.click(switchOf());
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(invoked('plugins.disable')).toHaveLength(1));
    backend.script('plugins.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'Path does not exist: /nope' });
    });
    act(() => emit('plugins.changed', {}));
    const warning = await waitFor(() => within(detail()!).getByText(/Path does not exist: \/nope/));
    expect(warning.textContent).toBe('Path does not exist: /nope · showing the last value it reported');
    expect(warning.getAttribute('role')).toBe('status');
    expect(switchOf().getAttribute('aria-checked')).toBe('true'); // the last read's position, now disclosed as such
  });

  it('the row’s overflow keeps its own click: its menu opens and no detail does', async () => {
    await ready();
    expect(menuItems('e8-probe@e8-scratch')).toEqual(['Turn off', 'Update', 'Uninstall…']);
    expect(detail()).toBeNull();
    menu('e8-probe@e8-scratch', 'Update');
    await resolved();
    expect(detail()).toBeNull();
  });
});

// ---- P2-B M5: Browse ---------------------------------------------------------------------------------------------------
// The engine's configured sources as the host lists them: the built-in directory, the official marketplace (which alone
// carries counts), a third party; the installed identities joined back in; the card's detail and its What's inside.
describe('plugins widget: Browse', () => {
  const OFFICIAL_LOCATION = '/tmp/e8-scratch/claude-config/plugins/marketplaces/claude-plugins-official';
  const official = { name: 'claude-plugins-official', source: 'github', locator: 'anthropics/claude-plugins-official', installLocation: OFFICIAL_LOCATION };
  const directory = (name: string, over: Record<string, unknown> = {}) => ({ pluginId: `${name}@anthropic-plugin-directory`, name, marketplaceName: 'anthropic-plugin-directory', description: `${name} from the directory`, version: null, source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: `plugins/${name}` }, installCount: null, ...over });
  const offered = (name: string, installCount: number | null) => ({ pluginId: `${name}@claude-plugins-official`, name, marketplaceName: 'claude-plugins-official', description: `${name} from the marketplace`, version: '1.2.0', source: `./plugins/${name}`, installCount });
  beforeEach(() => {
    backend.script('marketplaces.list', () => ({ marketplaces: [{ name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-scratch/market', installLocation: '/tmp/e8-scratch/market' }, official] }));
    backend.script('plugins.available', () => ({
      plugins: [directory('frontend-design'), offered('frontend-design', 1_290_640), offered('code-simplifier', 3_448), directory('dir-only'), offered('counted-none', null)],
    }));
    installed = [
      plugin('e8-probe@e8-scratch'),
      plugin('supabase@claude-plugins-official', { scope: 'local', projectPath: '/work/other', enabled: false }), // only another project has it
      plugin('code-review@claude-plugins-official'), // installed for the user
    ];
  });

  it('folds a directory entry with its official twin into one card with the official count; counts only where the engine gives one; Most popular first', async () => {
    await ready();
    await toBrowse();
    const ids = () => [...section('browse').querySelectorAll('[data-browse-card]')].map((c) => c.getAttribute('data-browse-card'));
    // Anthropic & Partners: counted cards by count, then the rest by name; then e8-scratch
    expect(ids()).toEqual([
      'frontend-design@anthropic-plugin-directory',
      'code-simplifier@claude-plugins-official',
      'code-review@claude-plugins-official',
      'counted-none@claude-plugins-official',
      'dir-only@anthropic-plugin-directory',
      'supabase@claude-plugins-official',
      'e8-probe@e8-scratch',
    ]);
    expect(card('frontend-design@anthropic-plugin-directory').querySelector('[data-install-count]')!.textContent).toBe('1.3M installs');
    expect(card('code-simplifier@claude-plugins-official').querySelector('[data-install-count]')!.textContent).toBe('3.4K installs');
    for (const id of ['dir-only@anthropic-plugin-directory', 'counted-none@claude-plugins-official', 'code-review@claude-plugins-official']) expect(card(id).querySelector('[data-install-count]')).toBeNull();
    expect(card('code-review@claude-plugins-official').getAttribute('data-installed')).toBe('here');
    expect(card('supabase@claude-plugins-official').getAttribute('data-installed')).toBe('otherProjects');
    expect(within(card('supabase@claude-plugins-official')).getByText('Installed in other projects')).toBeTruthy();
    // Sort by: Most popular is offered, and chosen; Name orders by name
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitemradio').map((i) => [i.textContent, i.getAttribute('aria-checked')])).toEqual([
      ['●Most popular', 'true'],
      ['Name', 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
    expect(ids()[0]).toBe('code-review@claude-plugins-official');
  });

  it('with no count anywhere, Most popular is not offered and Name orders the cards', async () => {
    backend.script('plugins.available', () => ({ plugins: [directory('zeta'), directory('alpha')] }));
    await ready();
    await toBrowse();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['●Name']);
  });

  it('Filter: Status keeps one checked; Source narrows to a section; nothing left offers Reset filters', async () => {
    await ready();
    await toBrowse();
    const ids = () => [...section('browse').querySelectorAll('[data-browse-card]')].map((c) => c.getAttribute('data-browse-card'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Filter' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Not installed' }));
    expect(ids()).toEqual(['code-review@claude-plugins-official', 'e8-probe@e8-scratch']); // installed for the user or here
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Installed' })); // the last one checked stays
    expect(screen.getByRole('menuitemcheckbox', { name: 'Installed' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'e8-scratch' }));
    expect(ids()).toEqual(['e8-probe@e8-scratch']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'nothing like it' } });
    expect(within(section('browse')).getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(within(section('browse')).getByRole('button', { name: 'Reset filters' }));
    expect(ids()).toHaveLength(7);
  });

  it('a card installed only for other projects still offers Install here, at the scope its sheet chooses', async () => {
    await ready();
    await toBrowse();
    fireEvent.click(within(card('supabase@claude-plugins-official')).getByRole('button', { name: 'Install' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Project' }));
    expect(argvShown()).toEqual(['plugin', 'install', 'supabase@claude-plugins-official', '--scope', 'project', '--json']);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd, binary: BINARY, plugin: 'supabase@claude-plugins-official', scope: 'project' }]));
  });

  it('a card’s detail: the credit, the count, Also listed in, What’s inside from the marketplace’s clone, and Install; Back returns to the grid', async () => {
    backend.script('plugins.manifest', (input) => ({
      manifests: (input as { items: ManifestItemRef[] }).items.map((key) => (key.kind === 'available' && key.pluginId === 'frontend-design@claude-plugins-official' ? { ...manifestOf(key), components: { ...manifestOf(key).components, skills: [{ name: 'frontend-design', description: 'Distinctive interfaces' }] } } : manifestOf(key))),
    }));
    await ready();
    await toBrowse();
    fireEvent.click(within(card('frontend-design@anthropic-plugin-directory')).getByRole('button', { name: 'View Frontend design' }));
    const detail = () => document.querySelector<HTMLElement>('[data-browse-detail]')!;
    expect(detail().getAttribute('data-browse-detail')).toBe('frontend-design@anthropic-plugin-directory');
    expect(section('browse').className).toContain('hidden'); // the grid stays beneath
    expect(screen.queryByRole('searchbox')).toBeNull(); // the grid's controls leave with it
    expect(within(detail()).getByRole('heading', { name: 'Frontend design' })).toBeTruthy();
    expect(within(detail()).getByText('from anthropic-plugin-directory · 1.2.0 · 1.3M installs')).toBeTruthy();
    expect(within(detail()).getByText('Also listed in claude-plugins-official')).toBeTruthy();
    // the directory entry's own source is not on disk; its official twin's files sit in that marketplace's clone
    await waitFor(() => expect(invoked('plugins.manifest')).toContainEqual({ cwd, items: [{ kind: 'available', pluginId: 'frontend-design@claude-plugins-official' }] }));
    await waitFor(() => expect(within(detail()).getByRole('button', { name: 'Skills · 1' })).toBeTruthy());
    fireEvent.click(within(detail()).getByRole('button', { name: 'Install' }));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'install', 'frontend-design@anthropic-plugin-directory', '--scope', 'user', '--json']); // the card's own id
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('[data-plugins-sheet]')).toBeNull());
    fireEvent.click(within(detail()).getByRole('button', { name: 'Back to Browse' }));
    expect(document.querySelector('[data-browse-detail]')).toBeNull();
    expect(section('browse').className).not.toContain('hidden');
    expect(document.activeElement?.closest('[data-browse-card]')?.getAttribute('data-browse-card')).toBe('frontend-design@anthropic-plugin-directory');
  });

  it('a directory-only card says what’s inside is listed once installed, asking nothing; an installed card opens its My items detail, whose Back returns to Browse', async () => {
    await ready();
    await toBrowse();
    const asked = invoked('plugins.manifest').length;
    fireEvent.click(within(card('dir-only@anthropic-plugin-directory')).getByRole('button', { name: 'View Dir only' }));
    expect(within(document.querySelector<HTMLElement>('[data-browse-detail]')!).getByText('What’s inside is listed once it is installed.')).toBeTruthy();
    expect(invoked('plugins.manifest')).toHaveLength(asked);
    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-browse-detail]')!, { key: '[', metaKey: true });
    expect(document.querySelector('[data-browse-detail]')).toBeNull();
    fireEvent.click(within(card('code-review@claude-plugins-official')).getByRole('button', { name: 'View Code review' }));
    expect(document.querySelector('[data-plugin-detail]')!.getAttribute('data-plugin-detail')).toBe('code-review@claude-plugins-official');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Browse' }));
    expect(document.querySelector('[data-plugin-detail]')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Browse' }).getAttribute('aria-checked')).toBe('true');
  });

  it('an uninstall from an installed card’s detail keeps its result and Reload again above the grid it returns to (scale review D scalpel-1#2)', async () => {
    await ready();
    await toBrowse();
    fireEvent.click(within(card('code-review@claude-plugins-official')).getByRole('button', { name: 'View Code review' }));
    const detail = document.querySelector<HTMLElement>('[data-plugin-detail]')!;
    fireEvent.keyDown(within(detail).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall…' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('checkbox', { name: 'I understand' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(invoked('plugins.uninstall')).toHaveLength(1));
    installed = installed.filter((p) => p.id !== 'code-review@claude-plugins-official');
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(document.querySelector('[data-plugin-detail]')).toBeNull());
    act(() =>
      emit('plugins.operation', event({ opId: 'pop-1', action: 'uninstall', target: 'code-review@claude-plugins-official', phase: 'done', outcome: { ok: true, result: { message: 'Successfully uninstalled plugin: code-review (scope: user)' } }, reload: { sessions: [{ appSessionId: ID, outcome: 'not_reflected', error: null }] } })),
    );
    const gone = section('browse').querySelector<HTMLElement>('[data-plugin-result="code-review@claude-plugins-official"]')!;
    expect(gone).toBeTruthy();
    expect(within(gone).getByRole('status').textContent).toContain('Successfully uninstalled plugin: code-review (scope: user)');
    fireEvent.click(within(gone).getByRole('button', { name: 'Reload again' }));
    await waitFor(() => expect(backend.calls.filter((c) => c.subtype === 'reload_plugins')).toHaveLength(1));
  });

  it('a failed marketplace or installed read says so above the grid with its own Retry, never a silent Installed filter (scale review D scalpel-3#1)', async () => {
    let refuse = true;
    const markets = () => ({ marketplaces: [{ name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-scratch/market', installLocation: '/tmp/e8-scratch/market' }, official] });
    backend.script('marketplaces.list', () => {
      if (refuse) throw new WidgetBackendError({ code: 'internal', message: 'marketplaces unreadable' });
      return markets();
    });
    await ready();
    await toBrowse();
    const warnings = () => [...section('browse').querySelectorAll<HTMLElement>('[data-browse-dependency]')];
    // no marketplace answer: the installed official identities are not joined in, and Browse says why
    expect(section('browse').querySelector('[data-browse-card="code-review@claude-plugins-official"]')).toBeNull();
    expect(warnings().map((w) => w.getAttribute('data-browse-dependency'))).toEqual(['marketplaces']);
    expect(warnings()[0].textContent).toContain("Couldn't load your marketplaces.");
    expect(warnings()[0].textContent).toContain('marketplaces unreadable');
    // Installed alone: without the marketplaces the installed identities cannot be joined, so no empty result is claimed
    // (review round 1)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Filter' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Not installed' }));
    fireEvent.keyDown(screen.getAllByRole('menuitemcheckbox')[0], { key: 'Escape' });
    expect(section('browse').querySelector('[data-browse-card]')).toBeNull();
    expect(within(section('browse')).queryByText('Nothing matches these filters.')).toBeNull();
    expect(within(section('browse')).queryByText('Nothing to browse yet. Add a marketplace to see what it offers.')).toBeNull();
    const unknown = section('browse').querySelector<HTMLElement>('[data-browse-unknown]')!;
    expect(unknown.textContent).toContain("Can't say what matches until the lists above are read.");
    refuse = false;
    const asked = invoked('marketplaces.list').length;
    fireEvent.click(within(warnings()[0]).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(invoked('marketplaces.list').length).toBe(asked + 1));
    await waitFor(() => expect(card('code-review@claude-plugins-official')).toBeTruthy());
    expect(warnings()).toEqual([]);
    // a later failed installed read keeps the last Installed labels, and says they are the last read's
    backend.script('plugins.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'Path does not exist: /nope' });
    });
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(warnings().map((w) => w.getAttribute('data-browse-dependency'))).toEqual(['installed']));
    expect(warnings()[0].textContent).toContain('Path does not exist: /nope · showing the last value it reported');
  });

  it('no cards while the marketplaces are unread is not "nothing to browse": the body says it cannot tell, with Retry (review round 1 of D scalpel-3#1)', async () => {
    let refuse = true;
    backend.script('marketplaces.list', () => {
      if (refuse) throw new WidgetBackendError({ code: 'internal', message: 'marketplaces unreadable' });
      return { marketplaces: [official] };
    });
    backend.script('plugins.available', () => ({ plugins: [] }));
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
    const unknown = await waitFor(() => {
      const shown = section('browse').querySelector<HTMLElement>('[data-browse-unknown]');
      expect(shown).toBeTruthy();
      return shown!;
    });
    expect(within(section('browse')).queryByText('Nothing to browse yet. Add a marketplace to see what it offers.')).toBeNull();
    expect(within(section('browse')).queryByText('Nothing matches these filters.')).toBeNull();
    refuse = false;
    fireEvent.click(within(unknown).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(card('code-review@claude-plugins-official')).toBeTruthy());
    expect(section('browse').querySelector('[data-browse-unknown]')).toBeNull();
  });

  it('a zero install count is never shown, and Most popular is not offered when 0 is the only count', async () => {
    backend.script('plugins.available', () => ({ plugins: [offered('zero', 0), directory('alpha')] }));
    await ready();
    await toBrowse();
    expect(card('zero@claude-plugins-official').querySelector('[data-install-count]')).toBeNull();
    expect(card('zero@claude-plugins-official').textContent).not.toContain('0 installs');
    fireEvent.click(within(card('zero@claude-plugins-official')).getByRole('button', { name: 'View Zero' }));
    expect(within(document.querySelector<HTMLElement>('[data-browse-detail]')!).getByText('from claude-plugins-official · 1.2.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Browse' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort by' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['●Name']);
  });

  it('a third-party marketplace named anthropic is its own section and Source, apart from Anthropic & Partners', async () => {
    backend.script('marketplaces.list', () => ({ marketplaces: [{ name: 'anthropic', source: 'github', locator: 'someone/anthropic', installLocation: '/tmp/e8-scratch/claude-config/plugins/marketplaces/anthropic' }, official] }));
    backend.script('plugins.available', () => ({ plugins: [offered('code-simplifier', 3_448), { pluginId: 'x@anthropic', name: 'x', marketplaceName: 'anthropic', description: 'Not Anthropic’s', version: null, source: './plugins/x', installCount: null }] }));
    installed = [plugin('e8-probe@e8-scratch')];
    await ready();
    await toBrowse();
    const headings = () => [...section('browse').querySelectorAll('[data-browse-section]')].map((h) => h.getAttribute('aria-label'));
    const ids = () => [...section('browse').querySelectorAll('[data-browse-card]')].map((c) => c.getAttribute('data-browse-card'));
    expect(headings()).toEqual(['From Anthropic & Partners', 'anthropic']);
    expect(card('x@anthropic').getAttribute('data-section')).not.toBe(card('code-simplifier@claude-plugins-official').getAttribute('data-section'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Filter' }), { key: 'Enter' });
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent!.replace('●', ''))).toEqual(['All sources', 'From Anthropic & Partners', 'anthropic']);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'anthropic' }));
    expect(ids()).toEqual(['x@anthropic']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Filter' }), { key: 'Enter' }); // a radio's choice closes the menu
    expect(screen.getByRole('menuitemradio', { name: 'anthropic' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'From Anthropic & Partners' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'From Anthropic & Partners' }));
    expect(ids()).toEqual(['code-simplifier@claude-plugins-official']);
  });

  it('the switch, clicked on the view shown, returns from its detail to its list: Browse’s card detail and an installed card’s', async () => {
    await ready();
    await toBrowse();
    fireEvent.click(within(card('dir-only@anthropic-plugin-directory')).getByRole('button', { name: 'View Dir only' }));
    expect(document.querySelector('[data-browse-detail]')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
    expect(document.querySelector('[data-browse-detail]')).toBeNull();
    expect(section('browse').className).not.toContain('hidden');
    expect(screen.getByRole('radio', { name: 'Browse' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(card('code-review@claude-plugins-official')).getByRole('button', { name: 'View Code review' }));
    expect(document.querySelector('[data-plugin-detail]')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Browse' }));
    expect(document.querySelector('[data-plugin-detail]')).toBeNull();
    expect(section('browse').className).not.toContain('hidden');
  });

  it('a card’s detail outlives a change whose catalogue answers before the installed list, and a card the reads no longer list: only Back leaves it', async () => {
    await ready();
    await toBrowse();
    const id = 'counted-none@claude-plugins-official';
    fireEvent.click(within(card(id)).getByRole('button', { name: 'View Counted none' }));
    const detail = () => document.querySelector<HTMLElement>('[data-browse-detail]');
    expect(detail()!.getAttribute('data-browse-detail')).toBe(id);
    // the install of the card's plugin, as the engine answers it: --available leaves the plugin out at once, and the
    // installed list that adds it back answers later
    let listed!: (value: { plugins: InstalledPlugin[] }) => void;
    backend.script('plugins.list', () => new Promise((resolve) => (listed = resolve)));
    backend.script('plugins.available', () => ({ plugins: [directory('frontend-design'), offered('frontend-design', 1_290_640), offered('code-simplifier', 3_448), directory('dir-only')] }));
    const asked = invoked('plugins.available').length;
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.available').length).toBe(asked + 1));
    await act(async () => {}); // the catalogue's answer drawn, the installed list still in flight
    expect(detail()?.getAttribute('data-browse-detail')).toBe(id);
    await act(async () => listed({ plugins: [...installed, plugin(id)] }));
    expect(detail()?.getAttribute('data-browse-detail')).toBe(id);
    await waitFor(() => expect(within(detail()!).queryByRole('button', { name: 'Install' })).toBeNull()); // installed here now
    // uninstalled elsewhere and no longer offered: the detail stays on the card as last read, until Back
    backend.script('plugins.list', () => ({ plugins: installed }));
    const lists = invoked('plugins.list').length;
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.list').length).toBe(lists + 1));
    await act(async () => {});
    expect(card(id)).toBeNull(); // gone from the grid beneath
    expect(detail()?.getAttribute('data-browse-detail')).toBe(id);
    expect(within(detail()!).queryByRole('button', { name: 'Install' })).toBeNull(); // as last read: installed here
    fireEvent.click(within(detail()!).getByRole('button', { name: 'Back to Browse' }));
    expect(detail()).toBeNull();
    expect(section('browse').className).not.toContain('hidden');
  });

  it('overlapping changes keep a card’s detail while an installed read owed to the second change has not yet run (review, M5 round 2)', async () => {
    await ready();
    await toBrowse();
    const id = 'counted-none@claude-plugins-official';
    fireEvent.click(within(card(id)).getByRole('button', { name: 'View Counted none' }));
    const detail = () => document.querySelector<HTMLElement>('[data-browse-detail]');
    let finishOld!: (value: { plugins: InstalledPlugin[] }) => void;
    let lists = 0;
    backend.script('plugins.list', () => (++lists === 1 ? new Promise((resolve) => (finishOld = resolve)) : { plugins: [...installed, plugin(id)] }));
    const beforeAvailable = invoked('plugins.available').length;
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(lists).toBe(1));
    await waitFor(() => expect(invoked('plugins.available').length).toBe(beforeAvailable + 1));
    await act(async () => {});
    // a later install completes while the first change's installed listing is still in flight: its reread is owed
    backend.script('plugins.available', () => ({ plugins: [directory('frontend-design'), offered('frontend-design', 1_290_640), offered('code-simplifier', 3_448), directory('dir-only')] }));
    act(() => emit('plugins.changed', {}));
    await waitFor(() => expect(invoked('plugins.available').length).toBe(beforeAvailable + 2));
    await act(async () => {});
    expect(detail()?.getAttribute('data-browse-detail')).toBe(id);
    // the stale listing answers (nothing fetching for a moment), then the owed one adds the card back as installed
    await act(async () => finishOld({ plugins: installed }));
    await waitFor(() => expect(lists).toBe(2));
    await waitFor(() => expect(card(id)?.getAttribute('data-installed')).toBe('here'));
    expect(detail()?.getAttribute('data-browse-detail')).toBe(id);
  });

  it('every open starts on My items with no catalogue read, whatever the last open showed', async () => {
    await ready();
    await toBrowse();
    expect(invoked('plugins.available')).toHaveLength(1);
    cleanup();
    mount();
    await waitFor(() => expect(row('e8-probe@e8-scratch')).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'My items' }).getAttribute('aria-checked')).toBe('true');
    expect(section('browse')).toBeNull();
    expect(invoked('plugins.available')).toHaveLength(1);
  });
});
