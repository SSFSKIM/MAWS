// P4-AGG M3: Customize's Discover over a scripted `catalog.*` and plugin CLI (the Discover spec, M3 and acceptance 1 to 7
// on the renderer's side; the e2e group proves them against the real engine): the library's second view is Discover; the
// home draws Featured, the shelves and All; See all filters by its shelf with a removable chip; a search shows results;
// + opens the install sheet with the add step for a marketplace the engine lacks, the contents and the runs-code
// warning, and runs the add, then the install only once the add succeeded; a failed install leaves the marketplace
// added and offers its removal; an installed card opens My items; Skills names the plugin and its skills.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, EventName, MawsBridge } from '@shared/ipc/schema';
import type { CatalogHome, CatalogItem, CatalogPage, CatalogQueryInput } from '@shared/ipc/schema/catalog';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { useLibraryStore } from '../../widgets/plugins/library-store';
import { PluginsLibrary } from '../../widgets/PluginsWidget';
import { CustomizeView } from '../CustomizeView';
import { SkillsDiscover, SkillsManage } from './SkillsDiscover';
import { connectCatalogEvents } from './read';
import { NO_CHOICES, useDiscoverStore } from './store';
import { item } from './test-items';
import type { ProjectId } from '@shared/graph/ids';
import { project as projectRecord } from '../../../../../test/support/builders';
import { useSessions } from '../../stores/sessions';
import { forgetKeptOperations } from '../../widgets/plugins/operation';
import { useCustomizeProject } from '../open';

const HOME = '/tmp/discover/config';
const BINARY = '/opt/claude/2.1.309';
const PROJECT = '/tmp/discover/project-a';

const TEST_ROUTE = { kind: 'plugin', marketplaceSource: '/tmp/discover/maws-discover-test', marketplaceName: 'maws-discover-test', ref: null, present: false } as const;
const hooked = item({
  id: 'local:/tmp/discover/maws-discover-test#plugins/hooked',
  name: 'hooked',
  publisher: 'MAWS e2e hooks',
  ownership: 'added',
  components: { skills: [], mcpServers: [], hooks: true, commands: 0, agents: 0, cli: false },
  runsOnYourComputer: true,
  install: { ...TEST_ROUTE, pluginName: 'hooked' },
  sources: ['test:maws-discover-test'],
});
const skillsOnly = item({
  id: 'local:/tmp/discover/maws-discover-test#plugins/skills-only',
  name: 'skills-only',
  publisher: 'MAWS e2e skills',
  ownership: 'added',
  components: { skills: ['greet', 'summarize-diff'], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false },
  install: { ...TEST_ROUTE, pluginName: 'skills-only' },
});
const frontend = item({ installs: 1_266_133, reviewTier: 'anthropic', iconUrl: 'https://api.anthropic.com/api/directory/plugin-icons/cdec906b4f0651042cc7ecc57e40bfb3a39ced821a7382e32f8223f721fbfa24/256.png' });
const mystery = item({ id: 'https://github.com/x/mystery#', name: 'mystery', ownership: 'community', components: null, runsOnYourComputer: 'unknown', install: { kind: 'plugin', marketplaceSource: 'anthropics/claude-plugins-community', marketplaceName: 'claude-community', pluginName: 'mystery', ref: null, present: true } });
const installedHere = item({ id: 'https://github.com/anthropics/claude-plugins-official#plugins/code-review', name: 'code-review', installed: 'here', install: { kind: 'plugin', marketplaceSource: 'anthropics/claude-plugins-official', marketplaceName: 'claude-plugins-official', pluginName: 'code-review', ref: null, present: true } });

let catalog: CatalogItem[];
let calls: { name: string; input: unknown }[];
let listeners: Map<string, Set<(payload: unknown) => void>>;
let outcome: (name: CommandName, input: unknown) => PluginsOperationEvent['outcome'];
let opSeq: number;
let pageSize: number | null; // catalog.query's page, or every item at once
let restartOnCursor: boolean;
let held: Map<string, () => void>; // operations whose completion a test releases
let holding: Set<CommandName>;
let iconAnswer: (url: string) => string | null; // catalog.icon's data URL for a URL
let installedToo: { id: string; name: string; marketplace: string }[]; // installations plugins.list answers besides code-review

const emit = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));

function homeOf(): CatalogHome {
  const now = (i: CatalogItem) => catalog.find((c) => c.id === i.id) ?? i; // the shelves as the catalog reads now
  return {
    featured: now(frontend),
    shelves: [
      { key: 'added', kind: 'added', title: 'Your sources', items: [hooked, skillsOnly].map(now), total: 2 },
      { key: 'seed:claude-plugins-official', kind: 'source', title: 'Anthropic official plugins', items: [frontend, installedHere].map(now), total: 2 },
    ],
    categories: [{ value: 'code', title: 'Code', total: 2 }],
    total: catalog.length,
  };
}

function query(input: CatalogQueryInput): CatalogPage {
  const needle = (input.text ?? '').toLowerCase();
  const items = catalog.filter((i) => (needle === '' || i.name.includes(needle)) && (input.source !== 'added' || i.ownership === 'added') && (input.tab !== 'skills' || (i.components?.skills.length ?? 0) > 0));
  if (pageSize === null) return { items, nextCursor: null, total: items.length, restarted: false };
  const cursor = input.cursor ?? null;
  if (cursor !== null && restartOnCursor) {
    restartOnCursor = false; // the catalog changed under the cursor: main says the list restarts
    return { items: [], nextCursor: null, total: items.length, restarted: true };
  }
  const from = cursor === null ? 0 : Number(cursor);
  return { items: items.slice(from, from + pageSize), nextCursor: from + pageSize < items.length ? String(from + pageSize) : null, total: items.length, restarted: false };
}

function answer(name: CommandName, input: unknown): unknown {
  switch (name) {
    case 'catalog.home':
      return homeOf();
    case 'catalog.query':
      return query(input as CatalogQueryInput);
    case 'catalog.item':
      return catalog.find((i) => i.id === (input as { id: string }).id);
    case 'catalog.sources':
      return [
        { key: 'directory:plugins', label: 'Anthropic’s directory: plugins', fetchedAt: null, state: 'unavailable', dropped: 0 },
        { key: 'plugin-details', label: 'Install counts (official plugins)', fetchedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), state: 'fresh', dropped: 2 },
      ];
    case 'catalog.icon':
      return { dataUrl: iconAnswer((input as { url: string }).url) };
    case 'catalog.refresh':
      return answer('catalog.sources', {});
    case 'plugins.env':
      return { binary: BINARY, binaryError: null, configHome: HOME, globalConfig: `${HOME}/.claude.json` };
    case 'plugins.list':
      return { plugins: [{ id: 'code-review@claude-plugins-official', name: 'code-review', marketplace: 'claude-plugins-official' }, ...installedToo].map((p) => ({ ...p, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `${HOME}/plugins/cache/x`, errors: [], notes: [], installedAt: null, lastUpdated: null, here: false, coversHere: true, projectEnabled: true })) };
    case 'marketplaces.list':
      return { marketplaces: [] };
    case 'plugins.manifest':
      return { manifests: [] };
    case 'customization.inventory':
      return { skills: [], servers: [], warnings: [], serversRead: true };
    case 'marketplaces.add':
    case 'plugins.install':
    case 'marketplaces.remove': {
      const opId = `op-${++opSeq}`;
      const done = () => emit('plugins.operation', { opId, action: name === 'plugins.install' ? 'install' : name === 'marketplaces.add' ? 'marketplace-add' : 'marketplace-remove', target: 'x', phase: 'done', outcome: outcome(name, input) });
      if (holding.has(name)) held.set(name, done);
      else queueMicrotask(done);
      return { opId };
    }
    default:
      throw new Error(`unscripted ${name}`);
  }
}

beforeEach(() => {
  catalog = [frontend, hooked, skillsOnly, mystery, installedHere];
  calls = [];
  listeners = new Map();
  opSeq = 0;
  pageSize = null;
  restartOnCursor = false;
  held = new Map();
  holding = new Set();
  installedToo = [];
  iconAnswer = (url) => (url.includes('plugin-icons') ? 'data:image/png;base64,iVBORw0KGgo=' : null);
  outcome = () => ({ ok: true, result: { message: 'done' } });
  const bridge: MawsBridge = {
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push({ name, input });
      try {
        return { ok: true, value: answer(name, input) };
      } catch (error) {
        return { ok: false, error: { code: 'invalid_input', message: (error as Error).message } };
      }
    }) as MawsBridge['invoke'],
    on: ((name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => void set.delete(listener);
    }) as MawsBridge['on'],
    pathForFile: () => '',
  };
  window.maws = bridge;
});
afterEach(() => {
  cleanup();
  disconnect?.();
  disconnect = null;
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useDiscoverStore.setState({ plugins: NO_CHOICES, skills: NO_CHOICES });
  useSessions.setState({ projects: new Map() });
  useCustomizeProject.setState({ projectId: undefined }, true);
  forgetKeptOperations();
  delete (window as { maws?: MawsBridge }).maws;
});

// A client with the window's catalog.changed listener (App.tsx's connectCatalogEvents), as the app has.
let disconnect: (() => void) | null = null;
const client = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect?.();
  disconnect = connectCatalogEvents(window.maws, qc);
  return qc;
};
const mountPlugins = () =>
  render(
    <QueryClientProvider client={client()}>
      <PluginsLibrary cwd={PROJECT} appSessionId={null} discover={{ cwd: PROJECT }} />
    </QueryClientProvider>,
  );
const discover = async () => {
  fireEvent.click(screen.getByRole('radio', { name: 'Discover' }));
  await screen.findByRole('region', { name: 'Featured' });
};
const card = (id: string) => document.querySelector<HTMLElement>(`[data-shelf] [data-catalog-card="${CSS.escape(id)}"]`)!;
const sheet = () => document.querySelector<HTMLElement>('[data-plugins-sheet]')!;
// The sheet offers its commands, behind Details, once plugins.env answered (the owner's ruling, 2026-10-25).
const resolved = () => waitFor(() => expect(sheet().querySelector('[data-plugins-details]')).toBeTruthy());
const openDetails = () => {
  const details = sheet().querySelector<HTMLElement>('[data-plugins-details]')!;
  if (details.getAttribute('aria-expanded') === 'false') fireEvent.click(details);
};
const argvShown = (attribute: 'data-plugins-argv' | 'data-plugins-add-argv' = 'data-plugins-argv') => {
  openDetails();
  return JSON.parse(sheet().querySelector(`[${attribute}]`)!.getAttribute(attribute)!) as string[];
};
// The element, once it is there (waitFor retries only a callback that throws).
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
const invoked = (name: string) => calls.filter((c) => c.name === name).map((c) => c.input);

describe('Customize › Plugins › Discover', () => {
  it('is the library’s second view: Featured, the shelves, All; it reads the catalog with the page’s cwd and never the engine’s listing', async () => {
    mountPlugins();
    await discover();
    const featured = screen.getByRole('region', { name: 'Featured' });
    expect(featured.textContent).toContain('frontend-design');
    expect(featured.textContent).toContain('1.3M installs');
    expect(screen.getAllByRole('region', { name: /^(Your sources|Anthropic official plugins)$/ }).map((r) => r.getAttribute('aria-label'))).toEqual(['Your sources', 'Anthropic official plugins']);
    expect(await screen.findByRole('heading', { name: 'All · 5' })).toBeTruthy();
    expect(invoked('catalog.home')).toEqual([{ tab: 'plugins', cwd: PROJECT }]);
    expect(invoked('plugins.available')).toEqual([]);
    // a card: by its publisher, its trust label and tooltip, its components; a directory icon as main's data
    const h = card(hooked.id);
    expect(h.textContent).toContain('by MAWS e2e hooks');
    expect(h.querySelector('[data-trust]')!.getAttribute('data-trust')).toBe('Added by you');
    expect(h.querySelector('[data-trust]')!.getAttribute('title')).toBe('You added this marketplace. Anthropic hasn’t reviewed it.');
    expect(h.querySelector('[data-catalog-components]')!.textContent).toBe('hooks · runs code');
    await waitFor(() => expect(card(frontend.id).querySelector('[data-catalog-icon]')!.getAttribute('data-catalog-icon')).toBe('image'));
    expect(h.querySelector('[data-catalog-icon]')!.textContent).toBe('H');
  });

  it('See all filters to its shelf with a removable chip; a search lists results', async () => {
    mountPlugins();
    await discover();
    fireEvent.click(screen.getByRole('button', { name: 'See all of Your sources' }));
    await waitFor(() => expect(invoked('catalog.query').at(-1)).toMatchObject({ source: 'added' }));
    expect(await screen.findByRole('heading', { name: '2 results' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Your sources' }));
    await screen.findByRole('region', { name: 'Featured' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all sources' }), { target: { value: 'myst' } });
    expect(await screen.findByRole('heading', { name: '1 result' })).toBeTruthy();
    expect(document.querySelector(`[data-catalog-grid] [data-catalog-card="${CSS.escape(mystery.id)}"]`)!.textContent).toContain('Contents shown after install');
  });

  it('a page whose cursor the catalog outgrew starts the list again from the top, and says so', async () => {
    pageSize = 2;
    restartOnCursor = true;
    mountPlugins();
    await discover();
    const all = await found('[data-discover-home] [data-catalog-results]');
    const shown = () => all.querySelectorAll('[data-catalog-grid] [data-catalog-card]').length;
    await waitFor(() => expect(shown()).toBe(2));
    fireEvent.click(within(all).getByRole('button', { name: 'Show more' }));
    expect(await within(all).findByText('The catalog changed, so the list started again from the top.')).toBeTruthy();
    await waitFor(() => expect(shown()).toBe(2));
    fireEvent.click(within(all).getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(shown()).toBe(4));
    expect(invoked('catalog.query').filter((input) => (input as CatalogQueryInput).cursor === null)).toHaveLength(2); // the first page, asked again
  });

  it('+ on a plugin whose marketplace the engine lacks: the sheet adds it, then installs, naming the hook that runs code', async () => {
    mountPlugins();
    await discover();
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Add hooked' }));
    await resolved();
    expect(sheet().querySelector('[data-catalog-summary]')!.textContent).toBe('Adds the marketplace maws-discover-test (user) and installs hooked');
    expect(sheet().querySelector('[data-plugins-add-argv]')).toBeNull(); // both commands behind a closed Details
    expect(sheet().querySelector('[data-plugins-argv]')).toBeNull();
    expect(argvShown('data-plugins-add-argv')).toEqual(['plugin', 'marketplace', 'add', '/tmp/discover/maws-discover-test', '--scope', 'user', '--json']);
    expect(argvShown()).toEqual(['plugin', 'install', 'hooked@maws-discover-test', '--scope', 'user', '--json']);
    expect(sheet().querySelector('[data-runs-code]')!.textContent).toBe('Includes components that run code on your computer: hooks.');
    expect(sheet().querySelector('[data-catalog-contents]')!.textContent).toBe('Comes with: hooks');
    // the scope applies to both steps
    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Project' }));
    expect(sheet().querySelector('[data-catalog-summary]')!.textContent).toBe('Adds the marketplace maws-discover-test (project) and installs hooked');
    expect(argvShown('data-plugins-add-argv')).toContain('project');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(invoked('plugins.install')).toHaveLength(1));
    expect(invoked('marketplaces.add')).toEqual([{ cwd: PROJECT, binary: BINARY, source: '/tmp/discover/maws-discover-test', scope: 'project' }]);
    expect(invoked('plugins.install')).toEqual([{ cwd: PROJECT, binary: BINARY, plugin: 'hooked@maws-discover-test', scope: 'project' }]);
    expect(calls.findIndex((c) => c.name === 'marketplaces.add')).toBeLessThan(calls.findIndex((c) => c.name === 'plugins.install'));
  });

  it('a failed add installs nothing; a failed install after the add says the marketplace stays and offers its removal', async () => {
    outcome = (name) => (name === 'marketplaces.add' ? { ok: false, error: { code: 'cli_failed', message: 'no such directory', failureCode: null, shownCommand: null } } : { ok: true, result: {} });
    mountPlugins();
    await discover();
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Add hooked' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(card(hooked.id).textContent).toContain('no such directory'));
    expect(invoked('plugins.install')).toEqual([]);

    outcome = (name) => (name === 'plugins.install' ? { ok: false, error: { code: 'cli_failed', message: 'plugin not found', failureCode: null, shownCommand: null } } : { ok: true, result: {} });
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Add hooked' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(card(hooked.id).querySelector('[data-marketplace-stays]')?.textContent).toContain('The marketplace maws-discover-test stays added.'));
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Remove marketplace' }));
    await waitFor(() => expect(sheet()?.getAttribute('data-plugins-sheet')).toBe('marketplace-remove'));
    await resolved();
    expect(argvShown()).toEqual(['plugin', 'marketplace', 'remove', 'maws-discover-test', '--scope', 'user', '--json']); // at the scope it was added at
  });

  it('the recovery’s Remove marketplace names what the removal uninstalls now: a plugin installed from it since the failed install', async () => {
    outcome = (name) => (name === 'plugins.install' ? { ok: false, error: { code: 'cli_failed', message: 'plugin not found', failureCode: null, shownCommand: null } } : { ok: true, result: {} });
    mountPlugins();
    await discover();
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Add hooked' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(card(hooked.id).querySelector('[data-marketplace-stays]')).toBeTruthy());
    installedToo = [{ id: 'skills-only@maws-discover-test', name: 'skills-only', marketplace: 'maws-discover-test' }]; // installed since, elsewhere
    fireEvent.click(within(card(hooked.id)).getByRole('button', { name: 'Remove marketplace' }));
    await waitFor(() => expect(sheet()?.getAttribute('data-plugins-sheet')).toBe('marketplace-remove'));
    expect(sheet().textContent).toContain('Also uninstalls 1 plugin: skills-only@maws-discover-test (user)');
  });

  it('a present marketplace’s plugin installs in one step; unknown contents get the softer warning', async () => {
    mountPlugins();
    await discover();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all sources' }), { target: { value: 'myst' } });
    const result = await found(`[data-catalog-grid] [data-catalog-card="${CSS.escape(mystery.id)}"]`);
    fireEvent.click(within(result).getByRole('button', { name: 'Add mystery' }));
    await resolved();
    openDetails();
    expect(sheet().querySelector('[data-plugins-argv]')).toBeTruthy();
    expect(sheet().querySelector('[data-plugins-add-argv]')).toBeNull();
    expect(sheet().querySelector('[data-catalog-summary]')!.textContent).toBe('Installs mystery from claude-community');
    expect(sheet().querySelector('[data-runs-code]')!.textContent).toBe('May include components that run code on your computer; its contents are not known before install.');
    expect(sheet().querySelector('[data-catalog-contents]')!.textContent).toBe('Contents shown after install');
  });

  it('an item installed here reads Installed and opens in My items; the others open their detail with Also listed by and Back', async () => {
    catalog = catalog.map((i) => (i.id === frontend.id ? { ...frontend, alsoListedBy: ['claude-community'] } : i));
    mountPlugins();
    await discover();
    expect(card(installedHere.id).querySelector('[data-catalog-installed]')!.textContent).toBe('Installed');
    expect(within(card(installedHere.id)).queryByRole('button', { name: 'Add code-review' })).toBeNull();
    fireEvent.click(within(card(frontend.id)).getByRole('button', { name: 'View frontend-design' }));
    const detail = await found('[data-catalog-detail]');
    await waitFor(() => expect(detail.querySelector('[data-also-listed]')?.textContent).toBe('Also listed by claude-community'));
    expect(detail.querySelector('[data-trust-words]')!.textContent).toBe('Verified — Anthropic has reviewed this plugin for quality and security.');
    fireEvent.click(within(detail).getByRole('button', { name: 'Back to Discover' }));
    await waitFor(() => expect(document.querySelector('[data-catalog-detail]')).toBeNull());
    fireEvent.click(within(card(installedHere.id)).getByRole('button', { name: 'View code-review' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'My items' }).getAttribute('data-state')).toBe('on'));
  });

  it('reads every catalog query again on catalog.changed', async () => {
    mountPlugins();
    await discover();
    await screen.findByRole('heading', { name: 'All · 5' });
    const homes = invoked('catalog.home').length;
    catalog = catalog.filter((i) => i.id !== mystery.id);
    act(() => emit('catalog.changed', {}));
    expect(await screen.findByRole('heading', { name: 'All · 4' })).toBeTruthy();
    expect(invoked('catalog.home').length).toBeGreaterThan(homes);
  });

  it('a change while Discover is not shown reaches it on return: left for My items, uninstalled, back', async () => {
    mountPlugins();
    await discover();
    expect(card(installedHere.id).getAttribute('data-installed')).toBe('here');
    fireEvent.click(screen.getByRole('radio', { name: 'My items' }));
    await waitFor(() => expect(document.querySelector('[data-discover]')).toBeNull());
    catalog = catalog.map((i) => (i.id === installedHere.id ? { ...installedHere, installed: 'no' as const } : i));
    act(() => emit('catalog.changed', {}));
    fireEvent.click(screen.getByRole('radio', { name: 'Discover' }));
    await waitFor(() => expect(card(installedHere.id).getAttribute('data-installed')).toBe('no'));
  });

  it('Featured’s Add shows its operation and the recovery, as a card does', async () => {
    outcome = (name) => (name === 'plugins.install' ? { ok: false, error: { code: 'cli_failed', message: 'plugin not found', failureCode: null, shownCommand: null } } : { ok: true, result: {} });
    mountPlugins();
    await discover();
    const featured = screen.getByRole('region', { name: 'Featured' });
    fireEvent.click(within(featured).getByRole('button', { name: 'Add' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Featured' })).getByRole('status').textContent).toContain('plugin not found'));
    expect(screen.getByRole('region', { name: 'Featured' }).querySelector('[data-marketplace-stays]')!.textContent).toContain('The marketplace claude-plugins-official stays added.');
  });

  it('an icon main could not answer is asked again on Refresh, so main’s retry reaches an open window', async () => {
    let up = false;
    iconAnswer = (url) => (up && url.includes('plugin-icons') ? 'data:image/png;base64,iVBORw0KGgo=' : null);
    mountPlugins();
    await discover();
    await waitFor(() => expect(invoked('catalog.icon').length).toBeGreaterThan(0));
    expect(card(frontend.id).querySelector('[data-catalog-icon]')!.getAttribute('data-catalog-icon')).toBe('monogram');
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(card(frontend.id).querySelector('[data-catalog-icon]')!.getAttribute('data-catalog-icon')).toBe('image'));
  });

  it('an icon renders only as an image of its data: an SVG’s script and external reference neither run nor load; anything but image data is a monogram', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__iconRan=1"><script>window.__iconRan=1</script><image xlink:href="https://evil.example/x.png" href="https://evil.example/x.png" width="10" height="10"/></svg>';
    const hostile = `data:image/svg+xml;base64,${btoa(svg)}`;
    iconAnswer = (url) => (url.includes('plugin-icons') ? hostile : null);
    const fetched = vi.spyOn(window, 'fetch');
    mountPlugins();
    await discover();
    const tile = await waitFor(() => {
      const el = card(frontend.id).querySelector('[data-catalog-icon="image"]');
      if (!el) throw new Error('no icon yet');
      return el;
    });
    expect(tile.querySelector('img')!.getAttribute('src')).toBe(hostile);
    expect(tile.querySelectorAll('svg, script, object, embed, iframe, image')).toHaveLength(0);
    expect(document.querySelector('script')).toBeNull();
    expect((window as { __iconRan?: number }).__iconRan).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
    cleanup();
    iconAnswer = (url) => (url.includes('plugin-icons') ? 'https://evil.example/x.png' : null); // not data: a monogram, never a request
    mountPlugins();
    await discover();
    await waitFor(() => expect(invoked('catalog.icon').length).toBeGreaterThan(1));
    expect(card(frontend.id).querySelector('[data-catalog-icon]')!.getAttribute('data-catalog-icon')).toBe('monogram');
    expect(card(frontend.id).querySelector('img')).toBeNull();
  });

  // Panel taste (1512 wide): "by Anthr…" beside "Listed by Anthropic". The publisher keeps its line, the trust label
  // wraps beneath it when the two do not fit, into the room under a two-line description (the card's height is fixed).
  it('a card’s byline gives the publisher its line and wraps the trust label beneath it, the full byline as its title', async () => {
    mountPlugins();
    await discover();
    const byline = card(hooked.id).querySelector<HTMLElement>('[data-catalog-byline]')!;
    expect(byline.classList.contains('flex-wrap')).toBe(true);
    const publisher = byline.querySelector<HTMLElement>('[data-catalog-publisher]')!;
    expect(publisher.textContent).toBe('by MAWS e2e hooks');
    expect(publisher.title).toBe('by MAWS e2e hooks');
    expect(byline.lastElementChild!.hasAttribute('data-trust')).toBe(true); // after the publisher, so it is what wraps
  });

  it('the Sources popover says which source is unavailable and counts dropped records', async () => {
    mountPlugins();
    await discover();
    const trigger = await screen.findByRole('button', { name: 'Sources' });
    await waitFor(() => expect(trigger.textContent).toContain('updated 3 hours ago'));
    fireEvent.click(trigger);
    const popover = await found('[data-catalog-sources]');
    expect(popover.querySelector('[data-source="directory:plugins"]')!.textContent).toContain('Anthropic’s directory: plugins unavailable');
    expect(popover.querySelector('[data-source="plugin-details"]')!.textContent).toContain('2 records could not be read');
  });
});

// scalpel-5#1: Customize keys each page's library by its directory, so choosing another project unmounts the page an
// add-then-install was asked on; the operation still finishes (the install after the add) and its line is there on return.
describe('Customize: an add-then-install outlives a change of the page’s project', () => {
  const A = 'project-a' as ProjectId;
  const B = 'project-b' as ProjectId;
  for (const [section, panel, cardOf, name] of [
    ['plugins', 'Plugins', hooked, 'hooked'],
    ['skills', 'Skills', skillsOnly, 'skills-only'],
  ] as const) {
    it(`${panel}: the install runs once the add succeeds, with the other project shown, and its line shows on return`, async () => {
      useSessions.setState({ projects: new Map([[A, projectRecord(A, 0, { directory: PROJECT })], [B, projectRecord(B, 1, { directory: '/tmp/discover/project-b' })]]) });
      useCustomizeProject.setState({ projectId: A }, true);
      holding.add('marketplaces.add');
      render(
        <QueryClientProvider client={client()}>
          <CustomizeView section={section} />
        </QueryClientProvider>,
      );
      const tab = () => screen.getByRole('tabpanel', { name: panel });
      const shelfCard = () => found(`[data-discover="${section}"] [data-shelf] [data-catalog-card="${CSS.escape(cardOf.id)}"]`);
      fireEvent.click(within(tab()).getByRole('radio', { name: 'Discover' }));
      fireEvent.click(within(await shelfCard()).getByRole('button', { name: `Add ${name}` }));
      await resolved();
      fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(held.has('marketplaces.add')).toBe(true)); // the add runs
      fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: B } }); // the page leaves
      act(() => held.get('marketplaces.add')!());
      await waitFor(() => expect(invoked('plugins.install')).toEqual([expect.objectContaining({ cwd: PROJECT, plugin: `${name}@maws-discover-test` })]));
      fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: A } });
      fireEvent.click(within(tab()).getByRole('radio', { name: 'Discover' }));
      await waitFor(async () => expect(within(await shelfCard()).getByRole('status').textContent).toBe('done'));
    });
  }
});

describe('Customize › Skills › Discover', () => {
  it('names the plugin that carries the skills, and notes that unknown contents are under Plugins', async () => {
    render(
      <QueryClientProvider client={client()}>
        <SkillsManage cwd={PROJECT}>
          <SkillsDiscover cwd={PROJECT} onOpenInstalled={() => {}} />
        </SkillsManage>
      </QueryClientProvider>,
    );
    expect((await screen.findByText('Items whose contents are not known before install are under Plugins.')).tagName).toBe('P');
    expect(invoked('catalog.home')).toEqual([{ tab: 'skills', cwd: PROJECT }]);
    const shelf = await found(`[data-shelf] [data-catalog-card="${CSS.escape(skillsOnly.id)}"]`);
    fireEvent.click(within(shelf).getByRole('button', { name: 'Add skills-only' }));
    await resolved();
    expect(shelf.querySelector('[data-catalog-components]')!.textContent).toBe('greet, summarize-diff'); // a Skills card lists its skills by name
    expect(sheet().querySelector('[data-catalog-summary]')!.textContent).toBe('Installs the plugin skills-only from maws-discover-test, with 2 skills: greet, summarize-diff');
    expect(sheet().textContent).toContain('Adds the marketplace maws-discover-test (user) and installs skills-only');
  });

  it('an add-then-install asked here finishes after the person leaves for My items and for Plugins, its line still on the card', async () => {
    holding.add('marketplaces.add');
    const qc = client();
    const view = (section: 'plugins' | 'skills') => (
      <QueryClientProvider client={qc}>
        <CustomizeView section={section} />
      </QueryClientProvider>
    );
    const { rerender } = render(view('skills'));
    const skills = () => screen.getByRole('tabpanel', { name: 'Skills' });
    fireEvent.click(within(skills()).getByRole('radio', { name: 'Discover' }));
    const shelf = await found(`[data-discover="skills"] [data-shelf] [data-catalog-card="${CSS.escape(skillsOnly.id)}"]`);
    fireEvent.click(within(shelf).getByRole('button', { name: 'Add skills-only' }));
    await resolved();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(held.has('marketplaces.add')).toBe(true)); // the add runs
    fireEvent.click(within(skills()).getByRole('radio', { name: 'My items' })); // Discover leaves
    rerender(view('plugins')); // and so does the section
    act(() => held.get('marketplaces.add')!());
    await waitFor(() => expect(invoked('plugins.install')).toEqual([{ cwd: HOME, binary: BINARY, plugin: 'skills-only@maws-discover-test', scope: 'user' }]));
    rerender(view('skills'));
    fireEvent.click(within(skills()).getByRole('radio', { name: 'Discover' }));
    const back = await found(`[data-discover="skills"] [data-shelf] [data-catalog-card="${CSS.escape(skillsOnly.id)}"]`);
    await waitFor(() => expect(within(back).getByRole('status').textContent).toBe('done'));
  });
});
