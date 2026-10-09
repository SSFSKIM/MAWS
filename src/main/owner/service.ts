// Main's owner channel (X18, X1; the P2-C document, Design §5 and §6; M4). It listens to the engine host's event batches
// beside the attention service and keeps, in the index, every question and essential the agents marked, with its state:
// - Marks. Each finalized main-thread text block's questions and essentials are stored once by their id (a replay, a
//   resync burst or a backfill changes nothing). A mark at or after the session's watermark may raise an item; one that
//   came live from a MAWS process while the lane was on and no terminal or job held the session may notify. A superseding
//   block, a retraction and a rewind retire the marks of the messages they take away.
// - Answers. The renderer reports the seam's result (`ownerChannel.answered`); the answer then follows its members
//   (./answers.ts) through the host's `queue.transition` rows and the engine's `command.lifecycle`, from a ten-minute log
//   of both for a report that arrives late. A member the transcript must settle (an exit's uncertain submission) is read
//   from it. `ownerChannel.cancel` withdraws an answer's queued entry or pending steer through the host.
// - Recovery. Main hears nothing while the host is away (an app closed or crashed, a reconnect): at start and at every
//   reconnect, each session holding an answer on its way reads the host's prompt record (`session.promptHistory`) and
//   folds it before anything else, then reads the queue's snapshot as positive evidence; what neither settles is read
//   from the transcript, and what that cannot settle reads `unconfirmed`, never a guess.
// - Legacy recognition. A human prompt the engine took that answers `Answering "<head>": …` settles the one question of
//   the session with that head (an answer given in a terminal through the doperpowers mod, or one whose report never
//   arrived), unless the prompt is itself a member of an answer.
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
import { applyEvent, newAnswer, statusOf, type Answer, type PromptEvent } from './answers';
import { laneOn } from './launch';
import { pendingOf } from './mods';
import { blockMarksOf, ownerItemsOf } from './projection';
import type { OwnerChannelStore, OwnerMarkRow } from './store';

export type AnsweredInput = CommandInput<'ownerChannel.answered'>;
type CancelOutcome = CommandOutput<'ownerChannel.cancel'>['outcome'];

// The late-report log (Design §6): per session, what the host and the engine said of prompts in the last ten minutes.
export const LOG_WINDOW_MS = 10 * 60_000;
export const LOG_MAX = 2048;
const RECENT_MAX = 2048; // the prompts and user messages remembered per session (legacy recognition, a rewind's target)

export interface OwnerChannelServiceDeps {
  store: OwnerChannelStore;
  sessions: Pick<SessionStore, 'get' | 'onChange'>; // the holder (foreign-held), the archive and the engine session id
  appEnabled: () => boolean; // settings' mods.toHuman.enabled
  attention: { setOwnerItems(appSessionId: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]): void };
  dispatch: HostDispatch;
  // the first of `uuids` the session's transcript shows the engine took (./prompt-state.ts), or null
  transcriptEvidence: (appSessionId: AppSessionId, uuids: readonly MessageUuid[]) => Promise<MessageUuid | null>;
  emit: (name: 'ownerChannel.changed', payload: { appSessionId: AppSessionId; state: OwnerChannelState }) => void;
  now?: () => string; // ISO-8601; the tests' clock
  log?: (message: string) => void;
}

interface SessionLive {
  log: { event: PromptEvent; at: number }[];
  answers: Map<MarkId, Answer>; // the answers on their way (queued or unconfirmed)
  failures: Map<MarkId, string>; // the last refused send of an unanswered question
  prompts: Map<MessageUuid, { text: string; at: string }>; // human prompts carrying an answer line, written and not yet taken
  userAt: Map<MessageUuid, string>; // when each human prompt was written or read back (a rewind's target)
  checking: Set<MessageUuid>; // uuids whose transcript evidence is being read
  // a delivered question's answer while a follow-up Reply is on its way: what it reads again if the follow-up never
  // arrives (in memory: a restart in between leaves the follow-up's own outcome)
  previous: Map<MarkId, { text: string; origin: 'answer' | 'reply' | 'legacy'; at: string }>;
}

const isForeign = (record: SessionRecord | null) => record !== null && (record.holder.kind === 'terminal' || record.holder.kind === 'background_job');
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class OwnerChannelService {
  private readonly live = new Map<AppSessionId, SessionLive>();
  private readonly recovering = new Set<AppSessionId>(); // until its recovery read is folded, no event reaches its answers
  private readonly held = new Map<AppSessionId, string>(); // the last holder and archive facts each session projected under
  private readonly pending = new Set<Promise<unknown>>();
  private streaming = false;
  private offRecords: (() => void) | null = null;
  private readonly now: () => string;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: OwnerChannelServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.log = deps.log ?? ((message) => console.warn(`[owner] ${message}`));
  }

  // The answers on their way come back from the table and every session re-projects silently; until the host streams,
  // each session holding one waits for its recovery read.
  start(opts: { streaming: boolean }): void {
    for (const row of this.deps.store.openAnswers()) this.liveOf(row.appSessionId).answers.set(row.id as MarkId, answerOfRow(row));
    for (const appSessionId of this.deps.store.markedSessions()) this.project(appSessionId, true);
    this.offRecords = this.deps.sessions.onChange((record) => this.recordChanged(record));
    for (const [appSessionId, live] of this.live) if (live.answers.size > 0) this.recovering.add(appSessionId);
    this.streaming = opts.streaming;
    if (opts.streaming) this.track(this.hostStreaming());
  }

  stop(): void {
    this.offRecords?.();
    this.offRecords = null;
  }

  // Resolves once every read this service started (recoveries, transcript evidence) has settled.
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  // The engine host left `ready`: main hears nothing until it streams again.
  hostDown(): void {
    this.streaming = false;
    for (const [appSessionId, live] of this.live) if (live.answers.size > 0) this.recovering.add(appSessionId);
  }

  // The engine host streams again (or for the first time): every session waiting reads its prompt record.
  async hostStreaming(): Promise<void> {
    this.streaming = true;
    await Promise.all([...this.recovering].map((appSessionId) => this.recover(appSessionId)));
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
            for (const [markId, answer] of live.answers) if (applyEvent(answer, event, seen)) touched.add(markId);
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
    live.failures.delete(markId);
    if (row.state === 'delivered' && row.answerText !== null) live.previous.set(markId, { text: row.answerText, origin: row.answerOrigin ?? 'answer', at: row.answeredAt ?? row.stateChangedAt });
    if (input.disposition === 'refused') {
      live.failures.set(markId, input.reason ?? 'refused');
      this.changed(appSessionId);
      return;
    }
    const members: AnswerMember[] = [];
    if (input.messageUuid !== undefined && input.disposition !== 'queued') members.push({ kind: 'uuid', id: input.messageUuid, life: 'alive' });
    if (input.queueId !== undefined && (input.disposition === 'queued' || input.disposition === 'started')) members.push({ kind: 'entry', id: input.queueId, life: 'alive' });
    const existing = live.answers.get(markId);
    let answer: Answer;
    if (existing !== undefined && statusOf(existing) !== 'delivered' && statusOf(existing) !== 'unanswered') {
      // answered again while unconfirmed: the earlier members are kept, for their evidence to settle it later
      answer = existing;
      answer.text = input.text;
      answer.origin = input.origin;
      for (const member of members) if (!answer.members.some((m) => m.kind === member.kind && m.id === member.id)) answer.members.push(member);
      answer.unconfirmed = members.length === 0;
    } else {
      answer = newAnswer({ text: input.text, origin: input.origin, members, unconfirmed: members.length === 0, reportedAt: this.now() });
    }
    live.answers.set(markId, answer);
    if (!this.streaming) this.recovering.add(appSessionId);
    // the report reaches main after the seam answered: what happened since is in the log, replayed in order (a session
    // still waiting for its recovery read folds it there, after the history)
    if (!this.recovering.has(appSessionId)) {
      const seen = live.log.map((entry) => entry.event);
      seen.forEach((event, i) => applyEvent(answer, event, () => seen.slice(0, i)));
    }
    this.persist(appSessionId, markId);
    this.changed(appSessionId);
  }

  // Design §6, "Cancel": the answer's queued entry through `session.queue.remove`, its pending steer through
  // `session.steer.cancel`. A failed command leaves the answer as it was.
  async cancel(input: CommandInput<'ownerChannel.cancel'>): Promise<{ outcome: CancelOutcome }> {
    const appSessionId = input.appSessionId as AppSessionId;
    const markId = input.markId as MarkId;
    const answer = this.live.get(appSessionId)?.answers.get(markId);
    if (answer === undefined || statusOf(answer) === 'delivered' || statusOf(answer) === 'unanswered') return { outcome: 'not_queued' };
    const alive = answer.members.filter((m) => m.life === 'alive');
    if (alive.length === 0) return { outcome: answer.members.some((m) => m.life !== 'dead') ? 'already_delivering' : 'not_queued' };
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
    return { outcome: !delivering && statusOf(answer) === 'unanswered' ? 'cancelled' : 'already_delivering' };
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
    const failures = this.live.get(appSessionId)?.failures;
    return {
      appSessionId,
      lane: {
        on, override, applied: row?.applied ?? null, pending: pendingOf(row, on),
        mismatch: row?.styleMismatch && row.style !== null && row.observedStyle !== null ? { resolved: row.style, observed: row.observedStyle } : null,
      },
      marks: this.deps.store.marks(appSessionId).map((mark) => ownerMarkOf(mark, failures?.get(mark.id as MarkId))),
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

  private liveOf(appSessionId: AppSessionId): SessionLive {
    let live = this.live.get(appSessionId);
    if (!live) this.live.set(appSessionId, (live = { log: [], answers: new Map(), failures: new Map(), prompts: new Map(), userAt: new Map(), checking: new Set(), previous: new Map() }));
    return live;
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => this.log(messageOf(error))).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private logEvent(live: SessionLive, event: PromptEvent): void {
    const now = Date.parse(this.now());
    live.log.push({ event, at: now });
    while (live.log.length > LOG_MAX || (live.log.length > 0 && live.log[0]!.at < now - LOG_WINDOW_MS)) live.log.shift();
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
            answerText: null, answerOrigin: null, answerMembers: [], answeredAt: null, readAt: null, stateChangedAt: event.at,
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
  // this run never saw is placed after the message the rewind kept, when that message holds a mark.
  private rewind(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'boundary.rewind' }>): boolean {
    const target = this.liveOf(appSessionId).userAt.get(event.targetMessageUuid);
    if (target !== undefined) return this.retire(appSessionId, (mark) => Date.parse(mark.at) >= Date.parse(target));
    const kept = event.precedingAssistantUuid === null ? undefined : this.deps.store.marks(appSessionId).find((mark) => mark.messageUuid === event.precedingAssistantUuid);
    if (kept !== undefined) return this.retire(appSessionId, (mark) => Date.parse(mark.at) > Date.parse(kept.at));
    this.log(`${appSessionId}: a rewind to ${event.targetMessageUuid}, a prompt this run has not seen; its marks stay`);
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
    if (event.seq === null) return this.legacy(appSessionId, event.messageUuid, text, event.at);
    remember(live.prompts, event.messageUuid, { text, at: event.at });
    return false;
  }

  // The engine's word on a prompt it was written: taken (started, completed) or not.
  private taken(appSessionId: AppSessionId, event: Extract<SessionEvent, { kind: 'command.lifecycle' }>): boolean {
    const live = this.liveOf(appSessionId);
    const prompt = live.prompts.get(event.commandUuid);
    if (prompt === undefined || event.state === 'queued') return false;
    live.prompts.delete(event.commandUuid);
    return event.state === 'started' || event.state === 'completed' ? this.legacy(appSessionId, event.commandUuid, prompt.text, prompt.at) : false;
  }

  // Legacy recognition (Design §6): each answer line settles the one question of the session with its head, asked before
  // the prompt and still unanswered or unconfirmed; never two questions with one head, never a prompt that belongs to an
  // answer (a question whose answer is on its way is neither unanswered nor unconfirmed).
  private legacy(appSessionId: AppSessionId, uuid: MessageUuid, text: string, at: string): boolean {
    const live = this.liveOf(appSessionId);
    const marks = this.deps.store.marks(appSessionId);
    const member = (members: readonly AnswerMember[]) => members.some((m) => m.kind === 'uuid' && m.id === uuid);
    if ([...live.answers.values()].some((answer) => member(answer.members)) || marks.some((mark) => member(mark.answerMembers))) return false;
    let settled = false;
    for (const { head, answer } of answersOf(text)) {
      const asked = marks.filter((mark) => mark.kind === 'need-input' && mark.state !== 'retired' && mark.head === head && Date.parse(mark.at) <= Date.parse(at));
      if (asked.length !== 1 || (asked[0]!.state !== 'unanswered' && asked[0]!.state !== 'unconfirmed')) continue;
      const markId = asked[0]!.id as MarkId;
      this.deps.store.updateMark(markId, { state: 'delivered', answerText: answerText(head, answer), answerOrigin: 'legacy', answerMembers: [], answeredAt: at, stateChangedAt: this.now() });
      live.answers.delete(markId);
      live.failures.delete(markId);
      settled = true;
    }
    return settled;
  }

  // Writes an answer's state to its mark; an answer that arrived or fell back to unanswered leaves the in-flight set. A
  // member whose fate only the transcript can tell is read from it.
  private persist(appSessionId: AppSessionId, markId: MarkId): void {
    const live = this.liveOf(appSessionId);
    const answer = live.answers.get(markId);
    if (answer === undefined) return;
    const status = statusOf(answer);
    const at = this.now();
    if (status === 'delivered') {
      this.deps.store.updateMark(markId, { state: 'delivered', answerText: answer.text, answerOrigin: answer.origin, answerMembers: answer.members, answeredAt: answer.deliveredAt, stateChangedAt: at });
      live.answers.delete(markId);
      live.previous.delete(markId);
    } else if (status === 'unanswered') {
      const previous = live.previous.get(markId);
      // a follow-up that never arrived leaves the question answered as it was
      if (previous !== undefined) this.deps.store.updateMark(markId, { state: 'delivered', answerText: previous.text, answerOrigin: previous.origin, answerMembers: [], answeredAt: previous.at, stateChangedAt: at });
      else this.deps.store.updateMark(markId, { state: 'unanswered', answerText: null, answerOrigin: null, answerMembers: [], answeredAt: null, stateChangedAt: at });
      live.answers.delete(markId);
      live.previous.delete(markId);
      if (answer.failed !== null) live.failures.set(markId, answer.failed.reason);
    } else {
      this.deps.store.updateMark(markId, { state: status, answerText: answer.text, answerOrigin: answer.origin, answerMembers: answer.members, answeredAt: answer.reportedAt, stateChangedAt: at });
      this.evidence(appSessionId, markId, answer);
    }
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
        if (live.answers.get(markId) !== answer) return; // settled or replaced meanwhile
        if (taken !== null) answer.deliveredAt = this.now();
        else for (const member of answer.members) if (member.life === 'unknown' && unknown.includes(member.id as MessageUuid)) member.life = 'dead';
        this.persist(appSessionId, markId);
        this.changed(appSessionId);
      }),
    );
  }

  // Design §6, "Restarts and reconnects: the recovery read".
  private async recover(appSessionId: AppSessionId): Promise<void> {
    const live = this.liveOf(appSessionId);
    const answers = [...live.answers.entries()];
    try {
      if (answers.length === 0) return;
      const since = new Date(Math.min(...answers.map(([, answer]) => Date.parse(answer.reportedAt))) - LOG_WINDOW_MS).toISOString();
      const history = await hostCall(this.deps.dispatch, 'session.promptHistory', { appSessionId, since });
      const queue = await hostCall(this.deps.dispatch, 'session.queue.list', { appSessionId });
      // the journals first, then what the live stream brought meanwhile (an event both carry is applied once, by its id)
      const events = [...history.events, ...live.log.map((entry) => entry.event)];
      events.forEach((event, i) => {
        for (const [, answer] of live.answers) applyEvent(answer, event, () => events.slice(0, i));
      });
      // the queue's snapshot, positively: an entry or a pending steer it shows is alive
      const shown = new Set<string>([...queue.entries.flatMap((e) => [e.queueId, ...(e.messageUuid === null ? [] : [e.messageUuid])]), ...(queue.steers ?? []).map((s) => s.messageUuid)]);
      const reads: Promise<void>[] = [];
      for (const [, answer] of live.answers) {
        if (statusOf(answer) === 'delivered') continue;
        for (const member of answer.members) if (member.life !== 'dead' && shown.has(member.id)) member.life = 'alive';
        // a member still alive by the record but in neither the record's end nor the snapshot: what became of it is
        // read from the transcript, and an answer it cannot settle reads unconfirmed
        const unsettled = answer.members.filter((m) => (m.life === 'alive' || m.life === 'withdrawing') && !shown.has(m.id));
        if (unsettled.length === 0 || answer.members.some((m) => shown.has(m.id))) continue;
        const uuids = unsettled.filter((m) => m.kind === 'uuid').map((m) => m.id as MessageUuid);
        reads.push(
          (uuids.length === 0 ? Promise.resolve(null) : this.deps.transcriptEvidence(appSessionId, uuids)).then((taken) => {
            if (taken !== null) answer.deliveredAt = this.now();
            else answer.unconfirmed = true;
          }),
        );
      }
      await Promise.all(reads);
    } catch (error) {
      this.log(`${appSessionId}: the recovery read failed, its answers keep their states: ${messageOf(error)}`);
    } finally {
      this.recovering.delete(appSessionId);
      // an answer reported while the read was out takes the log now (an event the fold applied is skipped by its id)
      const seen = live.log.map((entry) => entry.event);
      for (const [, answer] of live.answers) seen.forEach((event, i) => applyEvent(answer, event, () => seen.slice(0, i)));
      for (const markId of new Set([...answers.map(([markId]) => markId), ...live.answers.keys()])) this.persist(appSessionId, markId);
      if (answers.length > 0 || live.answers.size > 0) this.changed(appSessionId);
    }
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
function ownerMarkOf(mark: OwnerMarkRow, failure: string | undefined): OwnerMark {
  const base = { id: mark.id as MarkId, kind: mark.kind, anchor: { messageUuid: mark.messageUuid as MessageUuid, blockIndex: mark.blockIndex, span: mark.span }, head: mark.head, at: mark.at, item: mark.item };
  if (mark.kind === 'essential') return { ...base, essential: { state: mark.state === 'read' || mark.state === 'retired' ? mark.state : 'unread', readAt: mark.readAt } };
  let question: QuestionState;
  switch (mark.state) {
    case 'queued':
    case 'unconfirmed':
      question = { state: mark.state, text: mark.answerText ?? '', origin: mark.answerOrigin === 'reply' ? 'reply' : 'answer', members: mark.answerMembers };
      break;
    case 'delivered':
      question = { state: 'delivered', answer: { text: mark.answerText ?? '', origin: mark.answerOrigin ?? 'answer', at: mark.answeredAt ?? mark.stateChangedAt } };
      break;
    case 'retired':
      question = { state: 'retired' };
      break;
    default:
      question = { state: 'unanswered', ...(failure === undefined ? {} : { failed: { reason: failure } }) };
  }
  return { ...base, question };
}

// An answer on its way, as the table kept it.
function answerOfRow(row: OwnerMarkRow): Answer {
  return newAnswer({
    text: row.answerText ?? '', origin: row.answerOrigin === 'reply' ? 'reply' : 'answer', members: row.answerMembers.map((m) => ({ ...m })),
    unconfirmed: row.state === 'unconfirmed', reportedAt: row.answeredAt ?? row.stateChangedAt,
  });
}

// A bounded map: the oldest entry goes once it holds RECENT_MAX.
function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > RECENT_MAX) map.delete(map.keys().next().value as K);
}
