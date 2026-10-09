// The summary card over seeded stores (C8a execution document, M2): the sessions and layout stores seeded directly, a
// fake bridge standing in for main (git.*, layout.get/set, fs.workflows), and C6's transcript store attached to the
// session's key as the session tab would attach it.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { CommandName } from '@shared/ipc/schema';
import type { GitDiff, GitStatus } from '@shared/ipc/schema/git';
import type { ScmGhState, ScmPrState, ScmStatus } from '@shared/ipc/schema/scm';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { digest, record, status as engineStatus } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { A, panelOf, probeTool, resetPanelStores, TestHost } from '../../test-support/panel';
import { journalToEvents } from '../../transcript/dev/journal';
import { registerPanelTool } from '../host';

const DIR = '/work/app-a'; // A's directory in the builders' record
const GIT: GitStatus = {
  repoRoot: DIR, gitDir: `${DIR}/.git`, commonDir: `${DIR}/.git`, isWorktree: false, branch: 'main', head: 'abcdef1234567', upstream: 'origin/main',
  remoteUrl: 'git@github.com:o/maws.git', ahead: 1, behind: 0, dirty: true, stashCount: 0, checkedAt: '2026-09-29T10:00:00.000Z',
  files: [
    { path: 'a.ts', oldPath: null, index: '.', worktree: 'M', untracked: false },
    { path: 'new.txt', oldPath: null, index: '?', worktree: '?', untracked: true },
  ],
};
const DIFF: GitDiff = { patch: '', files: [{ path: 'a.ts', oldPath: null, insertions: 3, deletions: 1, binary: false }] };
// E6 (a C8a test amended by E6): the push-state row's PR line reads E6's `scm.status` and `scm.pr.state`; here gh answers
// that the branch has no PR.
const GH: ScmGhState = { state: 'ready', path: '/bin/gh', version: 'gh version 2.97.0' };
const SCM: ScmStatus = { directory: DIR, repository: true, trusted: true, trustKey: DIR, remotes: [{ name: 'origin', url: 'git@github.com:o/maws.git' }], defaultRemote: 'origin', defaultBase: 'main', gh: GH, checkedAt: '2026-09-29T10:00:00.000Z' };
const PR_STATE: ScmPrState = { checkedAt: '2026-09-29T10:00:01.000Z', branch: 'main', gh: GH, pr: null, error: null };
const RUN = { runId: 'run-1', snapshot: null, journal: [] };

let fake: FakeClient;
const offs: (() => void)[] = [];

function bridge(over: Partial<Record<CommandName, unknown>> = {}) {
  fake = fakeClient({ 'git.watch': GIT, 'git.diff': DIFF, 'git.unwatch': undefined, 'layout.get': { value: null }, 'layout.set': undefined, 'layout.openExternal': undefined, 'fs.workflows': { runs: [RUN, RUN] }, 'session.reloadPlugins': { opId: 'op-1' }, 'session.reloadSkills': { opId: 'op-2' }, 'scm.status': SCM, 'scm.pr.state': PR_STATE, ...over });
  window.maws = fake.client;
}

// The bridge answers `name` with a failure (still recording the call).
function failing(name: CommandName, message: string, code = 'internal') {
  const invoke = fake.client.invoke;
  fake.client.invoke = (async (command: CommandName, input: never) => {
    const answer = await invoke(command, input);
    return command === name ? { ok: false, error: { code, message } } : answer;
  }) as never;
}

const live = () => act(() => useSessions.setState((s) => ({ engine: new Map([[A, { ...engineStatus(A), backgroundTasks: [task('local_bash'), task('local_workflow'), task('local_agent')] }]]), digests: new Map([[A, digest(A, { childAgents: { active: 2, done: 1 } })]]), digestsVersion: s.digestsVersion + 1 })));
const task = (taskType: string) => ({ taskId: `${taskType}-1` as never, taskType, description: taskType, ambient: false });
const section = (name: string) => screen.getByRole('region', { name });
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function attachTranscript(name: string) {
  const events = journalToEvents(loadSyntheticJournal(name));
  const source = { subscribe: () => () => {}, snapshot: () => Promise.resolve(events as SessionEvent[]) };
  await act(() => useTranscriptStore.getState().attach(A, source));
}

async function mount() {
  const view = render(<TestHost />);
  await settle();
  await settle();
  return view;
}

beforeEach(() => {
  resetPanelStores();
  bridge();
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  vi.restoreAllMocks();
});

describe('summary card', () => {
  it('renders the sections in order with their headings, then the footer', async () => {
    await live();
    await mount();
    const card = screen.getByRole('tabpanel');
    expect(within(card).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Environment', 'Push state', 'Subagents', 'Background work', 'Sources']);
    expect(within(card).getAllByRole('button', { expanded: true }).map((b) => b.textContent)).toEqual(['Environment', 'Push state', 'Subagents', 'Background work', 'Sources']);
    expect(card.textContent).toMatch(/Tools stay with this session\. Pin a tab to keep it with you as you switch\.$/);
  });

  it('shows the footer alone when no session is shown', async () => {
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    await mount();
    expect(screen.getByRole('tabpanel').textContent).toBe('Tools stay with this session. Pin a tab to keep it with you as you switch.');
    expect(fake.invoked('git.watch')).toEqual([]);
  });

  it('reads the branch, the change line and the push state from git, and opens the branch on GitHub', async () => {
    const user = userEvent.setup();
    await mount();
    expect(fake.invoked('git.watch')).toEqual([{ directory: DIR }]);
    expect(fake.invoked('git.diff')).toEqual([{ directory: DIR, scope: 'all' }]);
    const env = section('Environment');
    expect(within(env).getByText('⎇ main')).toBeTruthy();
    expect(within(env).getByTestId('change-line').textContent).toBe('+3 −1 across 2 files · 1 untracked');
    const push = section('Push state');
    expect(within(push).getByText('1 ahead of origin/main')).toBeTruthy();
    await waitFor(() => expect(within(push).getByTestId('pr-line').textContent).toBe('No PR for main')); // E6: the row's second line, once main's two reads answer
    await user.click(within(push).getByRole('button', { name: 'Open on GitHub' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://github.com/o/maws/tree/main' }]);
  });

  it('keeps the branch and says the change is unavailable when git.diff fails; hides the push state on a detached head', async () => {
    bridge({ 'git.watch': { ...GIT, branch: null } });
    failing('git.diff', 'git diff failed: bad object');
    await mount();
    const env = section('Environment');
    expect(within(env).getByText('detached at abcdef1')).toBeTruthy();
    expect(within(env).getByTestId('change-line').textContent).toBe('Change unavailable');
    expect(screen.queryByRole('region', { name: 'Push state' })).toBeNull();
  });

  it('reads Clean for a clean tree, Not pushed without an upstream, and Up to date at zero ahead', async () => {
    bridge({ 'git.watch': { ...GIT, dirty: false, files: [], upstream: null, remoteUrl: null, ahead: 0 } });
    const view = await mount();
    expect(within(section('Environment')).getByTestId('change-line').textContent).toBe('Clean');
    expect(fake.invoked('git.diff')).toEqual([]);
    expect(within(section('Push state')).getByText('Not pushed')).toBeTruthy();
    view.unmount();
    bridge({ 'git.watch': { ...GIT, ahead: 0, behind: 2, remoteUrl: '/tmp/origin.git' } });
    await mount();
    expect(within(section('Push state')).getByText('Up to date with origin/main · 2 behind')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open on GitHub' })).toBeNull();
  });

  it('says Not a git repository for that failure and Git unavailable for any other, with no branch', async () => {
    for (const [message, words] of [
      ['not a git repository', 'Not a git repository'],
      ['git unavailable: /usr/bin/git: ENOENT', 'Git unavailable'],
    ]) {
      bridge();
      failing('git.watch', message);
      const view = await mount();
      const env = section('Environment');
      expect(within(env).getByText(words)).toBeTruthy();
      expect(env.textContent).not.toContain('⎇');
      expect(screen.queryByRole('region', { name: 'Push state' })).toBeNull();
      view.unmount();
    }
  });

  it('Review opens the review tool when one is registered and names C8c when not', async () => {
    const user = userEvent.setup();
    await mount();
    const disabled = within(section('Environment')).getByRole('button', { name: 'review is not available' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
    offs.push(registerPanelTool(probeTool('review', { title: 'Review', multiInstance: false }).tool));
    await settle();
    await user.click(within(section('Environment')).getByRole('button', { name: 'Review' }));
    expect(panelOf(A)!.tabs.map((t) => t.toolId)).toEqual(['review']);
    expect(panelOf(A)!.activeTabId).toBe(panelOf(A)!.tabs[0].id);
  });

  it('the model row opens Session info, and names C11 while it is not registered', async () => {
    const user = userEvent.setup();
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { model: { requested: 'opus', resolved: 'claude-opus-4-1' }, effort: 'high' })) })));
    await mount();
    const env = section('Environment');
    // W9 (H4): the chip's words, the exact id the engine reported in the tooltip
    expect(within(env).getByText('opus high').getAttribute('title')).toBe('claude-opus-4-1');
    expect(within(env).getByRole('button', { name: 'session-info is not available' }).hasAttribute('disabled')).toBe(true);
    offs.push(registerPanelTool(probeTool('session-info', { title: 'Session info', multiInstance: false }).tool));
    await settle();
    await user.click(within(section('Environment')).getByRole('button', { name: 'Session info' }));
    expect(panelOf(A)!.tabs.map((t) => t.toolId)).toEqual(['session-info']);
  });

  // W13: the Claude Code version the session last ran on, a line of its own
  it('names the Claude Code version the session ran on, and nothing while none is known', async () => {
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { engineVersion: '2.1.287' })) })));
    await mount();
    expect(within(section('Environment')).getByText('Claude Code 2.1.287')).toBeTruthy();
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { engineVersion: null })) })));
    expect(within(section('Environment')).queryByText(/^Claude Code /)).toBeNull();
  });

  it('counts subagents from the digest and draws the transcript’s glyphs; Open says it is not available', async () => {
    await live();
    await attachTranscript('agents-and-messages');
    await mount();
    const agents = section('Subagents');
    expect(within(agents).getByText('2 working · 1 done')).toBeTruthy();
    expect(within(agents).getByTestId('agent-glyphs').textContent).toBe('✻✿'); // C6's marks 0 and 2 (glyphFor of the two task ids)
    expect(within(agents).getByRole('button', { name: 'subagents is not available' }).hasAttribute('disabled')).toBe(true);
  });

  it('reads No subagents yet with no children, and counts alone with no transcript', async () => {
    await mount();
    expect(within(section('Subagents')).getByText('No subagents yet')).toBeTruthy();
    expect(within(section('Subagents')).queryByTestId('agent-glyphs')).toBeNull();
  });

  it('counts a live session’s background work by kind, agents excluded', async () => {
    await live();
    await mount();
    expect(within(section('Background work')).getByText('1 shell · 1 workflow')).toBeTruthy();
    act(() => useSessions.setState({ engine: new Map([[A, engineStatus(A)]]) }));
    expect(within(section('Background work')).getByText('Nothing running')).toBeTruthy();
  });

  it('a disk-only session shows its workflow runs on disk and the shells sentence', async () => {
    await mount();
    const background = section('Background work');
    expect(await within(background).findByText('2 workflow runs on disk')).toBeTruthy();
    expect(within(background).getByText('Shells and monitors are known only while the session runs here')).toBeTruthy();
    expect(fake.invoked('fs.workflows')).toEqual([{ appSessionId: A }]);
  });

  it('a disk-only session whose fs.workflows fails shows the shells sentence alone', async () => {
    failing('fs.workflows', 'no host', 'host_unavailable');
    await mount();
    const background = section('Background work');
    expect(background.textContent).toBe('Background workShells and monitors are known only while the session runs herebackground is not available');
  });

  it('lists Sources from the transcript projection: files open a file tab, web rows open externally, MCP rows are source only', async () => {
    const user = userEvent.setup();
    const openTab = vi.fn();
    act(() => useLayout.setState({ openTab }));
    await attachTranscript('exploration-and-web');
    await mount();
    const sources = section('Sources');
    const rows = within(sources).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows[0]).toBe('docs · searchSource only');
    expect(rows[1]).toContain('tanstack.com/virtual/latest/docs/api/virtualizer');
    expect(rows).toHaveLength(8);
    await user.click(within(sources).getByRole('button', { name: /reduce\.ts/ }));
    expect(openTab).toHaveBeenCalledWith({ kind: 'file', path: '/tmp/maws-synth-exploration-and-web/src/model/reduce.ts', line: null, appSessionId: A });
    await user.click(within(sources).getByRole('button', { name: /tanstack\.com/ }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://tanstack.com/virtual/latest/docs/api/virtualizer' }]);
    expect(within(sources).queryByRole('button', { name: /docs · search/ })).toBeNull();
  });

  it('Sources and the glyph line are the same after every turn is toggled and after expandAll', async () => {
    await live();
    // exploration-and-web for the Sources rows (eight of them), agents-and-messages for the glyph line (its only
    // file and search calls are the children's own, which are not the session's sources).
    for (const [fixture, rows, glyphs] of [
      ['exploration-and-web', 8, null],
      ['agents-and-messages', 0, '✻✿'],
    ] as const) {
      await attachTranscript(fixture);
      const view = await mount();
      const read = () => ({ sources: within(section('Sources')).queryAllByRole('listitem').map((row) => row.textContent), glyphs: screen.queryByTestId('agent-glyphs')?.textContent ?? null });
      const before = read();
      expect(before.sources, fixture).toHaveLength(rows);
      expect(before.glyphs, fixture).toBe(glyphs);
      const store = useTranscriptStore.getState;
      act(() => store().entries[A].state.order.forEach((turn) => store().toggleTurn(A, turn)));
      expect(read(), fixture).toEqual(before);
      act(() => store().expandAll(A, { cells: true }));
      expect(read(), fixture).toEqual(before);
      view.unmount();
      store().drop(A);
    }
  });

  it('asks for the session when its transcript was never mounted here, and says when there is nothing yet', async () => {
    const view = await mount();
    expect(within(section('Sources')).getByText('Open the session to list its sources')).toBeTruthy();
    view.unmount();
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.resolve([]) }));
    await mount();
    expect(within(section('Sources')).getByText('No sources yet')).toBeTruthy();
  });

  it('says Sources unavailable when the transcript’s hydration failed, never No sources yet', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(() => useTranscriptStore.getState().attach(A, { subscribe: () => () => {}, snapshot: () => Promise.reject(new Error('history unreadable')) }));
    expect(useTranscriptStore.getState().entries[A]?.phase).toBe('failed');
    await mount();
    expect(within(section('Sources')).getByText('Sources unavailable')).toBeTruthy();
    expect(within(section('Sources')).queryByText('No sources yet')).toBeNull();
    error.mockRestore();
  });

  it('collapsing a section hides its rows and writes summary.sections with that id once after the debounce', async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole('button', { name: 'Sources', expanded: true }));
    expect(screen.getByRole('button', { name: 'Sources' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(section('Sources')).queryByText('Open the session to list its sources')).toBeNull();
    expect(fake.invoked('layout.set')).toEqual([]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(fake.invoked('layout.set')).toEqual([{ key: 'summary.sections', value: { version: 1, collapsed: ['sources'] } }]);
  });

  // R1: the engine's `ui_status`, one pinned line per plugin
  it('lists each plugin’s pinned status line after Environment, by plugin name, and drops the section when the last line clears', async () => {
    const at = '2026-10-01T10:00:00.000Z';
    const status = (n: number, plugin: string, text: string) => ({ id: `${A}:L:${n}:0`, sessionId: 's', at, seq: n, agentId: null, parentToolUseId: null, kind: 'plugin.status', plugin, text }) as SessionEvent;
    let push: (batch: SessionEvent[]) => void = () => {};
    const source = { subscribe: (listener: (batch: SessionEvent[]) => void) => ((push = listener), () => {}), snapshot: () => Promise.resolve([status(1, 'zeta', 'watching'), status(2, 'mods-probe', 'MODS_PROBE_STATUS start'), status(3, 'mods-probe', 'MODS_PROBE_STATUS turn')]) };
    await act(() => useTranscriptStore.getState().attach(A, source));
    await mount();
    const card = screen.getByRole('tabpanel');
    expect(within(card).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Environment', 'Plugins', 'Push state', 'Subagents', 'Background work', 'Sources']);
    expect(within(section('Plugins')).getAllByText(/ · /).map((line) => line.textContent)).toEqual(['mods-probe · MODS_PROBE_STATUS turn', 'zeta · watching']);
    act(() => push([status(4, 'zeta', '')]));
    expect(within(section('Plugins')).getAllByText(/ · /).map((line) => line.textContent)).toEqual(['mods-probe · MODS_PROBE_STATUS turn']);
    act(() => push([status(5, 'mods-probe', '')]));
    expect(screen.queryByRole('region', { name: 'Plugins' })).toBeNull();
  });

  // E8 D-9: the section shows whenever the session loaded plugins, with their count and the two reloads
  it('shows Plugins with the loaded count and Reload plugins and Reload skills when the session loaded plugins and nothing pins a line, and not with neither', async () => {
    await mount();
    expect(screen.queryByRole('region', { name: 'Plugins' })).toBeNull(); // no plugin loaded, no line pinned
    const plugins = [{ name: 'e8-probe', path: '/tmp/home/plugins/cache/e8-scratch/e8-probe/0.1.0', source: 'e8-probe@e8-scratch', version: '0.1.0' }, { name: 'zeta', path: '/p/zeta', source: null, version: null }];
    act(() => useSessions.setState({ engine: new Map([[A, { ...engineStatus(A), plugins }]]) }));
    const card = screen.getByRole('tabpanel');
    expect(within(card).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Environment', 'Plugins', 'Push state', 'Subagents', 'Background work', 'Sources']);
    expect(within(section('Plugins')).getByText('Plugins · 2 loaded')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(within(section('Plugins')).getByRole('button', { name: 'Reload plugins' }));
    expect(fake.invoked('session.reloadPlugins')).toEqual([{ appSessionId: A }]);
    expect(within(section('Plugins')).getByRole('status').textContent).toBe('Working…');
    act(() => fake.event('session.operation', { appSessionId: A, opId: 'op-1', command: 'session.reloadPlugins', late: false, outcome: { ok: true, value: { commands: [], agents: [], plugins: [{ name: 'e8-probe' }], error_count: 0 } } }));
    expect(within(section('Plugins')).getByRole('status').textContent).toBe('Reloaded · 0 commands · 0 agents · 1 plugins · 0 errors');
    await user.click(within(section('Plugins')).getByRole('button', { name: 'Reload skills' }));
    expect(fake.invoked('session.reloadSkills')).toEqual([{ appSessionId: A }]);
    act(() => fake.event('session.operation', { appSessionId: A, opId: 'op-2', command: 'session.reloadSkills', late: false, outcome: { ok: false, error: { code: 'engine_error', message: 'reload_skills failed', engineCode: null } } }));
    expect(within(section('Plugins')).getByRole('status').textContent).toBe('reload_skills failed · engine_error');
    // an exited session keeps its count and offers no reload
    act(() => useSessions.setState({ engine: new Map([[A, { ...engineStatus(A, { process: 'exited' }), plugins }]]) }));
    expect(within(section('Plugins')).getByText('Plugins · 2 loaded')).toBeTruthy();
    expect(within(section('Plugins')).queryByRole('button', { name: 'Reload plugins' })).toBeNull();
  });

  // P2-A (2026-10-09; X17): with no live process the count is the last list the engine host kept, with when; a live one
  // that has reported its plugins reads "Loaded now"; a session switch reads the facts and starts nothing
  it('counts the observed plugins of a session with no process, labelled with when, and the live ones as loaded now', async () => {
    const plugins = [{ name: 'p1', path: '/p1', source: null, version: null }, { name: 'p2', path: '/p2', source: null, version: null }];
    const at = new Date(Date.now() - 2 * 86_400_000 - 60_000).toISOString();
    bridge({ 'session.observedFacts': { version: 1, appSessionId: A, engineSessionId: null, writtenAt: at, source: 'journal', launches: ['L1'], engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: { value: { plugins, errors: [], warnings: [] }, at, launchId: 'L1' }, contextUsage: null, complete: true } });
    await mount();
    expect(within(section('Plugins')).getByText('Plugins · 2 loaded')).toBeTruthy();
    expect(within(section('Plugins')).getByText('Loaded last time, 2 days ago')).toBeTruthy();
    expect(within(section('Plugins')).queryByRole('button', { name: 'Reload plugins' })).toBeNull();
    expect([...fake.invoked('session.start'), ...fake.invoked('session.launch')]).toEqual([]);
    act(() => useSessions.setState({ engine: new Map([[A, { ...engineStatus(A), plugins: [plugins[0]!], pluginsObservedAt: new Date().toISOString() }]]) }));
    expect(within(section('Plugins')).getByText('Plugins · 1 loaded')).toBeTruthy();
    expect(within(section('Plugins')).getByText('Loaded now')).toBeTruthy();
  });

  it('a registered tool’s summary component fills its section in place of the baseline', async () => {
    const { tool } = probeTool('subagents', { title: 'Subagents', summary: ({ appSessionId, open }) => <button type="button" onClick={() => open()}>custom {appSessionId}</button> });
    offs.push(registerPanelTool(tool));
    await mount();
    const agents = section('Subagents');
    expect(within(agents).queryByText('No subagents yet')).toBeNull();
    await userEvent.setup().click(within(agents).getByRole('button', { name: `custom ${A}` }));
    expect(panelOf(A)!.tabs.map((t) => t.toolId)).toEqual(['subagents']);
  });

  // E2: Deliverables follows Sources once a build registers the tool, filled by the tool's own summary; none before.
  it('shows Deliverables after Sources only while the Deliverables tool is registered', async () => {
    const { tool } = probeTool('deliverables', { title: 'Deliverables', summary: () => <p>3 delivered</p> });
    offs.push(registerPanelTool(tool));
    await mount();
    const card = screen.getByRole('tabpanel');
    expect(within(card).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Environment', 'Push state', 'Subagents', 'Background work', 'Sources', 'Deliverables']);
    expect(within(section('Deliverables')).getByText('3 delivered')).toBeTruthy();
  });
});
