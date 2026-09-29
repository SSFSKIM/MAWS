import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { project, record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { runSessionAction, sessionActionsFor } from '../app/session-actions';
import { registerSessionCreator, runAction } from '../keymap/actions-runtime';
import { PROJECT_ACTION_IDS, PROJECT_ACTIONS, runProjectAction } from '../sidebar/project-actions';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { resetSetupStore } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { focusedProject, registerSessionActions } from './actions';
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
    expect(sessionActionsFor(record('x', { holder: { kind: 'terminal', pid: 1 } }))).toEqual(['open']);
  });

  it('retires the project-level "Add directory…" and adds "Archived sessions…"', () => {
    expect(PROJECT_ACTION_IDS).toEqual(['archiveSessions', 'removeProject', 'revealInFinder', 'archivedSessions']);
    expect(Object.values(PROJECT_ACTIONS)).not.toContain('Add directory…');
  });

  it('⌘N creates in the focused session’s project, else the first project', async () => {
    useSessions.setState({ projects: new Map([[P2, project('p2', 1)], [P1, project('p1', 0)]]), records: new Map([[A, record(A, { projectId: P2 })]]) });
    expect(focusedProject()).toBe(P1);
    useLayout.getState().openTab({ kind: 'session', appSessionId: A });
    expect(focusedProject()).toBe(P2);
    const created: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (created.push(projectId), null)));
    runAction('session.new');
    await waitFor(() => expect(created).toEqual([P2]));
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
});
