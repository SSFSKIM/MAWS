// Main's owner channel (X18, X1; the P2-C document, Design §5 and §6; M4). It listens to the engine host's event batches
// beside the attention service and keeps, in the index, every question and essential the agents marked, with its state:
// - Marks. Each finalized main-thread text block's questions and essentials are stored once by their id (a replay, a
//   resync burst or a backfill changes nothing). A mark at or after the session's watermark may raise an item; one that
//   came live from a MAWS process while the lane was on and no terminal or job held the session may notify. A superseding
//   block, a retraction and a rewind retire the marks of the messages they take away (a rewind to a prompt this run did
//   not see, by the transcript's chain).
// - Answers. The renderer reports the seam's result (`ownerChannel.answered`); the answer then follows its members
//   (./answers.ts) through the host's `queue.transition` rows and the engine's `command.lifecycle`, from a ten-minute log
//   of both for a report that arrives late. A member the transcript must settle (an exit's uncertain submission) is read
//   from it. Each answer sent ("Answer again", a follow-up Reply) keeps its own text and members; the newest the engine
//   took is the question's answer, kept in the table beside any answer still on its way. An older answer stays the
//   question's: followed to its end, and kept once taken, so its prompt is never read as another question's answer.
//   `ownerChannel.cancel` withdraws the question's queued entries and pending steers through the host.
// - Recovery. Main hears nothing while the host is away (an app closed or crashed, a reconnect): at start and at every
//   reconnect, each session holding an answer on its way reads the host's prompt record (`session.promptHistory`) and
//   folds it before anything else, then reads the queue's snapshot as positive evidence; what neither settles, and no
//   withdrawal a complete record shows pending explains, is read from the transcript, and what that cannot settle reads
//   `unconfirmed`, never a guess. A read that fails leaves the session waiting, and is tried again after a backoff or at
//   the next reconnect.
// - Legacy recognition. A human prompt the engine took that answers `Answering "<head>": …` settles the one question of
//   the session with that head (an answer given in a terminal through the doperpowers mod, or one whose report never
//   arrived), unless the prompt is itself a member of an answer. While the session waits for its recovery read, whose
//   prompt it is cannot be known yet: the prompt is held and read once the read is folded.
// - Projection. While the lane is on, the stored marks project into the attention service (Design §5's table): a restart,
//   a change of holder and a lane switch re-project silently. The marks table is the one truth.
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { SessionRecord } from '@shared/graph/session';
import { answersOf, answerText } from '@shared/owner/answer';
import { markIdOf, type MarkId } from '@shared/owner/marks';
import type { AnswerMember, OwnerChannelState, OwnerMark, QuestionState } from '@shared/owner/state';
import { TO_HUMAN_GRAMMAR_VERSION } from '@shared/owner/to-human-parser';
import type { SessionStore } from '../index/sessions';
import type { HostDispatch } from '../ipc/router';
import { hostCall } from '../sessions/context';
import { applyEvent, newAnswer, onItsWay, settleAnswers, statusOf, storedOf, type Answer, type PromptEvent } from './answers';
import { laneOn } from './launch';
import { pendingOf } from './mods';
import { blockMarksOf, ownerItemsOf } from './projection';
import type { MarkUpdate, OwnerChannelStore, OwnerMarkRow } from './store';

export type AnsweredInput = CommandInput<'ownerChannel.answered'>;
type CancelOutcome = CommandOutput<'ownerChannel.cancel'>['outcome'];

// The late-report log (Design §6): per session, what the host and the engine said of prompts in the last ten minutes.
export const LOG_WINDOW_MS = 10 * 60_000;
export const LOG_MAX = 2048;
const RECENT_MAX = 2048; // the prompts and user messages remembered per session (legacy recognition, a rewind's target)
// A failed recovery read is tried again after this, doubling up to the cap, while the host streams (and at every reconnect).
const RECOVERY_RETRY_MS = 1000;
const RECOVERY_RETRY_MAX_MS = 60_000;

export interface OwnerChannelServiceDeps {
  store: OwnerChannelStore;
  sessions: Pick<SessionStore, 'get' | 'onChange'>; // the holder (foreign-held), the archive and the engine session id
  appEnabled: () => boolean; // settings' mods.toHuman.enabled
  attention: { setOwnerItems(appSessionId: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]): void };
  dispatch: HostDispatch;
  // the first of `uuids` the session's transcript shows the engine took (./prompt-state.ts), or null
  transcriptEvidence: (appSessionId: AppSessionId, uuids: readonly MessageUuid[]) => Promise<MessageUuid | null>;
  // the uuids at and below `uuid` on the session's transcript chain (./prompt-state.ts), or null: what a rewind took
  transcriptChain: (appSessionId: AppSessionId, uuid: MessageUuid) => Promise<ReadonlySet<string> | null>;
  emit: (name: 'ownerChannel.changed', payload: { appSessionId: AppSessionId; state: OwnerChannelState }) => void;
  now?: () => string; // ISO-8601; the tests' clock
  log?: (message: string) => void;
  recoveryRetryMs?: number; // the first retry's delay after a failed recovery read
}

// A send of a question's answer that did not go out, as the seam said (X22): refused in its words, or held by a trust or
// relay card until its continuation (the seam's 'trust' | 'relay'). In memory only (Design §6's table).
interface Unsent {
  disposition: 'refused' | 'held';
  reason: string;
}

interface SessionLive {
  log: { event: PromptEvent; at: number }[];
  // per question with an answer on its way (queued or unconfirmed, superseded or not), all its answers, oldest first
  answers: Map<MarkId, Answer[]>;
  unsent: Map<MarkId, Unsent>; // the last send of an unanswered question that did not go out (refused or held)
  prompts: Map<MessageUuid, { text: string; at: string }>; // human prompts carrying an answer line, written and not yet taken
  userAt: Map<MessageUuid, string>; // when each human prompt was written or read back (a rewind's target)
  checking: Set<MessageUuid>; // uuids whose transcript evidence is being read
  heldPrompts: { uuid: MessageUuid; text: string; at: string }[]; // taken while the recovery read was out (legacy recognition)
  evictedAt: number; // when the last event the log let go had arrived: an event since then is still in the log
  refold: boolean; // a report the log could not cover arrived: the recovery read folds again before the gate opens
}

const isForeign = (record: SessionRecord | null) => record !== null && (record.holder.kind === 'terminal' || record.holder.kind === 'background_job');
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class OwnerChannelService {
  private readonly live = new Map<AppSessionId, SessionLive>();
  private readonly recovering = new Set<AppSessionId>(); // until its recovery read is folded, no event reaches its answers
  private connection = 0; // counts the host's departures: a read begun before one cannot open the gate after it
  private readonly reading = new Map<AppSessionId, number>(); // the connection each session's recovery read was begun in
  private streamingSince = Number.POSITIVE_INFINITY; // since when the host has streamed without a break: every event since is heard
  private readonly retries = new Map<AppSessionId, { count: number; timer: ReturnType<typeof setTimeout> | null }>();
  private readonly held = new Map<AppSessionId, string>(); // the last holder and archive facts each session projected under
  private readonly pending = new Set<Promise<unknown>>();
  private streaming = false;
  private offRecords: (() => void) | null = null;
  private readonly now: () => string;
  private readonly log: (message: string) => void;
  private readonly retryMs: number;

  constructor(private readonly deps: OwnerChannelServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.log = deps.log ?? ((message) => console.warn(`[owner] ${message}`));
    this.retryMs = deps.recoveryRetryMs ?? RECOVERY_RETRY_MS;
  }

  // The answers on their way come back from the table and every session re-projects silently; until the host streams,
  // each session holding one waits for its recovery read.
  start(opts: { streaming: boolean }): void {
    for (const row of this.deps.store.openAnswers()) {
      const answers = row.answerAttempts.map(newAnswer);
      if (answers.some(onItsWay)) this.liveOf(row.appSessionId).answers.set(row.id as MarkId, answers);
    }
    for (const appSessionId of this.deps.store.markedSessions()) this.project(appSessionId, true);
    this.offRecords = this.deps.sessions.onChange((record) => this.recordChanged(record));
    for (const [appSessionId, live] of this.live) if (live.answers.size > 0) this.recovering.add(appSessionId);
    this.streaming = opts.streaming;
    if (opts.streaming) this.track(this.hostStreaming());
  }

  stop(): void {
    this.offRecords?.();
    this.offRecords = null;
    this.cancelRetries();
  }

  // Resolves once every read this service started (recoveries, transcript evidence) has settled.
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  // The engine host left `ready`: main hears nothing until it streams again.
  hostDown(): void {
    this.streaming = false;
    this.connection += 1;
    this.cancelRetries(); // the next connection reads again
    for (const [appSessionId, live] of this.live) if (live.answers.size > 0) this.recovering.add(appSessionId);
  }

  // The engine host streams again (or for the first time): every session waiting reads its prompt record (unless a read
  // begun in this connection is still out).
  async hostStreaming(): Promise<void> {
    this.streaming = true;
    this.streamingSince = Date.parse(this.now());
    await Promise.all([...this.recovering].filter((appSessionId) => this.reading.get(appSessionId) !== this.connection).map((appSessionId) => this.recover(appSessionId)));
  }

  onEvents(appSessionId: AppSessionId, events: readonly SessionEvent[]): void {
    const live = this.liveOf(appSessionId);
    const touched = new Set<MarkId>();
    let marked = false;
    for (const event of events) {
      if (event.parentToolUseId !== null) continue; // the main conversation's
      switch (event.kind) {
        case 'assistant.block.complete':
          if (event.supersedes.length > 0) marked = this.retire(appSessionId, (mark) => event.supersedes.includes(mark.messageUuid as MessageUuid)) || marked;
          marked = this.derive(appSessionId, event) || marked;
          break;
        case 'boundary.retraction':
          marked = this.retire(appSessionId, (mark) => event.retractedMessageUuids.includes(mark.messageUuid as MessageUuid)) || marked;
          break;
        case 'boundary.rewind':
          marked = this.rewind(appSessionId, event) || marked;
          break;
        case 'turn.started':
          if (event.userMessageUuid !== null && !live.userAt.has(event.userMessageUuid)) remember(live.userAt, event.userMessageUuid, event.at);
          break;
        case 'user.message':
          marked = this.prompt(appSessionId, event) || marked;
          break;
        case 'queue.transition':
        case 'command.lifecycle': {
          this.logEvent(live, event);
          if (!this.recovering.has(appSessionId)) {
            const seen = () => live.log.slice(0, -1).map((entry) => entry.event); // what came before this event
            for (const [markId, answers] of live.answers) for (const answer of answers) if (applyEvent(answer, event, seen)) touched.add(markId);
          }
          if (event.kind === 'command.lifecycle') marked = this.taken(appSessionId, event) || marked;
          break;
        }
        default:
          break;
      }
    }
    for (const markId of touched) this.persist(appSessionId, markId);
    if (marked || touched.size > 0) this.changed(appSessionId);
  }

  // The seam's result for a question's answer (Design §6, "The card's send").
  answered(input: AnsweredInput): void {
    const appSessionId = input.appSessionId as AppSessionId;
    const markId = input.markId as MarkId;
    const row = this.deps.store.mark(markId);
    if (row === null || row.appSessionId !== appSessionId || row.kind !== 'need-input') throw new Error(`unknown question: ${markId}`);
    if (row.state === 'retired') return;
    const live = this.liveOf(appSessionId);
    // a report made again (the card's Record again) or after the prompt's own answer is known: an id that already
    // carries one of this question's answers (on its way, delivered, legacy recognition's) adds no answer and changes no
    // state. Legacy recognition's answer only learns that it was the card's (the engine took the prompt before the
    // report arrived), so the question's answer keeps the card's origin.
    const ids = [input.messageUuid, input.queueId].filter((id) => id !== undefined);
    if (ids.length > 0) {
      const answers = this.answersOf(live, row);
      const known = answers.find((answer) => answer.members.some((m) => ids.includes(m.id)));
      if (known !== undefined) {
        if (known.origin === 'legacy') {
          known.origin = input.origin;
          live.answers.set(markId, answers);
          this.persist(appSessionId, markId);
          this.changed(appSessionId);
        }
        return;
      }
    }
    live.unsent.delete(markId);
    // nothing went out: a refusal, or a card holding the message until its continuation (never an answer to follow, so
    // never the identifier-free `unconfirmed`); the question keeps its state and says why
    if (input.disposition === 'refused' || input.disposition === 'held') {
      live.unsent.set(markId, { disposition: input.disposition, reason: input.reason ?? input.disposition });
      this.changed(appSessionId);
      return;
    }
    const members: AnswerMember[] = [];
    // the first member is the seam's: the uuid it sent or steered, the entry it queued; whether the send started the
    // session first changes nothing, and a result carrying neither id is unconfirmed
    if (input.messageUuid !== undefined && input.disposition !== 'queued') members.push({ kind: 'uuid', id: input.messageUuid, life: 'alive' });
    if (input.queueId !== undefined && input.disposition === 'queued') members.push({ kind: 'entry', id: input.queueId, life: 'alive' });
    // a new answer of its own: one sent before it (answered again while unconfirmed, or a delivered answer's follow-up)
    // keeps its own text and members, for its evidence to settle it alone
    // the recovery read reaches back from when the prompt was sent (the seam's call), or else from now
    const sent = input.sentAt === undefined ? Date.parse(this.now()) : Math.min(Date.parse(input.sentAt), Date.parse(this.now()));
    const answer = newAnswer({ text: input.text, origin: input.origin, members, unconfirmed: members.length === 0, reportedAt: new Date(sent).toISOString() });
    live.answers.set(markId, [...this.answersOf(live, row), answer]);
    // the report reaches main after the seam answered: what happened since is in the log, replayed in order, unless the
    // prompt was sent before the log's reach (a report made again a while later; the host not streaming throughout).
    // Such an answer, like a session still waiting for its recovery read, is folded from the host's prompt record
    // since then, which is what §6's recovery read is for: nothing is concluded from the log's silence
    const covered = input.sentAt === undefined || sent > Math.max(this.streamingSince, live.evictedAt);
    if (!this.streaming || !covered) this.recovering.add(appSessionId);
    if (!this.recovering.has(appSessionId)) {
      const seen = live.log.map((entry) => entry.event);
      seen.forEach((event, i) => applyEvent(answer, event, () => seen.slice(0, i)));
    } else if (!covered) {
      live.refold = true;
      if (this.streaming && this.reading.get(appSessionId) !== this.connection) this.track(this.recover(appSessionId));
    }
    this.persist(appSessionId, markId);
    this.changed(appSessionId);
  }

  // Design §6, "Cancel": the question's answers on their way, each queued entry through `session.queue.remove` and each
  // pending steer through `session.steer.cancel`. A failed command leaves the answers as they were.
  async cancel(input: CommandInput<'ownerChannel.cancel'>): Promise<{ outcome: CancelOutcome }> {
    const appSessionId = input.appSessionId as AppSessionId;
    const markId = input.markId as MarkId;
    const answers = (this.live.get(appSessionId)?.answers.get(markId) ?? []).filter(onItsWay);
    if (answers.length === 0) return { outcome: 'not_queued' };
    const carried = answers.filter((answer) => answer.members.some((m) => m.life === 'alive'));
    const alive = carried.flatMap((answer) => answer.members.filter((m) => m.life === 'alive'));
    if (alive.length === 0) return { outcome: answers.some((answer) => answer.members.some((m) => m.life !== 'dead')) ? 'already_delivering' : 'not_queued' };
    const queue = await hostCall(this.deps.dispatch, 'session.queue.list', { appSessionId });
    let delivering = false;
    try {
      for (const member of alive) {
        if (member.kind === 'entry') {
          const entry = queue.entries.find((e) => e.queueId === member.id);
          if (entry === undefined) continue;
          if (entry.state !== 'queued') {
            delivering = true;
            continue;
          }
          await hostCall(this.deps.dispatch, 'session.queue.remove', { appSessionId, queueId: member.id });
          member.life = 'dead'; // the removal's success is the kill (a queue no process holds writes no row)
        } else if (queue.steers?.some((steer) => steer.messageUuid === member.id)) {
          const { outcome } = await hostCall(this.deps.dispatch, 'session.steer.cancel', { appSessionId, messageUuid: member.id as MessageUuid });
          if (outcome === 'cancelled') member.life = 'dead';
          else delivering = true;
        } else delivering = true; // submitted, not a pending steer: on its way
      }
    } finally {
      this.persist(appSessionId, markId);
      this.changed(appSessionId);
    }
    return { outcome: !delivering && carried.every((answer) => statusOf(answer) === 'unanswered') ? 'cancelled' : 'already_delivering' };
  }

  markRead(input: CommandInput<'ownerChannel.markRead'>): void {
    const appSessionId = input.appSessionId as AppSessionId;
    const at = this.now();
    let read = false;
    for (const mark of this.deps.store.marks(appSessionId)) {
      if (mark.kind !== 'essential' || mark.state !== 'unread' || (input.markIds !== 'all' && !input.markIds.includes(mark.id as MarkId))) continue;
      this.deps.store.updateMark(mark.id, { state: 'read', readAt: at, stateChangedAt: at });
      read = true;
    }
    if (read) this.changed(appSessionId);
  }

  state(appSessionId: AppSessionId): OwnerChannelState {
    const row = this.deps.store.session(appSessionId);
    const override = row?.override ?? 'inherit';
    const on = laneOn(this.deps.appEnabled(), override);
    const unsent = this.live.get(appSessionId)?.unsent;
    return {
      appSessionId,
      lane: {
        on, override, applied: row?.applied ?? null, pending: pendingOf(row, on),
        mismatch: row?.styleMismatch && row.style !== null && row.observedStyle !== null ? { resolved: row.style, observed: row.observedStyle } : null,
      },
      marks: this.deps.store.marks(appSessionId).map((mark) => ownerMarkOf(mark, unsent?.get(mark.id as MarkId))),
    };
  }

  // The lane switched (the app's switch, or one session's override): presentation and items follow at once, silently.
  laneChanged(appSessionId?: AppSessionId): void {
    for (const id of appSessionId === undefined ? this.deps.store.markedSessions() : [appSessionId]) {
      this.project(id, true);
      this.emitState(id);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------

  // A question's answers: in memory while one is on its way, else as the table keeps them.
  private answersOf(live: SessionLive, row: OwnerMarkRow): Answer[] {
    return live.answers.get(row.id as MarkId) ?? row.answerAttempts.map(newAnswer);
  }

  private liveOf(appSessionId: AppSessionId): SessionLive {
    let live = this.live.get(appSessionId);
    if (!live) this.live.set(appSessionId, (live = { log: [], answers: new Map(), unsent: new Map(), prompts: new Map(), userAt: new Map(), checking: new Set(), heldPrompts: [], evictedAt: Number.NEGATIVE_INFINITY, refold: false }));
    return live;
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => this.log(messageOf(error))).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private logEvent(live: SessionLive, event: PromptEvent): void {
    const now = Date.parse(this.now());
    live.log.push({ event, at: now });
    while (live.log.length > LOG_MAX || (live.log.length > 0 && live.log[0]!.at < now - LOG_WINDOW_MS)) live.evictedAt = live.log.shift()!.at;
  }

  // A holder or archive change re-projects the session, silently (a terminal took it over, or MAWS took it back).
  private recordChanged(record: SessionRecord): void {
    const facts = `${isForeign(record)}:${record.archived}`;
    const before = this.held.get(record.appId);
    if (before === undefined || before === facts) {
      this.held.set(record.appId, facts);
      return;
    }
    this.held.set(record.appId, facts);
    this.project(record.appId, true);
  }

  // The block's questions and essentials, stored once each (Design §5, "Derivation" and "The watermark").
  private derive(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'assistant.block.complete' }>): boolean {
    const marks = blockMarksOf(event);
    if (marks.length === 0) return false;
    let added = false;
    try {
      const enabledAt = this.deps.store.session(appSessionId)?.enabledAt ?? null;
      const record = this.deps.sessions.get(appSessionId);
      const live = event.seq !== null && laneOn(this.deps.appEnabled(), this.deps.store.override(appSessionId)) && !isForeign(record);
      const item = enabledAt !== null && Date.parse(event.at) >= Date.parse(enabledAt);
      for (const mark of marks) {
        added =
          this.deps.store.putMark({
            id: markIdOf(appSessionId, mark.kind, mark.anchor), appSessionId, kind: mark.kind, messageUuid: mark.anchor.messageUuid, blockIndex: mark.anchor.blockIndex,
            span: mark.anchor.span, grammar: TO_HUMAN_GRAMMAR_VERSION, head: mark.head, at: event.at, item, live, state: mark.kind === 'need-input' ? 'unanswered' : 'unread',
            answerText: null, answerOrigin: null, answerMembers: [], answeredAt: null, answerAttempts: [], readAt: null, stateChangedAt: event.at,
          }) || added;
      }
    } catch (error) {
      this.log(`the marks of ${appSessionId} could not be stored: ${messageOf(error)}`);
    }
    return added;
  }

  // Retires the session's marks `gone` names, and forgets their answers.
  private retire(appSessionId: AppSessionId, gone: (mark: OwnerMarkRow) => boolean): boolean {
    const at = this.now();
    let retired = false;
    for (const mark of this.deps.store.marks(appSessionId)) {
      if (mark.state === 'retired' || !gone(mark)) continue;
      this.deps.store.updateMark(mark.id, { state: 'retired', stateChangedAt: at });
      this.live.get(appSessionId)?.answers.delete(mark.id as MarkId);
      retired = true;
    }
    return retired;
  }

  // A rewind takes the target prompt and everything after it off the chain: the marks from its time on retire. A target
  // this run does not remember (a restart, an entry the bounded map let go) is found on the transcript's chain, and the
  // marks of the messages below it retire; only a transcript that cannot place it falls back to the time of a marked
  // message the rewind kept, and failing that the marks stay. Only the marks standing at the rewind are considered: a
  // message after it is never the rewind's.
  private rewind(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'boundary.rewind' }>): boolean {
    const target = this.liveOf(appSessionId).userAt.get(event.targetMessageUuid);
    if (target !== undefined) return this.retire(appSessionId, (mark) => Date.parse(mark.at) >= Date.parse(target));
    const standing = new Set(this.deps.store.marks(appSessionId).filter((mark) => mark.state !== 'retired').map((mark) => mark.id));
    this.track(
      this.deps.transcriptChain(appSessionId, event.targetMessageUuid).then((gone) => {
        let retired: boolean;
        if (gone !== null) retired = this.retire(appSessionId, (mark) => standing.has(mark.id) && gone.has(mark.messageUuid));
        else {
          const kept = event.precedingAssistantUuid === null ? undefined : this.deps.store.marks(appSessionId).find((mark) => mark.messageUuid === event.precedingAssistantUuid);
          if (kept === undefined) {
            this.log(`${appSessionId}: a rewind to ${event.targetMessageUuid}, a prompt neither this run nor the transcript places; its marks stay`);
            return;
          }
          retired = this.retire(appSessionId, (mark) => standing.has(mark.id) && Date.parse(mark.at) > Date.parse(kept.at));
        }
        if (retired) this.changed(appSessionId);
      }),
    );
    return false;
  }

  // A human prompt: when it was written (a rewind's target), and, when it carries an answer line, held for the engine's
  // acceptance; read back from disk, the transcript's record is that acceptance.
  private prompt(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'user.message' }>): boolean {
    if (event.messageUuid === null || event.bash !== null || event.isSynthetic || (event.origin !== 'human' && event.origin !== null)) return false;
    const live = this.liveOf(appSessionId);
    if (!live.userAt.has(event.messageUuid)) remember(live.userAt, event.messageUuid, event.at);
    const text = typeof event.content === 'string' ? event.content : event.content.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n');
    if (answersOf(text).length === 0) return false;
    if (event.seq === null) return this.recognize(appSessionId, event.messageUuid, text, event.at);
    remember(live.prompts, event.messageUuid, { text, at: event.at });
    return false;
  }

  // The engine's word on a prompt it was written: taken (started, completed) or not.
  private taken(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'command.lifecycle' }>): boolean {
    const live = this.liveOf(appSessionId);
    const prompt = live.prompts.get(event.commandUuid);
    if (prompt === undefined || event.state === 'queued') return false;
    live.prompts.delete(event.commandUuid);
    return event.state === 'started' || event.state === 'completed' ? this.recognize(appSessionId, event.commandUuid, prompt.text, prompt.at) : false;
  }

  // A taken prompt for legacy recognition: at once, or, while the session waits for its recovery read (whose rows may
  // make it an answer's member), held until the read is folded (§6's recovery barrier).
  private recognize(appSessionId: AppSessionId, uuid: MessageUuid, text: string, at: string): boolean {
    if (!this.recovering.has(appSessionId)) return this.legacy(appSessionId, uuid, text, at);
    const held = this.liveOf(appSessionId).heldPrompts;
    held.push({ uuid, text, at });
    if (held.length > RECENT_MAX) held.shift();
    return false;
  }

  // Legacy recognition (Design §6): each answer line settles the one question of the session with its head, asked before
  // the prompt and still unanswered or unconfirmed; never two questions with one head, never a prompt that belongs to an
  // answer (on its way, superseded or taken). The prompt becomes the question's newest taken answer.
  private legacy(appSessionId: AppSessionId, uuid: MessageUuid, text: string, at: string): boolean {
    const live = this.liveOf(appSessionId);
    const marks = this.deps.store.marks(appSessionId);
    const member = (members: readonly AnswerMember[]) => members.some((m) => m.kind === 'uuid' && m.id === uuid);
    const carries = [...live.answers.values()].flat().some((answer) => member(answer.members));
    if (carries || marks.some((mark) => member(mark.answerMembers) || mark.answerAttempts.some((answer) => member(answer.members)))) return false;
    let settled = false;
    for (const { head, answer } of answersOf(text)) {
      const asked = marks.filter((mark) => mark.kind === 'need-input' && mark.state !== 'retired' && mark.head === head && Date.parse(mark.at) <= Date.parse(at));
      if (asked.length !== 1 || (asked[0]!.state !== 'unanswered' && asked[0]!.state !== 'unconfirmed')) continue;
      const markId = asked[0]!.id as MarkId;
      const taken = newAnswer({ text: answerText(head, answer), origin: 'legacy', members: [{ kind: 'uuid', id: uuid, life: 'alive' }], unconfirmed: false, reportedAt: this.now(), deliveredAt: at });
      live.answers.set(markId, [...this.answersOf(live, asked[0]!), taken]);
      live.unsent.delete(markId);
      this.persist(appSessionId, markId);
      settled = true;
    }
    return settled;
  }

  // Writes a question's answers to its mark (./answers.ts, `settleAnswers`): the newest the engine took becomes its
  // delivered answer, the ones on their way after it are kept beside it, and the newest of those is what the card reads.
  // With none after it the question reads its delivered answer (a follow-up that never arrived leaves it answered as it
  // was), else unanswered. Older answers are kept as `settleAnswers` says; memory holds a question's answers only while
  // one is on its way. A member whose fate only the transcript can tell is read from it.
  private persist(appSessionId: AppSessionId, markId: MarkId): void {
    const live = this.liveOf(appSessionId);
    const answers = live.answers.get(markId);
    if (answers === undefined) return;
    const row = this.deps.store.mark(markId);
    if (row === null || row.state === 'retired') {
      live.answers.delete(markId);
      return;
    }
    const { delivered, open, dead, kept } = settleAnswers(answers);
    const update: MarkUpdate = { answerAttempts: kept.map(storedOf), stateChangedAt: this.now() };
    if (delivered !== null) Object.assign(update, { answerText: delivered.text, answerOrigin: delivered.origin, answerMembers: delivered.members, answeredAt: delivered.deliveredAt });
    const shown = open.at(-1);
    update.state = shown !== undefined ? statusOf(shown) : delivered !== null || row.answerText !== null ? 'delivered' : 'unanswered';
    this.deps.store.updateMark(markId, update);
    if (update.state === 'unanswered') for (const answer of dead) if (answer.failed !== null) live.unsent.set(markId, { disposition: 'refused', reason: answer.failed.reason });
    const followed = kept.filter(onItsWay);
    if (followed.length === 0) live.answers.delete(markId);
    else live.answers.set(markId, kept);
    for (const answer of followed) this.evidence(appSessionId, markId, answer);
  }

  // Design §6: an `unknown` member (a submission an exit cut) is settled by the transcript: taken, delivered; not, dead.
  private evidence(appSessionId: AppSessionId, markId: MarkId, answer: Answer): void {
    const live = this.liveOf(appSessionId);
    const unknown = answer.members.filter((m) => m.kind === 'uuid' && m.life === 'unknown' && !live.checking.has(m.id as MessageUuid)).map((m) => m.id as MessageUuid);
    if (unknown.length === 0) return;
    for (const uuid of unknown) live.checking.add(uuid);
    this.track(
      this.deps.transcriptEvidence(appSessionId, unknown).then((taken) => {
        for (const uuid of unknown) live.checking.delete(uuid);
        if (!live.answers.get(markId)?.includes(answer)) return; // settled meanwhile
        if (taken !== null) answer.deliveredAt = this.now();
        else for (const member of answer.members) if (member.life === 'unknown' && unknown.includes(member.id as MessageUuid)) member.life = 'dead';
        this.persist(appSessionId, markId);
        this.changed(appSessionId);
      }),
    );
  }

  // Design §6, "Restarts and reconnects: the recovery read". Until a read is folded the session's gate stays closed: a
  // read that fails concludes nothing and is tried again (after a backoff while the host streams, and at the next
  // reconnect), and one the host's departure overtook leaves the gate to the next connection's read.
  private async recover(appSessionId: AppSessionId): Promise<void> {
    const connection = this.connection;
    const live = this.liveOf(appSessionId);
    this.reading.set(appSessionId, connection);
    try {
      // folded again while a report the log could not cover arrived during the read (its window reaches back further)
      while (live.answers.size > 0) {
        live.refold = false;
        await this.fold(appSessionId, live);
        if (!live.refold) break;
      }
    } catch (error) {
      this.log(`${appSessionId}: the recovery read failed; its answers wait for the next read: ${messageOf(error)}`);
      this.retryLater(appSessionId);
      return;
    } finally {
      if (this.reading.get(appSessionId) === connection) this.reading.delete(appSessionId);
    }
    if (connection !== this.connection) return;
    this.retries.delete(appSessionId);
    this.recovering.delete(appSessionId);
    // an answer reported while the read was out takes the log now (an event the fold applied is skipped by its id)
    const seen = live.log.map((entry) => entry.event);
    for (const answers of live.answers.values()) for (const answer of answers) seen.forEach((event, i) => applyEvent(answer, event, () => seen.slice(0, i)));
    const marks = [...live.answers.keys()];
    for (const markId of marks) this.persist(appSessionId, markId);
    // the prompts taken while the read was out, now that their members are known
    let settled = false;
    for (const prompt of live.heldPrompts.splice(0)) settled = this.legacy(appSessionId, prompt.uuid, prompt.text, prompt.at) || settled;
    if (marks.length > 0 || settled) this.changed(appSessionId);
  }

  // The host's prompt record since the oldest answer on its way, then what the live stream brought meanwhile (an event
  // both carry is applied once, by its id); then the queue's snapshot, positively. An answer neither places, and no
  // withdrawal a complete record shows pending explains, is read from the transcript and otherwise reads unconfirmed.
  // Nothing is decided from absence unless every read succeeded.
  private async fold(appSessionId: AppSessionId, live: SessionLive): Promise<void> {
    const all = () => [...live.answers.values()].flat();
    const since = new Date(Math.min(...all().filter(onItsWay).map((answer) => Date.parse(answer.reportedAt))) - LOG_WINDOW_MS).toISOString();
    const history = await hostCall(this.deps.dispatch, 'session.promptHistory', { appSessionId, since });
    const queue = await hostCall(this.deps.dispatch, 'session.queue.list', { appSessionId });
    const events = [...history.events, ...live.log.map((entry) => entry.event)];
    events.forEach((event, i) => {
      for (const answer of all()) applyEvent(answer, event, () => events.slice(0, i));
    });
    // an entry or a pending steer the snapshot shows is alive; a steer a complete record shows being withdrawn, with no
    // outcome row yet, is on its way too: its outcome row (`hold`, `cancel`, `giveback`, or `abandon` at an exit) settles
    // it. A record that is not complete may have lost that row, so there a withdrawal proves nothing.
    const shown = new Set<string>([...queue.entries.flatMap((e) => [e.queueId, ...(e.messageUuid === null ? [] : [e.messageUuid])]), ...(queue.steers ?? []).map((s) => s.messageUuid)]);
    const withdrawals = new Set(history.complete ? events.flatMap((e) => (e.kind === 'queue.transition' && e.action === 'withdraw' && e.messageUuid !== null ? [e.messageUuid as string] : [])) : []);
    const placed = (member: AnswerMember) => shown.has(member.id) || (member.life === 'withdrawing' && withdrawals.has(member.id));
    const reads: Promise<() => void>[] = [];
    for (const answer of all()) {
      if (statusOf(answer) === 'delivered') continue;
      for (const member of answer.members) if ((member.life === 'alive' || member.life === 'unknown') && shown.has(member.id)) member.life = 'alive';
      // a member still alive by the record but placed by neither the record's end nor the snapshot: what became of it is
      // read from the transcript, and an answer it cannot settle reads unconfirmed (an entry removed from a saved queue
      // no process held, which writes no row, for one)
      if (answer.members.some(placed)) continue;
      const unsettled = answer.members.filter((m) => m.life === 'alive' || m.life === 'withdrawing');
      if (unsettled.length === 0) continue;
      const uuids = unsettled.filter((m) => m.kind === 'uuid').map((m) => m.id as MessageUuid);
      reads.push(
        (uuids.length === 0 ? Promise.resolve(null) : this.deps.transcriptEvidence(appSessionId, uuids)).then((taken) => () => {
          if (taken !== null) answer.deliveredAt = this.now();
          else answer.unconfirmed = true;
        }),
      );
    }
    for (const settle of await Promise.all(reads)) settle();
  }

  private retryLater(appSessionId: AppSessionId): void {
    const retry = this.retries.get(appSessionId);
    if (!this.streaming || retry?.timer) return; // the next connection reads again, or a retry is already set
    const count = (retry?.count ?? 0) + 1;
    const timer = setTimeout(() => {
      this.retries.set(appSessionId, { count, timer: null });
      if (this.streaming && this.recovering.has(appSessionId) && this.reading.get(appSessionId) !== this.connection) this.track(this.recover(appSessionId));
    }, Math.min(RECOVERY_RETRY_MAX_MS, this.retryMs * 2 ** (count - 1)));
    (timer as { unref?: () => void }).unref?.();
    this.retries.set(appSessionId, { count, timer });
  }

  private cancelRetries(): void {
    for (const { timer } of this.retries.values()) if (timer !== null) clearTimeout(timer);
    this.retries.clear();
  }

  // After a change of the session's marks or answers: its items and its state.
  private changed(appSessionId: AppSessionId): void {
    this.project(appSessionId, false);
    this.emitState(appSessionId);
  }

  private emitState(appSessionId: AppSessionId): void {
    try {
      this.deps.emit('ownerChannel.changed', { appSessionId, state: this.state(appSessionId) });
    } catch (error) {
      this.log(`ownerChannel.changed for ${appSessionId} not emitted: ${messageOf(error)}`);
    }
  }

  // The session's items while its lane is on (none while off, or once archived); `silent` re-projects without any
  // notification (a restart, a holder change, a lane switch).
  private project(appSessionId: AppSessionId, silent: boolean): void {
    try {
      const record = this.deps.sessions.get(appSessionId);
      if (record !== null) this.held.set(appSessionId, `${isForeign(record)}:${record.archived}`);
      const on = record !== null && !record.archived && laneOn(this.deps.appEnabled(), this.deps.store.override(appSessionId));
      const { items, quiet } = on
        ? ownerItemsOf(appSessionId, this.deps.store.marks(appSessionId), { sessionId: (record?.engineSessionId ?? null) as SessionId | null, foreignHeld: isForeign(record) })
        : { items: [], quiet: [] };
      this.deps.attention.setOwnerItems(appSessionId, items, silent ? items.map((item) => item.id) : quiet);
    } catch (error) {
      this.log(`the items of ${appSessionId} could not be projected: ${messageOf(error)}`);
    }
  }
}

// A question's state as main reports it (src/shared/owner/state.ts).
function ownerMarkOf(mark: OwnerMarkRow, unsent: Unsent | undefined): OwnerMark {
  const base = { id: mark.id as MarkId, kind: mark.kind, anchor: { messageUuid: mark.messageUuid as MessageUuid, blockIndex: mark.blockIndex, span: mark.span }, head: mark.head, at: mark.at, item: mark.item };
  if (mark.kind === 'essential') return { ...base, essential: { state: mark.state === 'read' || mark.state === 'retired' ? mark.state : 'unread', readAt: mark.readAt } };
  let question: QuestionState;
  switch (mark.state) {
    case 'queued':
    case 'unconfirmed': {
      const shown = mark.answerAttempts.at(-1); // the newest answer, on its way (never a legacy one: it is born taken)
      question = { state: mark.state, text: shown?.text ?? '', origin: shown?.origin === 'reply' ? 'reply' : 'answer', members: shown?.members ?? [] };
      break;
    }
    case 'delivered':
      question = { state: 'delivered', answer: { text: mark.answerText ?? '', origin: mark.answerOrigin ?? 'answer', at: mark.answeredAt ?? mark.stateChangedAt } };
      break;
    case 'retired':
      question = { state: 'retired' };
      break;
    default:
      question = { state: 'unanswered' };
      if (unsent?.disposition === 'refused') question.failed = { reason: unsent.reason };
      if (unsent?.disposition === 'held') question.held = { reason: unsent.reason };
  }
  return { ...base, question };
}

// A bounded map: the oldest entry goes once it holds RECENT_MAX.
function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > RECENT_MAX) map.delete(map.keys().next().value as K);
}
