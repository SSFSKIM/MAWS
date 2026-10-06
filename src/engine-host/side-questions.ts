// The host's side-question log (E3 execution document, Interfaces "The host's side-question log", Design §7): one per
// EngineSession, the `/btw` exchanges of that process in the order asked. It is host state (X13): a renderer reload
// lists it again (`side.question.list`), and nothing of it becomes an X1 event, as the engine writes no transcript
// record for a side question. Each ask carries the answered, non-synthetic exchanges before it as `history` (the
// bridge's shape the headless handler accepts, pass3/p1-side-question-session seq 95), which is the engine's own
// `btwHistory` rule (SPEC 11 §11.11.6).
import type { OperationEvent } from '@shared/engine/operations';
import type { SideExchange } from '@shared/side/question';
import type { SideQuestionResponse } from '@shared/wire/control';

export const SESSION_ENDED = 'The session ended';

export class SideQuestionLog {
  private readonly entries: SideExchange[] = [];

  // The history to send with `question`, and the bind that enters it under the operation id once the request was
  // written. A question whose request never got an id (the write threw) is never entered, so no entry is left that
  // nothing can settle.
  ask(question: string, askedAt: string): { history: { question: string; response: string }[] | undefined; bind(opId: string): void } {
    const history = this.entries.flatMap((e) => (e.state === 'answered' && !e.synthetic && e.response !== null ? [{ question: e.question, response: e.response }] : []));
    return {
      history: history.length > 0 ? history : undefined,
      bind: (opId) => {
        this.entries.push({ id: opId, question, state: 'pending', response: null, synthetic: false, error: null, askedAt, answeredAt: null });
      },
    };
  }

  // A completion of `session.sideQuestion`. A success answers the entry whatever it read before (a late success after
  // the timeout, or after the exit failed it); a failure settles only a pending entry, so the first word stands.
  settle(opId: string, outcome: OperationEvent['outcome'], at: string): void {
    const entry = this.entries.find((e) => e.id === opId);
    if (!entry) return;
    if (outcome.ok) {
      const value = outcome.value as SideQuestionResponse; // the side_question schema parsed it
      Object.assign(entry, { state: 'answered', response: value.response, synthetic: value.synthetic, error: null, answeredAt: at });
    } else if (entry.state === 'pending') {
      Object.assign(entry, { state: 'failed', error: outcome.error.message, answeredAt: at });
    }
  }

  list(): SideExchange[] {
    return this.entries.map((e) => ({ ...e }));
  }

  // A new side conversation: answered and failed entries go; pending ones stay, so their completions find them.
  clear(): void {
    const pending = this.entries.filter((e) => e.state === 'pending');
    this.entries.splice(0, this.entries.length, ...pending);
  }

  processExited(at: string): void {
    for (const entry of this.entries) if (entry.state === 'pending') Object.assign(entry, { state: 'failed', error: SESSION_ENDED, answeredAt: at });
  }
}
