// "Attach selection to chat", the hand-over (UX wave U6b-5a, M2; docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-
// keyboard.md, sequence S1, decisions 8 and 30 to 33, Interfaces §C): one attach's block, with an id of its own, goes to
// whoever is the authority over the session's draft, and the hand-over ends only when that authority holds it, once.
//
// - A composer mounted for the session is the authority: it takes the block itself (`FocusTarget.attachPasted`); its
//   save is believed only if no composer came or went across it and it is still mounted (Decision Log 14 (i)). A send of
//   the session in flight is a writer too, with or without its composer: nothing is asked while one is, and the loop
//   waits for it (`submissionOf`); so it does for a spawned session's automatic first send still to go, which sends its
//   box with no press (`firstSendPending`; (v)). An accepted send whose document held the block took it: the end is
//   `added`, and the block is not put in again ((ii); `watchAcceptedSends`).
// - With none mounted, the store is: a round reads the draft, and writes it with the block appended unless the block is
//   there, naming the revision that read answered (`replacesOf`). A round a composer came or went under, or a send was
//   in flight under, is not believed: the loop turns again and asks the authority of the moment.
// - Three rounds, then one last read that writes nothing. A write whose answer is not definite (`timeout`, a failure of
//   the route, a promise that rejects), and an accepted one in a round not believed ((iii)), is settled by a later
//   believed read, or stays unaccounted for; while one is, no end is a refusal: the person reads that MAWS could not
//   confirm (`unconfirmed`), never "not added". A write in the claim form is never accounted for again: the claim can
//   come true again after a clear. A read whose promise rejects is a failed read ((vi)).
// - The whole hand-over has a deadline (`attachDeadlineMs`): the store's work at its worst and one bound for a wait.
//
// `added` is said at an end where the authority holds the block, and at no earlier point; the line itself is the
// caller's (tools/terminal/attach.ts).
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { DRAFT_CLAIM, DRAFT_KEPT_WORDS, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { takeWithheld } from '@shared/sessions/draft-fit';
import { ipc } from '../ipc/client';
import { available } from '../keymap/shell-navigation';
import { isNotOffered, readerRowsOf } from '../lane-b/reader-rows';
import { readRemoteDraft, saveRemoteDraftOnce, unsavedRemoteDraft } from '../lane-b/remote-drafts';
import { isRemoteLaneB } from '../lane-b/remote-session';
import { firstSendPending } from '../sessions/remote-spawn';
import { useSetup } from '../sessions/store';
import { useComposerStore, type FocusTarget } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { submissionOf, watchAcceptedSends, type EditorHandle } from './editor/controller';
import type { ComposerDoc } from './editor/doc';
import { docOfDraft, draftOf } from './editor/drafts';
import { appendPasted, holdsBlock, type AttachedBlock } from './editor/pasted-block';

/** The store's rounds in one hand-over, each a read and at most one write; then one last read. */
export const ATTACH_ROUNDS = 3;
/** Seven commands of store work at their bounds (three reads, three writes, the last read), and one bound for a wait. */
export const ATTACH_DEADLINE_COMMANDS = 2 * ATTACH_ROUNDS + 2;
/**
 * The bound of one command to this Mac's services: main answers a host-owned command `timeout` past it
 * (`REQUEST_TIMEOUT_MS`, src/shared/host/host-supervisor.ts, which the renderer cannot import: it holds the host's
 * transport; attach-pasted.test.tsx pins the two equal).
 */
export const COMMAND_BOUND_HERE_MS = 10_000;
/** How often a hand-over looks again at a spawned session's first send still to go, which tells no one when it goes. */
export const FIRST_SEND_LOOK_MS = 100;
export function attachDeadlineMs(overLink: boolean): number {
  return ATTACH_DEADLINE_COMMANDS * (overLink ? REMOTE_ACT_PENDING_MS : COMMAND_BOUND_HERE_MS);
}

export type AttachRefusal = 'not-started' | 'busy' | 'closed' | 'unsaved' | 'taking-back' | 'changed' | 'unknown' | 'unreachable' | 'no-store' | 'failed';
export type AttachOutcome = { kind: 'taken' } | { kind: 'added' } | { kind: 'unconfirmed' } | { kind: 'refused'; why: AttachRefusal };
type BoxAnswer = Awaited<ReturnType<NonNullable<FocusTarget['attachPasted']>>>;

/**
 * The Composer's side of `FocusTarget.attachPasted`: where its box stands is the composer's to say (decision 8). By a
 * press, where the box can take the keyboard (its element available, no card holding it), at the caret with the
 * keyboard; otherwise, and always by a hand-over, at the end and saved at once.
 */
export async function takeIntoBox(editor: EditorHandle | null, block: AttachedBlock, by: 'press' | 'hand-over', box: { element: HTMLElement | null; covered: boolean }): Promise<BoxAnswer> {
  if (editor === null) return 'gone';
  if (by === 'press' && !box.covered && box.element !== null && available(box.element)) {
    const answer = await editor.attachPasted(block, { at: 'caret', save: false });
    return answer === 'taken' ? 'shown' : answer;
  }
  const answer = await editor.attachPasted(block, { at: 'end', save: true });
  return answer === 'taken' ? 'kept' : answer;
}

/** S1, whole: the text as one pasted block for the session, handed to the authority over its draft. */
export function attachPasted(appSessionId: AppSessionId, text: string, client: MawsBridge = ipc): Promise<AttachOutcome> {
  return new HandOver(appSessionId, { id: `attach-${crypto.randomUUID()}`, text }, client).run();
}

// `useSetupIntent`'s rule, read outside React: an intent, and not both a record and an engine status.
function notStarted(appSessionId: AppSessionId): boolean {
  const sessions = useSessions.getState();
  return useSetup.getState().intents.has(appSessionId) && !(sessions.records.has(appSessionId) && sessions.engine.has(appSessionId));
}

const composerOf = (appSessionId: AppSessionId): FocusTarget | null => useComposerStore.getState().focusTargets.get(appSessionId) ?? null;

const EXPIRED = Symbol('expired');
// A route whose promise rejected, as a result: a failure, with words no answer of the store's carries.
const rejected = (): CommandResult<CommandName> => ({ ok: false, error: ipcError('internal', 'the route to the draft store failed') });
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const said = (result: CommandResult<CommandName>, words: string): boolean => !result.ok && result.error.message.includes(words);
const unknownSession = (result: CommandResult<CommandName>): boolean => said(result, 'unknown app session');

// A read's cause, when it fails.
function readRefusal(result: CommandResult<CommandName>): AttachRefusal {
  if (isNotOffered(result)) return 'no-store';
  if (unknownSession(result)) return 'unknown';
  if (!result.ok && (result.error.code === 'host_unavailable' || result.error.code === 'timeout')) return 'unreachable';
  return 'failed';
}

// What one read of the round answered: the document the machine (or this Mac's store) keeps, by which a write is
// accounted for; the document to keep, which the round looks for the block in and appends to; the revision to name.
type Read = { ok: true; kept: unknown; keep: unknown; revision: string | null } | { ok: false; result: CommandResult<CommandName> };

// Each write's own stamp, later than the one before, so two writes of one hand-over never share a revision.
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

class HandOver {
  private readonly overLink: boolean;
  private comings = 0; // the session's composers coming and going, counted
  private waitingOnSend = false;
  private asking = false; // a composer asked and not yet answered
  private sent = false; // a write of the block sent to the store
  private unaccountedRevision = false; // a write naming a revision (or none, over the link) whose answer was not definite
  private unaccountedClaim = false; // a write in the claim form whose answer was not definite: for the rest of the hand-over
  private sentWithMessage = false; // an accepted send's document held the block
  private expiry: Promise<typeof EXPIRED> = new Promise(() => {});
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly session: AppSessionId,
    private readonly block: AttachedBlock,
    private readonly client: MawsBridge,
  ) {
    this.overLink = isRemoteLaneB(session);
  }

  async run(): Promise<AttachOutcome> {
    const pressed = composerOf(this.session);
    // a press on a composer that is sending: nothing of the block has been written, and nothing waits
    if (pressed !== null && submissionOf(this.session) !== null) return { kind: 'refused', why: 'busy' };
    this.expiry = new Promise((resolve) => (this.timer = setTimeout(() => resolve(EXPIRED), attachDeadlineMs(this.overLink))));
    const off = useComposerStore.subscribe((state, before) => {
      if (state.focusTargets.get(this.session) !== before.focusTargets.get(this.session)) this.comings += 1;
    });
    const unwatch = watchAcceptedSends(this.session, (doc) => {
      if (holdsBlock(doc, this.block.id)) this.sentWithMessage = true;
    });
    try {
      const end = await this.loop(pressed);
      // the block went with a message, once: whatever the store or a box answered after
      return this.sentWithMessage && (end.kind === 'refused' || end.kind === 'unconfirmed') ? { kind: 'added' } : end;
    } finally {
      off();
      unwatch();
      if (this.timer !== null) clearTimeout(this.timer);
    }
  }

  private within<T>(promise: Promise<T>): Promise<T | typeof EXPIRED> {
    return Promise.race([promise, this.expiry]);
  }

  // The deadline passed: an answer that comes later is not read.
  private expired(): AttachOutcome {
    if (this.sent || this.asking) return { kind: 'unconfirmed' };
    return { kind: 'refused', why: this.waitingOnSend ? 'busy' : 'failed' };
  }

  private unaccounted(): boolean {
    return this.unaccountedRevision || this.unaccountedClaim;
  }

  // "Not added" only where no write of the block can still land.
  private refuse(why: AttachRefusal): AttachOutcome {
    return this.unaccounted() ? { kind: 'unconfirmed' } : { kind: 'refused', why };
  }

  private believed(comings: number): boolean {
    return this.comings === comings && submissionOf(this.session) === null;
  }

  private async loop(pressed: FocusTarget | null): Promise<AttachOutcome> {
    let rounds = 0;
    for (;;) {
      if (this.sentWithMessage) return { kind: 'added' }; // never put in again
      if (firstSendPending(this.session)) {
        // its box sends what it holds with no press: nothing is put anywhere until that send has gone
        this.waitingOnSend = true;
        if ((await this.within(pause(FIRST_SEND_LOOK_MS))) === EXPIRED) return this.expired();
        this.waitingOnSend = false;
        continue;
      }
      const sending = submissionOf(this.session);
      if (sending !== null) {
        this.waitingOnSend = true;
        if ((await this.within(sending)) === EXPIRED) return this.expired();
        this.waitingOnSend = false;
        continue;
      }
      const target = composerOf(this.session);
      if (target !== null) {
        this.asking = true;
        const comings = this.comings;
        const asked = target.attachPasted?.(this.block, target === pressed ? 'press' : 'hand-over') ?? Promise.resolve<BoxAnswer>('closed');
        // an ask whose promise rejects may or may not have put the block in the box
        const answer = await this.within(asked.catch(() => 'rejected' as const));
        if (answer === EXPIRED) return this.expired();
        this.asking = false;
        switch (answer) {
          case 'rejected':
            return { kind: 'unconfirmed' };
          case 'shown':
            return { kind: 'taken' };
          case 'kept':
            // a save across which the authority changed may be overwritten by the one after it: ask that one
            if (this.comings === comings && composerOf(this.session) === target) return { kind: 'added' };
            continue;
          case 'present':
            return { kind: 'added' };
          case 'unsaved':
          case 'closed':
            return this.refuse(answer);
          case 'busy':
          case 'gone':
            // a send began meanwhile, or the composer went: ask again, after this turn of the event loop, so an editor
            // still settling its send is not asked in a loop of microtasks
            if ((await this.within(new Promise<void>((resolve) => setTimeout(resolve, 0)))) === EXPIRED) return this.expired();
            continue;
        }
      }
      if (rounds < ATTACH_ROUNDS) {
        rounds += 1;
        const end = await this.round();
        if (end !== null) return end;
        continue;
      }
      return this.lastRead();
    }
  }

  // The store's round: an end, or null to turn again.
  private async round(): Promise<AttachOutcome | null> {
    if (notStarted(this.session)) return this.refuse('not-started');
    if (this.overLink && readerRowsOf(this.session) === 'refused') return this.refuse('no-store');
    const comings = this.comings;
    const read = await this.within(this.read());
    if (read === EXPIRED) return this.expired();
    if (!read.ok) return this.refuse(readRefusal(read.result));
    if (!this.believed(comings)) return null; // a composer or a send may have written over the store: ask again
    if (holdsBlock(read.kept, this.block.id)) this.unaccountedRevision = false; // a write of it landed, and nothing since
    if (holdsBlock(read.keep, this.block.id)) return { kind: 'added' };
    const replaces = this.overLink ? read.revision : (read.revision ?? DRAFT_CLAIM);
    const draft = draftOf(appendPasted(read.keep, this.block), stamp());
    this.sent = true;
    const result = await this.within(this.write(draft, replaces));
    if (result === EXPIRED) return this.expired();
    if ('withheld' in result) return this.refuse('failed'); // only a take-back's stage is withheld: never this draft
    if (result.ok) {
      this.unaccountedRevision = false; // what an earlier write named is no longer kept, and never will be again
      if (this.believed(comings)) return { kind: 'added' };
      this.unaccountedFor(replaces); // kept, and a writer may have written over it since: a believed read settles it
      return null;
    }
    if (said(result, STALE_DRAFT_WORDS) || said(result, DRAFT_KEPT_WORDS)) return null;
    if (said(result, STAGED_DRAFT_WORDS)) return this.refuse('taking-back');
    if (unknownSession(result)) return this.refuse('unknown');
    if (isNotOffered(result)) return this.refuse('no-store');
    // not definite: it may still land
    this.unaccountedFor(replaces);
    return null;
  }

  private unaccountedFor(replaces: string | null): void {
    if (replaces === DRAFT_CLAIM) this.unaccountedClaim = true;
    else this.unaccountedRevision = true;
  }

  // The rounds spent: one read more, and no write. Over the link only the machine's own answer, with no save of the
  // session still out in this window, says the block is not there.
  private async lastRead(): Promise<AttachOutcome> {
    if (this.overLink && readerRowsOf(this.session) === 'refused') return this.refuse('no-store');
    const comings = this.comings;
    const read = await this.within(this.read());
    if (read === EXPIRED) return this.expired();
    if (!read.ok || !this.believed(comings)) return { kind: 'unconfirmed' };
    if (this.overLink && unsavedRemoteDraft(this.session) !== undefined) return { kind: 'unconfirmed' };
    if (holdsBlock(read.kept, this.block.id)) return { kind: 'added' };
    return this.unaccounted() ? { kind: 'unconfirmed' } : { kind: 'refused', why: 'changed' };
  }

  // On this Mac the window's read, which answers a cleared draft as none; over the link the machine's, every time
  // (never this window's memory of its revision), and the document to keep the newest this window holds that the
  // machine has not taken (a clear still out counts as a document with no block), else what the machine answered.
  private read(): Promise<Read> {
    return this.readOnce().catch((): Read => ({ ok: false, result: rejected() }));
  }

  private async readOnce(): Promise<Read> {
    if (!this.overLink) {
      const result = await this.client.invoke('session.drafts.get', { appSessionId: this.session });
      if (!result.ok) return { ok: false, result };
      const kept = docOfDraft(result.value);
      return { ok: true, kept, keep: kept, revision: result.value?.updatedAt ?? null };
    }
    const result = await readRemoteDraft(this.client, this.session);
    if (!result.ok) return { ok: false, result };
    const kept: ComposerDoc | null = result.value === null ? null : docOfDraft(takeWithheld(result.value).draft);
    const unsaved = unsavedRemoteDraft(this.session);
    return { ok: true, kept, keep: unsaved !== undefined ? docOfDraft(unsaved) : kept, revision: result.value?.updatedAt ?? null };
  }

  // A write whose promise rejects is not definite: it may have landed.
  private write(draft: Draft | null, replaces: string | null): Promise<CommandResult<'session.drafts.set'> | { withheld: true }> {
    const written = this.overLink ? saveRemoteDraftOnce(this.client, this.session, draft, replaces) : this.client.invoke('session.drafts.set', { appSessionId: this.session, draft, ...(replaces !== null && { replaces }) });
    return written.catch(() => rejected() as CommandResult<'session.drafts.set'>);
  }
}
