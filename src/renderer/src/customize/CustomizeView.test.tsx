import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { project, record, status } from '../../../../test/support/builders';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useLibraryStore } from '../widgets/plugins/library-store';
import { CustomizeView } from './CustomizeView';
import { useCustomizeProject } from './open';
import { PlusMenu } from '../composer/plus-menu/PlusMenu';
import { activeTab } from '../stores/layout-model';
import userEvent from '@testing-library/user-event';
import { SkillsWidget } from '../widgets/SkillsWidget';
import { resetCatalogStore } from '../stores/catalog';
import { useReadLoads } from '../widgets/read';

const P = 'project-one' as ProjectId;
const Q = 'project-two' as ProjectId;
let backend: WidgetBackend;
beforeEach(() => {
  backend = createWidgetBackend({ root: process.cwd(), statuses: [] });
  backend.script('customization.inventory', (input) => { const { cwd } = input as { cwd: string | null }; return ({
    skills: [{ name: cwd === '/one' ? 'review' : 'translate', description: 'A skill read from disk', source: 'project', path: `${cwd}/.claude/skills/review/SKILL.md`, plugin: null }],
    servers: [{ name: 'notion', scope: 'user', path: '/config/.claude.json', transport: 'http' }], warnings: [],
  }); });
  backend.script('plugins.env', () => ({ binary: null, binaryError: 'Unavailable', configHome: '/config', globalConfig: '/config/.claude.json' }));
  window.maws = backend.bridge();
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'One', directory: '/one' })], [Q, project(Q, 1, { name: 'Two', directory: '/two' })]]), records: new Map(), engine: new Map() });
  useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, current: P, sets: { [P]: LAYOUT_DEFAULTS.main.sets.none } } });
});
afterEach(() => {
  cleanup();
  resetCatalogStore();
  useReadLoads.setState({ loads: new Map() });
  useSessions.setState({ projects: new Map(), records: new Map(), engine: new Map() });
  useLayout.setState({ main: LAYOUT_DEFAULTS.main });
  useLibraryStore.setState(useLibraryStore.getInitialState());
  useCustomizeProject.setState({ projectId: undefined });
  delete (window as { maws?: MawsBridge }).maws;
});
const mount = (section: 'plugins' | 'skills' | 'mcp') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomizeView section={section} /></QueryClientProvider>);

it('keeps the plugin session picker with its library controls and reloads the selected session without resetting disk choices', async () => {
  const first = { ...status('live-a'), cwd: '/one', pluginsObservedAt: '2026-10-24T12:00:00.000Z' };
  const second = { ...status('live-b'), cwd: '/one', pluginsObservedAt: '2026-10-24T12:00:00.000Z' };
  useSessions.setState({
    engine: new Map([[first.appSessionId, first], [second.appSessionId, second]]),
    records: new Map([[first.appSessionId, record(first.appSessionId, { title: { text: 'Review notes', source: 'user' } })], [second.appSessionId, record(second.appSessionId, { title: { text: 'Prepare release', source: 'user' } })]]),
  });
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('plugins.available', () => ({ plugins: [] }));
  backend.script('mods.list', () => []);
  backend.script('session.reloadSkills', () => ({ opId: 'chrome-skills' }));
  mount('plugins');

  const pageHead = screen.getByRole('heading', { name: 'Customize' }).closest('header')!;
  expect(within(pageHead).getByRole('tablist', { name: 'Customize sections' })).toBeTruthy();
  expect(within(pageHead).getByRole('combobox', { name: 'Project' })).toHaveProperty('value', P);
  expect(within(pageHead).queryByRole('combobox', { name: 'Live session' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Plugins' })).toBeNull();
  const picker = screen.getByRole('combobox', { name: 'Live session' });
  const libraryHead = picker.closest('header')!;
  expect(within(libraryHead).getByRole('radio', { name: 'My items' })).toBeTruthy();
  expect(within(libraryHead).getByRole('searchbox', { name: 'Search plugins' })).toBeTruthy();
  for (const name of ['Show', 'Sort by', 'Add']) expect(within(libraryHead).getByRole('button', { name })).toBeTruthy();
  expect(screen.getByText('Loaded now')).toBeTruthy();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search plugins' }), { target: { value: 'notes' } });
  fireEvent.change(picker, { target: { value: second.appSessionId } });
  expect(picker).toHaveProperty('value', second.appSessionId);
  expect(screen.getByRole('searchbox', { name: 'Search plugins' })).toHaveProperty('value', 'notes');
  fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }));
  await waitFor(() => expect(backend.calls.filter((call) => call.command === 'session.reloadSkills').map((call) => call.input)).toEqual([{ appSessionId: second.appSessionId }]));
  expect(screen.getByText('Working…').getAttribute('role')).toBe('status');
  act(() => backend.emitOperation({ appSessionId: second.appSessionId, opId: 'chrome-skills', command: 'session.reloadSkills', late: false, outcome: { ok: true, value: { skills: [{ name: 'review' }, { name: 'release' }] } } }));
  expect((await screen.findByText('Reloaded · 2 skills')).getAttribute('role')).toBe('status');
  expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeTruthy();

  // P4-AGG M3: Customize's second view is Discover, over the catalog with the page's cwd, not the engine's listing
  backend.script('catalog.home', () => ({ featured: null, shelves: [], categories: [], total: 0 }));
  backend.script('catalog.query', () => ({ items: [], nextCursor: null, total: 0, restarted: false }));
  backend.script('catalog.sources', () => []);
  fireEvent.click(within(libraryHead).getByRole('radio', { name: 'Discover' }));
  await waitFor(() => expect(backend.calls.filter((call) => call.command === 'catalog.home').map((call) => call.input)).toEqual([{ tab: 'plugins', cwd: '/one' }]));
  expect(backend.calls.filter((call) => call.command === 'plugins.available')).toEqual([]);
  expect(within(libraryHead).getByRole('combobox', { name: 'Live session' })).toBe(picker);
  expect(within(libraryHead).getByRole('searchbox', { name: 'Search all sources' })).toBeTruthy();
  expect(within(libraryHead).getByRole('button', { name: 'Sources' })).toBeTruthy();
  expect(backend.calls.filter((call) => call.command === 'session.acquire')).toEqual([]);
});

it('keeps the Skills scopes visible through search and detail without treating the attachment as disk inventory', async () => {
  const live = { ...status('live-skills-scope'), cwd: '/one' };
  useSessions.setState({ engine: new Map([[live.appSessionId, live]]) });
  mount('skills');
  await screen.findByRole('button', { name: 'View review' });
  const pageHead = screen.getByRole('heading', { name: 'Customize' }).closest('header')!;
  expect(within(pageHead).queryByRole('combobox', { name: 'Live session' })).toBeNull();
  const picker = screen.getByRole('combobox', { name: 'Live session' });
  const toolbar = picker.closest('[data-customize-toolbar]') as HTMLElement;
  expect(within(toolbar).getByRole('searchbox', { name: 'Search skills' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: 'absent' } });
  expect(screen.queryByRole('button', { name: 'View review' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'View review' }));
  expect(screen.getByRole('combobox', { name: 'Live session' })).toBe(picker);
  expect(screen.getByRole('combobox', { name: 'Project' })).toHaveProperty('value', P);
  fireEvent.click(screen.getByRole('button', { name: 'Back to Skills' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: Q } });
  await screen.findByRole('button', { name: 'View translate' });
  expect(screen.queryByRole('combobox', { name: 'Live session' })).toBeNull();
  expect(backend.calls.filter((call) => call.command.startsWith('session.'))).toEqual([]);
});

it('keeps the MCP session picker beside live connectors and switches only the live read', async () => {
  const first = { ...status('mcp-a'), cwd: '/one' };
  const second = { ...status('mcp-b'), cwd: '/one' };
  useSessions.setState({ engine: new Map([[first.appSessionId, first], [second.appSessionId, second]]) });
  backend.script('session.mcpStatus', (input) => ({ mcpServers: [{ name: (input as { appSessionId: string }).appSessionId, status: 'connected', tools: [{ name: 'read' }] }] }));
  mount('mcp');
  const live = await screen.findByRole('region', { name: 'Live connectors' });
  await within(live).findByText(first.appSessionId);
  const picker = within(live).getByRole('combobox', { name: 'Live session' });
  const pageHead = screen.getByRole('heading', { name: 'Customize' }).closest('header')!;
  expect(within(pageHead).queryByRole('combobox', { name: 'Live session' })).toBeNull();
  const inventoryReads = backend.calls.filter((call) => call.command === 'customization.inventory').length;
  picker.focus();
  fireEvent.change(picker, { target: { value: second.appSessionId } });
  await within(screen.getByRole('region', { name: 'Live connectors' })).findByText(second.appSessionId);
  expect(screen.getByRole('combobox', { name: 'Live session' })).toBe(picker);
  expect(document.activeElement).toBe(picker);
  expect(screen.getByText('notion')).toBeTruthy();
  expect(backend.calls.filter((call) => call.command === 'session.mcpStatus').map((call) => call.input)).toEqual([{ appSessionId: first.appSessionId }, { appSessionId: second.appSessionId }]);
  expect(backend.calls.filter((call) => call.command === 'customization.inventory')).toHaveLength(inventoryReads);
  expect(backend.calls.filter((call) => call.command === 'session.acquire')).toEqual([]);
});

it('reads the focused project without a session and switches the disk inventory with the project picker', async () => {
  mount('skills');
  await screen.findByRole('button', { name: 'View review' });
  expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: Q } });
  await screen.findByRole('button', { name: 'View translate' });
  expect(screen.queryByRole('button', { name: 'View review' })).toBeNull();
  expect(backend.calls.filter((call) => call.command.startsWith('session.'))).toEqual([]);
});

it('keeps the visited plugin library mounted when another Customize section is selected', async () => {
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('plugins.available', () => ({ plugins: [] }));
  backend.script('mods.list', () => []);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (section: 'plugins' | 'skills') => <QueryClientProvider client={client}><CustomizeView section={section} /></QueryClientProvider>;
  const mounted = render(view('plugins'));
  const browse = await screen.findByRole('radio', { name: 'Discover' });
  fireEvent.click(browse);
  expect(browse.getAttribute('aria-checked')).toBe('true');
  mounted.rerender(view('skills'));
  await screen.findByRole('button', { name: 'View review' });
  mounted.rerender(view('plugins'));
  expect(screen.getByRole('radio', { name: 'Discover' })).toBe(browse);
  expect(browse.getAttribute('aria-checked')).toBe('true');
});

it('keeps disk skill names as display metadata without inventing user or plugin invocations', async () => {
  backend.script('customization.inventory', () => ({ skills: [
    { name: 'Quarterly Review', description: 'A user skill display name', source: 'user', path: '/config/skills/review/SKILL.md', plugin: null },
    { name: 'Plugin: Quarterly Review', description: 'A plugin skill display name', source: 'plugin', path: '/plugins/reports/skills/review/SKILL.md', plugin: 'reports@market' },
  ], servers: [], warnings: [] }));
  mount('skills');
  for (const name of ['Quarterly Review', 'Plugin: Quarterly Review']) {
    const open = await screen.findByRole('button', { name: `View ${name}` });
    const label = open.closest('li')!.querySelector('[data-skill-name]')!;
    expect(label.textContent).toBe(name);
    expect(label.getAttribute('title')).toBeNull();
    const tile = open.closest('li')!.querySelector('span[aria-hidden]')!;
    expect(tile.textContent?.trim()).not.toBe('/');
    expect(tile.querySelector('svg')).not.toBeNull();
    fireEvent.click(open);
    const detail = document.querySelector<HTMLElement>('[data-skill-detail]')!;
    expect(within(detail).getByRole('heading', { name })).toBeTruthy();
    const detailTile = detail.querySelector('span[aria-hidden]')!;
    expect(detailTile.textContent?.trim()).not.toBe('/');
    expect(detailTile.querySelector('svg')).not.toBeNull();
    expect(within(detail).queryByText('Type')).toBeNull();
    expect(within(detail).queryByText(`/${name}`)).toBeNull();
    expect(within(detail).queryByRole('button', { name: 'Use in chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Skills' }));
  }
});

it('retains the engine-qualified invocation and Use in chat for the live Skills widget', async () => {
  const live = status('live-skills');
  backend = createWidgetBackend({ root: process.cwd(), statuses: [live] });
  backend.script('session.getSkillsDialog', () => ({ skills: [{ name: 'reports:review', display_name: 'reports:review', description: 'A loaded plugin skill', source: 'plugin', tokens: 20, state: 'on', advertised: true, handles: {} }] }));
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[live.appSessionId, backend.status(live.appSessionId)]]) });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SkillsWidget appSessionId={live.appSessionId} args="" close={() => {}} /></QueryClientProvider>);
  const open = await screen.findByRole('button', { name: 'View review' });
  expect(open.closest('li')!.querySelector('[data-skill-name]')!.getAttribute('title')).toBe('/reports:review');
  expect(open.closest('li')!.querySelector('span[aria-hidden]')!.textContent?.trim()).toBe('/');
  fireEvent.click(open);
  const detail = document.querySelector<HTMLElement>('[data-skill-detail]')!;
  expect(detail.querySelector('span[aria-hidden]')!.textContent?.trim()).toBe('/');
  expect(within(detail).getByText('Type')).toBeTruthy();
  expect(within(detail).getByText('/reports:review')).toBeTruthy();
  expect(within(detail).getByRole('button', { name: 'Use in chat' })).toBeTruthy();
});

it('opens the connector Manage footer for the composer project even when no session exists', async () => {
  const user = userEvent.setup();
  render(<PlusMenu cwd="/two" editor={{ current: null }} />);
  await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
  const connectors = screen.getByRole('menuitem', { name: 'Connectors' });
  act(() => connectors.focus());
  await user.keyboard('{ArrowRight}');
  await user.click(await screen.findByRole('menuitem', { name: 'Manage connectors…' }));
  expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'customize', section: 'mcp' });
  expect(useCustomizeProject.getState().projectId).toBe(Q);
  expect(backend.calls).toEqual([]);
});

it('attaches live facts only from a ready session in the selected directory and detaches on exit', async () => {
  const matching = { ...status('running-one'), cwd: '/one' };
  const unrelated = { ...status('running-two'), cwd: '/two' };
  useSessions.setState({ engine: new Map([[matching.appSessionId, matching], [unrelated.appSessionId, unrelated]]) });
  backend.script('session.mcpStatus', () => ({ mcpServers: [{ name: 'live-documents', status: 'connected', tools: [{ name: 'read' }] }] }));
  mount('mcp');
  const live = await screen.findByRole('region', { name: 'Live connectors' });
  await within(live).findByText('live-documents');
  expect(backend.calls.filter((call) => call.command === 'session.mcpStatus').map((call) => call.input)).toEqual([{ appSessionId: matching.appSessionId }]);
  act(() => useSessions.setState({ engine: new Map([[matching.appSessionId, { ...matching, process: 'exited' }], [unrelated.appSessionId, unrelated]]) }));
  expect(screen.queryByRole('region', { name: 'Live connectors' })).toBeNull();
  expect(screen.getByText(/Connection state and tools are unavailable/)).toBeTruthy();
  expect(backend.calls.filter((call) => call.command === 'session.acquire')).toEqual([]);
});

it.each(['skills', 'mcp'] as const)('shows normal inventory coverage quietly in %s, separately from actionable read warnings', async (section) => {
  const coverage = 'Plugin MCP servers and marketplace-only skill declarations are not inventoried; see Plugins.';
  const unreadable = '/config/settings.json: not valid JSON';
  backend.script('customization.inventory', () => ({ skills: [], servers: [], warnings: [coverage] }));
  mount(section);
  const note = await screen.findByText('Inventory coverage');
  expect(note.closest('details')?.classList.contains('text-fg-muted')).toBe(true);
  expect(screen.queryByText('Some configuration could not be read')).toBeNull();
  fireEvent.click(note);
  expect(screen.getByText(coverage)).toBeTruthy();

  backend.script('customization.inventory', () => ({ skills: [], servers: [], warnings: [coverage, unreadable] }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  const warning = await screen.findByText('Some configuration could not be read');
  expect(warning.closest('details')?.classList.contains('text-warning')).toBe(true);
  expect(within(warning.closest('details')!).getByText(unreadable)).toBeTruthy();
  expect(within(warning.closest('details')!).queryByText(coverage)).toBeNull();
});

it('shows configured servers without inventing connection state or offering a session start', async () => {
  mount('mcp');
  await screen.findByText('notion');
  expect(screen.getByText(/Connection state and tools are unavailable/)).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load now' })).toBeNull();
  await waitFor(() => expect(backend.calls.some((call) => call.command === 'customization.inventory')).toBe(true));
  expect(backend.calls.filter((call) => call.command.startsWith('session.'))).toEqual([]);
});
