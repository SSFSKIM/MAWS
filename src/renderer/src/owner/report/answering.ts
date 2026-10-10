// The cards' actions (the P2-C document, Design §6 "The card's send" and "Cancel", §8; M6). A choice or a Reply is
// `answerText(head, answer)` sent through the one human-prompt seam (X22) with origin `answer` or `reply`, and the
// seam's result, whatever it is, is reported to main with `ownerChannel.answered`: main owns the question's state from
// there (queued, delivered, unconfirmed, or unanswered with what kept it from going out), because only main persists
// and sees every event. A seam that throws (main or the host unreachable) is reported as a refusal in its words, so the
// card shows it with Retry like any other; a send a trust or relay card holds (X22's `held`) is reported as held, and
// the card says that card's words with Retry. While the seam answers the card says Sending…, or Starting… when the
// session has no ready process and the send acquires it first (P2-A). After a Reply the session's composer takes the
// keyboard, its draft untouched. Cancel and Mark read are main's commands. No action's failure escapes or goes unsaid:
// a failed command (main's failure envelope, or a rejected invoke when the bridge is gone) is said where it was asked,
// and a sent answer whose report failed is kept so that the report alone can be made again, never the prompt. It is
// kept outside the card, since the transcript mounts only the rows in view: a card scrolled away and back, or one that
// left while its send was out, still says it and can make it again.
import { useState } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, MawsBridge } from '@shared/ipc/schema';
import { answerText } from '@shared/owner/answer';
import type { MarkId } from '@shared/owner/marks';
import type { AnswerOrigin } from '@shared/owner/state';
import type { Choice } from '@shared/owner/to-human-parser';
import { sendHumanPrompt, type HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { ipc } from '../../ipc/client';
import { canTakeOver, takeOverSession } from '../../sessions/record-ops';
import { useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { QUESTION } from './copy';
import type { QuestionActions } from './QuestionCard';

export type AnswerReport = CommandInput<'ownerChannel.answered'>;
export interface AnswerSend { text: string; origin: AnswerOrigin }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A command's failure in its words, null when it succeeded: main's failure envelope, or the invoke rejected.
async function failureOf(invoke: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>): Promise<string | null> {
  try {
    const result = await invoke();
    return result.ok ? null : result.error.message;
  } catch (error) {
    return messageOf(error);
  }
}

// The prompt went out (sent, steered or queued): an answer main follows. `held` and `refused` sent nothing.
const wentOut = (result: HumanPromptResult) => result.disposition === 'sent' || result.disposition === 'steered' || result.disposition === 'queued';

// The seam's result as main takes it: X22's five dispositions, as the seam said them, and when the seam was called
// (`sentAt`: a report made again later is read by main from the host's record since then).
export function reportOf(appSessionId: AppSessionId, markId: MarkId, send: AnswerSend, result: HumanPromptResult, sentAt?: string): AnswerReport {
  const { disposition, started, messageUuid, queueId, reason } = result;
  return {
    appSessionId, markId, text: send.text, origin: send.origin, disposition, started,
    ...(messageUuid !== undefined && { messageUuid }), ...(queueId !== undefined && { queueId }), ...(reason !== undefined && { reason }),
    ...(sentAt !== undefined && { sentAt }),
  };
}

// The report made to main: null when main took it, else the failure's words.
export const reportAnswer = (report: AnswerReport, client: MawsBridge = ipc): Promise<string | null> => failureOf(() => client.invoke('ownerChannel.answered', report));

export interface AnswerOutcome {
  result: HumanPromptResult;
  report: AnswerReport;
  unreported: string | null; // the report's failure in its words; null: main has it
}

// One answer: the seam, then the report of whatever it answered.
export async function sendAnswer(appSessionId: AppSessionId, markId: MarkId, send: AnswerSend, client: MawsBridge = ipc): Promise<AnswerOutcome> {
  const sentAt = new Date().toISOString();
  let result: HumanPromptResult;
  try {
    result = await sendHumanPrompt(appSessionId, send.text, { origin: send.origin }, client);
  } catch (error) {
    result = { disposition: 'refused', started: false, reason: messageOf(error) };
  }
  const report = reportOf(appSessionId, markId, send, result, sentAt);
  return { result, report, unreported: await reportAnswer(report, client) };
}

// Null when main read them, else the failure's words, for the caller to say where it was asked.
export const markRead = (appSessionId: AppSessionId, markIds: MarkId[] | 'all', client: MawsBridge = ipc): Promise<string | null> =>
  failureOf(() => client.invoke('ownerChannel.markRead', { appSessionId, markIds }));

// What the card shows while its own send or cancel runs, what its last send or cancel answered, and a sent answer's
// report still to be made: its failure's words, and whether it is being made again now.
export interface Answering {
  actions: QuestionActions;
  busy: 'sending' | 'starting' | null;
  note: string | null;
  unreported: { error: string; recording: boolean } | null;
}

// Kept until main has the report: through a Record again in flight too, so nothing offers to send the answer again
interface Unreported { report: AnswerReport; error: string; recording: boolean }

// Each question's kept report, by its mark (a mark id names its session), for the life of the window
const useUnreported = create<{ byMark: ReadonlyMap<MarkId, Unreported> }>(() => ({ byMark: new Map() }));
function setUnreportedOf(markId: MarkId, update: (now: Unreported | null) => Unreported | null) {
  useUnreported.setState(({ byMark }) => {
    const next = update(byMark.get(markId) ?? null);
    if (next === (byMark.get(markId) ?? null)) return { byMark };
    const changed = new Map(byMark);
    if (next === null) changed.delete(markId);
    else changed.set(markId, next);
    return { byMark: changed };
  });
}
export const resetUnreportedAnswers = () => useUnreported.setState({ byMark: new Map() });

// A question's actions for its card: null without a mark main knows (a block still streaming, or not derived yet),
// since main can follow only a question it has.
export function useQuestionAnswering(appSessionId: AppSessionId, markId: MarkId | null, head: string, client: MawsBridge = ipc): Answering {
  const holder = useSessions((s) => s.records.get(appSessionId)?.holder ?? null);
  const [busy, setBusy] = useState<Answering['busy']>(null);
  const [note, setNote] = useState<string | null>(null);
  const [last, setLast] = useState<AnswerSend | null>(null);
  const unreported = useUnreported((s) => (markId === null ? null : (s.byMark.get(markId) ?? null)));
  if (markId === null) return { actions: {}, busy: null, note: null, unreported: null };

  const send = async (answer: AnswerSend): Promise<AnswerOutcome | null> => {
    if (busy !== null) return null; // the same answer clicked twice: one send
    const sessions = useSessions.getState();
    setBusy(sessions.engine.get(appSessionId)?.process !== 'ready' && sessions.records.has(appSessionId) ? 'starting' : 'sending');
    setNote(null);
    setLast(answer);
    try {
      const outcome = await sendAnswer(appSessionId, markId, answer, client);
      const { result } = outcome;
      // main says what kept an unanswered question's answer from going out; a follow-up's on an answered question, and
      // one main never heard of, the card says itself
      if (result.disposition === 'refused') setNote(result.reason ?? null);
      if (result.disposition === 'held') setNote(QUESTION.held(result.reason));
      // a sent answer main never heard of is kept until its report is made; a newer sent answer's report supersedes it
      // (the older prompt is still the engine's, and main's legacy recognition reads it, Design §6)
      if (wentOut(result)) setUnreportedOf(markId, () => outcome.unreported === null ? null : { report: outcome.report, error: outcome.unreported, recording: false });
      return outcome;
    } finally {
      setBusy(null);
    }
  };
  // the kept report made again (the prompt never is); it is kept until main has it, and a newer sent answer's report
  // that replaced it meanwhile is left alone
  const recordAgain = async (pending: Unreported) => {
    if (pending.recording) return;
    const mine = (now: Unreported | null) => now?.report === pending.report;
    setUnreportedOf(markId, (now) => (mine(now) ? { ...pending, recording: true } : now));
    const error = await reportAnswer(pending.report, client);
    setUnreportedOf(markId, (now) => (!mine(now) ? now : error === null ? null : { ...pending, error, recording: false }));
  };
  const foreign = holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job') ? holder : null;

  return {
    busy,
    note,
    unreported: unreported === null ? null : { error: unreported.error, recording: unreported.recording },
    actions: {
      choose: (choice: Choice) => void send({ text: answerText(head, choice.text), origin: 'answer' }),
      reply: async (text: string) => {
        const outcome = await send({ text: answerText(head, text), origin: 'reply' });
        if (outcome === null || !wentOut(outcome.result)) return false;
        // the composer's own focus action; a report main never got keeps the keyboard on the card that says so
        if (outcome.unreported === null) useComposerStore.getState().focusTargets.get(appSessionId)?.focusFrame();
        return true;
      },
      // Retry sends the last answer again, so never while a sent answer's report is still to be made
      ...(last !== null && unreported === null && { retry: () => void send(last) }),
      ...(unreported !== null && { recordAgain: () => void recordAgain(unreported) }),
      cancel: () => {
        setNote(null);
        void client.invoke('ownerChannel.cancel', { appSessionId, markId }).then(
          (result) => {
            if (!result.ok) setNote(result.error.message);
            else if (result.value.outcome === 'already_delivering') setNote(QUESTION.alreadyOnItsWay);
          },
          (error: unknown) => setNote(messageOf(error)),
        );
      },
      ...(foreign !== null && canTakeOver(foreign) && { takeOver: () => void takeOverSession(appSessionId, foreign) }),
    },
  };
}
