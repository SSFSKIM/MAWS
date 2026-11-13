// Plugins, Connectors and Skills before the first message (UX wave U11a, §D, l8-settings-03; A4): an unstarted tab (a New
// chat with nothing sent: a setup intent, no record, no engine) lists what is configured on disk for the folder it chose,
// and a tab set to another machine says the lists show once the chat starts there. The inventory's rows are built in the
// shapes `customization.inventory` answers; the skills' invocations follow P3
// (spikes/protocol-probe/findings-uxwave-u11-skill-names.txt): `/<name> ` for a project's and a person's skill,
// `/<manifest name>:<name> ` for a plugin's, none for a plugin skill whose manifest name is unknown.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { CustomizationInventory } from '@shared/ipc/schema/customization';
import type { MachineRef } from '@shared/machine/ref';
import { addressOf } from '@shared/machine/address';
import { project, record, status } from '../../../../test/support/builders';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { PlusMenu } from '../composer/plus-menu/PlusMenu';
import { useCustomizeProject, useDiscoverRequest } from '../customize/open';
import { resetRemoteSpawn, useRemoteSpawn } from '../sessions/remote-spawn';
import { putIntent, intent, resetSetupStore } from '../test-support/setup-intents';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { McpWidget } from './McpWidget';
import { useLibraryStore } from './plugins/library-store';
import { forgetKeptOperations } from './plugins/operation';
import { PluginsWidget } from './PluginsWidget';
import { useReadLoads } from './read';
import { SkillsWidget } from './SkillsWidget';

const BARE = 'app-new-chat' as AppSessionId;
const ID = at(BARE);
const P = at('project-atlas' as ProjectId);
const ATLAS = '/work/atlas';
const CONFIG_HOME = '/config';
const NOT_YET = 'Available once the session starts';
let backend: WidgetBackend;
let inventories: Map<string, CustomizationInventory | Promise<CustomizationInventory>>;

const skill = (name: string, source: 'user' | 'project' | 'plugin', over: Partial<CustomizationInventory['skills'][number]> = {}) => ({ name, description: `${name} on disk`, source, path: `/disk/${source}/${name}/SKILL.md`, plugin: null, ...over });
const ATLAS_INVENTORY: CustomizationInventory = {
  skills: [
    skill('review', 'project'),
    skill('translate', 'user'),
    skill('draw', 'plugin', { plugin: 'fx-entry@fx-market', pluginName: 'fx-manifest' }), // the manifest names it otherwise
    skill('sketch', 'plugin', { plugin: 'fx-old@fx-market', pluginName: null }), // the manifest's name could not be read
    skill('trace', 'plugin', { plugin: 'fx-older@fx-market' }), // an engine host of build F: no pluginName at all
  ],
  servers: [
    { name: 'notion', scope: 'project', path: `${ATLAS}/.mcp.json`, transport: 'http' },
    { name: 'notion', scope: 'user', path: '/config/.claude.json', transport: 'http' }, // the user's entry wins over the project's
    { name: 'files', scope: 'local', path: '/config/.claude.json', transport: 'stdio' },
  ],
  warnings: [],
  serversRead: true,
};

beforeEach(() => {
  backend = createWidgetBackend({ root: process.cwd(), statuses: [] });
  inventories = new Map([[ATLAS, ATLAS_INVENTORY]]);
  backend.script('customization.inventory', (input) => {
    const { cwd } = input as { cwd: string | null };
    return inventories.get(cwd ?? 'user') ?? { skills: [], servers: [], warnings: [], serversRead: true };
  });
  backend.script('plugins.env', () => ({ binary: '/bin/claude', binaryError: null, configHome: CONFIG_HOME, globalConfig: '/config/.claude.json' }));
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('plugins.manifest', () => ({ manifests: [] }));
  backend.script('mods.list', () => []);
  window.maws = backend.bridge();
  resetSetupStore();
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'Atlas', directory: ATLAS })]]), records: new Map(), engine: new Map() });
  putIntent(intent({ appSessionId: ID, projectId: P, location: { kind: 'directory', path: ATLAS } }));
});
afterEach(() => {
  cleanup();
  forgetKeptOperations();
  resetSetupStore();
  resetRemoteSpawn();
  resetComposerStore();
  useReadLoads.setState({ loads: new Map() });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useMachines.setState({ roster: 'unread', machines: new Map() });
  useCustomizeProject.setState({ projectId: undefined });
  useDiscoverRequest.setState({}, true);
  delete (window as { maws?: unknown }).maws;
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const mount = (Widget: typeof McpWidget, close: () => void = () => {}, id: AppSessionId = ID) => render(<QueryClientProvider client={client()}><Widget appSessionId={id} args="" close={close} /></QueryClientProvider>);
const invoked = (command: string) => backend.calls.filter((c) => c.command === command).map((c) => c.input);
const lead = () => document.querySelector('[data-before-start]')?.textContent ?? null;
const noNotYet = () => expect(document.body.textContent).not.toContain(NOT_YET);
const startedStatus = (process: EngineSessionStatus['process']): EngineSessionStatus => ({ ...status(BARE, { process }), appSessionId: ID });

describe('the Connectors dialog before the first message', () => {
  it('lists one row per configured name with its scope in Customize’s words, and no switch, Reconnect or Sign in', async () => {
    mount(McpWidget);
    const list = await screen.findByRole('list', { name: 'Connectors' });
    expect(lead()).toBe('Configured for Atlas. Connection state, and connectors from plugins, show once the chat starts.');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('[data-connector-name]')?.textContent)).toEqual(['notion', 'files']);
    expect(rows.map((row) => row.querySelector('[data-connector-state]')?.textContent)).toEqual(['user scope', 'local scope']);
    expect(within(list).queryByRole('switch')).toBeNull();
    expect(within(list).queryByRole('button', { name: /Reconnect|Sign in/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeTruthy();
    expect(invoked('customization.inventory')).toEqual([{ cwd: ATLAS }]);
    expect(invoked('session.mcpStatus')).toEqual([]);
    noNotYet();
  });

  it('opens a row onto its transport and the file that configures it', async () => {
    mount(McpWidget);
    const list = await screen.findByRole('list', { name: 'Connectors' });
    const notion = within(list).getAllByRole('listitem')[0]!;
    fireEvent.click(notion.querySelector('button[aria-expanded]')!);
    expect(notion.textContent).toContain('http');
    expect(notion.textContent).toContain('/config/.claude.json');
  });

  it('says No connectors under its line when nothing is configured, and names the folder of a chat in no project', async () => {
    resetSetupStore();
    putIntent(intent({ appSessionId: ID, projectId: null, location: { kind: 'directory', path: '/Users/someone/scratch' } }));
    mount(McpWidget);
    expect(await screen.findByText('No connectors')).toBeTruthy();
    expect(lead()).toBe('Configured for ~/scratch. Connection state, and connectors from plugins, show once the chat starts.');
  });

  it('shows a failed read in its words with Retry in the list’s place', async () => {
    let fail = true;
    backend.script('customization.inventory', () => {
      if (fail) throw new WidgetBackendError({ code: 'host_unavailable', message: 'The engine host is not running' });
      return ATLAS_INVENTORY;
    });
    mount(McpWidget);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The engine host is not running');
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Connectors' })).toBeTruthy();
  });
});

describe('the Skills dialog before the first message', () => {
  it('lists the skills on disk in Customize’s three groups under its line, with no Reload', async () => {
    mount(SkillsWidget);
    await screen.findByRole('region', { name: 'In this project' });
    expect(lead()).toBe('On disk for Atlas. The chat may load more once it starts.');
    const rowsOf = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('listitem').map((li) => li.getAttribute('data-skill-row'));
    expect(rowsOf('In this project')).toEqual(['review']);
    expect(rowsOf('Created by you')).toEqual(['translate']);
    expect(rowsOf('From marketplaces you added')).toEqual(['draw', 'sketch', 'trace']);
    expect(screen.queryByRole('button', { name: 'Reload skills' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search skills' })).toBeTruthy();
    expect(invoked('session.getSkillsDialog')).toEqual([]);
    noNotYet();
  });

  it('inserts /<name> for a project’s and a person’s skill and /<manifest name>:<name> for a plugin’s; one with no manifest name has no Use in chat', async () => {
    const close = vi.fn();
    const insertText = vi.fn();
    registerFocusTarget(ID, { focusEditor: () => {}, focusFrame: () => {}, insertText });
    mount(SkillsWidget, close);
    await screen.findByRole('region', { name: 'In this project' });
    const use = (name: string) => within(document.querySelector<HTMLElement>(`[data-skill-row="${name}"]`)!).queryByRole('button', { name: 'Use in chat' });
    expect(use('sketch')).toBeNull();
    expect(use('trace')).toBeNull();
    for (const [name, text] of [['review', '/review '], ['translate', '/translate '], ['draw', '/fx-manifest:draw ']] as const) {
      fireEvent.click(use(name)!);
      expect(insertText).toHaveBeenLastCalledWith(text);
    }
    expect(close).toHaveBeenCalledTimes(3);
    expect(invoked('session.send')).toEqual([]);
  });
});

describe('the Plugins dialog before the first message', () => {
  it('manages the plugins of the project’s folder, its loaded line reading Not observed yet alone', async () => {
    mount(PluginsWidget);
    await waitFor(() => expect(invoked('plugins.list')).toContainEqual({ cwd: ATLAS }));
    const line = document.querySelector<HTMLElement>('[data-plugins-loaded]')!;
    expect(line.textContent).toBe('Not observed yet');
    expect(within(line).queryByRole('button')).toBeNull();
    noNotYet();
    expect(invoked('session.observedFacts')).toEqual([]);
    expect(invoked('session.acquire')).toEqual([]);
  });

  it('reads the repository’s root for a worktree not yet made, and the engine’s config home with no folder chosen', async () => {
    resetSetupStore();
    putIntent(intent({ appSessionId: ID, projectId: P, location: { kind: 'newWorktree', repoRoot: ATLAS, name: 'atlas-1a2b', branch: { kind: 'new', name: 'worktree-atlas-1a2b', base: 'HEAD' } } }));
    const first = mount(PluginsWidget);
    await waitFor(() => expect(invoked('plugins.list')).toContainEqual({ cwd: ATLAS }));
    first.unmount();
    resetSetupStore();
    putIntent(intent({ appSessionId: ID, projectId: null, location: null }));
    mount(PluginsWidget);
    await waitFor(() => expect(invoked('plugins.list')).toContainEqual({ cwd: CONFIG_HOME }));
  });

  it('opens Customize for the user configuration from Open Discover when no folder is chosen', async () => {
    resetSetupStore();
    putIntent(intent({ appSessionId: ID, projectId: null, location: null }));
    const close = vi.fn();
    mount(PluginsWidget, close);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Discover' }));
    expect(close).toHaveBeenCalled();
    expect(useCustomizeProject.getState()).toEqual({ projectId: null });
    expect(useDiscoverRequest.getState()).toEqual({ cwd: null });
  });
});

describe('a tab set to another machine', () => {
  const elsewhere = addressOf(OTHER_MACHINE, BARE);
  beforeEach(() => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { ref: OTHER_MACHINE, name: 'studio' } as never]]) });
  });

  it('draws only its sentence in each dialog, and reads nothing of this Mac’s', async () => {
    useRemoteSpawn.setState({ chosen: new Map([[ID, { machine: OTHER_MACHINE as MachineRef, name: 'studio', checkout: '/srv/atlas', key: null }]]) });
    for (const Widget of [McpWidget, SkillsWidget, PluginsWidget]) {
      mount(Widget);
      expect(await screen.findByText('Shown once the chat starts on studio')).toBeTruthy();
      noNotYet();
      cleanup();
    }
    expect(backend.calls.filter((c) => c.command === 'customization.inventory' || c.command.startsWith('plugins.') || c.command.startsWith('marketplaces.'))).toEqual([]);
  });

  it('says so for an unstarted tab whose id another machine holds', async () => {
    resetSetupStore();
    putIntent(intent({ appSessionId: elsewhere, projectId: null, location: null }));
    mount(McpWidget, () => {}, elsewhere);
    expect(await screen.findByText('Shown once the chat starts on studio')).toBeTruthy();
  });
});

describe('held open', () => {
  it('draws no answer of the old folder while the new folder’s read is out', async () => {
    let answer!: (value: CustomizationInventory) => void;
    inventories.set('/work/other', new Promise((resolve) => (answer = resolve)));
    mount(McpWidget);
    await screen.findByRole('list', { name: 'Connectors' });
    act(() => putIntent(intent({ appSessionId: ID, projectId: null, location: { kind: 'directory', path: '/work/other' } })));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Connectors' })).toBeNull());
    expect(screen.getByText('Reading configuration…')).toBeTruthy();
    expect(document.body.textContent).not.toContain('notion');
    await act(async () => answer({ ...ATLAS_INVENTORY, servers: [{ name: 'linear', scope: 'project', path: '/work/other/.mcp.json', transport: 'http' }] }));
    const list = await screen.findByRole('list', { name: 'Connectors' });
    expect(within(list).getAllByRole('listitem').map((row) => row.querySelector('[data-connector-name]')?.textContent)).toEqual(['linear']);
  });

  it('draws a started chat’s dialog when the chat starts while it is open: the rows, then Starting…, then the live rows', async () => {
    backend.script('session.mcpStatus', () => ({ mcpServers: [{ name: 'notion', status: 'connected', tools: [{ name: 'search' }] }] }));
    mount(McpWidget);
    await screen.findByRole('list', { name: 'Connectors' });
    act(() => useSessions.setState({ records: new Map([[ID, { ...record(BARE), appId: ID }]]), engine: new Map([[ID, startedStatus('starting')]]) }));
    await waitFor(() => expect(document.body.textContent).toContain('Starting…'));
    expect(screen.queryByRole('list', { name: 'Connectors' })).toBeNull();
    expect(lead()).toBeNull();
    act(() => useSessions.setState({ engine: new Map([[ID, startedStatus('ready')]]) }));
    const list = await screen.findByRole('list', { name: 'Connectors' });
    expect(within(list).getByRole('switch')).toBeTruthy();
    expect(within(list).getByText('Connected')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Starting…');
  });

  it('closes a dialog open when its tab leaves for another machine', async () => {
    for (const Widget of [McpWidget, SkillsWidget, PluginsWidget]) {
      const close = vi.fn();
      mount(Widget, close);
      await waitFor(() => expect(lead() ?? document.querySelector('[data-plugins-loaded]')?.textContent).toBeTruthy());
      act(() => useRemoteSpawn.setState({ chosen: new Map([[ID, { machine: OTHER_MACHINE as MachineRef, name: 'studio', checkout: null, key: null }]]) }));
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      cleanup();
      resetRemoteSpawn();
    }
  });
});

// The fix wave of M7's review: a change the plugin CLI made (`plugins.changed`, which the runner sends after every
// operation) marks the folder's inventory stale whether or not any reader of it is mounted or may fetch, so a reader
// opened again inside the stale time reads the new answer.
describe('a plugin change while no reader of the inventory is fetching', () => {
  let changed: () => void;
  beforeEach(() => {
    const base = backend.bridge();
    const listeners = new Set<(payload: unknown) => void>();
    window.maws = {
      ...base,
      on(name, listener) {
        if (name !== 'plugins.changed') return base.on(name, listener);
        const entry = listener as (payload: unknown) => void;
        listeners.add(entry);
        return () => void listeners.delete(entry);
      },
    };
    changed = () => listeners.forEach((listener) => listener({}));
  });
  const withSkill = (name: string): CustomizationInventory => ({ ...ATLAS_INVENTORY, skills: [skill(name, 'project')], servers: [{ name, scope: 'project', path: `${ATLAS}/.mcp.json`, transport: 'http' }] });

  it('reads again when the "+" menu opens after a change made while it was closed', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={client()}><PlusMenu appSessionId={ID} cwd={ATLAS} editor={{ current: null }} /></QueryClientProvider>);
    const openConnectors = async () => {
      await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
      act(() => screen.getByRole('menuitem', { name: 'Connectors' }).focus());
      await user.keyboard('{ArrowRight}');
    };
    await openConnectors();
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('notionuser scope'));
    await user.keyboard('{Escape}{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Connectors' })).toBeNull());
    inventories.set(ATLAS, withSkill('linear'));
    act(() => changed());
    expect(invoked('customization.inventory')).toEqual([{ cwd: ATLAS }]); // a closed menu starts no read
    await openConnectors();
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain('linearproject scope'));
    expect(invoked('customization.inventory')).toEqual([{ cwd: ATLAS }, { cwd: ATLAS }]);
  });

  it('reads again when /skills opens after a change made while no dialog was open', async () => {
    const shared = client();
    const open = () => render(<QueryClientProvider client={shared}><SkillsWidget appSessionId={ID} args="" close={() => {}} /></QueryClientProvider>);
    const first = open();
    await screen.findByRole('region', { name: 'In this project' });
    expect(document.querySelector('[data-skill-row="review"]')).toBeTruthy();
    first.unmount();
    inventories.set(ATLAS, withSkill('linear'));
    act(() => changed());
    open();
    await waitFor(() => expect(document.querySelector('[data-skill-row="linear"]')).toBeTruthy());
    expect(document.querySelector('[data-skill-row="review"]')).toBeNull();
  });
});

describe('the "+" › Connectors submenu', () => {
  const openConnectors = async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={client()}><PlusMenu appSessionId={ID} cwd={ATLAS} editor={{ current: null }} /></QueryClientProvider>);
    await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
    const trigger = screen.getByRole('menuitem', { name: 'Connectors' });
    act(() => trigger.focus());
    await user.keyboard('{ArrowRight}');
    return user;
  };
  const rowTexts = () => screen.getAllByRole('menuitem').map((item) => item.textContent).filter((text) => text === 'notionuser scope' || text === 'fileslocal scope');

  it('lists the folder’s configured connectors with their scopes before the start, reading the inventory once for two opens', async () => {
    const user = await openConnectors();
    await waitFor(() => expect(rowTexts()).toEqual(['notionuser scope', 'fileslocal scope']));
    expect(screen.queryByText('Live details are unavailable until this session is running')).toBeNull();
    await user.keyboard('{Escape}{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
    act(() => screen.getByRole('menuitem', { name: 'Connectors' }).focus());
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(rowTexts()).toEqual(['notionuser scope', 'fileslocal scope']));
    expect(invoked('customization.inventory')).toEqual([{ cwd: ATLAS }]);
  });

  it('says No connectors with nothing configured, and the remote sentence for a tab set to another machine', async () => {
    inventories.set(ATLAS, { skills: [], servers: [], warnings: [], serversRead: true });
    await openConnectors();
    expect(await screen.findByText('No connectors')).toBeTruthy();
    cleanup();
    useRemoteSpawn.setState({ chosen: new Map([[ID, { machine: OTHER_MACHINE as MachineRef, name: 'studio', checkout: null, key: null }]]) });
    const before = invoked('customization.inventory').length;
    await openConnectors();
    expect(await screen.findByText('Shown once the chat starts on studio')).toBeTruthy();
    expect(invoked('customization.inventory')).toHaveLength(before);
  });

  it('words a started session’s connectors as the dialog does', async () => {
    resetSetupStore();
    const ready = { ...startedStatus('ready'), mcpServers: [{ name: 'notion', status: 'needs-auth', source: null }, { name: 'files', status: 'disabled', source: null }] };
    useSessions.setState({ records: new Map([[ID, { ...record(BARE), appId: ID }]]), engine: new Map([[ID, ready]]) });
    await openConnectors();
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(expect.arrayContaining(['notionSign in needed', 'filesOff'])));
    expect(invoked('customization.inventory')).toEqual([]);
  });

  it('lists no plugin rows and no unavailable sentence in the Plugins submenu before the start', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={client()}><PlusMenu appSessionId={ID} cwd={ATLAS} editor={{ current: null }} /></QueryClientProvider>);
    await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
    act(() => screen.getByRole('menuitem', { name: 'Plugins' }).focus());
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitem', { name: /^Plugins in this chat…/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Manage plugins…' })).toBeTruthy();
    expect(screen.queryByText('Live details are unavailable until this session is running')).toBeNull();
  });
});
