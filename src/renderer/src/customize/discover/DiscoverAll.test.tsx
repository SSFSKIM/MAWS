// UX wave U11c M4 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §F; Acceptance C8): Discover with Show
// All. The home is the Featured plugin and a shelf per kind, Plugins, Skills, Connectors, with no Category menu, no sort
// control and no grid under the shelves; a shelf's See all chooses its kind in Show. A search turns the page into one grid
// across kinds, each card saying Plugin or Connector beside its name; a connector's + there opens the connector sheet and
// a plugin's the install sheet, and both run on the page's one book, their lines on their cards whatever is drawn. A card
// that reads Installed opens My items on its own kind. Every name here is invented.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName, EventName, PreloadBridge } from '@shared/ipc/schema';
import type { CatalogHome, CatalogItem, CatalogQueryInput, CatalogTab } from '@shared/ipc/schema/catalog';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { project, status } from '../../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { mountCustomize } from '../../test-support/customize-page';
import { useLibraryStore } from '../../widgets/plugins/library-store';
import { forgetKeptOperations } from '../../widgets/plugins/operation';
import { resetCatalogStore } from '../../stores/catalog';
import { resetSignIns } from '../connectors/sign-in';
import { useCustomizeProject } from '../open';
import { useCustomizePage, useOpenRequest } from '../page';
import { useDiscoverStore } from './store';
import { item } from './test-items';

const A = at('project-quay' as ProjectId);
const QUAY = '/tmp/discover-all/quay';
const HOME = '/tmp/discover-all/config';
const BINARY = '/opt/claude/engine';

const route = (pluginName: string) => ({ kind: 'plugin', marketplaceSource: 'harbour/market', marketplaceName: 'harbour-market', pluginName, ref: null, present: true }) as const;
const noSkills = { skills: [], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false };
const chart = item({ id: 'https://example.test/harbour#plugins/anchor-chart', name: 'anchor-chart', installs: 900, components: noSkills, install: route('anchor-chart'), sources: ['test:harbour'] });
const pilot = item({ id: 'https://example.test/harbour#plugins/pilot-notes', name: 'pilot-notes', components: noSkills, installed: 'here', install: route('pilot-notes'), sources: ['test:harbour'] });
const tides = item({ id: 'https://example.test/harbour#plugins/tide-tables', name: 'tide-tables', components: { ...noSkills, skills: ['tide-read', 'tide-plot'] }, install: route('tide-tables'), sources: ['test:harbour'] });
const connectorRoute = (name: string): CatalogItem['install'] => ({ kind: 'connector', name, url: `https://mcp.example.test/${name}`, urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'no_auth' });
const harbour = item({ id: 'harbour-mail-server', kind: 'connector', name: 'Harbour Mail', publisher: 'Harbour', components: null, rank: 3, install: connectorRoute('harbour-mail'), sources: ['directory:servers'] });
const ferry = item({ id: 'ferry-times-server', kind: 'connector', name: 'Ferry Times', publisher: 'Ferry', components: null, rank: 5, installed: 'here', install: connectorRoute('ferry-times'), sources: ['directory:servers'] });
const installedPilot = { id: 'pilot-notes@harbour-market', name: 'pilot-notes', marketplace: 'harbour-market', version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `${HOME}/plugins/cache/pilot-notes`, errors: [], notes: [], installedAt: null, lastUpdated: null, here: false, coversHere: true, projectEnabled: true };

let catalog: CatalogItem[];
let calls: { name: string; input: unknown }[];
let listeners: Map<string, Set<(payload: unknown) => void>>;
let held: Map<string, (outcome?: unknown, reload?: unknown) => void>; // a held command's done (with its reload), released by the test
let holdDone: Set<CommandName>;
let opSeq: number;

const deliver = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
const emit = (name: EventName, payload: unknown) => {
  act(() => {
    deliver(name, payload);
  });
};
const invoked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.input);
const ACTION_OF: Partial<Record<CommandName, string>> = { 'plugins.install': 'install', 'connectors.add': 'mcp-add' };
const inTab = (entry: CatalogItem, tab: CatalogTab) => tab === 'all' || (tab === 'connectors' ? entry.kind === 'connector' : entry.kind === 'plugin' && (tab === 'plugins' || (entry.components?.skills.length ?? 0) > 0));

// main's home for All (§F): the Plugins home's Featured, then a shelf per kind; a kind's own home, one shelf of its items
function home(tab: CatalogTab): CatalogHome {
  const kind = (key: 'plugins' | 'skills' | 'connectors', title: string, items: CatalogItem[], total: number) => ({ key: `kind:${key}`, kind: 'kind' as const, title, items, total });
  if (tab === 'all')
    return { featured: chart, shelves: [kind('plugins', 'Plugins', [chart, pilot], 5), kind('skills', 'Skills', [tides], 2), kind('connectors', 'Connectors', [harbour, ferry], 3)], categories: [], total: catalog.length };
  const items = catalog.filter((entry) => inTab(entry, tab));
  return { featured: null, shelves: [{ key: 'added', kind: 'added', title: 'Your sources', items, total: items.length }], categories: [{ value: 'code', title: 'Code', total: 1 }], total: items.length };
}

function answer(name: CommandName, input: unknown): unknown {
  switch (name) {
    case 'plugins.env':
      return { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: `${HOME}/.claude.json` };
    case 'plugins.list':
      return { plugins: [installedPilot] };
    case 'marketplaces.list':
      return { marketplaces: [] };
    case 'plugins.manifest':
      return { manifests: [] };
    case 'mods.list':
      return [];
    case 'customization.inventory':
      return { skills: [], servers: [{ name: 'ferry-times', scope: 'user', path: `${HOME}/.claude.json`, transport: 'http' }], warnings: [], serversRead: true };
    case 'catalog.home':
      return home((input as { tab: CatalogTab }).tab);
    case 'catalog.query': {
      const query = input as CatalogQueryInput;
      const needle = (query.text ?? '').toLowerCase();
      const items = catalog.filter((entry) => inTab(entry, query.tab) && entry.name.toLowerCase().includes(needle));
      return { items, nextCursor: null, total: items.length, restarted: false };
    }
    case 'catalog.item':
      return catalog.find((entry) => entry.id === (input as { id: string }).id);
    case 'catalog.sources':
      return [];
    case 'catalog.icon':
      return { dataUrl: null };
    case 'catalog.pluginIcons':
      return { icons: (input as { ids: string[] }).ids.map((id) => ({ id, iconUrl: null })) };
    case 'catalog.postures':
      return { servers: [{ name: 'ferry-times', scope: 'user', path: `${HOME}/.claude.json`, authPosture: 'no_auth', fingerprint: 'print-1', revision: null, iconUrl: null }] };
    case 'session.mcpStatus':
      return { mcpServers: [] };
    case 'plugins.install':
    case 'connectors.add': {
      const opId = `op-${++opSeq}`;
      const event = (outcome: unknown = { ok: true, result: { message: `${ACTION_OF[name]} done` } }, reload?: unknown) => ({ opId, action: ACTION_OF[name], target: 'x', phase: 'done', outcome, ...(reload !== undefined && { reload }) });
      if (holdDone.has(name)) held.set(name, (outcome, reload) => emit('plugins.operation', event(outcome ?? undefined, reload)));
      else queueMicrotask(() => deliver('plugins.operation', event()));
      return { opId };
    }
    default:
      throw new Error(`unscripted ${name}`);
  }
}

beforeEach(() => {
  catalog = [chart, pilot, tides, harbour, ferry];
  calls = [];
  listeners = new Map();
  held = new Map();
  holdDone = new Set();
  opSeq = 0;
  const bridge: PreloadBridge = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      try {
        return { ok: true, value: answer(name, input) };
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
  useSessions.setState({ projects: new Map([[A, project(A, 0, { name: 'Quay', directory: QUAY })]]), records: new Map(), engine: new Map() });
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
  useDiscoverStore.setState(useDiscoverStore.getInitialState(), true);
  useCustomizePage.setState(useCustomizePage.getInitialState(), true);
  useOpenRequest.setState(useOpenRequest.getInitialState(), true);
  delete (window as { maws?: PreloadBridge }).maws;
});

const header = () => document.querySelector<HTMLElement>('[data-customize-header]')!;
const chooseShow = (name: 'All' | 'Plugins' | 'Skills' | 'Connectors') => fireEvent.click(within(within(header()).getByRole('radiogroup', { name: 'Show' })).getByRole('radio', { name }));
const where = () => useLayout.getState().destination;
const sheet = () => document.querySelector<HTMLElement>('[data-plugins-sheet]')!;
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
const home$ = () => found('[data-discover="all"] [data-discover-home]');
const shelf = (kind: 'plugins' | 'skills' | 'connectors') => found(`[data-discover="all"] [data-shelf="kind:${kind}"]`);
const shelfCard = (entry: CatalogItem) => found(`[data-discover="all"] [data-shelf] [data-catalog-card="${CSS.escape(entry.id)}"]`);
const gridCard = (entry: CatalogItem) => found(`[data-discover="all"] [data-catalog-grid] [data-catalog-card="${CSS.escape(entry.id)}"]`);
const search = (text: string) => fireEvent.change(within(header()).getByRole('searchbox', { name: 'Search all sources' }), { target: { value: text } });
const lineOf = (card: HTMLElement) => within(card).getByRole('status').textContent;
// A ready session MAWS runs in the page's folder: the page's attachment, whose reloads a plugin's line offers.
const attachLive = () => {
  const live = { ...status('quay-live'), appSessionId: at('quay-live' as AppSessionId), cwd: QUAY };
  useSessions.setState({ engine: new Map([[live.appSessionId, live]]) });
};
const NOT_REFLECTED = { sessions: [{ appSessionId: 'quay-live', outcome: 'not_reflected', error: null }] };

// + on a card: the install sheet's Install, or the connector sheet's Add once it has read what is configured
async function confirm(card: HTMLElement, entry: CatalogItem) {
  fireEvent.click(within(card).getByRole('button', { name: `Add ${entry.name}` }));
  if (entry.kind === 'connector') {
    const dialog = await screen.findByRole('dialog', { name: `Add ${entry.name}?` });
    expect(sheet().getAttribute('data-plugins-sheet')).toBe('mcp-add');
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
  } else {
    await waitFor(() => expect(sheet().querySelector('[data-plugins-details]')).toBeTruthy());
    expect(sheet().getAttribute('data-plugins-sheet')).not.toBe('mcp-add');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
  }
  await waitFor(() => expect(document.querySelector('[data-plugins-sheet]')).toBeNull());
}

describe('Customize › Discover › All', () => {
  it('its home is Featured and a shelf per kind, with no Category menu, no sort control and no grid under them', async () => {
    mountCustomize({ view: 'discover', show: 'all' });
    const shown = await home$();
    expect(invoked('catalog.home')).toContainEqual({ tab: 'all', cwd: QUAY });
    expect(within(shown).getByRole('region', { name: 'Featured' }).textContent).toContain('anchor-chart');
    expect([...shown.querySelectorAll('[data-shelf]')].map((s) => s.getAttribute('aria-label'))).toEqual(['Plugins', 'Skills', 'Connectors']);
    expect(shown.querySelector('[data-catalog-results]')).toBeNull();
    expect(invoked('catalog.query')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Category' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sort by' })).toBeNull();
    expect(document.querySelector('[data-skills-note]')).toBeNull();
    // the filter row keeps its chips and Not installed
    expect([...document.querySelectorAll('[data-discover="all"] [data-chip]')].map((chip) => chip.getAttribute('data-chip'))).toEqual(['anthropic', 'partner', 'community', 'added']);
    expect(screen.getByRole('checkbox', { name: 'Not installed' })).toBeTruthy();
    // a shelf's cards carry no kind word; a Skills card names its skills, as a Skills card does
    expect(shown.querySelector('[data-shelf] [data-kind-word]')).toBeNull();
    expect((await shelfCard(tides)).querySelector('[data-catalog-components]')!.textContent).toBe('tide-read, tide-plot');
    expect((await shelf('plugins')).querySelector('[data-see-all]')!.textContent).toBe('See all5');
  });

  it('a shelf’s See all chooses its kind in Show, in Discover', async () => {
    mountCustomize({ view: 'discover', show: 'all' });
    for (const [title, show] of [['Plugins', 'plugins'], ['Skills', 'skills'], ['Connectors', 'connectors']] as const) {
      await home$();
      fireEvent.click(screen.getByRole('button', { name: `See all of ${title}` }));
      expect(where()).toEqual({ kind: 'customize', view: 'discover', show });
      await found(`[data-discover="${show}"]`);
      chooseShow('All');
    }
  });

  it('a search draws one grid across kinds, each card saying Plugin or Connector beside its name, with no sort control', async () => {
    mountCustomize({ view: 'discover', show: 'all' });
    await home$();
    search('o');
    const grid = await found('[data-discover="all"] [data-catalog-grid]');
    expect(invoked('catalog.query').at(-1)).toMatchObject({ tab: 'all', cwd: QUAY, text: 'o' });
    const cards = [...grid.querySelectorAll<HTMLElement>('[data-catalog-card]')];
    expect(cards.map((card) => [card.getAttribute('data-catalog-card'), card.querySelector('[data-kind-word]')?.textContent])).toEqual([
      [chart.id, 'Plugin'],
      [pilot.id, 'Plugin'],
      [harbour.id, 'Connector'],
    ]);
    // the word stands beside the name, in the card's head
    expect(cards[2]!.querySelector('[data-kind-word]')!.parentElement!.textContent).toBe('Harbour MailConnector');
    expect(screen.getByRole('heading', { name: '3 results' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sort by' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Category' })).toBeNull();
    // the search is All's own: a kind's Discover keeps its text
    expect(useDiscoverStore.getState().plugins.text).toBe('');
    chooseShow('Plugins');
    expect(within(header()).getByRole('searchbox', { name: 'Search all sources' })).toHaveProperty('value', '');
    chooseShow('All');
    expect(within(header()).getByRole('searchbox', { name: 'Search all sources' })).toHaveProperty('value', 'o');
  });

  it('held open: a connector’s + and a plugin’s in the grid open their own sheets and both run; each line reads on its card, and on the shelves’ once the search is cleared', async () => {
    holdDone.add('plugins.install');
    holdDone.add('connectors.add');
    mountCustomize({ view: 'discover', show: 'all' });
    await home$();
    search('r');
    await confirm(await gridCard(harbour), harbour);
    await waitFor(() => expect(invoked('connectors.add')).toEqual([expect.objectContaining({ binary: BINARY, name: 'harbour-mail', url: 'https://mcp.example.test/harbour-mail', transport: 'http', scope: 'user' })]));
    await confirm(await gridCard(chart), chart);
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd: QUAY, binary: BINARY, plugin: 'anchor-chart@harbour-market', scope: 'user' }]));
    // both run: each card reads its own line, and neither has ended
    const working = lineOf(await gridCard(harbour));
    expect(working).toBeTruthy();
    expect(working).not.toContain('done');
    expect(lineOf(await gridCard(chart))).not.toContain('done');
    expect((await gridCard(ferry)).querySelector('[role="status"]')).toBeNull();
    // the search cleared: the home's cards read the same lines
    search('');
    expect(lineOf(await shelfCard(harbour))).toBe(working);
    expect(lineOf(await shelfCard(chart))).not.toContain('done');
    act(() => held.get('connectors.add')!());
    await waitFor(async () => expect(lineOf(await shelfCard(harbour))).toContain('mcp-add done'));
    expect(lineOf(await shelfCard(chart))).not.toContain('done');
    act(() => held.get('plugins.install')!());
    await waitFor(async () => expect(lineOf(await shelfCard(chart))).toContain('install done'));
    expect(lineOf(await shelfCard(harbour))).toContain('mcp-add done');
  });

  // Keep means keep: a card's line offers what its kind's line offered (a plugin's, Reload again)
  for (const [entry, from, offered] of [
    [chart, 'the Plugins shelf', true],
    [tides, 'the Skills shelf', false],
    [harbour, 'the Connectors shelf', false],
  ] as const)
    it(`a change from ${from} whose reload a session did not reflect ${offered ? 'offers' : 'offers no'} Reload again`, async () => {
      attachLive();
      const command = entry.kind === 'connector' ? 'connectors.add' : 'plugins.install';
      holdDone.add(command);
      mountCustomize({ view: 'discover', show: 'all' });
      await home$();
      await confirm(await shelfCard(entry), entry);
      await waitFor(() => expect(held.has(command)).toBe(true));
      act(() => held.get(command)!(undefined, NOT_REFLECTED));
      await waitFor(async () => expect(lineOf(await shelfCard(entry))).toContain('not reflected'));
      expect(within(await shelfCard(entry)).queryByRole('button', { name: 'Reload again' }) !== null).toBe(offered);
    });

  it('a card that reads Installed opens My items with its own kind chosen', async () => {
    mountCustomize({ view: 'discover', show: 'all' });
    expect(within(await shelfCard(pilot)).getByText('Installed')).toBeTruthy();
    fireEvent.click(within(await shelfCard(pilot)).getByRole('button', { name: 'View pilot-notes' }));
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' });
    await found('[data-plugin-detail="pilot-notes@harbour-market"]');
    fireEvent.click(within(header()).getByRole('radio', { name: 'Discover' }));
    chooseShow('All');
    fireEvent.click(within(await shelfCard(ferry)).getByRole('button', { name: 'View Ferry Times' }));
    expect(where()).toEqual({ kind: 'customize', view: 'mine', show: 'connectors' });
    await found('[data-connector="ferry-times"]');
  });
});
