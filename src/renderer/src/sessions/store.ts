// The renderer's side of C10's session service (C10 execution document, Interfaces "The unstarted session"; M4
// decisions): the setup intents of unstarted sessions, the latest setup phase of each start in flight, the card a start
// left waiting for the human (trust, relay), and the deletions a previous run left half-way. Fed by `connectSetup`,
// which subscribes to `session.intent.changed` and `session.setup` before it asks for the snapshots (C1's ordering
// rule); main answers `session.intent.list` only after its start-time reconciliation, so the first answer is the
// settled set C5's hydration waits for (`registerTabRetention.ready`).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { DeletionManifestView } from '@shared/ipc/schema/session';
import type { FirstMessage, SetupIntent } from '@shared/sessions/intent';
import type { SetupEvent } from '@shared/sessions/setup';
import type { TrustState } from '@shared/sessions/trust';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { toastHeld } from './holder-words';
import { returnMessage } from './message-return';

// A card a start answered with and that waits for the human, with the first message it docked with (the intent's
// retained message, or a resume's), which its continuation runs with and a refusal hands back. A failed setup's card
// is not here: it is read from the setup's `failed` event or, after a restart, the intent's `progress.lastFailure`
// (failureOf below).
export type WaitingCard = ({ kind: 'trust'; trust: TrustState } | { kind: 'relay'; health: RelayHealth }) & { message: FirstMessage | null };

export interface SetupFailure {
  message: string;
  resources: Extract<NonNullable<SetupEvent['outcome']>, { kind: 'error' }>['resources'];
}

export interface SetupState {
  loaded: boolean;
  intents: Map<AppSessionId, SetupIntent>;
  phases: Map<AppSessionId, SetupEvent>; // the latest `session.setup` of each id
  cards: Map<AppSessionId, WaitingCard>;
  invoking: Set<AppSessionId>; // a `session.start` this window sent and main has not answered yet
  deletions: Map<AppSessionId, DeletionManifestView>;
  dismissed: Set<AppSessionId>; // failures the human dismissed ("Back to editing"), until the next start
  removed: Set<AppSessionId>; // intents main dropped: an older snapshot never brings one back (ids are never reused)
  resumes: Map<AppSessionId, FirstMessage>; // the message of a record's resume this window started, until `ready` or `failed`
  applyIntents(intents: SetupIntent[]): void;
  applyIntentChanged(event: EventPayload<'session.intent.changed'>): void;
  applySetup(event: SetupEvent): void;
  setIntent(intent: SetupIntent): void; // a command's own answer (patch, release, resolveWorktree)
  dock(appSessionId: AppSessionId, card: WaitingCard): void;
  undock(appSessionId: AppSessionId): void;
  settle(appSessionId: AppSessionId): void; // the human dismissed what the last start left: its card and its failure
  setInvoking(appSessionId: AppSessionId, invoking: boolean): void;
  holdResume(appSessionId: AppSessionId, message: FirstMessage): void;
  applyDeletions(manifests: DeletionManifestView[]): void;
  setDeletion(appSessionId: AppSessionId, manifest: DeletionManifestView | null): void;
}

const without = <K, V>(map: Map<K, V>, key: K): Map<K, V> => {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
};

export function createSetupStore() {
  // The newer of two writes of one intent; `updatedAt` is main's clock, the same for every write of the file.
  const newer = (held: SetupIntent | undefined, next: SetupIntent) => held === undefined || next.updatedAt >= held.updatedAt;

  return create<SetupState>()((set, get) => ({
    loaded: false,
    intents: new Map(),
    phases: new Map(),
    cards: new Map(),
    invoking: new Set(),
    deletions: new Map(),
    dismissed: new Set(),
    removed: new Set(),
    resumes: new Map(),
    applyIntents(intents) {
      const { removed } = get();
      const next = new Map(get().intents);
      for (const intent of intents) if (!removed.has(intent.appSessionId) && newer(next.get(intent.appSessionId), intent)) next.set(intent.appSessionId, intent);
      set({ intents: next, loaded: true });
    },
    applyIntentChanged({ appSessionId, intent }) {
      if (intent === null) {
        set((s) => ({
          intents: without(s.intents, appSessionId),
          cards: without(s.cards, appSessionId),
          phases: without(s.phases, appSessionId),
          removed: new Set(s.removed).add(appSessionId),
        }));
        return;
      }
      if (get().removed.has(appSessionId) || !newer(get().intents.get(appSessionId), intent)) return;
      set((s) => ({ intents: new Map(s.intents).set(appSessionId, intent) }));
    },
    applySetup(event) {
      // C3's own relay answer at launch docks the relay card, with the message the intent (or the resume) still retains
      const id = event.appSessionId;
      const message = get().intents.get(id)?.message ?? get().resumes.get(id) ?? null;
      const cards =
        event.phase === 'failed' && event.outcome?.kind === 'relay_unreachable' ? new Map(get().cards).set(id, { kind: 'relay', health: event.outcome.health, message }) : get().cards;
      // a resume's message is the engine's at `ready`, the card's or the editor's at `failed` (connectSetup hands it back)
      const resumes = event.phase === 'ready' || event.phase === 'failed' ? without(get().resumes, id) : get().resumes;
      set((s) => ({ phases: new Map(s.phases).set(id, event), cards, resumes }));
    },
    setIntent(intent) {
      get().applyIntentChanged({ appSessionId: intent.appSessionId, intent });
    },
    dock(appSessionId, card) {
      set((s) => ({ cards: new Map(s.cards).set(appSessionId, card) }));
    },
    undock(appSessionId) {
      set((s) => ({ cards: without(s.cards, appSessionId) }));
    },
    settle(appSessionId) {
      set((s) => ({ cards: without(s.cards, appSessionId), phases: without(s.phases, appSessionId), dismissed: new Set(s.dismissed).add(appSessionId) }));
    },
    setInvoking(appSessionId, invoking) {
      const next = new Set(get().invoking);
      const dismissed = new Set(get().dismissed);
      if (invoking) {
        next.add(appSessionId);
        dismissed.delete(appSessionId); // a new start's failure is shown again
      } else next.delete(appSessionId);
      set({ invoking: next, dismissed });
    },
    holdResume(appSessionId, message) {
      set((s) => ({ resumes: new Map(s.resumes).set(appSessionId, message) }));
    },
    applyDeletions(manifests) {
      set({ deletions: new Map(manifests.map((m) => [m.appSessionId as AppSessionId, m])) });
    },
    setDeletion(appSessionId, manifest) {
      set((s) => ({ deletions: manifest === null ? without(s.deletions, appSessionId) : new Map(s.deletions).set(appSessionId, manifest) }));
    },
  }));
}

export const useSetup = createSetupStore();

const RUNNING: ReadonlySet<SetupEvent['phase']> = new Set(['worktree', 'trusting', 'launching']);

// Whether a start of the id is in flight: this window's command not answered yet, or main reporting a phase before
// `ready` or `failed`.
export function isStarting(s: Pick<SetupState, 'invoking' | 'phases'>, appSessionId: AppSessionId): boolean {
  const phase = s.phases.get(appSessionId)?.phase;
  return s.invoking.has(appSessionId) || (phase !== undefined && RUNNING.has(phase));
}

// The failure the tab's card shows, while the setup's intent is retained: the latest `failed` event's error, else
// (after a restart, or before any event) the intent's last failure. None while a start runs or a card waits, or once
// the human went back to editing. A failure without an intent is a record's (a resume, or a launch that kept its
// transcript): an exited session with the engine's own notice, not a card (Rollback (1)).
export function failureOf(s: Pick<SetupState, 'invoking' | 'phases' | 'intents' | 'cards' | 'dismissed'>, appSessionId: AppSessionId): SetupFailure | null {
  if (!s.intents.has(appSessionId) || isStarting(s, appSessionId) || s.cards.has(appSessionId) || s.dismissed.has(appSessionId)) return null;
  // the stored objects themselves, so a selector over this answer is stable between renders
  const event = s.phases.get(appSessionId);
  if (event?.phase === 'failed' && event.outcome?.kind === 'error') return event.outcome;
  return s.intents.get(appSessionId)?.progress.lastFailure ?? null;
}

// What a resume held elsewhere tells the human (the engine's own refusal: a job took the session after MAWS's read).
// The composition hands in the toast with the job's Attach (`sessions/attach.ts`), which keeps the Terminal tool out of
// this store's imports; without it the holder is still named.
type SessionHolder = SessionRecord['holder'];
export type HeldNotice = (appSessionId: AppSessionId, holder: SessionHolder, attach: { jobId: string; command: string } | null) => void;
const nameHolder: HeldNotice = (_appSessionId, holder) => toastHeld(holder);

// Subscribes, then loads the intent snapshot and the interrupted deletions. `ready` resolves once the intents are known
// (answered or failed: a page with no answerer starts empty rather than holding hydration forever).
export function connectSetup(client: MawsBridge = ipc, store: typeof useSetup = useSetup, onHeld: HeldNotice = nameHolder): { ready: Promise<void>; disconnect(): void } {
  let live = true;
  const offs = [
    client.on('session.intent.changed', (e) => live && store.getState().applyIntentChanged(e)),
    client.on('session.setup', (e) => {
      if (!live) return;
      const resumed = store.getState().resumes.get(e.appSessionId) ?? null;
      store.getState().applySetup(e);
      // a resume that failed after it started has no card: its message returns to the editor (main handed it back) and
      // its reason is a toast (the record stays, exited); the engine's own refusal (a job took the session after MAWS's
      // read) names the holder and offers its Attach. C3's relay answer docked the relay card with the message instead.
      if (e.phase === 'failed' && !store.getState().intents.has(e.appSessionId)) {
        if (resumed !== null && e.outcome?.kind !== 'relay_unreachable') returnMessage(e.appSessionId, resumed);
        if (e.outcome?.kind === 'error') toast({ level: 'danger', text: e.outcome.message, actions: [], dismissible: true });
        else if (e.outcome?.kind === 'held') onHeld(e.appSessionId, e.outcome.holder, e.outcome.attach);
      }
    }),
  ];
  const unavailable = (error: unknown) => {
    console.warn('[sessions] session.intent.list unavailable; no unstarted sessions', error);
    if (live) store.getState().applyIntents([]);
  };
  const ready = client.invoke('session.intent.list', undefined).then((result) => {
    if (!live) return;
    if (result.ok) store.getState().applyIntents(result.value.intents);
    else unavailable(result.error);
  }, unavailable);
  void client.invoke('session.deletions.list', undefined).then(
    (result) => {
      if (!live) return;
      if (result.ok) store.getState().applyDeletions(result.value.manifests);
      else console.warn('[sessions] session.deletions.list unavailable', result.error);
    },
    (error: unknown) => console.warn('[sessions] session.deletions.list unavailable', error),
  );
  return {
    ready,
    disconnect() {
      live = false;
      offs.forEach((off) => off());
    },
  };
}
