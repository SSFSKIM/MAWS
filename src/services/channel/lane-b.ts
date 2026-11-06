// Lane B's to-human entries for the project channel (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M7b, "lane B's source"), read from the owner channel's event batches with the one extraction the transcript and the
// owner channel read (`@shared/owner/to-human-items`; the architect's condition, Decision Log "M7b's refresh at its cut",
// item 4), so the channel and this machine's own to-human view never disagree about what was a message:
// - a message tool's call of the main conversation is a `message` once its result says it was sent, at the call's time
//   (the transcript's `to_human` row);
// - each message span of a finished main-conversation text is a `message`, at the block's time;
// - each question of one the owner channel keeps a mark of (not an interrupted partial) is a `question`, as it was
//   asked, with its options; and its answer is an `answered`, at the time the engine took it, once the owner channel
//   states it delivered (`ownerChannel.changed`), the one truth of an answer. Only a question this journal recorded is
//   answered here: the journal starts empty, with no back-fill (M7b, "Back-fill");
// - each question of a MAWS ask (`mcp__maws__ask`, a subagent's too: the person answers it alike) is a `question` from
//   the ask's own record as the engine host journals it (`maws.ask.opened`: the question and its options), and each
//   answer an `answered` (`maws.ask.answered`), keyed by the ask's id; the host's ask table is its one store, held in its
//   memory (src/engine-host/tool-server/asks.ts), and these events are what it tells of it.
// Only what a MAWS process said is read (an event with its journal row, `seq`): history read back from disk is no entry
// (M7b, "Back-fill": none), and nor is a transcript followed while a terminal or a job holds the session, whose words are
// lane A's, sminos's to tell.
// Each entry's `src` is its anchor in the session (`<project>/lane-b/<appSessionId>/<anchor>`, each part encoded:
// `pathOf`), the same whenever the batch is replayed, so a replay records nothing new. An answer stated before its
// question is read waits for it (`await`). A session no org project joins (no checkout, or one with no
// sminos id) records nothing. One whose project's org id is not derived yet (the start's refresh, which waits on git) is
// held, CHANNEL_BOUNDS.held at most across sessions, and recorded in the order it was said once the id is
// (`placesChanged`), so nothing said early in a run is lost to the join.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import { askQuestionId, type AskAnswer } from '@shared/maws/tools';
import { answersOf } from '@shared/owner/answer';
import type { OwnerChannelState } from '@shared/owner/state';
import { finishedTextOf, messageOfCall, toHumanOfText } from '@shared/owner/to-human-items';
import { CHANNEL_BOUNDS } from './journal';

type ToolUse = Extract<SessionEvent, { kind: 'tool.use' }>;
type Said = Pick<NewHostEntry, 'kind' | 'text' | 'at' | 'choices'>;

// The message calls of a session waiting for their results. A call whose result never comes (its session gone mid-call)
// is let go, oldest first, past this many.
const PENDING_MAX = 256;
// The answers waiting for their question to be recorded (`await`), across sessions.
const UNMATCHED_MAX = 256;

// A `src` or an anchor from its parts, each encoded (`encodeURIComponent`), so no id holding a `/` can make one entry's
// identity another's: a question `q`'s answer (`…/q/answered`) and a question `q/answered` (`…/q%2Fanswered`) stay apart.
const pathOf = (...parts: readonly (string | number)[]): string => parts.map((part) => encodeURIComponent(String(part))).join('/');

export interface LaneBPlace {
  project: string; // sminos's project id of the session's checkout (OX3's smnsId)
  engineSessionId: SessionId | null;
}

export interface LaneBDeps {
  // the org-project join; null: no project joins the session; 'pending': its project's org id is not derived yet
  place(appSessionId: AppSessionId): LaneBPlace | 'pending' | null;
  record(entry: NewHostEntry): void;
  recorded(src: string): boolean;
  log(line: string): void;
}

// What a session said, waiting for its place. `requires`: the anchor of the question an answer answers, recorded first.
interface Held {
  appSessionId: AppSessionId;
  engineSessionId: SessionId | undefined; // undefined: the session's, as the index holds it
  said: Said;
  anchor: string;
  requires: string | undefined;
}

export class LaneBSource {
  private readonly pending = new Map<AppSessionId, Map<string, ToolUse>>();
  private held: Held[] = [];
  private readonly heldKeys = new Set<string>(); // `<appSessionId>/<anchor>`: a replay or a state stated again holds nothing more
  private readonly unmatched = new Map<string, Map<string, Held>>(); // by its question's src: the answers waiting for it, by their src
  private readonly unmatchedOrder = new Map<string, string>(); // each waiting answer's src to its question's, oldest first
  private letGo = 0; // held entries let go past the bound since the last flush

  constructor(private readonly deps: LaneBDeps) {}

  onEvents(appSessionId: AppSessionId, events: readonly SessionEvent[]): void {
    for (const event of events) {
      if (event.seq === null) continue; // read back from disk (no journal row): history, or a transcript another process holds
      if (event.kind === 'maws.ask.opened') {
        event.questions.forEach((question, index) => {
          const choices = question.options?.map((option) => option.label) ?? [];
          this.add(appSessionId, event.sessionId, { kind: 'question', text: question.question, at: event.at, ...(choices.length > 0 ? { choices } : {}) }, pathOf('ask', event.askId, askQuestionId(question, index)));
        });
        continue;
      }
      if (event.kind === 'maws.ask.answered') {
        for (const answer of event.answers) {
          this.add(appSessionId, event.sessionId, { kind: 'answered', text: askAnswerOf(answer), at: event.at }, pathOf('ask', event.askId, answer.id, 'answered'), pathOf('ask', event.askId, answer.id));
        }
        continue;
      }
      if (event.parentToolUseId !== null) continue; // a subagent's words: drawn in its own transcript, not its parent's
      if (event.kind === 'tool.use') this.called(appSessionId, event);
      else if (event.kind === 'tool.result') {
        const calls = this.pending.get(appSessionId);
        const use = calls?.get(event.toolUseId);
        if (use === undefined) continue;
        calls!.delete(event.toolUseId);
        const message = messageOfCall(use, event);
        if (message?.state === 'sent') this.add(appSessionId, use.sessionId, { kind: 'message', text: message.text, at: use.at }, pathOf('call', use.toolUseId));
      } else {
        const finished = finishedTextOf(event);
        if (finished === null) continue;
        for (const item of toHumanOfText(finished.text)) {
          if (item.kind === 'message') this.add(appSessionId, event.sessionId, { kind: 'message', text: item.text, at: event.at }, pathOf('text', finished.messageUuid, finished.blockIndex, `m${item.span}`));
          else if (!finished.aborted) {
            const choices = item.choices.map((choice) => choice.text);
            this.add(appSessionId, event.sessionId, { kind: 'question', text: item.text, at: event.at, ...(choices.length > 0 ? { choices } : {}) }, pathOf('text', finished.messageUuid, finished.blockIndex, `q${item.span}`));
          }
        }
      }
    }
  }

  // The owner channel's state of a session (`ownerChannel.changed`): each delivered answer of a question recorded here.
  ownerChanged(state: OwnerChannelState): void {
    for (const mark of state.marks) {
      if (mark.kind !== 'need-input' || mark.question?.state !== 'delivered') continue;
      const { messageUuid, blockIndex, span } = mark.anchor;
      const { text, at } = mark.question.answer;
      this.add(state.appSessionId, undefined, { kind: 'answered', text: answerOf(mark.head, text), at }, pathOf('answer', messageUuid, blockIndex, `q${span}`, at), pathOf('text', messageUuid, blockIndex, `q${span}`));
    }
  }

  // A project's org id may have been derived (the index's projects changed): what waited for it is recorded, in order.
  placesChanged(): void {
    if (this.held.length > 0) {
      const waiting = this.held;
      this.held = [];
      this.heldKeys.clear();
      for (const item of waiting) this.add(item.appSessionId, item.engineSessionId, item.said, item.anchor, item.requires);
    }
    if (this.letGo > 0) {
      this.deps.log(`${this.letGo} held entries were let go past ${CHANNEL_BOUNDS.held}`);
      this.letGo = 0;
    }
  }

  private called(appSessionId: AppSessionId, use: ToolUse): void {
    if (messageOfCall(use, null) === null) return;
    let calls = this.pending.get(appSessionId);
    if (calls === undefined) this.pending.set(appSessionId, (calls = new Map()));
    calls.set(use.toolUseId, use);
    if (calls.size > PENDING_MAX) calls.delete(calls.keys().next().value!);
  }

  private add(appSessionId: AppSessionId, engineSessionId: SessionId | undefined, said: Said, anchor: string, requires?: string): void {
    const place = this.deps.place(appSessionId);
    if (place === null) return;
    if (place === 'pending') return this.hold({ appSessionId, engineSessionId, said, anchor, requires });
    const prefix = pathOf(place.project, 'lane-b', appSessionId);
    const src = `${prefix}/${anchor}`;
    if (requires !== undefined && !this.deps.recorded(`${prefix}/${requires}`)) return this.await(`${prefix}/${requires}`, src, { appSessionId, engineSessionId, said, anchor, requires });
    this.deps.record({ project: place.project, appSessionId, engineSessionId: engineSessionId ?? place.engineSessionId, lane: 'B', ...said, src });
    const answers = this.unmatched.get(src);
    if (answers === undefined) return;
    this.unmatched.delete(src);
    for (const [answer, item] of answers) {
      this.unmatchedOrder.delete(answer);
      this.add(item.appSessionId, item.engineSessionId, item.said, item.anchor, item.requires);
    }
  }

  private hold(item: Held): void {
    const key = `${pathOf(item.appSessionId)}/${item.anchor}`;
    if (this.heldKeys.has(key)) return;
    this.heldKeys.add(key);
    this.held.push(item);
    if (this.held.length <= CHANNEL_BOUNDS.held) return;
    const oldest = this.held.shift()!;
    this.heldKeys.delete(`${pathOf(oldest.appSessionId)}/${oldest.anchor}`);
    if (this.letGo++ === 0) this.deps.log(`more than ${CHANNEL_BOUNDS.held} entries wait for their project's org id; the oldest are let go`);
  }

  // An answer whose question is not recorded yet waits for it, UNMATCHED_MAX at most, the oldest let go unlogged: the
  // owner channel reads a batch before lane B does (its listener is the spine's first), so it can state an answer
  // delivered before lane B has read the question in that same batch, and an answer to a question asked before this
  // journal began (no back-fill) is stated again at each change of its session and never matched.
  private await(question: string, answer: string, item: Held): void {
    if (this.unmatchedOrder.has(answer)) return;
    let answers = this.unmatched.get(question);
    if (answers === undefined) this.unmatched.set(question, (answers = new Map()));
    answers.set(answer, item);
    this.unmatchedOrder.set(answer, question);
    if (this.unmatchedOrder.size <= UNMATCHED_MAX) return;
    const [oldest, of] = this.unmatchedOrder.entries().next().value!;
    this.unmatchedOrder.delete(oldest);
    const waiting = this.unmatched.get(of)!;
    waiting.delete(oldest);
    if (waiting.size === 0) this.unmatched.delete(of);
  }
}

// What an answer says: its answer line for the question's head (`Answering "<head>": <answer>`, as a card and the
// doperpowers mod send it), else the prompt as it was written (a reply in the person's own words).
function answerOf(head: string, text: string): string {
  return answersOf(text).find((line) => line.head === head)?.answer ?? text;
}

// What a MAWS ask's answer says, read by the person rather than the model: the two non-answers as the steer names them
// (src/shared/maws/ask.ts), else the chosen labels, the text or the paths, and what was typed under Other, a project's or
// a design system's name, or the build request; then the note the person wrote beside it.
function askAnswerOf(answer: AskAnswer): string {
  const said = answer.status === 'skipped' ? 'skipped' : answer.status === 'decide_for_me' ? 'decide for me' : answeredOf(answer);
  return answer.note === undefined ? said : `${said}\nnote: ${answer.note}`;
}

function answeredOf(answer: AskAnswer): string {
  if (answer.create === true) return 'build a new one with me';
  if (answer.designSystemId !== undefined) return answer.name !== undefined ? `${answer.name} (${answer.designSystemId})` : answer.designSystemId;
  const values = (answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value]).join(', ');
  const value = answer.name !== undefined ? `${answer.name} (${values})` : values;
  return [value, answer.otherText !== undefined ? `Other: ${answer.otherText}` : ''].filter((part) => part !== '').join('; ');
}
