import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { project, status } from '../../../../test/support/builders';
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
const mount = (section: 'skills' | 'mcp') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomizeView section={section} /></QueryClientProvider>);

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
  const browse = await screen.findByRole('radio', { name: 'Browse' });
  fireEvent.click(browse);
  expect(browse.getAttribute('aria-checked')).toBe('true');
  mounted.rerender(view('skills'));
  await screen.findByRole('button', { name: 'View review' });
  mounted.rerender(view('plugins'));
  expect(screen.getByRole('radio', { name: 'Browse' })).toBe(browse);
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
    fireEvent.click(open);
    const detail = document.querySelector<HTMLElement>('[data-skill-detail]')!;
    expect(within(detail).getByRole('heading', { name })).toBeTruthy();
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
  fireEvent.click(open);
  const detail = document.querySelector<HTMLElement>('[data-skill-detail]')!;
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

it('shows configured servers without inventing connection state or offering a session start', async () => {
  mount('mcp');
  await screen.findByText('notion');
  expect(screen.getByText(/Connection state and tools are unavailable/)).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load now' })).toBeNull();
  await waitFor(() => expect(backend.calls.some((call) => call.command === 'customization.inventory')).toBe(true));
  expect(backend.calls.filter((call) => call.command.startsWith('session.'))).toEqual([]);
});
