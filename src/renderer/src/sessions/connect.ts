// C10's renderer composition (C10 execution document, Repository map: App.tsx's registrations; Actions): the setup
// store, C5's tab retention (registered at once, so hydration waits for the intent snapshot), and, in launch mode
// `index`, the `newSession` slot, the session creator, the close guard, the unstarted title, the session and project
// actions, and C7's seams: the setup cards docked in the composer's place, a handed-back first message prefilled into
// the editor, and the resubmit provider (an edited message forks). The setup-intent hook itself is registered at
// App.tsx's module load, before any composer renders (C7's rule for a hook). In launch mode `scenario` C5's stub
// creator stands and nothing of C10's is registered but the retention, which keeps nothing there (a stub's new
// session has no intent).
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Location } from '@shared/sessions/intent';
import { registerSlot } from '../app/slots';
import { registerResubmitProvider } from '../composer/resubmit-seam';
import { registerReleasedResume } from '../composer/resume-seam'; // C12
import { ipc } from '../ipc/client';
import { NEW_CHAT, registerCloseGuard, registerSessionCreator, registerTabRetention, registerUnstartedTitle, unstartedTitlesChanged, type UnstartedTitleAnswer } from '../keymap/actions-runtime';
import { prefillComposer } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { registerSessionActions } from './actions';
import { heldToast } from './attach';
import { messagePrefill } from './first-message';
import { registerMessageReturn } from './message-return';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { resubmitProvider } from './record-ops';
import { connectSetupDock } from './SetupCard';
import { beforeCloseUnstarted, resumeSession } from './setup-actions'; // C12: resumeSession
import { connectSetup, useSetup } from './store';
import { intentProjectName } from './useSetupIntent';

// The project an unstarted session will run in, by name (`intentProjectName`).
export function projectNameOf(appSessionId: AppSessionId): string | null {
  const intent = useSetup.getState().intents.get(appSessionId);
  if (intent === undefined) return null;
  return intentProjectName(intent, intent.projectId ? useSessions.getState().projects.get(intent.projectId) : undefined);
}

// What the tab strip calls an unstarted session's tab (called during render: reads state, calls no hook): "New chat",
// with the project beside it once one is chosen (New chat, 2026-10-01).
export function unstartedTitle(appSessionId: AppSessionId): UnstartedTitleAnswer | null {
  const intent = useSetup.getState().intents.get(appSessionId);
  if (intent === undefined) return null;
  return { title: NEW_CHAT, project: projectNameOf(appSessionId), projectId: intent.projectId };
}

// The strip and the toolbar call `unstartedTitle` during render without subscribing to the intents, so a change of what
// it answers (a project chosen, changed, renamed or dropped) is announced to C5 (New chat, 2026-10-01). W12: a project
// chosen or changed also moves the unstarted tab to that project's tab set.
function watchUnstartedTitles(): () => void {
  const signature = (intents: ReadonlyMap<AppSessionId, { projectId: ProjectId | null }>) => [...intents].map(([id, i]) => `${id}:${i.projectId}`).join('|');
  let last = signature(useSetup.getState().intents);
  const offIntents = useSetup.subscribe((state) => {
    const next = signature(state.intents);
    if (next === last) return;
    last = next;
    unstartedTitlesChanged();
    useLayout.getState().refileTabs();
  });
  const offProjects = useSessions.subscribe((state, previous) => {
    if (state.projects !== previous.projects) unstartedTitlesChanged();
  });
  return () => {
    offIntents();
    offProjects();
  };
}

// C5's retention: a tab is kept while its id has a persisted intent, a failed one included.
export const retainsTab = (appSessionId: string): boolean => useSetup.getState().intents.has(appSessionId as AppSessionId);

// "+" and ⌘N: an app session id with a setup intent; C5 opens its tab.
export async function createUnstartedSession(projectId: ProjectId | null, client: MawsBridge = ipc, location: Location | null = null): Promise<AppSessionId | null> {
  const result = await client.invoke('session.create', { projectId, location });
  if (!result.ok) {
    console.error('[sessions] session.create failed', result.error);
    return null;
  }
  useSetup.getState().setIntent(result.value.intent);
  return result.value.appSessionId as AppSessionId;
}

export function connectSessions(client: MawsBridge = ipc): () => void {
  const setup = connectSetup(client, useSetup, heldToast);
  const offs: (() => void)[] = [registerTabRetention({ ready: setup.ready, retains: retainsTab })];
  let live = true;
  void client.invoke('session.launchMode', undefined).then((result) => {
    if (!live || !result.ok || result.value.mode !== 'index') return;
    registerSlot('newSession', NewSessionEmptyState);
    offs.push(
      registerSessionCreator((projectId, location) => createUnstartedSession(projectId, client, location ?? null)),
      registerCloseGuard('session', (ref) => (ref.kind === 'session' ? beforeCloseUnstarted(ref.appSessionId).then((r) => r === 'closed') : Promise.resolve(true))),
      registerUnstartedTitle(unstartedTitle),
      watchUnstartedTitles(), // New chat: a project chosen in the row renames the tab
      registerSessionActions(),
      connectSetupDock(),
      registerMessageReturn((appSessionId, message) => prefillComposer(appSessionId, messagePrefill(message))),
      registerResubmitProvider(resubmitProvider),
      registerReleasedResume(resumeSession), // C12: Send on a session released under the memory budget resumes it
    );
  });
  return () => {
    live = false;
    setup.disconnect();
    offs.forEach((off) => off());
  };
}
