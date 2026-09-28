// The app-owned message queue (charter §4.2 "Queue ownership", §4.4; C3 execution document, Interfaces "Queue, steer,
// interrupt", M4). Every send is an entry: submitted at once when the session is not busy, queued otherwise, so two
// quick sends at an idle engine serialise. A submission is persisted as `submitting` with its minted uuid before the
// `user` frame is written, becomes `released` at the engine's `command_lifecycle` for that uuid, and leaves the list
// at the `turn.ended` naming it or at the process's exit (retired `interrupted`, never re-sent). The release rule: a
// main-lane, non-receipt `turn.ended` of a human turn submits the head while the queue is not paused; an
// engine-initiated turn (`task-notification`) releases nothing. A submission a crash interrupted comes back as the
// `uncertain` head of a paused queue for the human to re-send or remove. Steer bypasses the queue with `priority:
// 'now'`. Every change is saved through the store before `onChange` fires. Releases and pauses are journaled as
// `meta queue` rows and the queue's warnings as `meta notice` rows (the normaliser maps those to `notice.posted`).
import { randomUUID } from 'node:crypto';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { SendContentSchema, type QueueEntry, type QueueState, type SendContent, type SessionStateStore } from '@shared/engine/session-state-store';
import type { UserInputFrame } from '@shared/wire/frames';

export const ACK_TIMEOUT_MS = 5_000;

export type ReleaseTrigger = 'send' | 'turn_ended' | 'resume';
export type PauseReason = 'user' | 'interrupt' | 'write_failed' | 'uncertain' | 'exit';
export type ExitKind = 'quit' | 'stop' | 'archive' | 'crash' | 'unknown';

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
  private loaded = false; // recover() ran: before it the queue owns nothing and must never overwrite the stored one
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly log: (message: string) => void;

  constructor(private readonly deps: MessageQueueDeps) {
    this.log = deps.log ?? ((message) => console.warn(`[engine-host ${deps.appSessionId} queue] ${message}`));
  }

  get state(): QueueState {
    return structuredClone({ entries: this.entries, paused: this.paused });
  }

  // A turn is open, or an entry is `submitting`, or a `released` entry's turn has not ended.
  get busy(): boolean {
    return this.deps.turnOpen() || this.entries.some((e) => e.state !== 'queued');
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
    this.loaded = true;
    this.settleAfterExit();
    await this.persist();
  }

  async send(content: SendContent): Promise<{ entry: QueueEntry; disposition: 'sent' | 'queued' }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const entry: QueueEntry = { queueId: randomUUID(), appSessionId: this.deps.appSessionId, content, createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false };
    const submitNow = !this.busy && this.queuedCount === 0; // FIFO: a send never overtakes an entry already waiting
    this.entries.push(entry);
    if (!submitNow) {
      await this.persist();
      return { entry: structuredClone(entry), disposition: 'queued' };
    }
    const sent = await this.submit(entry, 'send');
    return { entry: structuredClone(entry), disposition: sent ? 'sent' : 'queued' };
  }

  async edit(queueId: string, content: SendContent): Promise<QueueEntry> {
    this.checkContent(content);
    const entry = this.queued(queueId);
    entry.content = content;
    entry.uncertain = false; // an edit is the human's decision about an uncertain entry
    await this.persist();
    return structuredClone(entry);
  }

  async remove(queueId: string): Promise<void> {
    const entry = this.queued(queueId);
    this.entries = this.entries.filter((e) => e !== entry);
    await this.persist();
  }

  // The composer's Resume is setPaused(false), which also submits the head when the session is not busy.
  async setPaused(paused: boolean): Promise<void> {
    if (paused) return this.pause('user');
    if (this.paused) {
      this.paused = false;
      this.journal({ event: 'queue', action: 'resume', reason: 'user' });
      await this.persist();
    }
    await this.releaseHead('resume');
  }

  async pause(reason: PauseReason): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    this.journal({ event: 'queue', action: 'pause', reason });
    await this.persist();
  }

  // Steer: written at once with the engine queue's highest priority, never entering the app queue (§4.2).
  async steer(content: SendContent): Promise<{ messageUuid: MessageUuid }> {
    this.checkContent(content);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const uuid = randomUUID() as MessageUuid;
    await this.deps.write({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
    return { messageUuid: uuid };
  }

  // A queued entry steered out of the queue; it goes back to its place when the write fails.
  async promote(queueId: string): Promise<{ messageUuid: MessageUuid }> {
    const entry = this.queued(queueId);
    if (!this.deps.canWrite()) throw new QueueEntryError('the session is not ready');
    const index = this.entries.indexOf(entry);
    this.entries.splice(index, 1);
    try {
      const result = await this.steer(entry.content);
      await this.persist();
      return result;
    } catch (error) {
      this.entries.splice(Math.min(index, this.entries.length), 0, entry);
      throw error;
    }
  }

  // submitting → released: the engine acknowledges every stdin user frame with command_lifecycle (pass2/dialogs 5–6).
  onLifecycle(event: Extract<SessionEvent, { kind: 'command.lifecycle' }>): void {
    const entry = this.entries.find((e) => e.state === 'submitting' && e.messageUuid === event.commandUuid);
    if (!entry) return; // a steer, the plan sequence's frames, or an entry already retired (a late `cancelled`)
    entry.state = 'released';
    this.clearAck(entry.queueId);
    void this.persist();
  }

  // The release rule. Entries the turn names leave the list (a `submitting` one too: a result naming it is proof of
  // delivery); then a human turn's end submits the head unless paused. Echo receipts and child lanes are not turns.
  async onTurnEnded(event: Extract<SessionEvent, { kind: 'turn.ended' }>): Promise<void> {
    if (event.isEchoReceipt || event.parentToolUseId !== null) return;
    const named = new Set<string>(event.userMessageUuids);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => {
      const done = e.state !== 'queued' && e.messageUuid !== null && named.has(e.messageUuid);
      if (done) this.clearAck(e.queueId);
      return !done;
    });
    if (this.entries.length !== before) await this.persist();
    if (event.origin === 'human' || event.origin === null) await this.releaseHead('turn_ended');
  }

  // At the process's exit: every `released` entry no turn.ended named is retired `interrupted`; a `submitting` entry
  // takes the recovery path; an exit nobody asked for pauses a non-empty queue (Exit policy). The rows are journaled before
  // the returned promise's persist, so the session can call this right before it writes the exit row.
  onProcessExited(reason: ExitKind): Promise<void> {
    for (const queueId of [...this.ackTimers.keys()]) this.clearAck(queueId);
    if (!this.loaded) return Promise.resolve(); // the process never reached recovery: the stored queue stays as it was
    this.settleAfterExit();
    // only when something is left to hold back: a paused empty queue would silently hold the resumed session's next queue
    if ((reason === 'crash' || reason === 'unknown') && !this.paused && this.entries.length > 0) {
      this.paused = true;
      this.journal({ event: 'queue', action: 'pause', reason: 'exit' });
    }
    return this.persist();
  }

  dispose(): void {
    for (const queueId of [...this.ackTimers.keys()]) this.clearAck(queueId);
  }

  // ---------------------------------------------------------------------------------------------------------------------

  private settleAfterExit(): void {
    const uncertain: QueueEntry[] = [];
    const kept: QueueEntry[] = [];
    for (const entry of this.entries) {
      if (entry.state === 'released') {
        this.notice(`queue:interrupted:${entry.queueId}`, 'A message was accepted, but the session ended before it was answered. Re-send it if you still want an answer.');
      } else if (entry.state === 'submitting') {
        uncertain.push({ ...entry, state: 'queued', messageUuid: null, submittedAt: null, uncertain: true });
        this.notice(`queue:uncertain:${entry.queueId}`, 'A message may not have been delivered before the session ended. Check the transcript, then resume the queue to send it or remove it.');
      } else {
        kept.push(entry);
      }
    }
    this.entries = [...uncertain, ...kept];
    if (uncertain.length > 0 && !this.paused) {
      this.paused = true;
      this.journal({ event: 'queue', action: 'pause', reason: 'uncertain' });
    }
  }

  private async releaseHead(trigger: ReleaseTrigger): Promise<void> {
    if (this.paused || this.busy || !this.deps.canWrite()) return;
    const head = this.entries.find((e) => e.state === 'queued');
    if (head) await this.submit(head, trigger);
  }

  // queued → submitting (persisted) → the frame written; true when it reached the pipe.
  private async submit(entry: QueueEntry, trigger: ReleaseTrigger): Promise<boolean> {
    const uuid = randomUUID() as MessageUuid;
    Object.assign(entry, { state: 'submitting', messageUuid: uuid, submittedAt: new Date().toISOString(), uncertain: false });
    await this.persist();
    const current = () => entry.state === 'submitting' && entry.messageUuid === uuid && this.entries.includes(entry);
    if (!current()) return false; // the process exited during the persist; recovery already took the entry
    if (!this.deps.canWrite()) {
      this.revert(entry);
      await this.persist();
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
          this.paused = true;
          this.journal({ event: 'queue', action: 'pause', reason: 'write_failed' });
        }
        await this.persist();
      }
      return false;
    }
    if (current()) this.startAck(entry, uuid);
    return true;
  }

  private revert(entry: QueueEntry): void {
    Object.assign(entry, { state: 'queued', messageUuid: null, submittedAt: null });
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

  private notice(key: string, text: string): void {
    this.journal({ event: 'notice', level: 'warning', key, text });
  }

  private journal(frame: Record<string, unknown>): void {
    try {
      this.deps.meta(frame);
    } catch (error) {
      this.log(`${String(frame.event)} row not journaled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Saved through the store, then announced with what was saved.
  private async persist(): Promise<void> {
    const snapshot = this.state;
    try {
      await this.deps.store.saveQueue(this.deps.appSessionId, snapshot);
    } catch (error) {
      this.log(`queue not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      this.deps.onChange(snapshot);
    } catch (error) {
      this.log(`queue listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
