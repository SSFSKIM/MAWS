// UX wave U11c M2 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D; Acceptance C1, C2, C3, C11):
// Customize's page with My items | Discover outside and "Show:" inside. The head's two rows and the tools of each view
// and Show; a change of view keeps Show and a change of Show keeps the view, each written as the page's two fields; what
// a person started is held by the page for its place, so an install, a removal and a sign-in outlive a change of view,
// of Show and of project; the ways in; U11g's action in the head. Every name here is invented.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName, EventName, PreloadBridge } from '@shared/ipc/schema';
import type { CatalogHome, CatalogItem, CatalogQueryInput } from '@shared/ipc/schema/catalog';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { project, status } from '../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { mountCustomize } from '../test-support/customize-page';
import { useLibraryStore } from '../widgets/plugins/library-store';
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
      return { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: `${HOME}/.claude.json` };
    case 'plugins.list':
      return listAnswer ?? { plugins: installed };
    case 'marketplaces.list':
      return { marketplaces: [] };
    case 'plugins.manifest':
      return { manifests: [] };
    case 'mods.list':
      return [];
    case 'customization.inventory':
      return { skills: [{ name: 'tide-tables', description: 'Reads the tides', source: 'project', path: `${QUAY}/.claude/skills/tide-tables/SKILL.md`, plugin: null }], servers, warnings: [], serversRead: true };
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
      return { icons: (input as { ids: string[] }).ids.map((id) => ({ id, iconUrl: null })) };
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

  it('draws the tools of each view and Show', async () => {
    servers = [];
    const table: [view: 'mine' | 'discover', show: 'all' | 'plugins' | 'skills' | 'connectors', search: string, present: string[], absent: string[]][] = [
      ['mine', 'all', 'Search my items', ['Add custom connector…', 'Refresh'], ['Filter', 'Sort by', 'Add', 'Sources']],
      ['mine', 'plugins', 'Search plugins', ['Filter', 'Sort by', 'Add'], ['Add custom connector…', 'Refresh', 'Sources']],
      ['mine', 'skills', 'Search skills', ['Refresh'], ['Filter', 'Add', 'Add custom connector…', 'Sources']],
      ['mine', 'connectors', 'Search connectors', ['Add custom connector…', 'Refresh'], ['Filter', 'Sort by', 'Add', 'Sources']],
      ['discover', 'plugins', 'Search all sources', ['Refresh', 'Sources', 'Add'], ['Filter', 'Add custom connector…']],
      ['discover', 'skills', 'Search all sources', ['Refresh', 'Sources'], ['Add', 'Add custom connector…']],
      ['discover', 'connectors', 'Search all sources', ['Refresh', 'Sources'], ['Add', 'Add custom connector…']],
      ['discover', 'all', 'Search all sources', ['Refresh', 'Sources'], ['Add', 'Add custom connector…', 'Filter']],
    ];
    mountCustomize({ view: 'mine', show: 'all' });
    for (const [view, show, search, present, absent] of table) {
      act(() => useLayout.getState().openDestination({ kind: 'customize', view, show }));
      const at = `${view}, ${show}`;
      await waitFor(() => expect(within(tools()!).getByRole('searchbox', { name: search }), at).toBeTruthy());
      for (const name of present) expect(within(tools()!).queryByRole('button', { name }), `${at}: ${name}`).not.toBeNull();
      for (const name of absent) expect(within(tools()!).queryByRole('button', { name }), `${at}: no ${name}`).toBeNull();
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
});
