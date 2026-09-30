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
import { randomUUID } from 'node:crypto';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { SendContentSchema, type QueueEntry, type QueuePauseReason, type QueueState, type SendContent, type SessionStateStore } from '@shared/engine/session-state-store';
import type { UserInputFrame } from '@shared/wire/frames';

export const ACK_TIMEOUT_MS = 5_000;
const DROPPED_BEFORE_START: ReadonlySet<string> = new Set(['cancelled', 'discarded', 'refused']);

export type ReleaseTrigger = 'send' | 'turn_ended' | 'resume' | 'dropped';
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
  onChange: (queue: QueueState) => void;
  log?: (message: string) => void;
  ackTimeoutMs?: number;
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
  private readonly log: (message: string) => void;

  constructor(private readonly deps: MessageQueueDeps) {
    this.log = deps.log ?? ((message) => console.warn(`[engine-host ${deps.appSessionId} queue] ${message}`));
  }

  get state(): QueueState {
    return structuredClone({ entries: this.entries, paused: this.paused, pauseReason: this.pauseReason }); // C7: pauseReason
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
    const loaded = await this.deps.store.loadQueue(this.deps.appSessionId);
    this.entries = loaded.entries;
    this.paused = loaded.paused;
    this.pauseReason = loaded.paused ? (loaded.pauseReason ?? null) : null; // C7
    this.loaded = true;
    if (loaded.corrupt !== null) {
      // the state file was unreadable and kept aside: never a silent empty queue (M4 review)
      if (!this.paused) this.pauseFor('state_corrupt'); // C7: through pauseFor
      this.notice(`state:corrupt:${this.deps.appSessionId}`, `This session's saved queue and grants could not be read; the file was kept at ${loaded.corrupt} and the session started without them.`);
    }
    this.settleAfterExit();
    await this.persist(); // rejects: a recovery that cannot be saved is an initialization failure
  }

  async send(content: SendContent): Promise<{ entry: QueueEntry; disposition: 'sent' | 'queued' }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const entry: QueueEntry = { queueId: randomUUID(), appSessionId: this.deps.appSessionId, content, createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    const submitNow = !this.busy && this.queuedCount === 0; // FIFO: a send never overtakes an entry already waiting
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

  // Steer: written at once, never entering the app queue (§4.2). On 2.1.283 `now` (the command's default, the caret
  // menu's "Interrupt and send") preempts the running turn and runs as the next turn (M6 live 3.7); `next` (⌥Enter's
  // Steer, C8b's relay) folds into the running turn at its next tool boundary, and one result names both prompts
  // (pass3/steer-next seq 71, 239).
  async steer(content: SendContent, opts: { priority?: SteerPriority } = {}): Promise<{ messageUuid: MessageUuid }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const uuid = randomUUID() as MessageUuid;
    await this.deps.write({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: opts.priority ?? 'now' });
    return { messageUuid: uuid };
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
    try {
      await this.deps.write({ type: 'user', uuid, message: { role: 'user', content: entry.content }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: opts.priority ?? 'now' });
    } catch (error) {
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
