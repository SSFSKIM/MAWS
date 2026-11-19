// UX wave U11c M2 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D; Acceptance C1, C2, C3, C11):
// Customize's page with My items | Discover outside and "Show:" inside. The head's two rows and the tools of each view
// and Show; a change of view keeps Show and a change of Show keeps the view, each written as the page's two fields; what
// a person started is held by the page for its place, so an install, a removal and a sign-in outlive a change of view,
// of Show and of project; the ways in; U11g's action in the head. Every name here is invented.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName, EventName, PreloadBridge } from '@shared/ipc/schema';
import type { CatalogHome, CatalogItem, CatalogQueryInput } from '@shared/ipc/schema/catalog';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { project, status } from '../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { useSettings } from '../stores/settings';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { mountCustomize } from '../test-support/customize-page';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { CustomizeView } from './CustomizeView';
import { forgetKeptOperations } from '../widgets/plugins/operation';
import { resetCatalogStore } from '../stores/catalog';
import { heard, resetSignIns } from './connectors/sign-in';
import { NO_CHOICES, useDiscoverStore } from './discover/store';
import { item } from './discover/test-items';
import { openCustomize, openDiscover, openMine, useCustomizeProject } from './open';
import { useCustomizePage } from './page';

const A = at('project-quay' as ProjectId);
const B = at('project-dock' as ProjectId);
const QUAY = '/tmp/page/quay';
const DOCK = '/tmp/page/dock';
const HOME = '/tmp/page/config';
const BINARY = '/opt/claude/engine';

const ledger = item({ id: 'https://example.test/harbour#plugins/quay-ledger', name: 'quay-ledger', install: { kind: 'plugin', marketplaceSource: 'harbour/market', marketplaceName: 'harbour-market', pluginName: 'quay-ledger', ref: null, present: true }, sources: ['test:harbour'] });
const berth = item({ id: 'https://example.test/harbour#plugins/berth-notes', name: 'berth-notes', install: { kind: 'plugin', marketplaceSource: 'harbour/annex', marketplaceName: 'harbour-annex', pluginName: 'berth-notes', ref: null, present: false }, sources: ['test:harbour'] });
const installedLedger = { id: 'quay-ledger@harbour-market', name: 'quay-ledger', marketplace: 'harbour-market', version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `${HOME}/plugins/cache/quay-ledger`, errors: [], notes: [], installedAt: null, lastUpdated: null, here: false, coversHere: true, projectEnabled: true };
const buoyLog = { ...installedLedger, id: 'buoy-log@harbour-market', name: 'buoy-log', installPath: `${HOME}/plugins/cache/buoy-log` };

let calls: { name: string; input: unknown }[];
let listeners: Map<string, Set<(payload: unknown) => void>>;
let held: Map<string, (outcome?: unknown, reload?: unknown) => void>; // a held command's receipt or its done (with its reload), released by the test
let holdReceipt: Set<CommandName>;
let holdDone: Set<CommandName>;
let installed: (typeof installedLedger)[];
let listAnswer: Promise<unknown> | null; // plugins.list's answer, when a test holds it
let servers: { name: string; scope: string; path: string; transport: string }[];
let opSeq: number;
let extraSkills: object[]; // UX wave U11's skill actions
let skillFileAnswer: unknown;
let envAnswer: Promise<unknown> | null; // plugins.env's answer, when a test holds it

const deliver = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
const emit = (name: EventName, payload: unknown) => {
  act(() => {
    deliver(name, payload);
  });
};
const invoked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.input);
let shelf: CatalogItem[];
const home = (): CatalogHome => ({ featured: null, shelves: [{ key: 'added', kind: 'added', title: 'Your sources', items: shelf, total: shelf.length }], categories: [], total: shelf.length });
const ACTION_OF: Partial<Record<CommandName, string>> = { 'plugins.install': 'install', 'marketplaces.add': 'marketplace-add', 'connectors.remove': 'mcp-remove' };

function answer(name: CommandName, input: unknown): unknown {
  switch (name) {
    case 'plugins.env':
      return envAnswer ?? { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: `${HOME}/.claude.json` };
    case 'plugins.list':
      return listAnswer ?? { plugins: installed };
    case 'marketplaces.list':
      return { marketplaces: [] };
    case 'plugins.manifest':
      return { manifests: [] };
    case 'mods.list':
      return [];
    case 'customization.inventory':
      return { skills: [{ name: 'tide-tables', description: 'Reads the tides', source: 'project', path: `${QUAY}/.claude/skills/tide-tables/SKILL.md`, plugin: null }, ...extraSkills], servers, warnings: [], serversRead: true };
    case 'layout.openInApps': // UX wave U11's skill actions: the rows this Mac has
      return { apps: [{ id: 'zed', name: 'Zed' }, { id: 'terminal', name: 'Terminal' }, { id: 'finder', name: 'Finder' }] };
    case 'customization.skillFile':
      return typeof skillFileAnswer === 'function' ? (skillFileAnswer as () => unknown)() : skillFileAnswer;
    case 'catalog.home':
      return home();
    case 'catalog.query':
      return { items: shelf.filter((i) => i.name.includes((input as CatalogQueryInput).text ?? '')), nextCursor: null, total: shelf.length, restarted: false };
    case 'catalog.item':
      return shelf.find((i) => i.id === (input as { id: string }).id);
    case 'catalog.sources':
      return [];
    case 'catalog.icon':
      return { dataUrl: null };
    case 'catalog.pluginIcons':
      return { icons: (input as { plugins: { id: string }[] }).plugins.map(({ id }) => ({ id, iconUrl: null })) };
    case 'catalog.postures':
      return { servers: servers.map((s) => ({ name: s.name, scope: s.scope, path: s.path, authPosture: 'auth_required', fingerprint: 'print-1', revision: null, iconUrl: null })) };
    case 'session.mcpStatus':
      return { mcpServers: [] };
    case 'connectors.signInCancel':
      return { cancelled: true };
    case 'plugins.install':
    case 'marketplaces.add':
    case 'connectors.remove':
    case 'connectors.signIn': {
      const opId = `op-${++opSeq}`;
      if (name === 'connectors.signIn') {
        if (holdReceipt.has(name)) return new Promise((resolve) => held.set(name, () => resolve({ opId })));
        return { opId };
      }
      const event = (outcome: unknown = { ok: true, result: { message: `${ACTION_OF[name]} done` } }, reload?: unknown) => ({ opId, action: ACTION_OF[name], target: 'x', phase: 'done', outcome, ...(reload !== undefined && { reload }) });
      // a held done is released by the test (inside its act); an automatic one arrives while the test waits
      if (holdDone.has(name)) held.set(name, (outcome, reload) => emit('plugins.operation', event(outcome ?? undefined, reload)));
      else queueMicrotask(() => deliver('plugins.operation', event()));
      return { opId };
    }
    default:
      throw new Error(`unscripted ${name}`);
  }
}

beforeEach(() => {
  calls = [];
  listeners = new Map();
  held = new Map();
  holdReceipt = new Set();
  holdDone = new Set();
  installed = [buoyLog];
  listAnswer = null;
  servers = [{ name: 'tides', scope: 'user', path: `${HOME}/.claude.json`, transport: 'http' }];
  opSeq = 0;
  extraSkills = [];
  skillFileAnswer = { status: 'opened' };
  envAnswer = null;
  shelf = [ledger, berth];
  const bridge: PreloadBridge = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      try {
        return { ok: true, value: await answer(name, input) };
      } catch (error) {
        return { ok: false, error: { code: 'invalid_input', message: (error as Error).message } };
      }
    }) as PreloadBridge['invoke'],
    on: ((name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => void set.delete(listener);
    }) as PreloadBridge['on'],
    pathForFile: () => '',
  };
  window.maws = bridge;
  useSessions.setState({ projects: new Map([[A, project(A, 0, { name: 'Quay', directory: QUAY })], [B, project(B, 1, { name: 'Dock', directory: DOCK })]]), records: new Map(), engine: new Map() });
  useCustomizeProject.setState({ projectId: A }, true);
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
});
afterEach(() => {
  cleanup();
  forgetKeptOperations();
  resetSignIns();
  resetCatalogStore();
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useCustomizeProject.setState({ projectId: undefined }, true);
  useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useDiscoverStore.setState({ plugins: NO_CHOICES, skills: NO_CHOICES, connectors: NO_CHOICES });
  useCustomizePage.setState(useCustomizePage.getInitialState(), true);
  delete (window as { maws?: PreloadBridge }).maws;
});

const header = () => document.querySelector<HTMLElement>('[data-customize-header]')!;
const showGroup = () => within(header()).getByRole('radiogroup', { name: 'Show' });
const chooseShow = (name: 'All' | 'Plugins' | 'Skills' | 'Connectors') => fireEvent.click(within(showGroup()).getByRole('radio', { name }));
const chooseView = (name: 'My items' | 'Discover') => fireEvent.click(within(header()).getByRole('radio', { name }));
const where = () => useLayout.getState().destination;
const tools = () => header().querySelector<HTMLElement>('[data-customize-tools]');
const sheet = () => document.querySelector<HTMLElement>('[data-plugins-sheet]')!;
const resolved = () => waitFor(() => expect(sheet().querySelector('[data-plugins-details]')).toBeTruthy());
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
const shelfCard = (entry: CatalogItem) => found(`[data-discover="plugins"] [data-shelf] [data-catalog-card="${CSS.escape(entry.id)}"]`);
const pluginRow = (id: string) => found(`[data-plugin-row="${CSS.escape(id)}"]`);
const install = async (entry: CatalogItem) => {
  fireEvent.click(within(await shelfCard(entry)).getByRole('button', { name: `Add ${entry.name}` }));
  await resolved();
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
};

// A ready session MAWS runs in the page's folder: the page's attachment, whose reloads a plugin's line offers.
const attachLive = () => {
  const live = { ...status('quay-live'), appSessionId: at('quay-live' as AppSessionId), cwd: QUAY };
  useSessions.setState({ engine: new Map([[live.appSessionId, live]]) });
};
const NOT_REFLECTED = { sessions: [{ appSessionId: 'quay-live', outcome: 'not_reflected', error: null }] };
const cardIn = (tab: 'plugins' | 'skills', entry: CatalogItem) => found(`[data-discover="${tab}"] [data-shelf] [data-catalog-card="${CSS.escape(entry.id)}"]`);

describe('the head', () => {
  it('has two rows: the view switch with Showing, then Show: and its four choices with the tools; no section tab is left', async () => {
    mountCustomize({ view: 'mine', show: 'connectors' });
    const rows = [...header().children] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('radiogroup', { name: 'Library' })).toBeTruthy();
    expect(within(rows[0]!).getByRole('combobox', { name: 'Project' })).toHaveProperty('value', A);
    expect(rows[1]!.textContent).toMatch(/^Show:/);
    const choices = within(rows[1]!).getAllByRole('radio');
    expect(choices.map((choice) => choice.textContent)).toEqual(['All', 'Plugins', 'Skills', 'Connectors']);
    expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true']);
    expect(rows[1]!.contains(tools())).toBe(true);
    expect(screen.queryByRole('tablist')).toBeNull();
    for (const name of ['Plugins', 'Skills', 'Connectors']) expect(screen.queryByRole('tab', { name })).toBeNull();
    await screen.findByText('tides');
    // the row's named parts (§E): its image stands before the main part (the name, what follows it, the state); then
    // the trailing controls
    const main = document.querySelector<HTMLElement>('[data-connector="tides"] [data-connector-main]')!;
    expect(main.querySelector('[data-item-image]')).toBeNull();
    expect(document.querySelector('[data-connector="tides"] > [data-item-image]')).not.toBeNull();
    expect(main.textContent).toContain('tides');
    expect(main.querySelector('[data-connector-trailing]')).toBeNull();
  });

  // the architect's ruling of 2026-11-15 on the tools line: one line, the search first, then the actions as one group, so
  // that where they no longer fit beside the search they go to the next line together, in reading order (the widths are
  // the e2e:discover case's, which measures the edges)
  it('draws the tools of each view and Show: the search, then the actions as one group', async () => {
    servers = [];
    const table: [view: 'mine' | 'discover', show: 'all' | 'plugins' | 'skills' | 'connectors', search: string, present: string[], absent: string[]][] = [
      ['mine', 'all', 'Search my items', ['New skill…', 'Add custom connector…', 'Refresh'], ['Filter', 'Sort by', 'Add', 'Sources']],
      ['mine', 'plugins', 'Search plugins', ['Filter', 'Sort by', 'Add'], ['New skill…', 'Add custom connector…', 'Refresh', 'Sources']],
      ['mine', 'skills', 'Search skills', ['New skill…', 'Refresh'], ['Filter', 'Add', 'Add custom connector…', 'Sources']],
      ['mine', 'connectors', 'Search connectors', ['Add custom connector…', 'Refresh'], ['New skill…', 'Filter', 'Sort by', 'Add', 'Sources']],
      ['discover', 'plugins', 'Search all sources', ['Refresh', 'Sources', 'Add'], ['New skill…', 'Filter', 'Add custom connector…']],
      ['discover', 'skills', 'Search all sources', ['Refresh', 'Sources'], ['New skill…', 'Add', 'Add custom connector…']],
      ['discover', 'connectors', 'Search all sources', ['Refresh', 'Sources'], ['New skill…', 'Add', 'Add custom connector…']],
      ['discover', 'all', 'Search all sources', ['Refresh', 'Sources'], ['New skill…', 'Add', 'Add custom connector…', 'Filter']],
    ];
    mountCustomize({ view: 'mine', show: 'all' });
    for (const [view, show, search, present, absent] of table) {
      act(() => useLayout.getState().openDestination({ kind: 'customize', view, show }));
      const at = `${view}, ${show}`;
      await waitFor(() => expect(within(tools()!).getByRole('searchbox', { name: search }), at).toBeTruthy());
      for (const name of present) expect(within(tools()!).queryByRole('button', { name }), `${at}: ${name}`).not.toBeNull();
      for (const name of absent) expect(within(tools()!).queryByRole('button', { name }), `${at}: no ${name}`).toBeNull();
      const line = tools()!.querySelector<HTMLElement>('[data-customize-tools-line]');
      expect(line, `${at}: one line of tools`).not.toBeNull();
      expect(tools()!.children, `${at}: the line alone`).toHaveLength(1);
      const parts = [...line!.children].map((part) => (part.hasAttribute('data-customize-actions') ? 'actions' : part.querySelector('input[type="search"]') ? 'search' : part.tagName));
      expect(parts, at).toEqual(['search', 'actions']);
      const actions = line!.querySelector<HTMLElement>('[data-customize-actions]')!;
      for (const name of present) expect(within(actions).queryByRole('button', { name }), `${at}: ${name} among the actions`).not.toBeNull();
    }
  });

  it('draws no tools while a plugin’s or a skill’s detail is open; pressing the view shown or a Show value returns to the list', async () => {
    mountCustomize({ view: 'mine', show: 'plugins' });
    fireEvent.click(within(await pluginRow('buoy-log@harbour-market')).getByRole('button', { name: 'View Buoy log' }));
    await waitFor(() => expect(tools()).toBeNull());
    expect(showGroup()).toBeTruthy();
    chooseView('My items');
    await waitFor(() => expect(within(tools()!).getByRole('searchbox', { name: 'Search plugins' })).toBeTruthy());
    expect(document.activeElement?.closest('[data-plugin-row="buoy-log@harbour-market"]')).not.toBeNull(); // back on the row it left from
    chooseShow('Skills');
    fireEvent.click(await screen.findByRole('button', { name: 'View tide-tables' }));
    await waitFor(() => expect(tools()).toBeNull());
    chooseShow('Skills');
    await waitFor(() => expect(within(tools()!).getByRole('searchbox', { name: 'Search skills' })).toBeTruthy());
    expect(document.querySelector('[data-skill-detail]')).toBeNull();
  });

  it('a change of view keeps Show, and a change of Show keeps the view; each writes only the page’s fields', async () => {
    mountCustomize({ view: 'mine', show: 'connectors' });
    const strip = useLayout.getState().main;
    await screen.findByText('tides');
    chooseView('Discover');
    expect(where()).toEqual({ kind: 'customize', view: 'discover', show: 'connectors' });
    expect(await found('[data-discover="connectors"]')).toBeTruthy();
    chooseShow('Skills');
    expect(where()).toEqual({ kind: 'customize', view: 'discover', show: 'skills' });
    expect(await found('[data-discover="skills"]')).toBeTruthy();
    chooseView('My items');
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'skills' });
    expect(await screen.findByRole('button', { name: 'View tide-tables' })).toBeTruthy();
    expect(useLayout.getState().main).toBe(strip);
    expect(useLayout.getState().settings).toBeNull();
  });

  it('keeps My items’ one search text across Show and across a change of view', async () => {
    mountCustomize({ view: 'mine', show: 'plugins' });
    fireEvent.change(await within(tools()!).findByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'buoy' } });
    chooseShow('Connectors');
    expect(within(tools()!).getByRole('searchbox', { name: 'Search connectors' })).toHaveProperty('value', 'buoy');
    chooseView('Discover');
    chooseView('My items');
    expect(within(tools()!).getByRole('searchbox', { name: 'Search connectors' })).toHaveProperty('value', 'buoy');
    expect(useLibraryStore.getState().plugins.search).toBe(''); // the session's /plugins keeps its own
  });

  it('“Add custom connector…” stands in My items under Connectors and under All, before Refresh, and nowhere else', async () => {
    mountCustomize({ view: 'mine', show: 'connectors' });
    for (const [view, show, drawn] of [['mine', 'connectors', true], ['mine', 'all', true], ['mine', 'plugins', false], ['mine', 'skills', false], ['discover', 'connectors', false], ['discover', 'all', false]] as const) {
      act(() => useLayout.getState().openDestination({ kind: 'customize', view, show }));
      const action = header().querySelector<HTMLElement>('[data-connector-add-custom]');
      expect(action !== null, `${view}, ${show}`).toBe(drawn);
      if (action) expect(action.nextElementSibling!.textContent).toBe('Refresh');
    }
  });

  it('draws no tools while a Discover card’s detail is open; pressing the view shown or a Show value returns to the list, the card focused again', async () => {
    mountCustomize({ view: 'discover', show: 'plugins' });
    const card = () => document.activeElement?.closest(`[data-catalog-card="${CSS.escape(berth.id)}"]`) ?? null;
    for (const press of [() => chooseView('Discover'), () => chooseShow('Plugins')]) {
      fireEvent.click(within(await shelfCard(berth)).getByRole('button', { name: 'View berth-notes' }));
      await found('[data-catalog-detail]');
      await waitFor(() => expect(tools()).toBeNull());
      press();
      await waitFor(() => expect(document.querySelector('[data-catalog-detail]')).toBeNull());
      expect(within(tools()!).getByRole('searchbox', { name: 'Search all sources' })).toBeTruthy();
      expect(card()).not.toBeNull(); // back on the card it left from
    }
  });

  it('a plugin’s row gives up its version and date under the page’s narrow width only', async () => {
    mountCustomize({ view: 'mine', show: 'plugins' });
    const facts = (await pluginRow('buoy-log@harbour-market')).querySelector<HTMLElement>('[data-plugin-version]')!;
    expect(facts.textContent).toContain('1.0.0');
    expect(facts.classList.contains('@max-sm/customize:hidden')).toBe(true); // the page's container, not /plugins' dialog
  });
});

// C2: what a person started is held by the page for its place, whichever view and Show value are drawn after.
describe('what a person started outlives the view', () => {
  it('held open: an install from a Discover card runs on through My items and Connectors; its result reads on the card and, once installed, on its row', async () => {
    holdDone.add('plugins.install');
    mountCustomize({ view: 'discover', show: 'plugins' });
    await install(ledger);
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd: QUAY, binary: BINARY, plugin: 'quay-ledger@harbour-market', scope: 'user' }]));
    await waitFor(async () => expect(within(await shelfCard(ledger)).getByRole('status').textContent).toBe('Working…'));
    chooseView('My items');
    chooseShow('Connectors');
    await screen.findByText('tides');
    chooseView('Discover');
    chooseShow('Plugins');
    await waitFor(async () => expect(within(await shelfCard(ledger)).getByRole('status').textContent).toBe('Working…'));
    chooseShow('Skills');
    await found('[data-discover="skills"]');
    installed = [buoyLog, installedLedger];
    act(() => held.get('plugins.install')!());
    emit('plugins.changed', {});
    chooseShow('Plugins');
    await waitFor(async () => expect(within(await shelfCard(ledger)).getByRole('status').textContent).toBe('install done'));
    chooseView('My items');
    await waitFor(async () => expect(within(await pluginRow('quay-ledger@harbour-market')).getByRole('status').textContent).toBe('install done'));
  });

  it('held open: an add-then-install whose second step starts while My items shows', async () => {
    holdDone.add('marketplaces.add');
    mountCustomize({ view: 'discover', show: 'plugins' });
    await install(berth);
    await waitFor(() => expect(held.has('marketplaces.add')).toBe(true));
    chooseView('My items');
    chooseShow('Skills');
    await screen.findByRole('button', { name: 'View tide-tables' });
    act(() => held.get('marketplaces.add')!());
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd: QUAY, binary: BINARY, plugin: 'berth-notes@harbour-annex', scope: 'user' }]));
    chooseView('Discover');
    chooseShow('Plugins');
    await waitFor(async () => expect(within(await shelfCard(berth)).getByRole('status').textContent).toBe('install done'));
  });

  it('held open: a connector’s removal runs on through a change of Show and of project, and its line is at the head of the connector rows', async () => {
    holdDone.add('connectors.remove');
    mountCustomize({ view: 'mine', show: 'connectors' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tides' }));
    const removal = await screen.findByRole('dialog', { name: 'Remove tides?' });
    await within(removal).findByRole('button', { name: 'Details' });
    fireEvent.click(within(removal).getByRole('checkbox'));
    fireEvent.click(within(removal).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoked('connectors.remove')).toEqual([{ cwd: QUAY, binary: BINARY, name: 'tides', scope: 'user' }]));
    chooseShow('Plugins');
    await pluginRow('buoy-log@harbour-market');
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: B } });
    servers = [];
    act(() => held.get('connectors.remove')!());
    emit('plugins.changed', {});
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: A } });
    chooseShow('Connectors');
    const gone = await found('[data-connector-gone]');
    expect(gone.firstElementChild!.textContent).toBe('tides');
    expect(within(gone).getByRole('status').textContent).toBe('mcp-remove done');
    expect(document.querySelector('[data-connector="tides"]')).toBeNull();
  });

  it('held open: a sign-in heard before its receipt reads its steps on the row across a change of Show, and Cancel reaches it', async () => {
    const signer = { ...status('quay-signer'), appSessionId: at('quay-signer' as AppSessionId), cwd: QUAY };
    useSessions.setState({ engine: new Map([[signer.appSessionId, signer]]) });
    holdReceipt.add('connectors.signIn');
    mountCustomize({ view: 'mine', show: 'connectors' });
    const row = () => document.querySelector<HTMLElement>('[data-connector="tides"]')!;
    fireEvent.click(await within(await found('[data-connector="tides"]')).findByRole('button', { name: 'Sign in to tides' }));
    await waitFor(() => expect(held.has('connectors.signIn')).toBe(true));
    const changed = (state: ConnectorSignInChanged['state']) => act(() => heard({ opId: 'op-1', name: 'tides', state, reason: null, message: null, where: null }));
    changed('starting'); // before the receipt
    chooseShow('All');
    chooseShow('Connectors');
    await act(async () => held.get('connectors.signIn')!());
    changed('waiting_callback');
    await waitFor(() => expect(within(row()).getByText('Finish signing in in your browser…')).toBeTruthy());
    fireEvent.click(within(row()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(invoked('connectors.signInCancel')).toEqual([{ opId: 'op-1' }]));
  });

  it('a change of project closes an open sheet and resets an open detail, and a sheet asked for then opens on the new place', async () => {
    mountCustomize({ view: 'mine', show: 'connectors' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tides' }));
    await screen.findByRole('dialog', { name: 'Remove tides?' });
    act(() => useCustomizeProject.setState({ projectId: B }, true)); // the place changes under the sheet, as an opener's write changes it
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: A } });
    expect(screen.queryByRole('dialog')).toBeNull(); // not again on return
    chooseShow('Plugins');
    fireEvent.click(within(await pluginRow('buoy-log@harbour-market')).getByRole('button', { name: 'View Buoy log' }));
    await found('[data-plugin-detail]');
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: B } });
    await waitFor(() => expect(document.querySelector('[data-plugin-detail]')).toBeNull());
    // a sheet asked for on the place now shown opens there
    fireEvent.keyDown(within(await pluginRow('buoy-log@harbour-market')).getByRole('button', { name: /^More actions for / }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall…' }));
    await waitFor(() => expect(sheet()).toBeTruthy());
  });

  it('held open: a declared command’s second sheet, asked by an install of the first visit to a project, is not opened on a later visit to it', async () => {
    holdDone.add('plugins.install');
    mountCustomize({ view: 'discover', show: 'plugins' });
    await install(ledger);
    await waitFor(() => expect(held.has('plugins.install')).toBe(true));
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: B } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: A } });
    await shelfCard(ledger);
    const declared = { ok: false, error: { code: 'cli_failed', message: 'This plugin runs a command its marketplace declares', failureCode: 'command_source_refused', shownCommand: { sha256: 'e'.repeat(64), command: 'npx quay-helper', kind: 'command-source' } } };
    act(() => held.get('plugins.install')!(declared));
    await waitFor(async () => expect((await shelfCard(ledger)).textContent).toContain('command_source_refused'));
    expect(document.querySelector('[data-plugins-sheet]')).toBeNull();
  });

  // Keep means keep: one book for every kind, and each kind's line offers what it offered (a plugin's, Reload again)
  for (const [tab, offered] of [['plugins', true], ['skills', false]] as const)
    it(`a ${tab} Discover install whose reload a session did not reflect ${offered ? 'offers' : 'offers no'} Reload again`, async () => {
      attachLive();
      holdDone.add('plugins.install');
      mountCustomize({ view: 'discover', show: tab });
      fireEvent.click(within(await cardIn(tab, ledger)).getByRole('button', { name: 'Add quay-ledger' }));
      await resolved();
      fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(held.has('plugins.install')).toBe(true));
      act(() => held.get('plugins.install')!(undefined, NOT_REFLECTED));
      await waitFor(async () => expect(within(await cardIn(tab, ledger)).getByRole('status').textContent).toContain('not reflected'));
      expect(within(await cardIn(tab, ledger)).queryByRole('button', { name: 'Reload again' }) !== null).toBe(offered);
    });

  it('a connector’s removal whose reload a session did not reflect offers no Reload again', async () => {
    attachLive();
    holdDone.add('connectors.remove');
    mountCustomize({ view: 'mine', show: 'connectors' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tides' }));
    const removal = await screen.findByRole('dialog', { name: 'Remove tides?' });
    await within(removal).findByRole('button', { name: 'Details' });
    fireEvent.click(within(removal).getByRole('checkbox'));
    fireEvent.click(within(removal).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(held.has('connectors.remove')).toBe(true));
    act(() => held.get('connectors.remove')!(undefined, NOT_REFLECTED));
    const row = () => document.querySelector<HTMLElement>('[data-connector="tides"]')!;
    await waitFor(() => expect(row().textContent).toContain('not reflected'));
    expect(screen.queryByRole('button', { name: 'Reload again' })).toBeNull();
  });
});

// C3: the openers write the page's two fields; a Discover card that reads Installed opens My items on its kind.
describe('ways in', () => {
  it('the sidebar’s and Settings’ opener opens My items, All; the composer’s names open their kind; Open Discover opens Discover, Plugins', () => {
    openCustomize();
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'all' });
    openCustomize('mcp', B);
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'connectors' });
    expect(useCustomizeProject.getState()).toEqual({ projectId: B });
    openCustomize('plugins');
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' });
    openCustomize('skills');
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'skills' });
    openDiscover(DOCK);
    expect(where()).toEqual({ kind: 'customize', view: 'discover', show: 'plugins' });
    expect(useCustomizeProject.getState()).toEqual({ projectId: B });
    openDiscover(null);
    expect(useCustomizeProject.getState()).toEqual({ projectId: null });
  });

  it('openMine keeps the place and sets the page’s search when asked', () => {
    openMine('skills', { search: 'berth-notes' });
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'skills' });
    expect(useCustomizeProject.getState()).toEqual({ projectId: A });
    expect(useCustomizePage.getState().search).toBe('berth-notes');
  });

  it('held open: a card that reads Installed opens My items, Plugins; its detail opens once the list answers with it', async () => {
    shelf = [{ ...ledger, installed: 'here' }, berth];
    let release!: () => void;
    listAnswer = new Promise((resolve) => (release = () => resolve({ plugins: [buoyLog, installedLedger] })));
    mountCustomize({ view: 'discover', show: 'plugins' });
    fireEvent.click(within(await shelfCard(ledger)).getByRole('button', { name: 'View quay-ledger' }));
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' });
    await waitFor(() => expect(within(tools()!).getByRole('searchbox', { name: 'Search plugins' })).toBeTruthy());
    await waitFor(() => expect(invoked('plugins.list').length).toBeGreaterThan(0));
    expect(document.querySelector('[data-plugin-detail]')).toBeNull();
    await act(async () => release());
    expect((await found('[data-plugin-detail]')).getAttribute('data-plugin-detail')).toBe('quay-ledger@harbour-market');
  });

  it('held open: the request is dropped when the person opens another row first, or changes Show', async () => {
    let release!: () => void;
    listAnswer = new Promise((resolve) => (release = () => resolve({ plugins: [buoyLog] })));
    mountCustomize({ view: 'mine', show: 'plugins' });
    act(() => openMine('plugins', { pluginId: 'quay-ledger@harbour-market' }));
    await act(async () => release());
    fireEvent.click(within(await pluginRow('buoy-log@harbour-market')).getByRole('button', { name: 'View Buoy log' }));
    expect((await found('[data-plugin-detail]')).getAttribute('data-plugin-detail')).toBe('buoy-log@harbour-market');
    listAnswer = null;
    installed = [buoyLog, installedLedger];
    emit('plugins.changed', {});
    await waitFor(() => expect(invoked('plugins.list').length).toBeGreaterThan(1));
    await act(async () => {});
    expect(document.querySelector('[data-plugin-detail]')!.getAttribute('data-plugin-detail')).toBe('buoy-log@harbour-market'); // another row was opened first

    cleanup();
    installed = [buoyLog];
    mountCustomize({ view: 'mine', show: 'plugins' });
    await pluginRow('buoy-log@harbour-market');
    act(() => openMine('plugins', { pluginId: 'quay-ledger@harbour-market' }));
    chooseShow('Skills');
    chooseShow('Plugins');
    installed = [buoyLog, installedLedger];
    emit('plugins.changed', {});
    await pluginRow('quay-ledger@harbour-market');
    expect(document.querySelector('[data-plugin-detail]')).toBeNull();
  });

  // The branch panel's finding (P2), confirmed by the architect on 2026-11-15: the request is the page's, so it ends with
  // the page. Here the page is drawn only while the layout has it, as `DestinationPage` draws it.
  it('held open: an Installed card’s request left when the person closes Customize is not opened by the composer’s “Manage plugins…”', async () => {
    shelf = [{ ...ledger, installed: 'here' }, berth];
    let release!: () => void;
    listAnswer = new Promise((resolve) => (release = () => resolve({ plugins: [buoyLog, installedLedger] })));
    function WhileOpen() {
      const destination = useLayout((s) => s.destination);
      return destination?.kind === 'customize' ? <CustomizeView view={destination.view} show={destination.show} /> : null;
    }
    useLayout.getState().openDestination({ kind: 'customize', view: 'discover', show: 'plugins' });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WhileOpen />
      </QueryClientProvider>,
    );
    fireEvent.click(within(await shelfCard(ledger)).getByRole('button', { name: 'View quay-ledger' }));
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' });
    await waitFor(() => expect(invoked('plugins.list').length).toBeGreaterThan(0));
    act(() => useLayout.getState().closeDestination()); // before the list holds the plugin
    expect(document.querySelector('[data-customize-page]')).toBeNull();
    await act(async () => release());
    listAnswer = null;
    installed = [buoyLog, installedLedger];
    act(() => openCustomize('plugins', A)); // the composer's "Manage plugins…", for its project
    await pluginRow('quay-ledger@harbour-market');
    await act(async () => {});
    expect(document.querySelector('[data-plugin-detail]')).toBeNull();
  });
});

// The branch panel's finding (P2), confirmed by the architect on 2026-11-15: when the plugin whose detail is open leaves
// the list (its last installation removed), the keyboard stays in the page, where `/` reaches the head's search field.
describe('the keyboard when the detailed plugin leaves the list', () => {
  for (const [show, search] of [['plugins', 'Search plugins'], ['all', 'Search my items']] as const)
    it(`stays in the page under Show: ${show}, and / still reaches the search field`, async () => {
      installed = [buoyLog, installedLedger];
      mountCustomize({ view: 'mine', show });
      fireEvent.click(within(await pluginRow('quay-ledger@harbour-market')).getByRole('button', { name: 'View Quay ledger' }));
      await found('[data-plugin-detail="quay-ledger@harbour-market"]');
      installed = [buoyLog]; // its last installation removed
      emit('plugins.changed', {});
      await waitFor(() => expect(document.querySelector('[data-plugin-detail]')).toBeNull());
      await pluginRow('buoy-log@harbour-market');
      const page = document.querySelector<HTMLElement>('[data-customize-page]')!;
      const active = document.activeElement as HTMLElement;
      expect(page.contains(active), `the keyboard is on ${active.tagName}`).toBe(true);
      // jsdom focuses any element; a browser focuses only a focusable one, and leaves the keyboard on the body otherwise
      expect(active.matches('a[href], button, input, select, textarea, [tabindex]'), `${active.tagName} can take the keyboard in a browser`).toBe(true);
      fireEvent.keyDown(document.activeElement!, { key: '/' });
      expect(document.activeElement).toBe(within(tools()!).getByRole('searchbox', { name: search }));
    });
});

// UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decisions 3 to 5): "New
// skill…" opens a chat in the page's place whose composer holds the first message, not sent; a plugin's skill's detail
// says that the plugin's updates replace its file.
describe('a skill’s actions', () => {
  const made: (ProjectId | null)[] = [];
  let off: () => void;
  beforeEach(() => {
    made.length = 0;
    off = registerSessionCreator(async (projectId) => (made.push(projectId), at(`app-new-${made.length}` as AppSessionId)));
  });
  afterEach(() => {
    off();
    useComposerStore.setState({ prefills: new Map() });
  });
  const prefill = (n: number) => useComposerStore.getState().prefills.get(at(`app-new-${n}` as AppSessionId))?.text;
  // the configuration home the first message names is plugins.env's, read with the page
  const envRead = async () => {
    await waitFor(() => expect(invoked('plugins.env')).not.toEqual([]));
    await act(async () => undefined);
  };

  it('on a project’s page, New skill… offers this project and the person’s own, each a chat in the project with its folder named', async () => {
    mountCustomize({ view: 'mine', show: 'skills' });
    await envRead();
    const press = async () => fireEvent.keyDown(await within(tools()!).findByRole('button', { name: 'New skill…' }), { key: 'Enter' });
    await press();
    const rows = await screen.findAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual(['In this project', 'Created by you']);
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(prefill(1)).toBe("Let's create a new skill in .claude/skills/ of this project. First ask me what it should do."));
    await press();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Created by you' }));
    await waitFor(() => expect(prefill(2)).toBe(`Let's create a new skill in ${HOME}/skills/, for all my projects. First ask me what it should do.`));
    expect(made).toEqual([A, A]);
    expect(invoked('session.send')).toEqual([]); // filled, never sent
  });

  it('on the user configuration’s page, New skill… is one button that makes the person’s own, in a chat with no project', async () => {
    useCustomizeProject.setState({ projectId: null }, true);
    mountCustomize({ view: 'mine', show: 'all' });
    await envRead();
    fireEvent.click(await within(tools()!).findByRole('button', { name: 'New skill…' }));
    await waitFor(() => expect(prefill(1)).toBe(`Let's create a new skill in ${HOME}/skills/, for all my projects. First ask me what it should do.`));
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(made).toEqual([null]);
  });

  it('a project’s skill’s detail has no plugin line', async () => {
    mountCustomize({ view: 'mine', show: 'skills' });
    fireEvent.click(await screen.findByRole('button', { name: 'View tide-tables' }));
    await found('[data-skill-detail="tide-tables"]');
    expect(document.querySelector('[data-skill-note]')).toBeNull();
  });

  const SKILL = `${QUAY}/.claude/skills/tide-tables/SKILL.md`;
  const openDetail = async (show: 'skills' | 'all', name = 'tide-tables') => {
    mountCustomize({ view: 'mine', show });
    fireEvent.click(await screen.findByRole('button', { name: `View ${name}` }));
    return found(`[data-skill-detail="${name}"]`);
  };
  const choose = async (detail: HTMLElement, row: string) => {
    fireEvent.keyDown(within(detail).getByRole('button', { name: 'Open in' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: row }));
  };

  it('Open in on a skill’s detail lists the editors and Finder this Mac has, no terminal, and hands the row’s file with the page’s place', async () => {
    const detail = await openDetail('skills');
    fireEvent.keyDown(within(detail).getByRole('button', { name: 'Open in' }), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((row) => row.textContent)).toEqual(['Zed', 'Finder']));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zed' }));
    await waitFor(() => expect(invoked('customization.skillFile')).toEqual([{ cwd: QUAY, path: SKILL, app: 'zed' }]));
    expect(document.querySelector('[data-skill-refusal]')).toBeNull();
  });

  it('from All too, and a refusal reads under the head until the detail is left', async () => {
    skillFileAnswer = { status: 'refused', reason: 'missing', message: null };
    const detail = await openDetail('all');
    await choose(detail, 'Finder');
    expect((await screen.findByRole('alert')).textContent).toBe("This skill's file is no longer here. Refresh, then try again.");
    expect(invoked('customization.skillFile')).toEqual([{ cwd: QUAY, path: SKILL, app: 'finder' }]);
    fireEvent.click(within(detail).getByRole('button', { name: /^Back/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'View tide-tables' }));
    await found('[data-skill-detail="tide-tables"]');
    expect(document.querySelector('[data-skill-refusal]')).toBeNull();
  });

  it('until the configuration home is known, Created by you waits, disabled, and In this project works', async () => {
    envAnswer = new Promise(() => {});
    mountCustomize({ view: 'mine', show: 'skills' });
    fireEvent.keyDown(await within(tools()!).findByRole('button', { name: 'New skill…' }), { key: 'Enter' });
    expect((await screen.findByRole('menuitem', { name: 'Created by you' })).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'In this project' }));
    await waitFor(() => expect(prefill(1)).toBe("Let's create a new skill in .claude/skills/ of this project. First ask me what it should do."));
  });

  it('a reply that arrives after its detail closed, or after a later choice, writes no refusal', async () => {
    const replies: ((value: unknown) => void)[] = [];
    skillFileAnswer = () => new Promise((resolve) => replies.push(resolve));
    const MISSING = { status: 'refused', reason: 'missing', message: null };
    let detail = await openDetail('skills');
    await choose(detail, 'Finder');
    await waitFor(() => expect(replies).toHaveLength(1));
    fireEvent.click(within(detail).getByRole('button', { name: /^Back/ }));
    await act(async () => replies[0]!(MISSING));
    fireEvent.click(await screen.findByRole('button', { name: 'View tide-tables' }));
    detail = await found('[data-skill-detail="tide-tables"]');
    expect(document.querySelector('[data-skill-refusal]')).toBeNull();
    // two choices: the first's late refusal does not stand over the second's success
    await choose(detail, 'Zed');
    await choose(detail, 'Finder');
    await waitFor(() => expect(replies).toHaveLength(3));
    await act(async () => replies[2]!({ status: 'opened' }));
    await act(async () => replies[1]!(MISSING));
    expect(document.querySelector('[data-skill-refusal]')).toBeNull();
  });

  // the review's second round (U11 decision 13)
  const rejected = (message: string) => {
    const promise = Promise.reject(new Error(message));
    promise.catch(() => undefined);
    return promise;
  };
  const CREATOR = { name: 'skill-creator', description: 'Makes skills', source: 'plugin', path: `${HOME}/plugins/cache/skill-creator/skills/skill-creator/SKILL.md`, plugin: 'skill-creator@official', pluginName: 'skill-creator' };
  const PLAIN = `Let's create a new skill in ${HOME}/skills/, for all my projects. First ask me what it should do.`;

  it('calls skill-creator only on a current listing: not after a refresh of the plugin list fails, nor while one is being read', async () => {
    useSettings.setState({ state: { settings: SETTINGS_DEFAULTS_V21, resolvedTheme: 'light' } });
    extraSkills = [CREATOR];
    installed = [buoyLog, { ...buoyLog, id: 'skill-creator@official', name: 'skill-creator', installPath: `${HOME}/plugins/cache/skill-creator` }];
    useCustomizeProject.setState({ projectId: null }, true);
    mountCustomize({ view: 'mine', show: 'all' });
    await envRead();
    const newSkill = () => within(tools()!).getByRole('button', { name: 'New skill…' });
    await pluginRow('skill-creator@official'); // the listing has answered
    expect(invoked('plugins.list')).toHaveLength(1); // and no other read of it is on its way
    await waitFor(() => expect(newSkill().hasAttribute('disabled')).toBe(false));
    fireEvent.click(newSkill());
    await waitFor(() => expect(prefill(1)).toBe(`/skill-creator:skill-creator ${PLAIN}`));
    // pressed in the same task as a Refresh whose read is still on its way: the last render still shows the listing that
    // was current, and the press reads the listing as it is now
    let fail: (error: Error) => void = () => undefined;
    listAnswer = new Promise((_, reject) => (fail = reject));
    fireEvent.click(within(tools()!).getByRole('button', { name: 'Refresh' }));
    fireEvent.click(newSkill());
    await waitFor(() => expect(prefill(2)).toBe(PLAIN));
    // that read fails: the list shown is the last one read, which confirms nothing now
    await waitFor(() => expect(invoked('plugins.list')).toHaveLength(2));
    await act(async () => fail(new Error('listing failed')));
    fireEvent.click(newSkill());
    await waitFor(() => expect(prefill(3)).toBe(PLAIN));
    act(() => useSettings.setState({ state: null }));
  });

  it('when the configuration home’s first read fails, New skill… says why it waits, and Refresh reads it again', async () => {
    useCustomizeProject.setState({ projectId: null }, true);
    envAnswer = rejected('engine unavailable');
    mountCustomize({ view: 'mine', show: 'skills' });
    await waitFor(() => expect(invoked('plugins.env')).not.toEqual([]));
    const newSkill = () => within(tools()!).getByRole('button', { name: 'New skill…' });
    await waitFor(() => expect(newSkill().hasAttribute('disabled')).toBe(true));
    expect(newSkill().getAttribute('title')).toBe('Your Claude configuration folder is not known yet. Refresh to try again.');
    envAnswer = null;
    fireEvent.click(within(tools()!).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(newSkill().hasAttribute('disabled')).toBe(false));
    fireEvent.click(newSkill());
    await waitFor(() => expect(prefill(1)).toBe(PLAIN));
  });

  it('a plugin’s skill’s detail says its plugin’s updates replace the file', async () => {
    extraSkills = [{ name: 'chart-reader', description: 'Reads charts', source: 'plugin', path: `${HOME}/plugins/cache/quay-ledger/skills/chart-reader/SKILL.md`, plugin: 'quay-ledger@harbour-market', pluginName: 'quay-ledger' }];
    await openDetail('skills', 'chart-reader');
    expect((await found('[data-skill-note]')).textContent).toBe('Comes with the plugin quay-ledger@harbour-market. An update of the plugin replaces this file, and any edit in it.');
  });
});
