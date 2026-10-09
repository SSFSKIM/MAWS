// The cards' actions (the P2-C document, Design §6 "The card's send" and "Cancel", §8; M6). A choice or a Reply is
// `answerText(head, answer)` sent through the one human-prompt seam (X22) with origin `answer` or `reply`, and the
// seam's result, whatever it is, is reported to main with `ownerChannel.answered`: main owns the question's state from
// there (queued, delivered, unconfirmed, or unanswered with the refusal's words), because only main persists and sees
// every event. A seam that throws (main or the host unreachable) is reported as a refusal in its words, so the card
// shows it with Retry like any other. While the seam answers the card says Sending…, or Starting… when the session has
// no ready process and the send acquires it first (P2-A). After a Reply the session's composer takes the keyboard,
// its draft untouched. Cancel and Mark read are main's commands.
import { useState } from 'react';
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

// The seam's result as main takes it. `held` is the composer's alone (the seam answers a card's send it could not
// start with `refused` and the card's words), so it is read as a refusal should it ever arrive.
export function reportOf(appSessionId: AppSessionId, markId: MarkId, send: AnswerSend, result: HumanPromptResult): AnswerReport {
  const { disposition, started, messageUuid, queueId, reason } = result;
  return {
    appSessionId, markId, text: send.text, origin: send.origin, disposition: disposition === 'held' ? 'refused' : disposition, started,
    ...(messageUuid !== undefined && { messageUuid }), ...(queueId !== undefined && { queueId }), ...(reason !== undefined && { reason }),
  };
}

// One answer: the seam, then the report of whatever it answered.
export async function sendAnswer(appSessionId: AppSessionId, markId: MarkId, send: AnswerSend, client: MawsBridge = ipc): Promise<HumanPromptResult> {
  let result: HumanPromptResult;
  try {
    result = await sendHumanPrompt(appSessionId, send.text, { origin: send.origin }, client);
  } catch (error) {
    result = { disposition: 'refused', started: false, reason: messageOf(error) };
  }
  const reported = await client.invoke('ownerChannel.answered', reportOf(appSessionId, markId, send, result));
  if (!reported.ok) console.warn('[owner] ownerChannel.answered failed', reported.error);
  return result;
}

export function markRead(appSessionId: AppSessionId, markIds: MarkId[] | 'all', client: MawsBridge = ipc): void {
  void client.invoke('ownerChannel.markRead', { appSessionId, markIds }).then((result) => {
    if (!result.ok) console.warn('[owner] ownerChannel.markRead failed', result.error);
  });
}

// What the card shows while its own send or cancel runs, and what a cancel answered.
export interface Answering {
  actions: QuestionActions;
  busy: 'sending' | 'starting' | null;
  note: string | null;
}

// A question's actions for its card: null without a mark main knows (a block still streaming, or not derived yet),
// since main can follow only a question it has.
export function useQuestionAnswering(appSessionId: AppSessionId, markId: MarkId | null, head: string, client: MawsBridge = ipc): Answering {
  const holder = useSessions((s) => s.records.get(appSessionId)?.holder ?? null);
  const [busy, setBusy] = useState<Answering['busy']>(null);
  const [note, setNote] = useState<string | null>(null);
  const [last, setLast] = useState<AnswerSend | null>(null);
  if (markId === null) return { actions: {}, busy: null, note: null };

  const send = async (answer: AnswerSend): Promise<HumanPromptResult | null> => {
    if (busy !== null) return null; // the same answer clicked twice: one send
    const sessions = useSessions.getState();
    setBusy(sessions.engine.get(appSessionId)?.process !== 'ready' && sessions.records.has(appSessionId) ? 'starting' : 'sending');
    setNote(null);
    setLast(answer);
    try {
      const result = await sendAnswer(appSessionId, markId, answer, client);
      // main shows a refusal on an unanswered question; a refused follow-up on an answered one is said here
      if (result.disposition === 'refused' || result.disposition === 'held') setNote(result.reason ?? null);
      return result;
    } finally {
      setBusy(null);
    }
  };
  const foreign = holder !== null && (holder.kind === 'terminal' || holder.kind === 'background_job') ? holder : null;

  return {
    busy,
    note,
    actions: {
      choose: (choice: Choice) => void send({ text: answerText(head, choice.text), origin: 'answer' }),
      reply: async (text: string) => {
        const result = await send({ text: answerText(head, text), origin: 'reply' });
        if (result === null || result.disposition === 'refused' || result.disposition === 'held') return false;
        useComposerStore.getState().focusTargets.get(appSessionId)?.focusFrame(); // the composer's own focus action
        return true;
      },
      ...(last !== null && { retry: () => void send(last) }),
      cancel: () => {
        setNote(null);
        void client.invoke('ownerChannel.cancel', { appSessionId, markId }).then((result) => {
          if (!result.ok) setNote(result.error.message);
          else if (result.value.outcome === 'already_delivering') setNote(QUESTION.alreadyOnItsWay);
        });
      },
      ...(foreign !== null && canTakeOver(foreign) && { takeOver: () => void takeOverSession(appSessionId, foreign) }),
    },
  };
}
