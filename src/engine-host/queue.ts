// The app-owned message queue (charter §4.2 "Queue ownership", §4.4; C3 execution document, Interfaces "Queue, steer,
// interrupt", M4). Every send is an entry: submitted at once when the session is not busy, queued otherwise, so two
// quick sends at an idle engine serialise. A submission is persisted as `submitting` with its minted uuid before the
// `user` frame is written, becomes `released` at the engine's `command_lifecycle` for that uuid, and leaves the list
// at the `turn.ended` naming it, at a lifecycle that drops it before it started (retired `dropped`, never re-sent), or at
// the process's exit (retired `interrupted`, never re-sent). The release rule: a
// main-lane, non-receipt `turn.ended` submits the head, and so does a `cancelled` or `discarded` drop before start (no turn.ended will follow it; a `refused` one pauses), while the queue is not paused and the session is idle, so nothing
// is ever released into a running turn, an engine-initiated one (`task-notification`) included, nor while a prompt the
// host wrote (a steer) waits for the engine to start it; after an engine turn a
// head that cannot go (not ready, write failed) pauses the queue with an info notice. A submission a crash interrupted comes back as the
// `uncertain` head of a paused queue for the human to re-send or remove. Steer bypasses the queue with `priority:
// 'now'` (or `'next'` on request). Every change is saved through the store before `onChange` fires. Releases and pauses are journaled as
// `meta queue` rows and the queue's warnings as `meta notice` rows (the normaliser maps those to `notice.posted`).
// W1: a `next` steer (Enter while a turn runs) is a pending steer until the engine starts it or drops it, published
// with the queue so the composer can offer "Hold until the turn ends": `hold` withdraws it from the engine
// (`cancel_async_message`, pass3/steer-next-cancelled) and appends it to the app queue, remembering its uuid.
import { randomUUID } from 'node:crypto';
import { queueTransaction } from './store/queue-transaction';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { SendContentSchema, WITHDRAWN_MAX, type PendingSteer, type QueueEntry, type QueuePauseReason, type QueueState, type SendContent, type SessionStateStore } from '@shared/engine/session-state-store';
import type { UserInputFrame } from '@shared/wire/frames';

export const ACK_TIMEOUT_MS = 5_000;
// W1: the plain stop's whole withdrawal phase (holdAll), so its interrupt is written well inside the bounded IPC budget
// (8 s, under main's 10 s deadline) however long the engine leaves a cancel unanswered (each has its own 8 s timeout).
export const HOLD_ALL_DEADLINE_MS = 2_000;
const DROPPED_BEFORE_START: ReadonlySet<string> = new Set(['cancelled', 'discarded', 'refused']);

export type ReleaseTrigger = 'send' | 'turn_ended' | 'resume' | 'dropped' | 'hold'; // W1: `hold`, a held steer whose turn ended during the withdrawal
export type SteerPriority = 'now' | 'next';
export type PauseReason = QueuePauseReason; // C7: the whole closed set the queue journals (QUEUE_PAUSE_REASONS)
export type ExitKind = 'quit' | 'stop' | 'archive' | 'crash' | 'unknown' | 'budget'; // C12: a release pauses nothing, like `stop`

export interface MessageQueueDeps {
  appSessionId: AppSessionId;
  store: SessionStateStore;
  write: (frame: UserInputFrame) => Promise<void>; // the process's OutboundWriter: resolves at the flushed out row, rejects after a write_failed row
  meta: (frame: Record<string, unknown>) => void; // journals a meta row (queue, notice) through the session's record path
  turnOpen: () => boolean; // the normaliser holds a main-lane turn open
  canWrite: () => boolean; // the process is ready
  cancel: (messageUuid: MessageUuid) => Promise<boolean>; // W1: `cancel_async_message`; true when the engine withdrew the message from its queue
  onChange: (queue: QueueState) => void;
  log?: (message: string) => void;
  ackTimeoutMs?: number;
  holdAllDeadlineMs?: number; // W1: HOLD_ALL_DEADLINE_MS by default
}

export class QueueEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueEntryError';
  }
}

export class MessageQueue {
  private entries: QueueEntry[] = [];
  private paused = false;
  private pauseReason: PauseReason | null = null; // C7: set with every pause, cleared on resume; null for a paused queue loaded from a state file older than the field
  private loaded = false; // recover() ran: before it the queue owns nothing and must never overwrite the stored one
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly started = new Set<string>(); // queue ids whose submission the engine started
  private readonly saving = new Set<Promise<void>>(); // store saves not yet settled
  private steers: PendingSteer[] = []; // W1: `next` steers written and not yet started or dropped, in write order
  private withdrawn: MessageUuid[] = []; // W1: the steers held back into the app queue, the last WITHDRAWN_MAX
  private readonly withdrawing = new Set<MessageUuid>(); // W1: steers one hold or stop has claimed and not yet settled
  private readonly log: (message: string) => void;

  constructor(private readonly deps: MessageQueueDeps) {
    this.log = deps.log ?? ((message) => console.warn(`[engine-host ${deps.appSessionId} queue] ${message}`));
  }

  get state(): QueueState {
    // C7: pauseReason; W1: steers and withdrawn, present only when there are any (absent reads as none)
    return structuredClone({ entries: this.entries, paused: this.paused, pauseReason: this.pauseReason, ...(this.steers.length > 0 && { steers: this.steers }), ...(this.withdrawn.length > 0 && { withdrawn: this.withdrawn }) });
  }

  // A turn is open, or an entry is `submitting`, or a `released` entry's turn has not ended.
  get busy(): boolean {
    return this.deps.turnOpen() || this.entries.some((e) => e.state !== 'queued');
  }

  // recover() ran: until then the persisted queue is the store's, never this object's (`session.queue.list`, M5)
  get recovered(): boolean {
    return this.loaded;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get queuedCount(): number {
    return this.entries.filter((e) => e.state === 'queued').length;
  }

  // Loads the persisted queue for a new process: a `submitting` entry (the host or the app died between the persist and
  // the acknowledgement) becomes the uncertain head of a paused queue; a `released` entry is retired `interrupted`.
  async recover(): Promise<void> {
    await queueTransaction(this.deps.store, this.deps.appSessionId, async () => {
      const loaded = await this.deps.store.loadQueue(this.deps.appSessionId);
      this.entries = loaded.entries;
      this.paused = loaded.paused;
      this.pauseReason = loaded.paused ? (loaded.pauseReason ?? null) : null; // C7
      this.steers = []; // W1: a pending steer lived in the engine process that is gone
      this.withdrawn = loaded.withdrawn ?? [];
      this.loaded = true;
      if (loaded.corrupt !== null) {
        // the state file was unreadable and kept aside: never a silent empty queue (M4 review)
        if (!this.paused) this.pauseFor('state_corrupt'); // C7: through pauseFor
        this.notice(`state:corrupt:${this.deps.appSessionId}`, `This session's saved queue and grants could not be read; the file was kept at ${loaded.corrupt} and the session started without them.`);
      }
      this.settleAfterExit();
      await this.persist(); // rejects: a recovery that cannot be saved is an initialization failure
    });
  }

  async send(content: SendContent): Promise<{ entry: QueueEntry; disposition: 'sent' | 'queued' }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const entry: QueueEntry = { queueId: randomUUID(), appSessionId: this.deps.appSessionId, content, createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    const submitNow = !this.paused && !this.busy && this.queuedCount === 0; // FIFO: a send never overtakes an entry already waiting
    this.entries.push(entry);
    if (!submitNow) {
      try {
        await this.persist();
      } catch (error) {
        await this.storeFailed(entry, error);
      }
      return { entry: structuredClone(entry), disposition: 'queued' };
    }
    const sent = await this.submit(entry, 'send');
    return { entry: structuredClone(entry), disposition: sent ? 'sent' : 'queued' };
  }

  // An edit that cannot be saved is undone and rejects.
  async edit(queueId: string, content: SendContent): Promise<QueueEntry> {
    this.checkContent(content);
    const entry = this.queued(queueId);
    const before = { content: entry.content, uncertain: entry.uncertain };
    entry.content = content;
    entry.uncertain = false; // an edit is the human's decision about an uncertain entry
    try {
      await this.persist();
    } catch (error) {
      Object.assign(entry, before);
      throw error;
    }
    return structuredClone(entry);
  }

  // A removal that cannot be saved is undone and rejects.
  async remove(queueId: string): Promise<void> {
    const entry = this.queued(queueId);
    const index = this.entries.indexOf(entry);
    this.entries = this.entries.filter((e) => e !== entry);
    try {
      await this.persist();
    } catch (error) {
      this.entries.splice(index, 0, entry);
      throw error;
    }
  }

  // The composer's Resume is setPaused(false), which also submits the head when the session is not busy.
  async setPaused(paused: boolean): Promise<void> {
    if (paused) return this.pause('user');
    if (this.paused) {
      const reason = this.pauseReason; // C7
      this.paused = false;
      this.pauseReason = null; // C7
      try {
        await this.persist();
      } catch (error) {
        this.paused = true; // still paused on disk: stay paused, release nothing
        this.pauseReason = reason; // C7
        throw error;
      }
      this.journal({ event: 'queue', action: 'resume', reason: 'user' });
    }
    await this.releaseHead('resume');
  }

  async pause(reason: PauseReason): Promise<void> {
    if (this.paused) return;
    this.pauseFor(reason); // C7: through pauseFor
    await this.persist();
  }

  // Steer: written at once, never entering the app queue (§4.2). On 2.1.283 `now` (the command's default)
  // preempts the running turn and runs as the next turn (M6 live 3.7); `next` (the composer's
  // Send during a turn, W10; C8b's relay) folds into the running turn at its next tool boundary, and one result names both prompts
  // (pass3/steer-next seq 71, 239).
  async steer(content: SendContent, opts: { priority?: SteerPriority } = {}): Promise<{ messageUuid: MessageUuid }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const uuid = randomUUID() as MessageUuid;
    const next = opts.priority === 'next';
    if (next) this.registerSteer(uuid, content);
    try {
      await this.deps.write({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: opts.priority ?? 'now' });
    } catch (error) {
      if (next) {
        this.steers = this.steers.filter((s) => s.messageUuid !== uuid);
        await this.announceSteers(); // a save during the write may have published it
      }
      throw error;
    }
    if (next) await this.announceSteers();
    return { messageUuid: uuid };
  }

  // W1: a `next` steer is pending until the engine starts or drops it (onLifecycle). It is registered before its write,
  // since the writer's settle drains the inbound frames it held (the engine's lifecycle for this uuid among them) before
  // the write's promise resolves; taken back if the write fails. Its saves are only announcements (a pending steer is
  // the engine's, so a lost save loses nothing).
  private registerSteer(messageUuid: MessageUuid, content: SendContent): void {
    this.steers = [...this.steers, { messageUuid, content, createdAt: new Date().toISOString() }];
  }

  private async announceSteers(): Promise<void> {
    await this.persist().catch((error: unknown) => this.log(`pending steers not saved: ${messageOf(error)}`));
  }

  // W1: "Hold until the turn ends": the pending steer is withdrawn from the engine's queue and appended to the app
  // queue, which releases it when the turn ends like any held message (at once if the turn ended while it was being
  // withdrawn). Refused when the engine has already taken it (it was folded into the turn, or started) or answers that
  // it had nothing to withdraw, and while another hold or a stop is withdrawing it (that one settles it; a second
  // cancel would only be answered `false` and take back the first one's marker).
  async hold(messageUuid: MessageUuid): Promise<QueueEntry> {
    if (this.withdrawing.has(messageUuid)) throw new QueueEntryError('This message is already being held');
    const steer = this.steers.find((s) => s.messageUuid === messageUuid);
    if (!steer) throw new QueueEntryError('This message has already reached the running turn');
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    this.claim([messageUuid]);
    await this.persist().catch((error: unknown) => this.log(`hold not announced: ${messageOf(error)}`));
    const entry = await this.withdraw(steer); // a failed cancel rejects here
    if (!entry) throw new QueueEntryError('This message has already reached the running turn');
    // The turn may have ended during the cancel's round trip, finding nothing to release: the usual gates (not paused,
    // idle, ready) decide whether the head goes now.
    await this.releaseHead('hold');
    return structuredClone(entry);
  }

  // W1: the plain stop (⌘., the Stop button, a route switch) holds every waiting `next` steer in the app queue before
  // the session interrupts the engine, which would otherwise start a waiting steer as its own turn the moment the
  // running one is interrupted (pass3/steer-next-interrupted): the human's text is kept, as held rows, and nothing runs
  // until Resume or Send now. Each is withdrawn as `hold` withdraws one, in write order, appended and saved in that order
  // before the next cancel. One the engine took meanwhile (folded into the turn, or started) answers `cancelled: false`
  // and stays the engine's, never duplicated; a cancel that fails is logged and leaves it the engine's; one another hold
  // or stop is already withdrawing is left to that one. The whole phase has one deadline (HOLD_ALL_DEADLINE_MS) so the
  // interrupt is always written promptly: past it no further cancel starts (those steers stay the engine's), and the one
  // in flight settles in the background, still appended and saved as a held entry if the engine withdraws it. It never
  // throws: the stop goes on regardless. Resolves to the entries held before the deadline.
  async holdAll(): Promise<QueueEntry[]> {
    const waiting = this.steers.filter((s) => !this.withdrawing.has(s.messageUuid));
    if (waiting.length === 0 || !this.deps.canWrite()) return [];
    const phase = { expired: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => {
        phase.expired = true;
        resolve('expired');
      }, this.deps.holdAllDeadlineMs ?? HOLD_ALL_DEADLINE_MS);
      (timer as { unref?: () => void }).unref?.();
    });
    this.claim(waiting.map((s) => s.messageUuid)); // named before the cancels, as in hold()
    await this.persist().catch((error: unknown) => this.log(`hold not announced: ${messageOf(error)}`));
    const held: QueueEntry[] = [];
    let started = 0;
    while (started < waiting.length && !phase.expired) {
      const withdrawal = this.withdraw(waiting[started++]).catch((error: unknown) => {
        this.log(`a waiting steer could not be held: ${messageOf(error)}`);
        return null;
      });
      const outcome = await Promise.race([withdrawal, deadline]);
      if (outcome === 'expired') {
        // the queue is paused by now; the gates decide, as after a hold, should it have been resumed meanwhile
        void withdrawal.then((entry) => (entry ? this.releaseHead('hold') : undefined)).catch((error: unknown) => this.log(`release after a late hold failed: ${messageOf(error)}`));
        break;
      }
      if (outcome) held.push(outcome);
    }
    clearTimeout(timer);
    const unstarted = waiting.slice(started).map((s) => s.messageUuid);
    if (unstarted.length > 0) {
      this.log(`the stop's hold ran out of time: ${unstarted.length} waiting steer(s) left with the engine`);
      await this.giveBack(unstarted);
    }
    await this.releaseHead('hold'); // gated as ever: a stop has paused the queue first
    return held.map((entry) => structuredClone(entry));
  }

  // Named withdrawn before the cancel, so the engine's `cancelled` for it (which arrives before the answer) never reads
  // as a message that was not sent; and claimed, so no other hold or stop withdraws it meanwhile.
  private claim(uuids: MessageUuid[]): void {
    for (const uuid of uuids) this.withdrawing.add(uuid);
    this.withdrawn = [...this.withdrawn, ...uuids].slice(-WITHDRAWN_MAX);
  }

  // A claim whose withdrawal did not happen, taken back by the one that made it (the steer stays the engine's).
  private async giveBack(uuids: MessageUuid[]): Promise<void> {
    const gone = new Set(uuids);
    for (const uuid of uuids) this.withdrawing.delete(uuid);
    this.withdrawn = this.withdrawn.filter((u) => !gone.has(u));
    await this.persist().catch((error: unknown) => this.log(`withdrawal's end not saved: ${messageOf(error)}`));
  }

  // A claimed steer withdrawn from the engine (`cancel_async_message`): on `cancelled: true` a held entry, saved before
  // this resolves (the engine's own `cancelled` already saved a snapshot without the steer, so the entry must not wait
  // on anything else to reach the disk; a save that fails pauses the queue and keeps it in memory); on `false` (the
  // engine had taken it) null, and a failed cancel rejects, both giving the claim back.
  private async withdraw(steer: PendingSteer): Promise<QueueEntry | null> {
    let cancelled: boolean;
    try {
      cancelled = await this.deps.cancel(steer.messageUuid);
    } catch (error) {
      await this.giveBack([steer.messageUuid]);
      throw error;
    }
    if (!cancelled) {
      await this.giveBack([steer.messageUuid]);
      return null;
    }
    this.withdrawing.delete(steer.messageUuid);
    const entry = this.appendHeld(steer);
    try {
      await this.persist();
    } catch (error) {
      await this.storeFailed(entry, error); // kept in memory, the queue paused: nothing is lost
    }
    return entry;
  }

  // A withdrawn steer as a held entry at the app queue's end (its uuid already named withdrawn), journaled.
  private appendHeld(steer: PendingSteer): QueueEntry {
    this.steers = this.steers.filter((s) => s.messageUuid !== steer.messageUuid); // the engine's `cancelled` may have removed it already
    const entry: QueueEntry = { queueId: randomUUID(), appSessionId: this.deps.appSessionId, content: steer.content, createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    this.entries.push(entry);
    this.journal({ event: 'queue', action: 'hold', queueId: entry.queueId, messageUuid: steer.messageUuid });
    return entry;
  }

  // A queued entry steered out of the queue, durably (M4 review): persisted as a `submitting` steer before the write
  // and removed only after the flush, so a crash on either side recovers it through the `uncertain` path like any
  // submission; a failed write puts it back as queued in its place and rejects. Its priority is steer's, `now` by default.
  async promote(queueId: string, opts: { priority?: SteerPriority } = {}): Promise<{ messageUuid: MessageUuid }> {
    const entry = this.queued(queueId);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const uuid = randomUUID() as MessageUuid;
    Object.assign(entry, { state: 'submitting', messageUuid: uuid, submittedAt: new Date().toISOString(), uncertain: false, steer: true });
    const current = () => entry.state !== 'queued' && entry.messageUuid === uuid && this.entries.includes(entry);
    try {
      await this.persist();
    } catch (error) {
      if (current()) this.revert(entry);
      throw error;
    }
    if (!current()) throw new QueueEntryError('the session ended before the steer was written');
    const next = opts.priority === 'next';
    if (next) this.registerSteer(uuid, entry.content); // W1: a pending steer from before its write, as in steer()
    try {
      await this.deps.write({ type: 'user', uuid, message: { role: 'user', content: entry.content }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: opts.priority ?? 'now' });
    } catch (error) {
      if (next) this.steers = this.steers.filter((s) => s.messageUuid !== uuid); // taken back, published with the revert
      if (current()) {
        this.revert(entry);
        await this.persist().catch((e: unknown) => this.log(`promote revert not saved: ${messageOf(e)}`));
      }
      throw error;
    }
    // flushed: the steer is the engine's now and the entry leaves the app queue
    this.entries = this.entries.filter((e) => e !== entry);
    await this.persist().catch((e: unknown) => this.log(`promoted entry's removal not saved (a restart recovers it as uncertain): ${messageOf(e)}`));
    return { messageUuid: uuid };
  }

  // submitting → released: the engine acknowledges every stdin user frame with command_lifecycle (pass2/dialogs 5–6).
  // A submission the engine drops before it started (`cancelled`, `discarded`, `refused`: pass1/queue-and-interrupt
  // seq 191) will never be named by a turn.ended, so it is retired there with its own notice, no longer holds the queue
  // busy (whole-branch review), and after a `cancelled` or `discarded` drop the head is released under the usual gates
  // (not paused, idle, ready): no turn.ended will come to release it; a `refused` drop pauses the queue instead. An interrupt pauses the queue first, so the drops it causes release nothing. Once started,
  // its turn.ended retires it.
  onLifecycle(event: Extract<SessionEvent, { kind: 'command.lifecycle' }>): void {
    // W1: a pending steer ends at any lifecycle past `queued`: started (folded into the turn, or a turn of its own), or
    // dropped (cancelled, discarded, refused)
    if (event.state !== 'queued' && this.steers.some((s) => s.messageUuid === event.commandUuid)) {
      this.steers = this.steers.filter((s) => s.messageUuid !== event.commandUuid);
      this.persist().catch((error: unknown) => this.log(`pending steer's end not saved: ${messageOf(error)}`));
    }
    const entry = this.entries.find((e) => e.state !== 'queued' && e.messageUuid === event.commandUuid);
    if (!entry) return; // a steer, the plan sequence's frames, or an entry already retired (a late `cancelled`)
    if (event.state === 'started') this.started.add(entry.queueId);
    if (DROPPED_BEFORE_START.has(event.state) && !this.started.has(entry.queueId)) {
      this.entries = this.entries.filter((e) => e !== entry);
      this.clearAck(entry.queueId);
      this.started.delete(entry.queueId);
      // A refusal may describe the engine's state rather than this message: with messages waiting, pause instead of
      // draining the queue into it (coordinator ruling); resume is one click. An empty queue is not paused, or it would
      // silently hold the next send.
      const pause = event.state === 'refused' && !this.paused && this.queuedCount > 0;
      const text = `The engine ${event.state} a message before starting it, so it was not answered. Re-send it if you still want an answer.`;
      this.notice(`queue:dropped:${entry.queueId}`, pause ? `${text} The queue is paused; resume it to send the next message.` : text);
      if (pause) this.pauseFor('refused'); // C7: through pauseFor
      void this.persist()
        .catch((error: unknown) => this.log(`retirement not saved: ${messageOf(error)}`)) // a stale released entry on disk retires at the next recovery
        .then(() => this.releaseHead('dropped'))
        .catch((error: unknown) => this.log(`release after a drop failed: ${messageOf(error)}`));
      return;
    }
    if (entry.state !== 'submitting') return;
    entry.state = 'released';
    this.clearAck(entry.queueId);
    // a lost save leaves `submitting` on disk, which recovery treats as uncertain: the safe side
    this.persist().catch((error: unknown) => this.log(`release not saved: ${messageOf(error)}`));
  }

  // The release rule. Entries the turn names leave the list (a `submitting` one too: a result naming it is proof of
  // delivery); then a human turn's end submits the head unless paused. Echo receipts and child lanes are not turns.
  async onTurnEnded(event: Extract<SessionEvent, { kind: 'turn.ended' }>): Promise<void> {
    if (event.isEchoReceipt || event.parentToolUseId !== null) return;
    const named = new Set<string>(event.userMessageUuids);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => {
      const done = e.state !== 'queued' && e.messageUuid !== null && named.has(e.messageUuid);
      if (done) {
        this.clearAck(e.queueId);
        this.started.delete(e.queueId);
      }
      return !done;
    });
    if (this.entries.length !== before) await this.persist().catch((error: unknown) => this.log(`turn end not saved: ${messageOf(error)}`)); // a stale entry on disk is retired at the next recovery
    if (event.origin === 'human' || event.origin === null) await this.releaseHead('turn_ended');
    else await this.releaseAfterEngineTurn();
  }

  // Concern 1, as ruled (the coordinator's reading of "no release at an engine turn"): nothing is released into an
  // engine-initiated turn, but when one ends and leaves the session idle with entries waiting, the head goes exactly as
  // after a human turn. Only when it cannot go at that moment (the process is not ready, or the write fails) does the
  // queue pause (`engine_turn`) with an info notice naming the head, so nothing waits silently.
  private async releaseAfterEngineTurn(): Promise<void> {
    const head = this.entries.find((e) => e.state === 'queued');
    if (!head || this.paused || this.busy) return;
    if (this.deps.canWrite()) {
      await this.submit(head, 'turn_ended', 'engine_turn');
      return;
    }
    this.pauseFor('engine_turn'); // C7: through pauseFor
    this.heldNotice(head);
    await this.persist().catch((error: unknown) => this.log(`hold not saved: ${messageOf(error)}`));
  }

  private interruptedNotice(entry: QueueEntry): void {
    this.notice(`queue:interrupted:${entry.queueId}`, 'A message was accepted, but the session ended before it was answered. Re-send it if you still want an answer.');
  }

  private heldNotice(head: QueueEntry): void {
    this.notice(`queue:held_after_engine_turn:${head.queueId}`, 'A background task finished while messages were queued, and the next one could not be sent; resume the queue to send it.', 'info');
  }

  // At the process's exit: every `released` entry no turn.ended named is retired `interrupted`; a `submitting` entry
  // takes the recovery path; an exit nobody asked for pauses a non-empty queue (Exit policy). The rows are journaled before
  // the returned promise's persist, so the session can call this right before it writes the exit row.
  onProcessExited(reason: ExitKind): Promise<void> {
    for (const queueId of [...this.ackTimers.keys()]) this.clearAck(queueId);
    if (!this.loaded) return Promise.resolve(); // the process never reached recovery: the stored queue stays as it was
    this.settleAfterExit();
    // only when something is left to hold back: a paused empty queue would silently hold the resumed session's next queue
    if ((reason === 'crash' || reason === 'unknown') && !this.paused && this.entries.length > 0) this.pauseFor('exit'); // C7: through pauseFor
    return this.persist();
  }

  dispose(): void {
    for (const queueId of [...this.ackTimers.keys()]) this.clearAck(queueId);
  }

  // Resolves once no save is in flight, including one a settling save's continuation issued (the session's exit waits
  // on it, so an archive's forget runs after the last write: nothing recreates the state file).
  async settled(): Promise<void> {
    while (this.saving.size > 0) await Promise.allSettled([...this.saving]);
  }

  // ---------------------------------------------------------------------------------------------------------------------

  private settleAfterExit(): void {
    this.started.clear(); // whatever the process started went with it
    this.steers = []; // W1: and so did the engine's queue, pending steers in it
    const uncertain: QueueEntry[] = [];
    const kept: QueueEntry[] = [];
    for (const entry of this.entries) {
      if (entry.state === 'released') {
        this.interruptedNotice(entry);
      } else if (entry.state === 'submitting') {
        uncertain.push({ ...entry, state: 'queued', messageUuid: null, submittedAt: null, uncertain: true, steer: false });
        this.notice(`queue:uncertain:${entry.queueId}`, 'A message may not have been delivered before the session ended. Check the transcript, then resume the queue to send it or remove it.');
      } else {
        kept.push(entry);
      }
    }
    this.entries = [...uncertain, ...kept];
    if (uncertain.length > 0 && !this.paused) this.pauseFor('uncertain'); // C7: through pauseFor
  }

  private async releaseHead(trigger: ReleaseTrigger): Promise<void> {
    if (this.paused || this.busy || !this.deps.canWrite()) return;
    const head = this.entries.find((e) => e.state === 'queued');
    if (head) await this.submit(head, trigger);
  }

  // queued → submitting (persisted) → the frame written; true when it reached the pipe. A failed write reverts the entry
  // and pauses the queue with `failReason` (`engine_turn` after an engine-initiated turn, with its held notice).
  private async submit(entry: QueueEntry, trigger: ReleaseTrigger, failReason: 'write_failed' | 'engine_turn' = 'write_failed'): Promise<boolean> {
    const uuid = randomUUID() as MessageUuid;
    Object.assign(entry, { state: 'submitting', messageUuid: uuid, submittedAt: new Date().toISOString(), uncertain: false });
    const current = () => entry.state === 'submitting' && entry.messageUuid === uuid && this.entries.includes(entry);
    try {
      await this.persist(); // no frame and no announced transition until the submission is durable (M4 review)
    } catch (error) {
      if (current()) {
        this.revert(entry);
        await this.storeFailed(entry, error);
      }
      return false;
    }
    if (!current()) return false; // the process exited during the persist; recovery already took the entry
    if (!this.deps.canWrite()) {
      this.revert(entry);
      await this.persist().catch((error: unknown) => this.log(`revert not saved: ${messageOf(error)}`));
      return false;
    }
    this.journal({ event: 'queue', action: 'release', trigger, queueId: entry.queueId, messageUuid: uuid });
    try {
      await this.deps.write({ type: 'user', uuid, message: { role: 'user', content: entry.content }, parent_tool_use_id: null, origin: { kind: 'human' } });
    } catch (error) {
      if (current()) {
        this.log(`submission ${entry.queueId} not written: ${error instanceof Error ? error.message : String(error)}`);
        this.revert(entry);
        if (!this.paused) {
          this.pauseFor(failReason); // C7: through pauseFor
          if (failReason === 'engine_turn') this.heldNotice(entry);
        }
        await this.persist().catch((e: unknown) => this.log(`revert not saved: ${messageOf(e)}`));
      }
      return false;
    }
    if (current()) this.startAck(entry, uuid);
    return true;
  }

  // C7 start: the one place a pause happens, so the reason the state carries is always the one the journal names.
  private pauseFor(reason: PauseReason): void {
    this.paused = true;
    this.pauseReason = reason;
    this.journal({ event: 'queue', action: 'pause', reason });
  }
  // C7 end

  private revert(entry: QueueEntry): void {
    Object.assign(entry, { state: 'queued', messageUuid: null, submittedAt: null, steer: false });
  }

  // A save that did not land (M4 review): the entry stays queued in memory, the queue pauses (`store_failed`) and a
  // warning says so; nothing is announced as durable unless a later save of that state lands.
  private async storeFailed(entry: QueueEntry, error: unknown): Promise<void> {
    this.log(`queue not saved: ${messageOf(error)}`);
    if (!this.paused) this.pauseFor('store_failed'); // C7: through pauseFor
    this.notice(`queue:store_failed:${entry.queueId}`, `A message could not be saved (${messageOf(error)}), so it was not sent and the queue is paused. Resume to try again.`);
    await this.persist().catch(() => {});
  }

  private startAck(entry: QueueEntry, uuid: MessageUuid): void {
    const timer = setTimeout(() => {
      this.ackTimers.delete(entry.queueId);
      if (entry.state === 'submitting' && entry.messageUuid === uuid) {
        this.notice(`queue:unacknowledged:${entry.queueId}`, `The engine has not acknowledged a sent message after ${Math.round((this.deps.ackTimeoutMs ?? ACK_TIMEOUT_MS) / 1000)} s.`);
      }
    }, this.deps.ackTimeoutMs ?? ACK_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    this.ackTimers.set(entry.queueId, timer);
  }

  private clearAck(queueId: string): void {
    const timer = this.ackTimers.get(queueId);
    if (timer !== undefined) clearTimeout(timer);
    this.ackTimers.delete(queueId);
  }

  private queued(queueId: string): QueueEntry {
    const entry = this.entries.find((e) => e.queueId === queueId);
    if (!entry) throw new QueueEntryError(`no queued entry ${queueId}`);
    if (entry.state !== 'queued') throw new QueueEntryError(`entry ${queueId} is ${entry.state}, not queued`);
    return entry;
  }

  private checkContent(content: SendContent): void {
    const parsed = SendContentSchema.safeParse(content);
    if (!parsed.success) throw new QueueEntryError(parsed.error.issues[0]?.message ?? 'invalid content');
  }

  private notice(key: string, text: string, level: 'warning' | 'info' = 'warning'): void {
    this.journal({ event: 'notice', level, key, text });
  }

  private journal(frame: Record<string, unknown>): void {
    try {
      this.deps.meta(frame);
    } catch (error) {
      this.log(`${String(frame.event)} row not journaled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Saved through the store, then announced with what was saved; a failed save rejects and announces nothing.
  private async persist(): Promise<void> {
    const snapshot = this.state;
    const save = this.deps.store.saveQueue(this.deps.appSessionId, snapshot);
    this.saving.add(save);
    const done = () => void this.saving.delete(save);
    save.then(done, done);
    await save;
    try {
      this.deps.onChange(snapshot);
    } catch (error) {
      this.log(`queue listener failed: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
