import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { project, record } from '../../../../test/support/builders';
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

const A = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const P1 = 'p1' as ProjectId;
const P2 = 'p2' as ProjectId;

let fake: FakeClient;
let offs: (() => void)[] = [];
beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  fake = fakeClient({ 'session.projects.remove': () => undefined });
  window.maws = fake.client;
  offs = [registerSessionActions()];
});
afterEach(() => {
  closeDialog();
  offs.forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the session and project entries', () => {
  it('offers Resume to a session with no process, never to a MAWS-live or foreign-live one', () => {
    expect(sessionActionsFor(record('x', { holder: { kind: 'none' } }))).toContain('resume');
    expect(sessionActionsFor(record('x', { holder: { kind: 'self' } }))).not.toContain('resume');
    expect(sessionActionsFor(record('x', { holder: { kind: 'terminal', pid: 1 } }))).toEqual(['open', 'openInNewTab']);
  });

  it('retires the project-level "Add directory…" and adds "Archived sessions…"', () => {
    expect(PROJECT_ACTION_IDS).toEqual(['archiveSessions', 'removeProject', 'revealInFinder', 'archivedSessions', 'worktrees']); // C12: Worktrees…
    expect(Object.values(PROJECT_ACTIONS)).not.toContain('Add directory…');
  });

  // New chat (2026-10-01): ⌘N comes with the session creator, and preselects only a focused project
  it('⌘N creates in the focused session’s project, else the open project page’s, else in none', async () => {
    useSessions.setState({ projects: new Map([[P2, project('p2', 1)], [P1, project('p1', 0)]]), records: new Map([[A, record(A, { projectId: P2 })]]) });
    expect(focusedProject(), 'the project list with nothing open: no project').toBeNull();
    useLayout.getState().setSidebar({ openProject: P1 });
    expect(focusedProject()).toBe(P1);
    useLayout.getState().openTab({ kind: 'session', appSessionId: A });
    expect(focusedProject(), 'the active session’s project first').toBe(P2);
    expect(focusedProject({ first: 'page' }), 'the sidebar’s own control asks its page first').toBe(P1);
    const created: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (created.push(projectId), null)));
    runAction('session.new');
    await waitFor(() => expect(created).toEqual([P2]));
  });

  it('Resume opens the session’s tab, so a card its start docks is on screen', async () => {
    fake = fakeClient({ 'session.start': () => ({ status: 'needs_trust', appSessionId: A, trust: trustState() }) });
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[A, record(A, { holder: { kind: 'none' } })]]) });
    act(() => runSessionAction('resume', A));
    const active = () => {
      const pane = useLayout.getState().main.panes[useLayout.getState().main.focusedPane]!;
      return pane.tabs.find((t) => t.id === pane.activeTabId);
    };
    expect(active()).toMatchObject({ kind: 'session', appSessionId: A });
    await waitFor(() => expect(useSetup.getState().cards.get(A)).toMatchObject({ kind: 'trust' }));
  });

  it('the per-session entries open their sheets', () => {
    for (const [id, kind] of [['rename', 'rename'], ['forkToWorktree', 'fork'], ['archive', 'archive'], ['deleteConversation', 'delete']] as const) {
      act(() => runSessionAction(id, A));
      expect(useDialogs.getState().open, id).toMatchObject({ kind, appSessionId: A });
    }
  });

  it('Remove project asks first, naming the sessions that stay', async () => {
    useSessions.setState({ projects: new Map([[P1, project('p1', 0, { name: 'maws' })]]), records: new Map([[A, record(A, { projectId: P1 })]]) });
    act(() => runProjectAction('removeProject', P1));
    await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Remove maws?', body: expect.stringContaining('1 session stays') }));
    act(() => (useDialogs.getState().open as { answer(yes: boolean): void }).answer(true));
    await waitFor(() => expect(fake.invoked('session.projects.remove')).toEqual([{ id: P1 }]));
    act(() => runProjectAction('archivedSessions', P1));
    expect(useDialogs.getState().open).toEqual({ kind: 'archived', projectId: P1 });
  });

  it('Archive sessions asks first, and names no config home it cannot know (CLAUDE_CONFIG_DIR may move it)', async () => {
    useSessions.setState({ projects: new Map([[P1, project('p1', 0, { name: 'maws' })]]), records: new Map([[A, record(A, { projectId: P1 })]]) });
    act(() => runProjectAction('archiveSessions', P1));
    await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Archive 1 session in maws?' }));
    const { body } = useDialogs.getState().open as { body: string };
    expect(body).toBe('Running sessions stop; transcripts stay where Claude Code keeps them, and every session can be unarchived from Archived sessions.');
  });

  it('Add project picks a directory with the native chooser and adds it; a cancelled chooser adds nothing', async () => {
    let picked = [{ path: '/work/repo', name: 'repo', bytes: 0, mediaType: 'inode/directory', data: null }];
    fake = fakeClient({ 'layout.pickFiles': () => ({ files: picked }), 'session.projects.add': ({ directory }: { directory: string }) => project('p9', 3, { directory }) });
    window.maws = fake.client;
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
  const FORK = 'f1111111-1111-4111-8111-111111111111' as AppSessionId;
  const EDITED = 'c1111111-1111-4111-8111-111111111111';

  it("forks in place from before the edited message, with the edit as the fork's first message, and opens its tab", async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'starting', appSessionId: FORK }), 'session.intent.get': () => null });
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[A, record(A, { projectId: P1 })]]) });
    await expect(resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'say it again' })).resolves.toEqual({ appSessionId: FORK });
    expect(fake.invoked('session.fork')).toEqual([{ appSessionId: A, target: { kind: 'inPlace' }, message: { content: 'say it again', display: 'say it again' }, rewindTo: EDITED }]);
    const pane = useLayout.getState().main.panes[useLayout.getState().main.focusedPane]!;
    expect(pane.tabs.find((t) => t.id === pane.activeTabId)).toMatchObject({ kind: 'session', appSessionId: FORK });
  });

  it('a fork waiting on the trust card docks with the edited message, so its Cancel returns it', async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'needs_trust', appSessionId: FORK, trust: trustState() }), 'session.intent.get': () => null });
    window.maws = fake.client;
    await resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'say it again' });
    expect(useSetup.getState().cards.get(FORK)).toMatchObject({ kind: 'trust', message: { content: 'say it again', display: 'say it again' } });
  });

  it('a refused fork throws its reason, so the composer keeps the edit and says why', async () => {
    fake = fakeClient({ 'session.fork': () => ({ status: 'refused', appSessionId: A, reason: 'busy', message: 'a turn is running' }) });
    window.maws = fake.client;
    await expect(resubmitProvider.forkFrom({ appSessionId: A, messageUuid: EDITED as never, content: 'x' })).rejects.toThrow('a turn is running');
    expect(useNotices.getState().notices).toEqual([]);
  });
});
