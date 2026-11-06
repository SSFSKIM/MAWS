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
//   answered here: the journal starts empty, with no back-fill (M7b, "Back-fill").
// Only what a MAWS process said is read (an event with its journal row, `seq`): history read back from disk is no entry
// (M7b, "Back-fill": none), and nor is a transcript followed while a terminal or a job holds the session, whose words are
// lane A's, sminos's to tell.
// Each entry's `src` is its anchor in the session (`<project>/lane-b/<appSessionId>/<anchor>`), the same whenever the
// batch is replayed, so a replay records nothing new. A session no org project joins (no checkout, or one with no
// sminos id) records nothing.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { NewHostEntry } from '@shared/ipc/schema/channel';
import { answersOf } from '@shared/owner/answer';
import type { OwnerChannelState } from '@shared/owner/state';
import { finishedTextOf, messageOfCall, toHumanOfText } from '@shared/owner/to-human-items';

type ToolUse = Extract<SessionEvent, { kind: 'tool.use' }>;

// The message calls of a session waiting for their results. A call whose result never comes (its session gone mid-call)
// is let go, oldest first, past this many.
const PENDING_MAX = 256;

export interface LaneBPlace {
  project: string; // sminos's project id of the session's checkout (OX3's smnsId)
  engineSessionId: SessionId | null;
}

export interface LaneBDeps {
  place(appSessionId: AppSessionId): LaneBPlace | null; // the org-project join; null: no project joins the session
  record(entry: NewHostEntry): void;
  recorded(src: string): boolean;
}

export class LaneBSource {
  private readonly pending = new Map<AppSessionId, Map<string, ToolUse>>();

  constructor(private readonly deps: LaneBDeps) {}

  onEvents(appSessionId: AppSessionId, events: readonly SessionEvent[]): void {
    for (const event of events) {
      if (event.parentToolUseId !== null) continue; // a subagent's: drawn in its own transcript, not its parent's
      if (event.seq === null) continue; // read back from disk (no journal row): history, or a transcript another process holds
      if (event.kind === 'tool.use') this.called(appSessionId, event);
      else if (event.kind === 'tool.result') {
        const calls = this.pending.get(appSessionId);
        const use = calls?.get(event.toolUseId);
        if (use === undefined) continue;
        calls!.delete(event.toolUseId);
        const message = messageOfCall(use, event);
        if (message?.state === 'sent') this.add(appSessionId, use.sessionId, { kind: 'message', text: message.text, at: use.at }, `call/${use.toolUseId}`);
      } else {
        const finished = finishedTextOf(event);
        if (finished === null) continue;
        for (const item of toHumanOfText(finished.text)) {
          const anchor = `text/${finished.messageUuid}/${finished.blockIndex}`;
          if (item.kind === 'message') this.add(appSessionId, event.sessionId, { kind: 'message', text: item.text, at: event.at }, `${anchor}/m${item.span}`);
          else if (!finished.aborted) {
            const choices = item.choices.map((choice) => choice.text);
            this.add(appSessionId, event.sessionId, { kind: 'question', text: item.text, at: event.at, ...(choices.length > 0 ? { choices } : {}) }, `${anchor}/q${item.span}`);
          }
        }
      }
    }
  }

  // The owner channel's state of a session (`ownerChannel.changed`): each delivered answer of a question recorded here.
  ownerChanged(state: OwnerChannelState): void {
    const appSessionId = state.appSessionId;
    let place: LaneBPlace | null | undefined;
    for (const mark of state.marks) {
      if (mark.kind !== 'need-input' || mark.question?.state !== 'delivered') continue;
      place ??= this.deps.place(appSessionId);
      if (place === null) return;
      const anchor = `${mark.anchor.messageUuid}/${mark.anchor.blockIndex}/q${mark.anchor.span}`;
      if (!this.deps.recorded(`${prefixOf(place, appSessionId)}/text/${anchor}`)) continue;
      const { text, at } = mark.question.answer;
      this.add(appSessionId, place.engineSessionId, { kind: 'answered', text: answerOf(mark.head, text), at }, `answer/${anchor}/${at}`, place);
    }
  }

  private called(appSessionId: AppSessionId, use: ToolUse): void {
    if (messageOfCall(use, null) === null) return;
    let calls = this.pending.get(appSessionId);
    if (calls === undefined) this.pending.set(appSessionId, (calls = new Map()));
    calls.set(use.toolUseId, use);
    if (calls.size > PENDING_MAX) calls.delete(calls.keys().next().value!);
  }

  private add(appSessionId: AppSessionId, engineSessionId: SessionId | null, said: Pick<NewHostEntry, 'kind' | 'text' | 'at' | 'choices'>, anchor: string, known?: LaneBPlace): void {
    const place = known ?? this.deps.place(appSessionId);
    if (place === null) return;
    this.deps.record({ project: place.project, appSessionId, engineSessionId, lane: 'B', ...said, src: `${prefixOf(place, appSessionId)}/${anchor}` });
  }
}

const prefixOf = (place: LaneBPlace, appSessionId: AppSessionId) => `${place.project}/lane-b/${appSessionId}`;

// What an answer says: its answer line for the question's head (`Answering "<head>": <answer>`, as a card and the
// doperpowers mod send it), else the prompt as it was written (a reply in the person's own words).
function answerOf(head: string, text: string): string {
  return answersOf(text).find((line) => line.head === head)?.answer ?? text;
}
