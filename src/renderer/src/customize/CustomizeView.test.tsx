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
