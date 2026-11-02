// The host's side-question log (E3 execution document, Interfaces "The host's side-question log", Design §7): one per
// EngineSession, the `/btw` exchanges of that process in the order asked. It is host state (X13): a renderer reload
// lists it again (`side.question.list`), and nothing of it becomes an X1 event, as the engine writes no transcript
// record for a side question. Each ask carries the answered, non-synthetic exchanges before it as `history` (the
// bridge's shape the headless handler accepts, pass3/p1-side-question-session seq 95), which is the engine's own
// `btwHistory` rule (SPEC 11 §11.11.6). A Retry names the failed entry it asks again, which the log drops once the
// retry is entered (E11), so a renderer reload never lists a retried failure again.
import type { OperationEvent } from '@shared/engine/operations';
import type { SideExchange } from '@shared/side/question';
import type { SideQuestionResponse } from '@shared/wire/control';

const SESSION_ENDED = 'The session ended';
const HOST_RESTARTED = 'The engine host restarted before the answer arrived'; // P5 O16 M3

export class SideQuestionLog {
  private readonly entries: SideExchange[] = [];

  // The history to send with `question`, and the bind that enters it under the operation id once the request was
  // written. A question whose request never got an id (the write threw) is never entered, so no entry is left that
  // nothing can settle. `retryOf`, a failed entry this question asks again, goes when the question is entered; one that
  // is no longer failed (a late success answered it) stays.
  ask(question: string, askedAt: string, retryOf?: string): { history: { question: string; response: string }[] | undefined; bind(opId: string): void } {
    const history = this.entries.flatMap((e) => (e.state === 'answered' && !e.synthetic && e.response !== null ? [{ question: e.question, response: e.response }] : []));
    return {
      history: history.length > 0 ? history : undefined,
      bind: (opId) => {
        const retried = this.entries.findIndex((e) => e.id === retryOf && e.state === 'failed');
        if (retried !== -1) this.entries.splice(retried, 1);
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

  // P5 O16 M3 (Interfaces §D; D24): one row of a launch's journal, folded by an adopter: each `side_question` the old
  // manager wrote is an entry under its request id (the operation id, operations.ts), answered or failed by the
  // engine's answer the journal holds.
  restore(row: { direction: string; at: string; frame: unknown }): void {
    const f = (row.frame ?? {}) as { type?: unknown; request_id?: unknown; request?: { subtype?: unknown; question?: unknown }; response?: { subtype?: unknown; request_id?: unknown; response?: unknown; error?: unknown } };
    if (row.direction === 'out' && f.type === 'control_request' && f.request?.subtype === 'side_question' && typeof f.request_id === 'string') {
      this.entries.push({ id: f.request_id, question: String(f.request.question ?? ''), state: 'pending', response: null, synthetic: false, error: null, askedAt: row.at, answeredAt: null });
    } else if (row.direction === 'in' && f.type === 'control_response' && typeof f.response?.request_id === 'string') {
      const entry = this.entries.find((e) => e.id === f.response!.request_id);
      if (!entry || entry.state !== 'pending') return;
      const value = (f.response.response ?? {}) as { response?: unknown; synthetic?: unknown };
      if (f.response.subtype === 'success') Object.assign(entry, { state: 'answered', response: typeof value.response === 'string' ? value.response : null, synthetic: value.synthetic === true, answeredAt: row.at });
      else Object.assign(entry, { state: 'failed', error: typeof f.response.error === 'string' ? f.response.error : 'the engine could not answer', answeredAt: row.at });
    }
  }

  // P5 O16 M3: the fold ended; a question still pending was asked by the old manager, whose operation no one completes
  // now (the engine's late answer names a request this writer never sent), so it reads failed and can be retried.
  adopted(at: string): void {
    for (const entry of this.entries) if (entry.state === 'pending') Object.assign(entry, { state: 'failed', error: HOST_RESTARTED, answeredAt: at });
  }

  processExited(at: string): void {
    for (const entry of this.entries) if (entry.state === 'pending') Object.assign(entry, { state: 'failed', error: SESSION_ENDED, answeredAt: at });
  }
}
