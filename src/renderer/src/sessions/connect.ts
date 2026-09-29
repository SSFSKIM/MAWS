// C10's renderer composition (C10 execution document, Repository map: App.tsx's registrations; Actions): the setup
// store, C5's tab retention (registered at once, so hydration waits for the intent snapshot), and, in launch mode
// `index`, the `newSession` slot, the session creator, the close guard, the unstarted title and the session and
// project actions. In launch mode `scenario` C5's stub creator stands and nothing of C10's is registered but the
// retention, which keeps nothing there (a stub's new session has no intent).
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { registerSlot } from '../app/slots';
import { ipc } from '../ipc/client';
import { registerCloseGuard, registerSessionCreator, registerTabRetention, registerUnstartedTitle } from '../keymap/actions-runtime';
import { useSessions } from '../stores/sessions';
import { registerSessionActions } from './actions';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { beforeCloseUnstarted } from './setup-actions';
import { connectSetup, useSetup } from './store';
import { baseDirectoryOf } from './useSetupIntent';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// The project an unstarted session was created in, by name: its project's, else its directory's.
export function projectNameOf(appSessionId: AppSessionId): string | null {
  const intent = useSetup.getState().intents.get(appSessionId);
  if (intent === undefined) return null;
  const project = intent.projectId ? useSessions.getState().projects.get(intent.projectId) : undefined;
  return project?.name ?? basename(baseDirectoryOf(intent.location));
}

// What the tab strip calls an unstarted session's tab (called during render: reads state, calls no hook).
export function unstartedTitle(appSessionId: AppSessionId): { title: string; project: string | null } | null {
  if (!useSetup.getState().intents.has(appSessionId)) return null;
  return { title: 'New session', project: projectNameOf(appSessionId) };
}

// C5's retention: a tab is kept while its id has a persisted intent, a failed one included.
export const retainsTab = (appSessionId: string): boolean => useSetup.getState().intents.has(appSessionId as AppSessionId);

// "+" and ⌘N: an app session id with a setup intent; C5 opens its tab.
export async function createUnstartedSession(projectId: ProjectId | null, client: MawsBridge = ipc): Promise<AppSessionId | null> {
  const result = await client.invoke('session.create', { projectId, location: null });
  if (!result.ok) {
    console.error('[sessions] session.create failed', result.error);
    return null;
  }
  useSetup.getState().setIntent(result.value.intent);
  return result.value.appSessionId as AppSessionId;
}

export function connectSessions(client: MawsBridge = ipc): () => void {
  const setup = connectSetup(client);
  const offs: (() => void)[] = [registerTabRetention({ ready: setup.ready, retains: retainsTab })];
  let live = true;
  void client.invoke('session.launchMode', undefined).then((result) => {
    if (!live || !result.ok || result.value.mode !== 'index') return;
    registerSlot('newSession', NewSessionEmptyState);
    offs.push(
      registerSessionCreator((projectId) => createUnstartedSession(projectId, client)),
      registerCloseGuard('session', (ref) => (ref.kind === 'session' ? beforeCloseUnstarted(ref.appSessionId).then((r) => r === 'closed') : Promise.resolve(true))),
      registerUnstartedTitle(unstartedTitle),
      registerSessionActions(),
    );
  });
  return () => {
    live = false;
    setup.disconnect();
    offs.forEach((off) => off());
  };
}
