import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { OrgKey } from '@shared/machine/org-key';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { project, record, remoteRow } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { runSessionAction, sessionActionsFor } from '../app/session-actions';
import { focusedProject, registerSessionCreator, runAction } from '../keymap/actions-runtime';
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runAddProject, runProjectAction } from '../sidebar/project-actions';
import { useNotices } from '../stores/notices';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { resetSetupStore, trustState } from '../test-support/setup-intents';
import { useSetup } from './store';
import { resetShellStores } from '../test-support/shell-stores';
import { registerSessionActions } from './actions';
import { resubmitProvider } from './record-ops';
import { closeDialog, useDialogs } from './dialogs';
import { currentSet } from '../stores/layout-model';

// P5 O6 M2: the page holds addresses; the fake `window.maws` (main) is asked and answers with the bare ids
const BARE_A = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const A = at(BARE_A);
const P1 = at('p1' as ProjectId);
const P2 = at('p2' as ProjectId);
const install = (f: FakeClient) => void (window.maws = f.client as unknown as PreloadBridge);

let fake: FakeClient;
let offs: (() => void)[] = [];
beforeEach(() => {
  resetShellStores();
  useNotices.setState({ notices: [] });
  resetSetupStore();
  fake = fakeClient({ 'session.projects.remove': () => undefined });
  install(fake);
  offs = [registerSessionActions()];
});
afterEach(() => {
  closeDialog();
  offs.forEach((off) => off());
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('the session and project entries', () => {
  it('offers Resume to a session with no process, never to a MAWS-live or foreign-live one', () => {
    expect(sessionActionsFor(record('x', { holder: { kind: 'none' } }))).toContain('resume');
    expect(sessionActionsFor(record('x', { holder: { kind: 'self' } }))).not.toContain('resume');
    expect(sessionActionsFor(record('x', { holder: { kind: 'terminal', pid: 1 } }))).toEqual(['open', 'openInNewTab']);
  });

  it('offers Take over in MAWS and Fork for a terminal session its bridge drives, which has no holder notice (P5 O9 M5, Q4)', () => {
    expect(sessionActionsFor(record('x', { holder: { kind: 'terminal', pid: 1 } }), { bridged: true })).toEqual(['open', 'openInNewTab', 'takeOver', 'fork']);
    expect(sessionActionsFor(record('x', { holder: { kind: 'background_job', pid: 1, jobId: 'j1' } }), { bridged: true })).toEqual(['open', 'openInNewTab', 'attach', 'takeOver', 'fork']);
    expect(sessionActionsFor(record('x', { holder: { kind: 'background_job', pid: 1, jobId: null } }), { bridged: true })).toEqual(['open', 'openInNewTab', 'fork']);
    expect(sessionActionsFor(record('x', { holder: { kind: 'self' } }), { bridged: true })).not.toContain('takeOver');
    expect(sessionActionsFor(record('x', { holder: { kind: 'none' } }))).not.toContain('takeOver');
  });

  it('archives old sessions only in the chosen project through the guarded main command', async () => {
    act(() => runProjectAction('archiveOlder', P1));
    await waitFor(() => expect(fake.pending('session.archiveOlder')).toBe(1));
    expect(fake.invoked('session.archiveOlder')).toEqual([{ projectId: 'p1', days: 7 }]);
    await act(() => fake.reply('session.archiveOlder', { archived: 3, skipped: 2 }));
    expect(useNotices.getState().notices.some((n) => n.text === '3 sessions archived; 2 kept')).toBe(true);
  });

  it('retires the project-level "Add directory…" and adds "Archived sessions…"', () => {
    expect(PROJECT_ACTION_IDS).toEqual(['archiveSessions', 'archiveOlder', 'removeProject', 'revealInFinder', 'archivedSessions', 'worktrees']); // C12: Worktrees…
    expect(Object.values(PROJECT_ACTIONS)).not.toContain('Add directory…');
  });

  // New chat (2026-10-01): ⌘N comes with the session creator, and preselects only the current project; UX wave U13a: the
  // row of the session in front, which a page in front keeps and a sidebar row does not change; W11: never one gone or
  // hidden from the sidebar, nor a machine's own row
  it('⌘N creates in the current project, else in none', async () => {
    const P3 = at('p3' as ProjectId);
    const [B, HIDDEN, GONE, LOOSE] = ['b', 'hidden', 'gone', 'loose'].map((id) => at(`${id}-session` as AppSessionId));
    useMachines.setState({ loaded: new Set([TEST_MACHINE]) });
    offs.push(() => useMachines.setState({ loaded: new Set() }));
    useSessions.setState({
      projects: new Map([[P2, project(P2, 1)], [P1, project(P1, 0)], [P3, project(P3, 2, { hidden: true })]]),
      records: new Map([
        [A, record(A, { projectId: P2 })],
        [B, record(B, { projectId: P1 })],
        [HIDDEN, record(HIDDEN, { projectId: P3 })],
        [GONE, record(GONE, { projectId: at('proj-gone' as ProjectId) })],
        [LOOSE, record(LOOSE)],
      ]),
    });
    const front = (id: AppSessionId) => useLayout.getState().openTab({ kind: 'session', appSessionId: id });
    expect(focusedProject(), 'nothing open: no project').toBeNull();
    useLayout.getState().setSidebar({ expandedProjects: [P1] });
    expect(focusedProject(), 'an expanded project is not the current one').toBeNull();
    front(B);
    expect(focusedProject(), 'the project of the session in front').toBe(P1);
    for (const id of [HIDDEN, GONE]) {
      front(id);
      expect(focusedProject(), `a hidden or removed project is no project (${id})`).toBeNull();
    }
    front(LOOSE);
    expect(focusedProject(), 'a machine’s own row: no project').toBeNull();
    front(A);
    expect(focusedProject(), 'opening a session makes its project current').toBe(P2);
    useLayout.getState().openTab({ kind: 'diagnostics' });
    expect(focusedProject(), 'a page in front keeps the current project').toBe(P2);
    const created: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (created.push(projectId), null)));
    runAction('session.new');
    await waitFor(() => expect(created).toEqual([P2]));
  });

  it('Resume opens the session’s tab, so a card its acquisition docks is on screen', async () => {
    fake = fakeClient({ 'session.acquire': () => ({ status: 'needs_trust', appSessionId: BARE_A, trust: trustState() }) }); // P2-A: Resume acquires
    install(fake);
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'none' } })]]) });
    act(() => runSessionAction('resume', A));
    const active = () => {
      const pane = currentSet(useLayout.getState().main).panes[currentSet(useLayout.getState().main).focusedPane]!;
      return pane.tabs.find((t) => t.id === pane.activeTabId);
    };
    expect(active()).toMatchObject({ kind: 'session', appSessionId: A });
    await waitFor(() => expect(useSetup.getState().cards.get(A)).toMatchObject({ kind: 'trust' }));
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: BARE_A, reason: 'resume' }]);
  });

  it('the per-session entries open their sheets', () => {
    for (const [id, kind] of [['rename', 'rename'], ['forkToWorktree', 'fork'], ['archive', 'archive'], ['deleteConversation', 'delete']] as const) {
      act(() => runSessionAction(id, A));
      expect(useDialogs.getState().open, id).toMatchObject({ kind, appSessionId: A });
    }
  });

  it('Remove from sidebar asks first, naming the sessions that stay and where the project comes back from', async () => {
    useSessions.setState({ projects: new Map([[P1, project(P1, 0, { name: 'maws' })]]), records: new Map([[A, record(A, { projectId: P1 })]]) });
    act(() => runProjectAction('removeProject', P1));
    await waitFor(() =>
      expect(useDialogs.getState().open).toMatchObject({
        kind: 'confirm',
        title: 'Remove maws from the sidebar?',
        body: 'Its 1 session stays on disk and in the terminal. Show the project again from Hidden projects… at the end of the sidebar\'s list.',
        confirmLabel: 'Remove from sidebar',
      }),
    );
    act(() => (useDialogs.getState().open as { answer(yes: boolean): void }).answer(true));
    await waitFor(() => expect(fake.invoked('session.projects.remove')).toEqual([{ id: 'p1' }]));
    act(() => runProjectAction('archivedSessions', P1));
    expect(useDialogs.getState().open).toEqual({ kind: 'archived', projectId: P1 });
  });

  it('Archive sessions asks first, and names no config home it cannot know (CLAUDE_CONFIG_DIR may move it)', async () => {
    useSessions.setState({ projects: new Map([[P1, project(P1, 0, { name: 'maws' })]]), records: new Map([[A, record(A, { projectId: P1 })]]) });
    act(() => runProjectAction('archiveSessions', P1));
    await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Archive 1 session in maws?' }));
    const { body } = useDialogs.getState().open as { body: string };
    expect(body).toBe('Running sessions stop; transcripts stay where Claude Code keeps them, and every session can be unarchived from Archived sessions.');
  });

  // P5 O6 M5 ("Hiding"): an org project's row spans machines; its removal hides each checkout on a machine that is up
  describe('on an org project checked out on two machines', () => {
    const org = { key: 'repo:maws' as OrgKey, name: 'maws', source: 'remote' as const, smnsId: null };
    const THERE = addressOf(OTHER_MACHINE, 'p1' as ProjectId);
    const B = addressOf(OTHER_MACHINE, BARE_A);
    const roster = (state: 'up' | 'down') =>
      useMachines.getState().applyRoster([
        { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-27T10:00:00Z', generation: 0 },
        { ref: OTHER_MACHINE, name: 'Studio', local: false, state, since: '2026-10-27T10:00:00Z', generation: 0 },
      ]);
    beforeEach(() => {
      useSessions.setState({
        projects: new Map([[P1, project(P1, 0, { name: 'maws', org })], [THERE, project(THERE, 0, { name: 'maws', org })]]),
        records: new Map([[A, record(A, { projectId: P1 })], [B, record(B, { projectId: THERE })]]),
      });
    });
    afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map() }));
    const removeAndConfirm = async (body: string) => {
      act(() => runProjectAction('removeProject', P1));
      await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', body }));
      act(() => (useDialogs.getState().open as { answer(yes: boolean): void }).answer(true));
    };

    it('Remove from sidebar hides the checkout on every machine that is up, counting the row’s sessions from both', async () => {
      roster('up');
      await removeAndConfirm('Its 2 sessions stay on disk and in the terminal. Show the project again from Hidden projects… at the end of the sidebar\'s list.');
      await waitFor(() => expect(fake.invoked('session.projects.remove')).toEqual([{ id: 'p1' }, { id: 'p1' }]));
      expect(fake.machines('session.projects.remove')).toEqual([TEST_MACHINE, OTHER_MACHINE]);
    });

    it('leaves an offline machine’s checkout as it is', async () => {
      roster('down');
      await removeAndConfirm('Its 2 sessions stay on disk and in the terminal. Show the project again from Hidden projects… at the end of the sidebar\'s list.');
      await waitFor(() => expect(fake.invoked('session.projects.remove')).toEqual([{ id: 'p1' }]));
      expect(fake.machines('session.projects.remove')).toEqual([TEST_MACHINE]);
    });

    // The UX wave, U9 (R2, S-02): the project-wide acts stay this Mac's. "Archive sessions older than a week" asks this
    // Mac's project only, and "Archive sessions" walks this Mac's records, its sheet saying the rest stay
    it('archives the old sessions of this Mac’s project only, sending nothing to the other machine', async () => {
      roster('up');
      act(() => runProjectAction('archiveOlder', P1));
      await waitFor(() => expect(fake.pending('session.archiveOlder')).toBe(1));
      await act(() => fake.reply('session.archiveOlder', { archived: 1, skipped: 0 }));
      expect(fake.machines('session.archiveOlder')).toEqual([TEST_MACHINE]);
      expect(useNotices.getState().notices.some((n) => n.text === '1 sessions archived; 0 kept')).toBe(true);
    });

    it('Archive sessions walks this Mac’s records only, says the other machine’s are not archived from here, and sends nothing there', async () => {
      roster('up');
      fake = fakeClient({ 'session.archive': () => ({ archived: true }) });
      install(fake);
      act(() => runProjectAction('archiveSessions', P1));
      await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Archive 1 session in maws?' }));
      expect((useDialogs.getState().open as { body: string }).body).toBe(
        'Running sessions stop; transcripts stay where Claude Code keeps them, and every session can be unarchived from Archived sessions. Sessions on other machines are not archived from here.',
      );
      act(() => (useDialogs.getState().open as { answer(yes: boolean): void }).answer(true));
      await waitFor(() => expect(fake.invoked('session.archive')).toEqual([{ appSessionId: BARE_A }]));
      expect(fake.machines('session.archive')).toEqual([TEST_MACHINE]);
    });

    it('says it of a project whose other machine holds only listings here', async () => {
      roster('up');
      useSessions.setState({ records: new Map([[A, record(A, { projectId: P1 })]]), listed: new Map([[B, { ...remoteRow(OTHER_MACHINE, BARE_A, { orgKey: org.key }), appId: B }]]) });
      try {
        act(() => runProjectAction('archiveSessions', P1));
        await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Archive 1 session in maws?' }));
        expect((useDialogs.getState().open as { body: string }).body).toMatch(/ Sessions on other machines are not archived from here\.$/);
      } finally {
        useSessions.setState({ listed: new Map() });
      }
    });
  });

  it('Add project picks a directory with the native chooser and adds it; a cancelled chooser adds nothing', async () => {
    let picked = [{ path: '/work/repo', name: 'repo', bytes: 0, mediaType: 'inode/directory', data: null }];
    fake = fakeClient({ 'layout.pickFiles': () => ({ files: picked }), 'session.projects.add': ({ directory }: { directory: string }) => project('p9', 3, { directory }) });
    install(fake);
    act(() => runAddProject());
    await waitFor(() => expect(fake.invoked('session.projects.add')).toEqual([{ directory: '/work/repo' }]));
    expect(fake.invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: null, multiple: false }]);
    picked = [];
    act(() => runAddProject());
    await waitFor(() => expect(fake.invoked('layout.pickFiles')).toHaveLength(2));
    expect(fake.invoked('session.projects.add')).toHaveLength(1);
  });
});

describe("C7's resubmit seam", () => {
  const BARE_FORK = 'f1111111-1111-4111-8111-111111111111' as AppSessionId;
  const FORK = at(BARE_FORK);
  const EDITED = 'c1111111-1111-4111-8111-111111111111';

  it("forks in place from before the edited message, with the edit as the fork's first message, and opens its tab", async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'starting', appSessionId: BARE_FORK }), 'session.intent.get': () => null });
    install(fake);
    useSessions.setState({ records: new Map([[A, record(A, { projectId: P1 })]]) });
    await expect(resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'say it again' })).resolves.toEqual({ appSessionId: FORK });
    expect(fake.invoked('session.fork')).toEqual([{ appSessionId: BARE_A, target: { kind: 'inPlace' }, message: { content: 'say it again', display: 'say it again' }, rewindTo: EDITED }]);
    const pane = currentSet(useLayout.getState().main).panes[currentSet(useLayout.getState().main).focusedPane]!;
    expect(pane.tabs.find((t) => t.id === pane.activeTabId)).toMatchObject({ kind: 'session', appSessionId: FORK });
  });

  it('a fork waiting on the trust card docks with the edited message, so its Cancel returns it', async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'needs_trust', appSessionId: BARE_FORK, trust: trustState() }), 'session.intent.get': () => null });
    install(fake);
    await resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'say it again' });
    expect(useSetup.getState().cards.get(FORK)).toMatchObject({ kind: 'trust', message: { content: 'say it again', display: 'say it again' } });
  });

  it('a refused fork throws its reason, so the composer keeps the edit and says why', async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'refused', appSessionId: BARE_A, reason: 'busy', message: 'a turn is running' }) });
    install(fake);
    await expect(resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'x' })).rejects.toThrow('a turn is running');
    expect(useNotices.getState().notices).toEqual([]);
  });
});

// The UX wave, U9 (O-48, A8; Interfaces §5): a fork of a session on another machine is made there and adopts nothing
// (its intent and its setup don't cross the link); its tab opens on the fork's address once the machine answers.
describe('a fork of a session on another machine', () => {
  const R = addressOf(OTHER_MACHINE, BARE_A);
  const BARE_FORK = 'f2222222-2222-4222-8222-222222222222' as AppSessionId;
  const FORK = addressOf(OTHER_MACHINE, BARE_FORK);
  const EDITED = 'c2222222-2222-4222-8222-222222222222';
  const texts = () => useNotices.getState().notices.map((n) => n.text);
  const activeTab = () => {
    const set = currentSet(useLayout.getState().main);
    const pane = set.panes[set.focusedPane]!;
    return pane.tabs.find((t) => t.id === pane.activeTabId);
  };
  beforeEach(() => {
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-13T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-13T10:00:00Z', generation: 1, capabilities: ['rl2.session-acts'], owner: true },
    ]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, BARE_A), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
  });
  afterEach(() => {
    useMachines.setState({ roster: 'unread', machines: new Map() });
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  });

  it('makes the act on that machine, says so while it is out, and opens the fork’s tab on its address with nothing adopted', async () => {
    act(() => runSessionAction('fork', R));
    await waitFor(() => expect(fake.pending('session.fork')).toBe(1));
    expect(fake.invoked('session.fork')).toEqual([{ appSessionId: BARE_A, target: { kind: 'inPlace' }, message: null, rewindTo: null }]);
    expect(fake.machines('session.fork')).toEqual([OTHER_MACHINE]);
    expect(texts()).toContain('Forking on Studio…');
    await act(() => fake.reply('session.fork', { status: 'starting', appSessionId: BARE_FORK }));
    expect(activeTab()).toMatchObject({ kind: 'session', appSessionId: FORK });
    expect(fake.invoked('session.intent.get')).toEqual([]);
    expect(useSessions.getState().unstarted.has(FORK)).toBe(false);
    expect(texts()).not.toContain('Forking on Studio…');
  });

  it('words any other outcome as the act’s failure, and the edit’s fork throws it with the edit sent inside the act', async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'refused', appSessionId: BARE_A, reason: 'busy', message: 'the session has a turn running; fork it once the turn ends' }) });
    install(fake);
    await expect(resubmitProvider.forkFrom({ appSessionId: R, messageUuid: EDITED as never, content: 'say it there' })).rejects.toThrow('Not forked: the session has a turn running; fork it once the turn ends');
    expect(fake.invoked('session.fork')).toEqual([{ appSessionId: BARE_A, target: { kind: 'inPlace' }, message: { content: 'say it there', display: 'say it there' }, rewindTo: EDITED }]);
    expect(texts()).not.toContain('Forking on Studio…');
  });

  it('shows a refusal main worded as it is', async () => {
    act(() => runSessionAction('fork', R));
    await waitFor(() => expect(fake.pending('session.fork')).toBe(1));
    await act(() => fake.fail('session.fork', 'Not forked: Studio is offline', 'host_unavailable', { refusal: 'offline' }));
    expect(texts()).toEqual(['Not forked: Studio is offline']);
  });
});
