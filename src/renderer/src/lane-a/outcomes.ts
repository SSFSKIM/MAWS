// A lane A op's outcome, once its op ends (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "The slash
// palette" and "The side question"): `laneA.command` and `laneA.btw` answer when the bridge took the op, and what it did
// comes later as the session's `op` messages for its id (start, then end), which the page's watch carries. A command's
// end is worded by the lifted desk-web rules (`commandOutcomeText`: what ran is confirmed by its row, its text or its
// effect, and nothing linkable is "ran, unconfirmed", never success) and shown as a toast; a side question's end is its
// answer's text, or its reason. Bounded: an op whose end never arrives is let go after OUTCOME_WAIT_MS.
import type { OpBody, SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { toast } from '../stores/notices';
import { commandOutcomeText } from './conversation/words';
import { opMessagesOf, watchLaneA } from './watches';

export const OUTCOME_WAIT_MS = 120_000;

const endOf = (messages: readonly SessionMessage[], opId: string): OpBody | null => {
  for (const message of messages) {
    if (message.kind !== 'op') continue;
    const body = message.body as OpBody;
    if (body.id === opId && body.phase === 'end') return body;
  }
  return null;
};

// Calls `ended` once with the op's end body, or with null after OUTCOME_WAIT_MS without one. Answers the unfollow.
export function followOp(appSessionId: AppSessionId, opId: string, ended: (body: OpBody | null) => void, client: MawsBridge): () => void {
  const held = endOf(opMessagesOf(appSessionId, opId), opId);
  if (held) {
    ended(held);
    return () => {};
  }
  let done = false;
  let off: () => void = () => {};
  const finish = (body: OpBody | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    off();
    ended(body);
  };
  const timer = setTimeout(() => finish(null), OUTCOME_WAIT_MS);
  off = watchLaneA(
    appSessionId,
    (event) => {
      const body = event.kind === 'messages' ? endOf(event.messages, opId) : null;
      if (body) finish(body);
    },
    { client },
  );
  if (done) off(); // the watch delivered the end while opening
  return () => {
    done = true;
    clearTimeout(timer);
    off();
  };
}

// Says `/name`'s outcome once the op `opId` ends; an end that never arrives says nothing, its row being the record.
export function announceCommand(appSessionId: AppSessionId, name: string, opId: string, client: MawsBridge): void {
  followOp(
    appSessionId,
    opId,
    (body) => {
      if (!body) return;
      const outcome = commandOutcomeText(body);
      toast({ level: outcome.state === 'failed' ? 'warning' : 'info', text: `/${name}: ${outcome.text}`, actions: [], dismissible: true });
    },
    client,
  );
}

export const SIDE_ANSWER_WORDS = {
  lost: 'No answer arrived from the terminal session',
  failed: 'The side question failed',
};

// A side question's end as the side pane keeps it: its answer's text, or why it has none (the bridge's `error`, else its reason).
export function sideAnswerOf(body: OpBody | null): { response: string } | { error: string } {
  if (body === null) return { error: SIDE_ANSWER_WORDS.lost };
  if (typeof body.text === 'string') return { response: body.text };
  if (typeof body.error === 'string' && body.error !== '') return { error: body.error };
  return { error: typeof body.reason === 'string' ? `${SIDE_ANSWER_WORDS.failed}: ${body.reason}` : SIDE_ANSWER_WORDS.failed };
}
