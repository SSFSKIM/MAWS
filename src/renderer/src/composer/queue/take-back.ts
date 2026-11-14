// Taking a waiting message back into the box (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md,
// decision 13; Interfaces D): ↑ and Edit, in five steps, so that at each a complete copy of the message is somewhere that
// survives the step failing. (1) Stage: the message's document gains `attrs.takeBack`, and the session's box is held
// read-only. (2) Save the stage, whole and acknowledged, under the claim (`DRAFT_CLAIM`: only where no draft with a
// document is kept). (3) Withdraw it (`session.steer.cancel` at the next step, `session.queue.remove` otherwise); what
// became of it is read from the record (`session.promptHistory`), never from a second withdrawal's answer. (4) Load it
// into the box without the mark and settle the stage (`settles(<revision>)`), or, where the agent has it, clear it so.
// (5) Whoever meets a stored stage (a mount that restores one, a claim the fence refused) carries it forward through 3
// and 4; a found stage is never rolled back. Nothing owns the operation: every step is idempotent.
//
// The draft store is the machine's services' (owner `machine`); for a session on another machine the stage goes to that
// machine, in the order of the session's other saves (../../lane-b/remote-drafts.ts). A claim answered stale comes only
// from a store of an earlier build, which knows neither the claim nor the fence: nothing is withdrawn, and Edit and ↑
// are refused for that machine's sessions until its link opens again (`storeRefusesStage`).
import { create } from 'zustand';
import type { SendContent } from '@shared/engine/session-state-store';
import type { PromptHistoryEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { DaemonStatus } from '@shared/ipc/schema/daemon';
import { DRAFT_CLAIM, DRAFT_KEPT_WORDS, settles, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft, type TakeBackMark } from '@shared/ipc/schema/session';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../../ipc/client';
import { readerRowsOf } from '../../lane-b/reader-rows';
import { readRemoteDraft, saveRemoteDraftOnce } from '../../lane-b/remote-drafts';
import { isRemoteLaneB } from '../../lane-b/remote-session';
import type { QueueControls } from '../../session/controls/types';
import { showStackNotice } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { useMachines } from '../../stores/machines';
import { machineName } from '../../stores/org-projects';
import { useQueueStore, type SessionQueue } from '../../stores/queue';
import { markPersisted } from '../editor/attachments';
import { attachmentsOf, type ComposerDoc } from '../editor/doc';
import { draftOf } from '../editor/drafts';
import { STACK_WORDS } from './stack';
import { entryDoc } from './entry-text';

export const TAKE_BACK_WORDS = {
  taking: 'Taking the message back…',
  draftKept: 'A draft is kept for this session, so the message was left waiting',
  notKept: 'Could not keep the message as a draft, so it was left waiting',
  later: 'Taken back; it will be in the box when the box is free',
  mayHaveRead: 'This message may already have been read; check the transcript before sending it again',
  needsNewer: (machine: string) => `Taking a message back needs a newer MAWS on ${machine}`,
  needsServices: 'Taking a message back needs this Mac’s MAWS services updated',
} as const;

/** How long a withdrawal's answer is waited for before the record is read instead (Acceptance 6 (a)). */
export const WITHDRAW_WAIT_MS = 5_000;
/**
 * A settling save that fails is asked again, first this long after, the wait doubling to a bound; after this many tries
 * the box's writer names its form too. Neither ends the hold: an acknowledged save or a read of what is kept does.
 */
const SETTLE_TRIES = 3;
export const SETTLE_RETRY_MS = 1_000;
const SETTLE_RETRY_MAX_MS = 30_000;

/** The session's box while a composer mounts it: what the take-back loads into and holds. */
export interface TakeBackBox {
  load(doc: ComposerDoc): boolean; // EditorHandle.load: false while the box holds text, a card holds it or a submission is in flight
  replace(doc: ComposerDoc | null): void; // after a stale settle: what is kept, in place of this mount's copy
  hold(on: boolean): void; // read-only, "Taking the message back…"
  settleLater(replaces: string, taken: () => void): void; // the writer names it at each save until one is acknowledged (`taken`)
  settled(): void; // the settle is done: the writer names the form no more
}

export interface TakeBackDeps {
  client: MawsBridge;
  controls(): QueueControls | null;
}

type Name = { kind: 'steer' | 'entry'; ref: string };
type Row = { kind: 'next' | 'after' | 'held' | 'uncertain'; key: string; content: SendContent; createdAt: string; messageUuid?: MessageUuid; queueId?: string };

// ---- the session's box and what is in hand --------------------------------------------------------------------------

const boxes = new Map<AppSessionId, TakeBackBox>();
const inHand = new Set<AppSessionId>();
const waitingForBox = new Map<AppSessionId, { stage: Draft; deps: TakeBackDeps; line: string | null }>();

/** The composer's box for the session, while it mounts it. */
export function attachTakeBackBox(appSessionId: AppSessionId, box: TakeBackBox): () => void {
  boxes.set(appSessionId, box);
  box.hold(inHand.has(appSessionId)); // a composer that moves to another session leaves the last one's hold behind
  return () => {
    if (boxes.get(appSessionId) === box) boxes.delete(appSessionId);
  };
}

/** Whether a take-back of the session is in hand in this window (a second ↑ meanwhile does nothing). */
export const takingBack = (appSessionId: AppSessionId): boolean => inHand.has(appSessionId);

/** A load the box refused is tried again at the editor's next change of state. */
export function retryTakeBackLoad(appSessionId: AppSessionId): void {
  const waiting = waitingForBox.get(appSessionId);
  const box = boxes.get(appSessionId);
  if (waiting === undefined || box === undefined || inHand.has(appSessionId)) return;
  // tried before the hold, so that a box still not free changes nothing (no hold to set and lift, no second notice)
  const doc = boxDocOf(waiting.stage);
  if (!box.load(doc)) return;
  waitingForBox.delete(appSessionId);
  void inHandFor(appSessionId, () => loaded(appSessionId, waiting.stage, waiting.deps, doc, waiting.line));
}

// ---- a store of an earlier build (Reported, 20) -----------------------------------------------------------------------

const LOCAL = 'local' as const;
type StoreKey = MachineRef | typeof LOCAL;
type Machines = ReturnType<typeof useMachines.getState>['machines'];
type Daemon = DaemonStatus | null;
// Which run of that machine's services refused a claim: there, its link's generation (the refusal holds until the link
// opens again); here, the services' daemon by pid and start (until they restart). Services this app runs itself (no
// daemon) are this build's and never answer so: nothing to remember.
const useRefusedStores = create<{ refused: ReadonlyMap<StoreKey, string> }>()(() => ({ refused: new Map() }));
const machineKeyOf = (appSessionId: AppSessionId): StoreKey => (isAddress(appSessionId) && machineOf(appSessionId) !== ipc.localMachine ? machineOf(appSessionId) : LOCAL);
const servicesRun = (key: StoreKey, machines: Machines, daemon: Daemon): string | null =>
  key === LOCAL ? (daemon === null ? null : `daemon ${daemon.pid} ${daemon.startedAt}`) : `link ${machines.get(key)?.generation ?? 0}`;
const sentenceFor = (key: StoreKey, machines: Machines): string => (key === LOCAL ? TAKE_BACK_WORDS.needsServices : TAKE_BACK_WORDS.needsNewer(machineName(machines, key, ipc.localMachine)));
const daemonNow = (): Daemon => useHosts.getState().supervisor?.daemon ?? null;

function refusalIn(appSessionId: AppSessionId, refused: ReadonlyMap<StoreKey, string>, machines: Machines, daemon: Daemon): string | null {
  const key = machineKeyOf(appSessionId);
  const run = refused.get(key);
  return run !== undefined && run === servicesRun(key, machines, daemon) ? sentenceFor(key, machines) : null;
}

/** The sentence while the run of that session's machine's services that answered a claim as stale serves; null otherwise. */
export function storeRefusesStage(appSessionId: AppSessionId): string | null {
  return refusalIn(appSessionId, useRefusedStores.getState().refused, useMachines.getState().machines, daemonNow());
}

/** The same, followed in a render. */
export function useStoreRefusesStage(appSessionId: AppSessionId): string | null {
  const refused = useRefusedStores((s) => s.refused);
  const machines = useMachines((s) => s.machines);
  const daemon = useHosts((s) => s.supervisor?.daemon ?? null);
  return refusalIn(appSessionId, refused, machines, daemon);
}

function rememberRefusal(appSessionId: AppSessionId): string {
  const key = machineKeyOf(appSessionId);
  const { machines } = useMachines.getState();
  const run = servicesRun(key, machines, daemonNow());
  if (run !== null) useRefusedStores.setState((s) => ({ refused: new Map(s.refused).set(key, run) }));
  return sentenceFor(key, machines);
}

/** Tests: a fresh window. */
export function resetTakeBack(): void {
  epoch += 1; // a settle still asking ends
  boxes.clear();
  inHand.clear();
  waitingForBox.clear();
  useRefusedStores.setState({ refused: new Map() });
}

// ---- the draft store, by the session's route ----------------------------------------------------------------------------

type SetResult = CommandResult<'session.drafts.set'> | { withheld: true };
const failedWith = (result: SetResult, words: string): boolean => !('withheld' in result) && !result.ok && result.error.message.includes(words);

async function setDraft(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, replaces: string): Promise<SetResult> {
  if (!isRemoteLaneB(appSessionId)) return client.invoke('session.drafts.set', { appSessionId, draft, replaces });
  if (readerRowsOf(appSessionId) === 'refused') return { withheld: true }; // the route was heard refused: nothing is sent
  return saveRemoteDraftOnce(client, appSessionId, draft, replaces);
}

async function readDraft(client: MawsBridge, appSessionId: AppSessionId): Promise<Draft | null | undefined> {
  const result = isRemoteLaneB(appSessionId) ? await readRemoteDraft(client, appSessionId) : await client.invoke('session.drafts.get', { appSessionId });
  return result.ok ? result.value : undefined; // undefined: could not be read
}

/** A stored draft's take-back mark, if it is a stage. */
export function stageMark(draft: Draft | null | undefined): TakeBackMark | null {
  const doc = draft?.doc as ComposerDoc | null | undefined;
  const mark = (doc?.attrs as { takeBack?: TakeBackMark } | undefined)?.takeBack;
  return mark !== undefined && typeof mark === 'object' && typeof mark.ref === 'string' && (mark.kind === 'steer' || mark.kind === 'entry') && typeof mark.since === 'string' ? mark : null;
}

/** The stage's document as the box takes it: no mark, and the draft's budget marked as a draft's (decision 13). */
function boxDocOf(stage: Draft): ComposerDoc {
  const doc = stage.doc as ComposerDoc;
  const { takeBack: _mark, ...attrs } = (doc.attrs ?? {}) as Record<string, unknown>;
  void _mark;
  return { ...doc, attrs: { ...attrs, attachments: markPersisted(attachmentsOf(doc)) } };
}

// ---- the operation ------------------------------------------------------------------------------------------------------

async function inHandFor(appSessionId: AppSessionId, run: () => Promise<void>): Promise<void> {
  inHand.add(appSessionId);
  boxes.get(appSessionId)?.hold(true);
  try {
    await run();
  } finally {
    inHand.delete(appSessionId);
    boxes.get(appSessionId)?.hold(false);
  }
}

const notice = (appSessionId: AppSessionId, text: string) => showStackNotice(appSessionId, text);

/**
 * ↑ or Edit on a row: steps 1 to 4. The caller has checked that the box is empty and that nothing refuses the act here;
 * a take-back of the session already in hand makes this do nothing.
 */
export async function takeBack(appSessionId: AppSessionId, row: Row, deps: TakeBackDeps): Promise<void> {
  if (inHand.has(appSessionId)) return;
  const name: Name = row.kind === 'next' ? { kind: 'steer', ref: row.messageUuid! } : { kind: 'entry', ref: row.queueId! };
  const mark: TakeBackMark = { ref: name.ref, kind: name.kind, since: row.createdAt };
  const doc = entryDoc(row.content);
  const stage = draftOf({ ...doc, attrs: { ...doc.attrs, takeBack: mark } }, new Date().toISOString(), { whole: true })!;
  await inHandFor(appSessionId, async () => {
    const claimed = await setDraft(deps.client, appSessionId, stage, DRAFT_CLAIM);
    if ('withheld' in claimed || !claimed.ok) {
      if (failedWith(claimed, DRAFT_KEPT_WORDS)) return notice(appSessionId, TAKE_BACK_WORDS.draftKept);
      if (failedWith(claimed, STALE_DRAFT_WORDS)) return notice(appSessionId, rememberRefusal(appSessionId));
      if (failedWith(claimed, STAGED_DRAFT_WORDS)) {
        const kept = await readDraft(deps.client, appSessionId); // a stage is kept already: it goes forward first
        if (stageMark(kept) !== null) return forward(appSessionId, kept!, deps);
      }
      return notice(appSessionId, TAKE_BACK_WORDS.notKept);
    }
    await forward(appSessionId, stage, deps);
  });
}

/** Step 5: a stored stage met by a mount (restored) carries forward; never rolled back. */
export async function carryForward(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps): Promise<void> {
  if (inHand.has(appSessionId) || stageMark(stage) === null) return;
  await inHandFor(appSessionId, () => forward(appSessionId, stage, deps));
}

// Steps 3 and 4, under the message's current name. Each read of the record is replayed from the stage's own name (the
// panel's finding 4): a promotion and its revert read from the promoted uuid would say nothing. A message the record
// keeps listed keeps its stage and is withdrawn again, at once under a new name and after the settle's backoff under the
// same one; only a record that cannot say loads it (decision 13's table; the panel's finding 3, ruled (A)).
async function forward(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps): Promise<void> {
  const mark = stageMark(stage)!;
  const own: Name = { kind: mark.kind, ref: mark.ref };
  const started = epoch;
  let name = own;
  for (let again = 0; ; ) {
    if (await withdraw(deps, name)) return load(appSessionId, stage, deps, null); // this caller's own withdrawal
    if (epoch !== started) return;
    const said = await record(deps.client, appSessionId, mark.since, own);
    if (epoch !== started) return;
    if (said.kind === 'gone') return load(appSessionId, stage, deps, null);
    if (said.kind === 'read') return clear(appSessionId, stage, deps);
    if (said.kind === 'unknown') return load(appSessionId, stage, deps, TAKE_BACK_WORDS.mayHaveRead);
    if (said.name.kind === name.kind && said.name.ref === name.ref) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(SETTLE_RETRY_MS * 2 ** again, SETTLE_RETRY_MAX_MS)));
      again += 1;
      if (epoch !== started) return;
    }
    name = said.name;
  }
}

const bounded = <T>(promise: Promise<T> | undefined): Promise<T | undefined> =>
  promise === undefined ? Promise.resolve(undefined) : Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), WITHDRAW_WAIT_MS))]);

// Whether this caller's own withdrawal took the message out (its `cancelled`, or its removal resolved).
async function withdraw(deps: TakeBackDeps, name: Name): Promise<boolean> {
  const queue = deps.controls();
  if (queue === null) return false;
  if (name.kind === 'steer') {
    const result = await bounded(queue.cancelSteer({ messageUuid: name.ref as MessageUuid }));
    return result?.ok === true && result.value.outcome === 'cancelled';
  }
  const result = await bounded(queue.remove({ queueId: name.ref }));
  return result?.ok === true;
}

type Said = { kind: 'gone' } | { kind: 'read' } | { kind: 'unknown' } | { kind: 'listed'; name: Name };

const listedIn = (queue: SessionQueue | undefined, name: Name): boolean =>
  queue !== undefined && (name.kind === 'steer' ? queue.steers.some((steer) => steer.messageUuid === name.ref) : queue.entries.some((entry) => entry.queueId === name.ref && entry.state === 'queued'));

/** What the record says became of the message, read in the order of its rows (decision 13's table). */
export function readRecord(events: readonly PromptHistoryEvent[], start: Name): { state: 'pending' | 'gone' | 'read'; name: Name } {
  let name = start;
  let state: 'pending' | 'gone' | 'read' = 'pending';
  let undo: Name | null = null; // the entry a `release` or a `promote` named, which a `revert` lists again
  for (const event of events) {
    if (event.kind === 'command.lifecycle') {
      if (event.state === 'started' && name.kind === 'steer' && event.commandUuid === name.ref) state = 'read';
      continue;
    }
    const { action, queueId, messageUuid } = event;
    const ofName = name.kind === 'steer' ? messageUuid === name.ref : queueId === name.ref;
    switch (action) {
      case 'cancel':
        if (name.kind === 'steer' && ofName) state = 'gone';
        break;
      case 'remove':
        if (name.kind === 'entry' && ofName) state = 'gone';
        break;
      case 'drop':
      case 'abandon':
        if (ofName) state = 'gone';
        break;
      case 'hold':
        if (name.kind === 'steer' && ofName && queueId !== null) {
          name = { kind: 'entry', ref: queueId };
          state = 'pending';
        }
        break;
      case 'promote':
        if (name.kind === 'entry' && ofName && messageUuid !== null) {
          undo = name;
          name = { kind: 'steer', ref: messageUuid };
          state = 'pending';
        }
        break;
      case 'release':
        if (name.kind === 'entry' && ofName) {
          undo = name;
          state = 'read';
        }
        break;
      case 'revert':
        if (undo !== null && queueId === undo.ref) {
          name = undo;
          undo = null;
          state = 'pending';
        }
        break;
      default:
        break;
    }
  }
  return { state, name };
}

async function record(client: MawsBridge, appSessionId: AppSessionId, since: string, name: Name): Promise<Said> {
  const result = await client.invoke('session.promptHistory', { appSessionId, since });
  if (!result.ok || !result.value.complete) return { kind: 'unknown' };
  const read = readRecord(result.value.events, name);
  if (read.state === 'gone') return { kind: 'gone' };
  if (read.state === 'read') return { kind: 'read' };
  return listedIn(useQueueStore.getState().bySession.get(appSessionId), read.name) ? { kind: 'listed', name: read.name } : { kind: 'unknown' };
}

// Step 4: the stage into the box, then the stage settled as the ordinary draft the box holds.
async function load(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps, line: string | null): Promise<void> {
  const doc = boxDocOf(stage);
  const box = boxes.get(appSessionId);
  if (box === undefined || !box.load(doc)) {
    // the stage stays stored: a later mount carries it forward, or this box takes it once it is free
    if (box !== undefined) waitingForBox.set(appSessionId, { stage, deps, line });
    return notice(appSessionId, TAKE_BACK_WORDS.later);
  }
  await loaded(appSessionId, stage, deps, doc, line);
}

// The box holds the message: its line, if the record left one, and the stage settled as the box's draft.
async function loaded(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps, doc: ComposerDoc, line: string | null): Promise<void> {
  if (line !== null) notice(appSessionId, line);
  await settle(appSessionId, stage, deps, draftOf(doc, new Date().toISOString()));
}

// Where the agent has the message: the stage is cleared by a save that settles it, and the stack says so.
async function clear(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps): Promise<void> {
  notice(appSessionId, STACK_WORDS.readAlready);
  await settle(appSessionId, stage, deps, null);
}

let epoch = 0; // a fresh window (`resetTakeBack`) ends what this one has in hand

// Settles the stage as the box's draft (`draft`, or null where the agent has the message). Only an acknowledged settling
// save, or a read of what is kept after a stale answer, ends it; until then the box stays held and the save is asked
// again, and after a few tries the box's writer names the form too, whose acknowledgement ends it as well.
async function settle(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps, draft: Draft | null): Promise<void> {
  const replaces = settles(stage.updatedAt);
  const loadedInto = boxes.get(appSessionId);
  const started = epoch;
  let byWriter = false;
  for (let attempt = 0; ; attempt++) {
    const result = await setDraft(deps.client, appSessionId, draft, replaces);
    if (epoch !== started) return;
    if (byWriter || (!('withheld' in result) && result.ok)) return settledAs(appSessionId, loadedInto, draft);
    // Refused as stale (no stage is kept at that revision: another mount settled first, or this one's earlier save landed
    // and its answer was lost) or as staged (another stage is kept), or not sent (the route was heard refused, which says
    // nothing of what is kept): what is kept is read, and taken as a mount takes it.
    if ('withheld' in result || failedWith(result, STALE_DRAFT_WORDS) || failedWith(result, STAGED_DRAFT_WORDS)) {
      const kept = await readDraft(deps.client, appSessionId);
      if (epoch !== started) return;
      if (kept !== undefined && !(stageMark(kept) !== null && kept!.updatedAt === stage.updatedAt)) return reconcile(appSessionId, stage, deps, kept);
      // a read that failed, or that still finds this stage, says nothing: the hold stays and the settle is asked again
    }
    if (attempt + 1 === SETTLE_TRIES) boxes.get(appSessionId)?.settleLater(replaces, () => void (byWriter = true));
    await new Promise((resolve) => setTimeout(resolve, Math.min(SETTLE_RETRY_MS * 2 ** attempt, SETTLE_RETRY_MAX_MS)));
    if (epoch !== started) return;
    if (byWriter) return settledAs(appSessionId, loadedInto, draft);
  }
}

// The settle was taken: a box mounted since the load (the composer remounted meanwhile) shows what is kept.
function settledAs(appSessionId: AppSessionId, loadedInto: TakeBackBox | undefined, draft: Draft | null): void {
  const box = boxes.get(appSessionId);
  box?.settled();
  if (box !== undefined && box !== loadedInto) box.replace(draft === null ? null : (draft.doc as ComposerDoc));
}

// The settle was refused and what is kept was read: the box's copy is superseded either way. A stage another wrote goes
// forward into the box, emptied first (it was held, so nothing of the person's is lost, and the copy, which the other
// window may have sent, never becomes editable); otherwise the box takes what is kept.
function reconcile(appSessionId: AppSessionId, stage: Draft, deps: TakeBackDeps, kept: Draft | null): Promise<void> | void {
  const box = boxes.get(appSessionId);
  box?.settled();
  if (kept !== null && stageMark(kept) !== null && kept.updatedAt !== stage.updatedAt) {
    box?.replace(null);
    return forward(appSessionId, kept, deps);
  }
  box?.replace(kept === null || kept.doc === null ? null : (kept.doc as ComposerDoc));
}
