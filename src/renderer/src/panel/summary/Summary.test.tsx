import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { SessionRecord } from '@shared/graph/session';
import { addressOf, bareOf } from '@shared/machine/address';
import { digest, item, project, record, remoteRow, status, T0 } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { registerSlot, resetSlots } from '../../app/slots';
import { queryClient } from '../../ipc/query';
import { useAttention } from '../../stores/attention';
import { useComposerStore } from '../../stores/composer';
import { useGit } from '../../stores/git';
import { storedLayout, useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../../transcript/dev/journal';
import type { SessionEvent } from '@shared/graph/events';
import { A, B, probeTool, resetPanelStores } from '../../test-support/panel';
import { SUMMARY_COPY } from '../copy';
import { panelHost, registerPanelTool } from '../host';
import { useHasSources } from './Sources';
import { Summary } from './Summary';
import { preloadOf } from '../../test-support/preload-of';

const P = at('project-a' as ProjectId);
const Q = at('project-b' as ProjectId);
const DIR = `/work/${A}`; // A's directory in the builders' record
// P5 O6 M2: the fake bridge stands for main, so it is asked, answers and speaks of the bare ids
const MAIN = { A: bareOf(A), P: bareOf(P), Q: bareOf(Q) };
const GIT: GitStatus = {
  repoRoot: DIR, gitDir: `${DIR}/.git`, commonDir: `${DIR}/.git`, isWorktree: false, branch: 'main', head: 'abcdef1234567', upstream: 'origin/main',
  remoteUrl: 'git@github.com:o/maws.git', ahead: 1, behind: 0, dirty: true, stashCount: 0, checkedAt: '2026-09-29T10:00:00.000Z',
  files: [{ path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false }],
};
let fake: FakeClient;
const offs: (() => void)[] = [];
const region = (name: string) => screen.getByRole('region', { name });
const open = async (name: string) => userEvent.setup().click(within(region(name)).getByRole('button', { expanded: false }));
const fold = async (name: string) => userEvent.setup().click(within(region(name)).getByRole('button', { expanded: true }));
const isOpen = (name: string) => within(region(name)).getAllByRole('button').find((button) => button.hasAttribute('aria-expanded'))!.getAttribute('aria-expanded') === 'true';
const cardNames = () => screen.queryAllByRole('region').filter((r) => r.tagName === 'SECTION').map((r) => r.getAttribute('aria-label'));
const list = () => screen.getByLabelText('Session cards');
const summaryOf = (id: AppSessionId) => <QueryClientProvider client={queryClient}><Summary appSessionId={id} /></QueryClientProvider>;
const mount = () => render(summaryOf(A));
// UX wave U8b (M4, §C.1): a request of the session that waits on its answer, and an open item that asks for none
const waiting = (id: AppSessionId, requestId: string | null = 'req-1') => item(id, 'permission', T0, { request: { requestId: requestId as never, toolUseId: null, taskId: null, agentId: null } });
const setAttention = (items: ReturnType<typeof item>[]) => act(() => useAttention.setState((s) => ({ bySession: new Map(items.length ? [[items[0]!.appSessionId, items]] : []), version: s.version + 1 })));

beforeEach(() => {
  resetPanelStores();
  resetSlots();
  useAttention.setState((s) => ({ bySession: new Map(), version: s.version + 1 }));
  useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'Project A' })], [Q, project(Q, 1, { name: 'Project B' })]]), records: new Map([[A, record(A, { projectId: P })], [B, record(B, { projectId: Q })]]) });
  useComposerStore.setState({ focusTargets: new Map() });
  fake = fakeClient({
    'git.watch': GIT, 'git.diff': { patch: '', files: [{ path: 'a.ts', oldPath: null, insertions: 3, deletions: 1, binary: false }] }, 'git.unwatch': undefined,
    'layout.get': { value: null }, 'layout.set': undefined, 'layout.openExternal': undefined,
    'session.observedFacts': { version: 1, appSessionId: MAIN.A, engineSessionId: null, writtenAt: '2026-10-01T00:00:00Z', source: 'journal', launches: [], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null, complete: true },
  });
  window.maws = preloadOf(fake);
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  resetSlots();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('floating session cards', () => {
  // UX wave U8b (A1, UC-9): the column's cards, their order and their folds.
  it('holds Environment open, then Context and Connectors folded, in that order, and no Artifacts card', async () => {
    mount();
    await waitFor(() => expect(fake.invoked('git.watch')).toEqual([{ directory: DIR }]));
    expect(cardNames()).toEqual(['Environment', 'Context', 'Connectors']);
    expect(['Environment', 'Context', 'Connectors'].map(isOpen)).toEqual([true, false, false]);
    expect(within(region('Environment')).getByText('This Mac')).toBeTruthy();
    expect(fake.invoked('library.list')).toEqual([]);
  });

  it('a folded card mounts none of its detail and makes no read; opening one opens only it', async () => {
    act(() => useLayout.setState({ cardsOpen: [] }));
    mount();
    await waitFor(() => expect(fake.invoked('git.watch')).toEqual([{ directory: DIR }]));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3);
    expect(screen.queryByText('This Mac')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage connectors…' })).toBeNull();
    expect(fake.invoked('scm.pr.state')).toEqual([]);
    await open('Context');
    expect(within(region('Context')).getByRole('button', { name: 'Details…' })).toBeTruthy();
    expect(['Environment', 'Context', 'Connectors'].map(isOpen)).toEqual([false, true, false]);
    expect(useLayout.getState().cardsOpen).toEqual(['context']);
  });

  it('a fold is kept across a change of session and a relaunch', async () => {
    const view = mount();
    await fold('Environment');
    expect(useLayout.getState().cardsOpen).toEqual([]);
    view.rerender(summaryOf(B));
    expect(isOpen('Environment')).toBe(false);
    view.rerender(summaryOf(A));
    expect(isOpen('Environment')).toBe(false);
    // a relaunch: the store hydrates from what it would write, over a store that holds the default again
    const values = Object.fromEntries(storedLayout(useLayout.getState()));
    expect(values['cards.open']).toEqual({ version: 1, open: [] });
    act(() => useLayout.setState({ cardsOpen: ['environment'] }));
    expect(isOpen('Environment')).toBe(true);
    const bridge = fakeClient({ 'layout.list': { keys: Object.keys(values) }, 'layout.get': ({ key }: { key: string }) => ({ value: values[key] ?? null }), 'layout.set': undefined });
    await act(() => useLayout.getState().hydrate(bridge.client, () => true));
    expect(isOpen('Environment')).toBe(false);
  });

  // UX wave U8b (A8, l5-code-16): no Review button on the branch row and no Claude Code version row.
  it('combines checkout, changes, push and real navigation in Environment', async () => {
    const addTool = vi.spyOn(panelHost, 'addTool').mockReturnValue('summary-test-tool');
    offs.push(registerPanelTool(probeTool('review', { title: 'Review' }).tool));
    offs.push(registerPanelTool(probeTool('source-control', { title: 'Source control' }).tool));
    mount();
    const env = region('Environment');
    expect(await within(env).findByText('⎇ main')).toBeTruthy();
    expect(within(env).getByText(DIR)).toBeTruthy();
    expect(within(env).getByTestId('change-line').textContent).toBe('+3 −1 across 1 file');
    await userEvent.setup().click(within(env).getByRole('button', { name: '1 ahead of origin/main' }));
    expect(addTool).toHaveBeenCalledWith('source-control', { appSessionId: A });
    await userEvent.setup().click(within(env).getByRole('button', { name: 'Open on GitHub' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://github.com/o/maws/tree/main' }]);
    expect(within(env).queryByRole('button', { name: 'Review' })).toBeNull();
    expect(within(within(env).getByText('⎇ main').closest('div')!.parentElement!).queryByRole('button')).toBeNull(); // the branch row
    expect(within(env).queryByText(/Claude Code/)).toBeNull();
    expect(within(env).queryByRole('switch')).toBeNull();
  });

  // UX wave U8b (A6, O-10): Details… alone, and Sources only when there is a source to list.
  it('the opened Context card has Details… and no other button, and no Sources part while there is no source', async () => {
    mount();
    await open('Context');
    const context = region('Context');
    expect(within(context).getAllByRole('button').filter((button) => !button.hasAttribute('aria-expanded')).map((button) => button.textContent)).toEqual(['Details…']);
    expect(within(context).queryByLabelText('Sources')).toBeNull();
    expect(within(context).queryByText(SUMMARY_COPY.openSession)).toBeNull();
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve([]) }));
    expect(within(context).queryByLabelText('Sources')).toBeNull(); // a transcript with nothing to list
  });

  it('useHasSources holds exactly when the session’s transcript lists a source', async () => {
    const { result } = renderHook(() => useHasSources(A));
    expect(result.current).toBe(false); // no transcript on this page
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(journalToEvents(loadSyntheticJournal('exploration-and-web')) as SessionEvent[]) }));
    expect(result.current).toBe(true);
  });

  // UX wave U8b (UC-9, §C.1): the two slots, first in the column and at its foot.
  it('draws the waiting card first only while a request of the session waits, and the foot under the last card', async () => {
    registerSlot('sessionCardWaiting', ({ appSessionId }) => <section aria-label="Waiting requests">{appSessionId}</section>);
    registerSlot('sessionCardFoot', ({ appSessionId }) => <div data-testid="card-foot">{appSessionId}</div>);
    mount();
    expect(screen.queryByRole('region', { name: 'Waiting requests' })).toBeNull();
    const foot = screen.getByTestId('card-foot');
    expect(list().contains(foot)).toBe(false); // outside the scrolling list
    expect(list().nextElementSibling).toBe(foot);
    setAttention([waiting(A, null)]); // open, but it asks for no answer
    expect(screen.queryByRole('region', { name: 'Waiting requests' })).toBeNull();
    setAttention([waiting(B)]); // another session's
    expect(screen.queryByRole('region', { name: 'Waiting requests' })).toBeNull();
    setAttention([waiting(A)]);
    expect(list().firstElementChild).toBe(screen.getByRole('region', { name: 'Waiting requests' }));
    expect(cardNames()).toEqual(['Waiting requests', 'Environment', 'Context', 'Connectors']);
    setAttention([{ ...waiting(A), state: 'confirmed' as const }]);
    expect(screen.queryByRole('region', { name: 'Waiting requests' })).toBeNull();
  });

  it('with nothing registered in the two slots, neither draws an element', () => {
    setAttention([waiting(A)]);
    mount();
    expect(list().parentElement!.children).toHaveLength(1);
    expect([...list().children].map((child) => child.getAttribute('aria-label'))).toEqual(['Environment', 'Context', 'Connectors']);
  });

  // UX wave U8b (UC-9): another machine's terminal session that is only listed has no record, so no record card.
  it('gives a listed terminal session without a record the column and its slots, and no record card', () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'eng-r' as AppSessionId);
    const LANE_B = addressOf(OTHER_MACHINE, 'eng-b' as AppSessionId);
    useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'eng-r', { lane: 'A' }), appId: REMOTE }], [LANE_B, { ...remoteRow(OTHER_MACHINE, 'eng-b'), appId: LANE_B }]]) });
    registerSlot('sessionCardFoot', ({ appSessionId }) => <div data-testid="card-foot">{appSessionId}</div>);
    const view = render(summaryOf(REMOTE));
    expect(list()).toBeTruthy();
    expect(cardNames()).toEqual([]);
    expect(screen.getByTestId('card-foot').textContent).toBe(REMOTE);
    expect(fake.invoked('git.watch')).toEqual([]);
    view.rerender(summaryOf(LANE_B)); // a listed session of the other lane has its record or nothing
    expect(screen.queryByLabelText('Session cards')).toBeNull();
    useSessions.setState({ listed: new Map() });
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

  it('keeps transcript Sources actionable inside Context instead of losing them with the old section', async () => {
    const events = journalToEvents(loadSyntheticJournal('exploration-and-web'));
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve(events as SessionEvent[]) }));
    const openTab = vi.spyOn(useLayout.getState(), 'openTab');
    mount();
    await open('Context');
    const context = region('Context');
    expect(within(context).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.setup().click(within(context).getByRole('button', { name: /reduce\.ts/ }));
    expect(openTab).toHaveBeenCalledWith({ kind: 'file', path: '/tmp/maws-synth-exploration-and-web/src/model/reduce.ts', line: null, appSessionId: A, machine: TEST_MACHINE });
    await userEvent.setup().click(within(context).getByRole('button', { name: /tanstack\.com/ }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://tanstack.com/virtual/latest/docs/api/virtualizer' }]);
    expect(within(context).queryByRole('button', { name: /docs · search/ })).toBeNull();
  });

  it('keeps plugin status lines and reload controls within Connectors', async () => {
    const observedAt = '2026-10-01T10:00:00.000Z';
    const plugins = [{ name: 'mods-probe', path: '/p/probe', source: null, version: null }];
    act(() => useSessions.setState({ engine: new Map([[A, { ...status(A), plugins, pluginsObservedAt: observedAt }]]) }));
    const event = { id: `${A}:L:1:0`, sessionId: 's', at: observedAt, seq: 1, agentId: null, parentToolUseId: null, kind: 'plugin.status', plugin: 'mods-probe', text: 'watching the build' } as SessionEvent;
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve([event]) }));
    mount();
    await open('Connectors');
    const connectors = region('Connectors');
    expect(within(connectors).getByText('mods-probe · watching the build')).toBeTruthy();
    expect(within(connectors).getByText('Plugins · 1 loaded')).toBeTruthy();
    await userEvent.setup().click(within(connectors).getByRole('button', { name: 'Reload plugins' }));
    expect(fake.invoked('session.reloadPlugins')).toEqual([{ appSessionId: MAIN.A }]);
    await act(() => fake.reply('session.reloadPlugins', { opId: 'op-1' }));
    act(() => fake.event('session.operation', { appSessionId: MAIN.A, opId: 'op-1', command: 'session.reloadPlugins', late: false, outcome: { ok: true, value: { commands: [], agents: [], plugins: [{ name: 'mods-probe' }], error_count: 0 } } }));
    await userEvent.setup().click(within(connectors).getByRole('button', { name: 'Reload skills' }));
    expect(fake.invoked('session.reloadSkills')).toEqual([{ appSessionId: MAIN.A }]);
  });

  it('has no session-dependent reads without a session', () => {
    render(<Summary appSessionId={null} />);
    expect(screen.queryByRole('region', { name: 'Environment' })).toBeNull();
    expect(fake.invoked('git.watch')).toEqual([]);
    expect(fake.invoked('library.list')).toEqual([]);
  });
});

// UX wave U8c-2 (M4, §H; the owner's answers, Decision Log 14): the card says where the agent is. The folder row shows the
// agent's own folder (the selector's `cwd`), cut at its start when it does not fit, whole in its tooltip; while the
// working folder is not the launch folder, one muted line "moved from <the launch folder's name>" sits directly under it.
describe('the Environment card follows the agent', () => {
  const REPO = '/repo';
  const W1 = '/repo/.claude/worktrees/w1';
  const put = (over: Partial<SessionRecord>) => act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { projectId: P, directory: REPO, ...over })) })));
  const byCd: Partial<SessionRecord> = { agentFolder: { checkout: W1, cwd: `${W1}/src`, branch: 'w1', linked: true } };
  const byTool: Partial<SessionRecord> = { directory: `${W1}/src`, worktree: { path: W1, branch: 'w1' }, launchFolder: REPO };
  const env = () => region('Environment');
  const folderRow = () => within(env()).getByTestId('card-folder');
  const movedFrom = () => within(env()).queryByTestId('moved-from');
  const header = () => within(env()).getByRole('button', { expanded: true }).textContent;

  it.each([['a cd', byCd], ['the worktree tool', byTool]])('after a move by %s: the agent’s folder in the row, cut at its start, and "moved from" directly under it', async (_how, over) => {
    put(over);
    mount();
    expect(await within(env()).findByText('⎇ main')).toBeTruthy();
    expect(fake.invoked('git.watch')).toEqual([{ directory: W1 }]); // git at the working folder
    expect(folderRow().textContent).toBe(`${W1}/src`);
    expect(folderRow().title).toBe(`${W1}/src`);
    expect(folderRow().getAttribute('dir')).toBe('rtl'); // the browser's ellipsis at the path's start; the text itself runs left to right
    const line = movedFrom()!;
    expect(line.textContent).toBe('moved from repo');
    expect(line.title).toBe(REPO);
    expect(line.previousElementSibling?.contains(folderRow())).toBe(true); // directly under the folder row
    expect(line.nextElementSibling?.textContent).toBe('⎇ main'); // above the branch row
  });

  it('draws no "moved from" at the launch folder nor in a sub-folder of it, and a change of sub-folder changes the row in place', async () => {
    put({});
    mount();
    await within(env()).findByText('⎇ main');
    expect(folderRow().textContent).toBe(REPO);
    expect(folderRow().getAttribute('dir')).toBe('rtl'); // every session's card, moved or not
    expect(movedFrom()).toBeNull();
    const row = folderRow();
    put({ agentFolder: { checkout: REPO, cwd: `${REPO}/packages/app`, branch: 'main', linked: false } });
    await waitFor(() => expect(folderRow().textContent).toBe(`${REPO}/packages/app`));
    expect(folderRow()).toBe(row); // the same row, its text changed
    expect(movedFrom()).toBeNull();
    expect(within(env()).getByText('⎇ main')).toBeTruthy();
    expect(fake.invoked('git.watch')).toEqual([{ directory: REPO }]); // a change of the agent's folder alone starts no watch
  });

  it('after a move, shows the new folder and the pending copy until git answers there; the old folder’s late answer changes nothing', async () => {
    fake = fakeClient({
      'git.diff': { patch: '', files: [{ path: 'a.ts', oldPath: null, insertions: 3, deletions: 1, binary: false }] }, 'git.unwatch': undefined,
      'layout.get': { value: null }, 'layout.set': undefined,
      'session.observedFacts': { version: 1, appSessionId: MAIN.A, engineSessionId: null, writtenAt: '2026-10-01T00:00:00Z', source: 'journal', launches: [], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null, complete: true },
    });
    window.maws = preloadOf(fake);
    useGit.setState({ entries: new Map() });
    put({});
    mount();
    await waitFor(() => expect(fake.invoked('git.watch')).toEqual([{ directory: REPO }])); // unanswered
    put(byCd);
    await waitFor(() => expect(fake.invoked('git.watch')).toEqual([{ directory: REPO }, { directory: W1 }]));
    expect(folderRow().textContent).toBe(`${W1}/src`);
    await act(() => fake.reply('git.watch', { ...GIT, repoRoot: REPO }, 0)); // the launch folder's answer, late
    expect(within(env()).queryByText('⎇ main')).toBeNull();
    expect(within(env()).queryByTestId('change-line')).toBeNull();
    expect(within(env()).getAllByText(SUMMARY_COPY.pending).length).toBeGreaterThan(0); // the one pending row
    expect(header()).toContain(SUMMARY_COPY.pending);
    await act(() => fake.reply('git.watch', { ...GIT, repoRoot: W1, branch: 'w1' }, 0));
    expect(await within(env()).findByText('⎇ w1')).toBeTruthy();
    expect(header()).toContain('w1');
    expect(movedFrom()?.textContent).toBe('moved from repo');
  });
});
