import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { heard, resetSignIns } from './connectors/sign-in';
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
import { forgetKeptOperations } from '../widgets/plugins/operation';

const P = 'project-one' as ProjectId;
const Q = 'project-two' as ProjectId;
let backend: WidgetBackend;
beforeEach(() => {
  backend = createWidgetBackend({ root: process.cwd(), statuses: [] });
  backend.script('customization.inventory', (input) => { const { cwd } = input as { cwd: string | null }; return ({
    skills: [{ name: cwd === '/one' ? 'review' : 'translate', description: 'A skill read from disk', source: 'project', path: `${cwd}/.claude/skills/review/SKILL.md`, plugin: null }],
    servers: [{ name: 'notion', scope: 'user', path: '/config/.claude.json', transport: 'http' }], warnings: [], serversRead: true,
  }); });
  backend.script('plugins.env', () => ({ binary: null, binaryError: 'Unavailable', configHome: '/config', globalConfig: '/config/.claude.json' }));
  window.maws = backend.bridge();
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'One', directory: '/one' })], [Q, project(Q, 1, { name: 'Two', directory: '/two' })]]), records: new Map(), engine: new Map() });
  useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, current: P, sets: { [P]: LAYOUT_DEFAULTS.main.sets.none } } });
});
afterEach(() => {
  cleanup();
  forgetKeptOperations(); // Customize's pages keep their operations past their views; each test is a fresh window
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
  expect(within(screen.getByRole('tabpanel', { name: 'Plugins' })).getByRole('radio', { name: 'Discover' })).toBe(browse); // P4-AGG M3: Skills, once visited, stays mounted too
  expect(browse.getAttribute('aria-checked')).toBe('true');
});

it('keeps disk skill names as display metadata without inventing user or plugin invocations', async () => {
  backend.script('customization.inventory', () => ({ skills: [
    { name: 'Quarterly Review', description: 'A user skill display name', source: 'user', path: '/config/skills/review/SKILL.md', plugin: null },
    { name: 'Plugin: Quarterly Review', description: 'A plugin skill display name', source: 'plugin', path: '/plugins/reports/skills/review/SKILL.md', plugin: 'reports@market' },
  ], servers: [], warnings: [], serversRead: true }));
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

// P4-AGG Decision Log 10: `/plugins`' Open Discover hands Customize the session's exact directory. One no project has as
// its directory (a worktree, a folder no project owns) is shown as itself, labelled by its path in the page's selector,
// never as its parent project nor as the user configuration; choosing a page there leaves it.
it('shows a session directory no project has as its directory as itself, its path in the selector, until a page is chosen', async () => {
  const worktree = '/one/.claude/worktrees/feature';
  backend.script('plugins.list', () => ({ plugins: [] }));
  backend.script('marketplaces.list', () => ({ marketplaces: [] }));
  backend.script('mods.list', () => []);
  window.maws = backend.bridge();
  useCustomizeProject.setState({ projectId: null, directory: worktree }, true);
  mount('plugins');
  const select = screen.getByRole('combobox', { name: 'Project' }) as HTMLSelectElement;
  expect(select.selectedOptions[0]!.textContent).toBe(worktree);
  await waitFor(() => expect(backend.calls.filter((call) => call.command === 'plugins.list').map((call) => (call.input as { cwd: string }).cwd)).toContain(worktree));
  expect(backend.calls.filter((call) => call.command === 'plugins.list').map((call) => (call.input as { cwd: string }).cwd).filter((cwd) => cwd !== worktree)).toEqual([]);
  await waitFor(() => expect(backend.calls.filter((call) => call.command === 'customization.inventory').map((call) => call.input)).toContainEqual({ cwd: worktree }));
  fireEvent.change(select, { target: { value: P } });
  expect(useCustomizeProject.getState()).toEqual({ projectId: P });
  expect([...select.options].map((option) => option.textContent)).not.toContain(worktree);
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
  backend.script('customization.inventory', () => ({ skills: [], servers: [], warnings: [coverage], serversRead: true }));
  mount(section);
  const note = await screen.findByText('Inventory coverage');
  expect(note.closest('details')?.classList.contains('text-fg-muted')).toBe(true);
  expect(screen.queryByText('Some configuration could not be read')).toBeNull();
  fireEvent.click(note);
  expect(screen.getByText(coverage)).toBeTruthy();

  backend.script('customization.inventory', () => ({ skills: [], servers: [], warnings: [coverage, unreadable], serversRead: false }));
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

// P4-AGG M4: Customize › Connectors (the Discover spec, Design "My items", "Signing in", "Which session").
describe('Connectors', () => {
  // main's posture for each configured server, by the record its endpoint matches; unscripted, it is unknown
  // with its configuration's fingerprint (`print`, read at each answer: an endpoint replaced under the same name changes it)
  let print = 'print-1';
  const posture = (_client: QueryClient, name: string, authPosture: 'auth_required' | 'no_auth', scope = 'user', path = '/config/.claude.json') => backend.script('catalog.postures', () => ({ servers: [{ name, scope, path, authPosture, fingerprint: print }] }));
  const mountWith = (client: QueryClient) => render(<QueryClientProvider client={client}><CustomizeView section="mcp" /></QueryClientProvider>);
  const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  afterEach(() => {
    resetSignIns();
    print = 'print-1';
  });

  it('is the tab named Connectors; a user-scope server signs in from any ready session and shows each step and the result', async () => {
    const elsewhere = { ...status('signer'), cwd: '/two' };
    useSessions.setState({ engine: new Map([[elsewhere.appSessionId, elsewhere]]) });
    backend.script('connectors.signIn', () => ({ opId: 'op-1' }));
    backend.script('connectors.signInCancel', () => ({ cancelled: true }));
    const client = fresh();
    posture(client, 'notion', 'auth_required');
    mountWith(client);
    expect(screen.getByRole('tab', { name: 'Connectors' })).toBeTruthy();
    const row = (await screen.findByText('notion')).closest('li')!;
    expect(await within(row).findByText('Sign in needed')).toBeTruthy(); // main's posture, read after the list
    fireEvent.click(within(row).getByRole('button', { name: 'Sign in to notion' }));
    await waitFor(() => expect(backend.calls.filter((call) => call.command === 'connectors.signIn').map((call) => call.input)).toEqual([{ name: 'notion', scope: 'user', cwd: '/one', path: '/config/.claude.json', appSessionId: 'signer' }]));
    const changed = (state: ConnectorSignInChanged['state'], over: Partial<ConnectorSignInChanged> = {}) => act(() => heard({ opId: 'op-1', name: 'notion', state, reason: null, message: null, where: null, ...over }));
    changed('starting');
    changed('waiting_callback');
    expect(within(row).getByText('Finish signing in in your browser…')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(backend.calls.filter((call) => call.command === 'connectors.signInCancel').map((call) => call.input)).toEqual([{ opId: 'op-1' }]));
    changed('submitting');
    changed('done', { where: 'new_sessions' });
    expect(within(row).getByText('Signed in · available in new sessions')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Sign in to notion' })).toBeNull();
    expect(backend.calls.filter((call) => call.command === 'session.acquire')).toEqual([]);
    // the configuration replaced outside MAWS (another endpoint under the same name and scope): the result was not for it
    print = 'print-2';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await within(row).findByText('Sign in needed')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Sign in to notion' })).toBeTruthy();
    expect(within(row).queryByText('Signed in · available in new sessions')).toBeNull();
  });

  it('with no ready session whose scope includes the server, Sign in says to open one and does nothing else', async () => {
    const client = fresh();
    posture(client, 'notion', 'auth_required');
    backend.script('customization.inventory', () => ({ skills: [], servers: [{ name: 'notion', scope: 'local', path: '/config/.claude.json', transport: 'http' }], warnings: [], serversRead: true }));
    const elsewhere = { ...status('elsewhere'), cwd: '/two' };
    useSessions.setState({ engine: new Map([[elsewhere.appSessionId, elsewhere]]) });
    mountWith(client);
    const row = (await screen.findByText('notion')).closest('li')!;
    expect(within(row).getByText('Open a session in One, then sign in')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Sign in to notion' })).toBeNull();
    expect(backend.calls.filter((call) => call.command.startsWith('session.') || call.command === 'connectors.signIn')).toEqual([]);
  });

  it('a name configured in two scopes: the entry the engine uses offers Sign in, the other says it is shadowed and offers none', async () => {
    const client = fresh();
    backend.script('catalog.postures', () => ({ servers: [{ name: 'notion', scope: 'user', path: '/config/.claude.json', authPosture: 'auth_required', fingerprint: 'print-user' }, { name: 'notion', scope: 'local', path: '/config/.claude.json', authPosture: 'auth_required', fingerprint: 'print-local' }] }));
    backend.script('customization.inventory', () => ({ skills: [], servers: [{ name: 'notion', scope: 'user', path: '/config/.claude.json', transport: 'http' }, { name: 'notion', scope: 'local', path: '/config/.claude.json', transport: 'http' }], warnings: [], serversRead: true }));
    const here = { ...status('here'), cwd: '/one' };
    useSessions.setState({ engine: new Map([[here.appSessionId, here]]) });
    mountWith(client);
    await screen.findAllByText('notion');
    const rowOf = (scope: string) => document.querySelector(`[data-connector="notion"][data-connector-scope="${scope}"]`) as HTMLElement;
    expect(await within(rowOf('local')).findByRole('button', { name: 'Sign in to notion' })).toBeTruthy();
    expect(within(rowOf('user')).getByText('Shadowed by the local entry')).toBeTruthy();
    expect(within(rowOf('user')).queryByRole('button', { name: 'Sign in to notion' })).toBeNull();
  });

  it('MAWS’s own server of the same name shadows the file entry, which offers no Sign in', async () => {
    const client = fresh();
    posture(client, 'notion', 'auth_required');
    backend.script('customization.inventory', () => ({ skills: [], servers: [{ name: 'notion', scope: 'app', path: '/maws/settings.json', transport: 'http' }, { name: 'notion', scope: 'user', path: '/config/.claude.json', transport: 'http' }], warnings: [], serversRead: true }));
    const here = { ...status('here'), cwd: '/one' };
    useSessions.setState({ engine: new Map([[here.appSessionId, here]]) });
    mountWith(client);
    await screen.findAllByText('notion');
    const user = document.querySelector('[data-connector="notion"][data-connector-scope="user"]') as HTMLElement;
    expect(within(user).getByText('Shadowed by MAWS’s notion server')).toBeTruthy();
    expect(within(user).queryByRole('button', { name: 'Sign in to notion' })).toBeNull();
  });

  it('two project files configuring one name: each row reads its own file’s posture and result; the nearer one is used', async () => {
    const outerFile = '/.mcp.json';
    const innerFile = '/one/.mcp.json';
    let innerPrint = 'print-inner';
    backend.script('catalog.postures', () => ({ servers: [
      { name: 'notion', scope: 'project', path: outerFile, authPosture: 'no_auth', fingerprint: 'print-outer' },
      { name: 'notion', scope: 'project', path: innerFile, authPosture: 'auth_required', fingerprint: innerPrint },
    ] }));
    backend.script('customization.inventory', () => ({ skills: [], servers: [{ name: 'notion', scope: 'project', path: outerFile, transport: 'http' }, { name: 'notion', scope: 'project', path: innerFile, transport: 'http' }], warnings: [], serversRead: true }));
    backend.script('connectors.signIn', () => ({ opId: 'op-inner' }));
    const here = { ...status('here'), cwd: '/one' };
    useSessions.setState({ engine: new Map([[here.appSessionId, here]]) });
    mountWith(fresh());
    await screen.findAllByText('notion');
    const rows = () => [...document.querySelectorAll('[data-connector="notion"]')] as HTMLElement[];
    const [outer, inner] = rows();
    expect(within(outer!).getByText(outerFile)).toBeTruthy();
    expect(within(outer!).getByText('Shadowed by the project entry')).toBeTruthy();
    expect(await within(inner!).findByText('Sign in needed')).toBeTruthy(); // the inner file's posture, not the outer one's
    fireEvent.click(within(inner!).getByRole('button', { name: 'Sign in to notion' }));
    await waitFor(() => expect(backend.calls.some((call) => call.command === 'connectors.signIn')).toBe(true));
    act(() => heard({ opId: 'op-inner', name: 'notion', state: 'done', reason: null, message: null, where: 'here' }));
    expect(await within(rows()[1]!).findByText('Signed in · connected here')).toBeTruthy();
    // the inner file's endpoint replaced: its result was not for it
    innerPrint = 'print-inner-2';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await within(rows()[1]!).findByText('Sign in needed')).toBeTruthy();
    expect(within(rows()[1]!).queryByText('Signed in · connected here')).toBeNull();
  });

  it('an authless server reads No sign-in needed and offers no sign-in', async () => {
    const client = fresh();
    posture(client, 'notion', 'no_auth');
    mountWith(client);
    const row = (await screen.findByText('notion')).closest('li')!;
    expect(await within(row).findByText('No sign-in needed')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Sign in to notion' })).toBeNull();
  });

  it('Remove opens the sheet with the exact command and file, behind the acknowledgement and Details, then runs claude mcp remove', async () => {
    backend.script('plugins.env', () => ({ binary: '/engine/claude', binaryError: null, configHome: '/config', globalConfig: '/config/.claude.json' }));
    backend.script('connectors.remove', () => ({ opId: 'remove-1' }));
    mountWith(fresh());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove notion' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remove notion?' });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Details' }));
    const argv = await within(sheet).findByText('claude mcp remove notion --scope user');
    expect(JSON.parse(argv.getAttribute('data-plugins-argv')!)).toEqual(['mcp', 'remove', 'notion', '--scope', 'user']);
    expect(within(sheet).getByText('/config/.claude.json')).toBeTruthy();
    const submit = within(sheet).getByRole('button', { name: 'Remove' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() => expect(backend.calls.filter((call) => call.command === 'connectors.remove').map((call) => call.input)).toEqual([{ cwd: '/one', binary: '/engine/claude', name: 'notion', scope: 'user' }]));
  });

  it('Remove of an entry from a parent directory’s .mcp.json runs in that directory and names that file (sweep#2)', async () => {
    backend.script('plugins.env', () => ({ binary: '/engine/claude', binaryError: null, configHome: '/config', globalConfig: '/config/.claude.json' }));
    backend.script('connectors.remove', () => ({ opId: 'remove-1' }));
    backend.script('customization.inventory', () => ({ skills: [], servers: [{ name: 'notion', scope: 'project', path: '/.mcp.json', transport: 'http' }], warnings: [], serversRead: true }));
    mountWith(fresh());
    fireEvent.click(await screen.findByRole('button', { name: 'Remove notion' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remove notion?' });
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Details' }));
    await within(sheet).findByText('claude mcp remove notion --scope project');
    expect(within(sheet).getByText('/.mcp.json')).toBeTruthy(); // the file the entry is in, not /one/.mcp.json
    fireEvent.click(within(sheet).getByRole('checkbox'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(backend.calls.filter((call) => call.command === 'connectors.remove').map((call) => call.input)).toEqual([{ cwd: '/', binary: '/engine/claude', name: 'notion', scope: 'project' }]));
  });

  it('Discover without any copy of Anthropic’s directory says so, with Retry', async () => {
    backend.script('catalog.sources', () => [{ key: 'directory:servers', label: 'Anthropic’s directory: connectors', fetchedAt: null, state: 'unavailable', dropped: 0 }]);
    backend.script('catalog.refresh', () => []);
    mountWith(fresh());
    fireEvent.click(await screen.findByRole('radio', { name: 'Discover' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Anthropic’s directory is unavailable.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(backend.calls.some((call) => call.command === 'catalog.refresh')).toBe(true));
  });
});
