import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { GitStatus } from '@shared/ipc/schema/git';
import { digest, project, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { queryClient } from '../../ipc/query';
import { resetLibrary } from '../../library/store';
import { useLibraryView } from '../../library/view';
import { useComposerStore } from '../../stores/composer';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../../transcript/dev/journal';
import type { SessionEvent } from '@shared/graph/events';
import { A, B, probeTool, resetPanelStores } from '../../test-support/panel';
import { panelHost, registerPanelTool } from '../host';
import { Summary } from './Summary';

const P = 'project-a' as ProjectId;
const Q = 'project-b' as ProjectId;
const DIR = '/work/app-a';
const GIT: GitStatus = {
  repoRoot: DIR, gitDir: `${DIR}/.git`, commonDir: `${DIR}/.git`, isWorktree: false, branch: 'main', head: 'abcdef1234567', upstream: 'origin/main',
  remoteUrl: 'git@github.com:o/maws.git', ahead: 1, behind: 0, dirty: true, stashCount: 0, checkedAt: '2026-09-29T10:00:00.000Z',
  files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }],
};
const artifact: LibraryRow = {
  id: '00000000-0000-4000-8000-000000000001', kind: 'document', title: 'Input errors plan', createdBy: { kind: 'human' },
  createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 1,
  lastEditor: { kind: 'human' }, lastEditedAt: 2, sessions: [], project: { id: P, name: 'Project A' },
};
let fake: FakeClient;
const offs: (() => void)[] = [];
const region = (name: string) => screen.getByRole('region', { name });
const open = async (name: string) => userEvent.setup().click(within(region(name)).getByRole('button', { expanded: false }));
const mount = () => render(<QueryClientProvider client={queryClient}><Summary appSessionId={A} /></QueryClientProvider>);

beforeEach(() => {
  resetPanelStores();
  resetLibrary();
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'Project A' })], [Q, project(Q, 1, { name: 'Project B' })]]), records: new Map([[A, record(A, { projectId: P })], [B, record(B, { projectId: Q })]]) });
  useComposerStore.setState({ focusTargets: new Map() });
  fake = fakeClient({
    'git.watch': GIT, 'git.diff': { patch: '', files: [{ path: 'a.ts', oldPath: null, insertions: 3, deletions: 1, binary: false }] }, 'git.unwatch': undefined,
    'layout.get': { value: null }, 'layout.set': undefined, 'layout.openExternal': undefined,
    'library.list': { rows: [artifact], counts: { document: 1, presentation: 0, design: 0, design_system: 0, dashboard: 0, html: 0, file: 0 } },
    'session.observedFacts': { version: 1, appSessionId: A, engineSessionId: null, writtenAt: '2026-10-01T00:00:00Z', source: 'journal', launches: [], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null, complete: true },
  });
  window.maws = fake.client;
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetLibrary();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('floating session cards', () => {
  it('starts folded without mounting expensive detail reads, then opens only the requested card', async () => {
    mount();
    await waitFor(() => expect(fake.invoked('git.watch')).toEqual([{ directory: DIR }]));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(4);
    expect(screen.queryByText('This Mac')).toBeNull();
    expect(fake.invoked('scm.pr.state')).toEqual([]);
    await open('Environment');
    expect(within(region('Environment')).getByText('This Mac')).toBeTruthy();
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3);
  });

  it('combines checkout, changes, push and real navigation in Environment', async () => {
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('summary-test-tool');
    offs.push(registerPanelTool(probeTool('review', { title: 'Review' }).tool));
    offs.push(registerPanelTool(probeTool('source-control', { title: 'Source control' }).tool));
    mount();
    await open('Environment');
    const env = region('Environment');
    expect(await within(env).findByText('⎇ main')).toBeTruthy();
    expect(within(env).getByText(DIR)).toBeTruthy();
    expect(within(env).getByTestId('change-line').textContent).toBe('+3 −1 across 1 file');
    await userEvent.setup().click(within(env).getByRole('button', { name: '1 ahead of origin/main' }));
    expect(addTool).toHaveBeenCalledWith('source-control', { appSessionId: A });
    await userEvent.setup().click(within(env).getByRole('button', { name: 'Open on GitHub' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://github.com/o/maws/tree/main' }]);
    await userEvent.setup().click(within(env).getByRole('button', { name: 'Review' }));
    expect(addTool).toHaveBeenCalledWith('review', { appSessionId: A });
    expect(within(env).queryByRole('switch')).toBeNull();
  });

  it('reads sampled context without presenting an unknown sample as zero', async () => {
    mount();
    await open('Context');
    expect(within(region('Context')).getByText('Not observed yet')).toBeTruthy();
    act(() => useSessions.setState({ engine: new Map([[A, status(A)]]), digests: new Map([[A, digest(A, { context: { percent: 21.4, totalTokens: 42_812, maxTokens: 200_000, autoCompactThreshold: 167_000 } })]]) }));
    expect(within(region('Context')).getByText('42,812 of 200,000 tokens')).toBeTruthy();
    expect(within(region('Context')).getByText('Autocompacts at 167,000 tokens')).toBeTruthy();
    expect(within(region('Context')).getByRole('button', { expanded: true }).textContent).toContain('21%');
  });

  it('opens the guarded compact widget only when a composer is available', async () => {
    mount();
    await open('Context');
    expect(within(region('Context')).getByRole('button', { name: 'Compact…' }).hasAttribute('disabled')).toBe(true);
    const openWidget = vi.fn(() => true);
    act(() => useComposerStore.setState({ focusTargets: new Map([[A, { openWidget } as never]]) }));
    await userEvent.setup().click(within(region('Context')).getByRole('button', { name: 'Compact…' }));
    expect(openWidget).toHaveBeenCalledWith('compact', '');
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('shows the reported MCP states, never guesses that every listed connector is connected', async () => {
    act(() => useSessions.setState({ engine: new Map([[A, { ...status(A), mcpServers: [{ name: 'github', status: 'connected', source: 'project' }, { name: 'sentry', status: 'needs-auth', source: null }] }]]) }));
    mount();
    await open('Connectors');
    const connectors = region('Connectors');
    expect(within(connectors).getByText('github')).toBeTruthy();
    expect(within(connectors).getByText('needs-auth')).toBeTruthy();
    expect(within(connectors).getByRole('button', { expanded: true }).textContent).toContain('1 connected');
    act(() => useSessions.setState({ engine: new Map([[A, { ...status(A, { process: 'exited' }), mcpServers: [{ name: 'github', status: 'connected', source: null }] }]]) }));
    expect(within(connectors).getByText('Last reported by this session')).toBeTruthy();
    expect(within(connectors).getByRole('button', { expanded: true }).textContent).not.toContain('connected');
  });

  it('keeps empty connector metadata unknown even when a ready session has events', async () => {
    mount();
    await open('Connectors');
    const connectors = region('Connectors');
    expect(within(connectors).getByText('Connector status not reported')).toBeTruthy();
    act(() => useSessions.setState({ engine: new Map([[A, { ...status(A, { process: 'ready' }), lastEventSeq: 5, mcpServers: [] }]]) }));
    expect(within(connectors).getByText('Connector status not reported')).toBeTruthy();
    expect(within(connectors).getByRole('button', { expanded: true }).textContent).toContain('Not reported');
    expect(within(connectors).queryByText('No MCP servers reported')).toBeNull();
  });

  it('queries this project, switches projects, and opens real artifact tabs', async () => {
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    mount();
    await waitFor(() => expect(fake.invoked('library.list')).toEqual([{ filter: { projectId: P } }]));
    await open('Artifacts');
    await userEvent.setup().click(await within(region('Artifacts')).findByRole('button', { name: 'Input errors plan' }));
    expect(openTab).toHaveBeenCalledWith({ kind: 'artifact', artifactId: artifact.id });
    await userEvent.setup().selectOptions(within(region('Artifacts')).getByRole('combobox', { name: 'Artifacts project' }), Q);
    await waitFor(() => expect(fake.invoked('library.list')).toEqual([{ filter: { projectId: P } }, { filter: { projectId: Q } }]));
  });

  it('does not leak the entire Library when the session has no project', async () => {
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A)) })));
    mount();
    await open('Artifacts');
    expect(within(region('Artifacts')).getByText('Choose a project to see its artifacts')).toBeTruthy();
    expect(fake.invoked('library.list')).toEqual([]);
  });

  it('All in Library clears stale filters and opens the main Library, not the old session tool', async () => {
    useLibraryView.setState({ view: 'pinned', query: 'invisible', kind: 'presentation', spaceId: 'old' });
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    mount();
    await open('Artifacts');
    await userEvent.setup().click(within(region('Artifacts')).getByRole('button', { name: 'All in Library' }));
    expect(useLibraryView.getState()).toMatchObject({ view: 'all', query: '', kind: null, spaceId: null });
    expect(openTab).toHaveBeenCalledWith({ kind: 'artifacts' });
  });

  it('switching sessions resets disclosures and project scope rather than leaking the previous session’s choice', async () => {
    const view = mount();
    await open('Artifacts');
    await userEvent.setup().selectOptions(within(region('Artifacts')).getByRole('combobox', { name: 'Artifacts project' }), Q);
    view.rerender(<QueryClientProvider client={queryClient}><Summary appSessionId={B} /></QueryClientProvider>);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(4);
    view.rerender(<QueryClientProvider client={queryClient}><Summary appSessionId={A} /></QueryClientProvider>);
    await open('Artifacts');
    expect((within(region('Artifacts')).getByRole('combobox') as HTMLSelectElement).value).toBe(P);
  });

  it('keeps transcript Sources actionable inside Context instead of losing them with the old section', async () => {
    const events = journalToEvents(loadSyntheticJournal('exploration-and-web'));
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events as SessionEvent[]) }));
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    mount();
    await open('Context');
    const context = region('Context');
    expect(within(context).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.setup().click(within(context).getByRole('button', { name: /reduce\.ts/ }));
    expect(openTab).toHaveBeenCalledWith({ kind: 'file', path: '/tmp/maws-synth-exploration-and-web/src/model/reduce.ts', line: null, appSessionId: A });
    await userEvent.setup().click(within(context).getByRole('button', { name: /tanstack\.com/ }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://tanstack.com/virtual/latest/docs/api/virtualizer' }]);
    expect(within(context).queryByRole('button', { name: /docs · search/ })).toBeNull();
  });

  it('keeps plugin status lines and reload controls within Connectors', async () => {
    const at = '2026-10-01T10:00:00.000Z';
    const plugins = [{ name: 'mods-probe', path: '/p/probe', source: null, version: null }];
    act(() => useSessions.setState({ engine: new Map([[A, { ...status(A), plugins, pluginsObservedAt: at }]]) }));
    const event = { id: `${A}:L:1:0`, sessionId: 's', at, seq: 1, agentId: null, parentToolUseId: null, kind: 'plugin.status', plugin: 'mods-probe', text: 'watching the build' } as SessionEvent;
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve([event]) }));
    mount();
    await open('Connectors');
    const connectors = region('Connectors');
    expect(within(connectors).getByText('mods-probe · watching the build')).toBeTruthy();
    expect(within(connectors).getByText('Plugins · 1 loaded')).toBeTruthy();
    await userEvent.setup().click(within(connectors).getByRole('button', { name: 'Reload plugins' }));
    expect(fake.invoked('session.reloadPlugins')).toEqual([{ appSessionId: A }]);
    await act(() => fake.reply('session.reloadPlugins', { opId: 'op-1' }));
    act(() => fake.event('session.operation', { appSessionId: A, opId: 'op-1', command: 'session.reloadPlugins', late: false, outcome: { ok: true, value: { commands: [], agents: [], plugins: [{ name: 'mods-probe' }], error_count: 0 } } }));
    await userEvent.setup().click(within(connectors).getByRole('button', { name: 'Reload skills' }));
    expect(fake.invoked('session.reloadSkills')).toEqual([{ appSessionId: A }]);
  });

  it('has no session-dependent reads without a session', () => {
    render(<Summary appSessionId={null} />);
    expect(screen.queryByRole('region', { name: 'Environment' })).toBeNull();
    expect(fake.invoked('git.watch')).toEqual([]);
    expect(fake.invoked('library.list')).toEqual([]);
  });
});
