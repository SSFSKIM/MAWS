// C10's renderer composition (C10 execution document, Repository map: App.tsx's registrations; Actions): the setup
// store, C5's tab retention (registered at once, so hydration waits for the intent snapshot), and, in launch mode
// `index`, the `newSession` slot, the session creator, the close guard, the unstarted title, the session and project
// actions, and C7's seams: the setup cards docked in the composer's place, a handed-back first message prefilled into
// the editor, and the resubmit provider (an edited message forks). The setup-intent hook itself is registered at
// App.tsx's module load, before any composer renders (C7's rule for a hook). In launch mode `scenario` C5's stub
// creator stands and nothing of C10's is registered but the retention, which keeps nothing there (a stub's new
// session has no intent). UX wave U13a: New chat's empty-chat port in mode `index`, and the discard of empty New chats
// before the layout hydrates.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';
import { tabId } from '@shared/ipc/schema/layout';
import type { Location } from '@shared/sessions/intent';
import { onLaunchMode } from '../app/launch-mode';
import { registerSlot } from '../app/slots';
import { registerResubmitProvider } from '../composer/resubmit-seam';
import { ipc } from '../ipc/client';
import { NEW_CHAT, registerCloseGuard, registerEmptyChats, registerReplaceVerdict, registerSessionCreator, registerTabRetention, registerUnstartedTitle, unstartedTitlesChanged, type UnstartedTitleAnswer } from '../keymap/actions-runtime';
import { prefillComposer } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { isOpen } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { registerSessionActions } from './actions';
import { heldToast } from './attach';
import { messagePrefill } from './first-message';
import { registerMessageReturn } from './message-return';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { resubmitProvider } from './record-ops';
import { connectSetupDock } from './SetupCard';
import { beforeCloseUnstarted, discardEmptyChat, isEmptyChat, unstartedReplaceVerdict } from './setup-actions'; // E11 F2b: unstartedReplaceVerdict; U13a: the empty chats
import { connectSetup, useSetup } from './store';
import { intentProjectName } from './useSetupIntent';
import { machineOf } from '@shared/machine/address';

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
// it answers (a project chosen, changed, renamed or dropped) is announced to C5 (New chat, 2026-10-01).
function watchUnstartedTitles(): () => void {
  const signature = (intents: ReadonlyMap<AppSessionId, { projectId: ProjectId | null }>) => [...intents].map(([id, i]) => `${id}:${i.projectId}`).join('|');
  let last = signature(useSetup.getState().intents);
  const offIntents = useSetup.subscribe((state) => {
    const next = signature(state.intents);
    if (next === last) return;
    last = next;
    unstartedTitlesChanged();
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

// U13a (its plan's Decision Log, 2026-11-13): no chat is created before the relaunch sweep below has run, so none of
// this run's is among its candidates (main announces a new intent before it answers the create). Set by
// `connectSessions` while it is wired; it settles once the sweep has run or is known not to run (launch mode
// `scenario`, a disconnect). Null: nothing to wait for.
let sweepRun: Promise<void> | null = null;

// "+" and ⌘N: an app session id with a setup intent; C5 opens its tab.
export async function createUnstartedSession(projectId: ProjectId | null, client: MawsBridge = ipc, location: Location | null = null): Promise<AppSessionId | null> {
  if (sweepRun !== null) await sweepRun;
  // P5 O6 M4: the project's machine; with none, this machine's (the setup intent's, until O7's machine picker)
  const result = await client.invoke('session.create', { projectId, location }, { machine: projectId === null ? client.localMachine : machineOf(projectId) });
  if (!result.ok) {
    console.error('[sessions] session.create failed', result.error);
    return null;
  }
  useSetup.getState().setIntent(result.value.intent);
  return result.value.appSessionId as AppSessionId;
}

// UX wave U13a (its plan's Interfaces §E; the owner, 2026-11-12: "No, only chats with content"): a New chat with nothing
// in it does not come back after a relaunch. Its intent is discarded once the snapshot holds the intents, before the
// retention lets the layout hydrate, so hydration finds no intent and drops its tab without a word; one main refuses
// stays, and its tab comes back as before. A relaunch's cleanup: the candidates are what an earlier run left (no chat
// of this run exists before the sweep has run: `sweepRun`), and none whose tab is open is discarded. Empty is New
// chat's own definition (`isEmptyChat`): at a relaunch nothing of a chat waits outside its intent, so it reads the intent
// alone, and anything that did wait (a prompt queued for it meanwhile) keeps it.

async function discardEmptyIntents(client: MawsBridge, candidates: readonly AppSessionId[]): Promise<void> {
  await Promise.all(
    candidates.map(async (appSessionId) => {
      if (!isEmptyChat(appSessionId) || isOpen(useLayout.getState().main, tabId({ kind: 'session', appSessionId }))) return;
      const result = await client.invoke('session.intent.discard', { appSessionId }).catch((error: unknown) => ({ ok: false as const, error }));
      if (result.ok) useSetup.getState().applyIntentChanged({ appSessionId, intent: null });
      else console.warn('[sessions] an empty New chat could not be discarded; its tab comes back', result.error);
    }),
  );
}

type LaunchMode = CommandOutput<'session.launchMode'>['mode'];

export function connectSessions(client: MawsBridge = ipc): () => void {
  const setup = connectSetup(client, useSetup, heldToast);
  let live = true;
  let modeOf!: (mode: LaunchMode) => void;
  const mode = new Promise<LaunchMode>((resolve) => (modeOf = resolve));
  // U13a: in launch mode `index` only (mode `scenario`'s stub sessions are not New chats); `known` waits for it too, so a
  // snapshot held only after a failed first read also lets the local machine settle without the empty chats
  // the candidates are taken as the snapshot lands (it is applied just before `known` resolves), the discards once the
  // mode is known
  const emptied = setup.known.then(() => {
    const candidates = [...useSetup.getState().intents.keys()];
    return mode.then((m) => (live && m === 'index' ? discardEmptyIntents(client, candidates) : undefined));
  });
  let disconnected!: () => void;
  const gone = new Promise<void>((resolve) => (disconnected = resolve));
  const sweep = Promise.race([mode.then((m) => (m === 'index' ? emptied : undefined)), gone]).then(
    () => undefined,
    () => undefined,
  );
  sweepRun = sweep;
  const ready = setup.ready.then((held) => (held ? emptied.then(() => held) : held));
  const offs: (() => void)[] = [registerTabRetention({ ready, known: emptied, retains: retainsTab })];
  // 2026-10-31: asked until main answers, so an upgrade's mawsd restart no longer leaves New chat disabled (launch-mode.ts)
  const stopAsking = onLaunchMode((m) => {
    modeOf(m);
    if (m !== 'index') return;
    registerSlot('newSession', NewSessionEmptyState);
    offs.push(
      registerSessionCreator((projectId, location) => createUnstartedSession(projectId, client, location ?? null)),
      registerCloseGuard('session', (ref) => (ref.kind === 'session' ? beforeCloseUnstarted(ref.appSessionId).then((r) => r === 'closed') : Promise.resolve(true))),
      registerReplaceVerdict('session', (ref) => (ref.kind === 'session' ? unstartedReplaceVerdict(ref.appSessionId) : null)), // E11 F2b
      registerUnstartedTitle(unstartedTitle),
      registerEmptyChats({ isEmpty: isEmptyChat, discard: discardEmptyChat }), // U13a: New chat's reuse and close
      watchUnstartedTitles(), // New chat: a project chosen in the row renames the tab
      registerSessionActions(),
      connectSetupDock(),
      registerMessageReturn((appSessionId, message) => prefillComposer(appSessionId, messagePrefill(message))),
      registerResubmitProvider(resubmitProvider),
      // P2-A: C12's send-to-resume registration is retired; the human send seam acquires every eligible record itself
    );
  }, client);
  return () => {
    live = false;
    disconnected();
    if (sweepRun === sweep) sweepRun = null;
    stopAsking();
    setup.disconnect();
    offs.forEach((off) => off());
  };
}
