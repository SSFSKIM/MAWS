// An answer's fate, followed from what the host and the engine say happened to its prompt (the P2-C document, Design
// §6, "An answer's members"). An answer in flight is tracked by its members, the queue entries and message uuids that
// have carried it. The first comes from the seam's result; every later one only from a `queue.transition` row naming a
// member (two-way: every id the row names joins, with the life the row gives it), never from text. The engine's
// `command.lifecycle` `started` or `completed` for a member uuid delivers the answer, for good; `discarded`, `refused`,
// or `cancelled` for a uuid the host is not withdrawing kills that uuid for good (no later row revives it); a `cancelled`
// while the host withdraws it waits for the host's outcome row (`hold`, `cancel`, `giveback`). A member added late is
// reconciled at once against the lifecycle evidence already seen for it. Nothing here concludes from absence: the service's recovery read does, after
// a fold of the journals, and an `unknown` member waits for the transcript's evidence. A question may have several
// answers (`settleAnswers`); each follows its own members.
import type { PromptHistoryEvent } from '@shared/graph/events';
import type { AnswerMember, AnswerOrigin } from '@shared/owner/state';

export type PromptEvent = PromptHistoryEvent; // a `queue.transition` or a `command.lifecycle`
type Life = AnswerMember['life'];
type TransitionAction = Extract<PromptEvent, { kind: 'queue.transition' }>['action'];

export type AnswerStatus = 'queued' | 'unconfirmed' | 'delivered' | 'unanswered';

export interface Answer {
  text: string; // the prompt sent
  origin: AnswerOrigin | 'legacy'; // legacy: a prompt legacy recognition read as the answer (born delivered)
  members: AnswerMember[];
  // what no member can settle: a seam result without an identifier, or a recovery the journals and the transcript left
  // open; the answer reads `unconfirmed` until a member delivers it (or every member is known dead)
  unconfirmed: boolean;
  deliveredAt: string | null;
  failed: { reason: string } | null; // the last refused send (in memory only)
  reportedAt: string; // when main learnt of it: the recovery read starts a window before it
  readonly applied: Set<string>; // the event ids already applied (a log replay and a recovery fold overlap)
  readonly droppedWhileWithdrawing: Set<string>; // uuids the engine cancelled while the host withdrew them
  readonly ended: Set<string>; // uuids the engine itself ended (discarded, refused, cancelled unasked): no row revives them
}

// The lives a row gives the ids it names (Design §6's table); undefined: the row says nothing of that id.
const ENTRY_LIFE: Partial<Record<TransitionAction, Life>> = {
  release: 'alive', revert: 'alive', uncertain: 'alive', retire: 'dead', drop: 'dead', hold: 'alive', promote: 'dead', remove: 'dead',
};
const UUID_LIFE: Partial<Record<TransitionAction, Life>> = {
  release: 'alive', revert: 'dead', uncertain: 'unknown', retire: 'dead', drop: 'dead', withdraw: 'withdrawing', giveback: 'alive', hold: 'dead',
  cancel: 'dead', abandon: 'dead', promote: 'alive',
};

// An answer as the table keeps it (one element of `owner_channel_marks.answer_attempts`); `deliveredAt` once the engine
// took it.
export interface StoredAnswer {
  text: string;
  origin: Answer['origin'];
  members: AnswerMember[];
  unconfirmed: boolean;
  reportedAt: string;
  deliveredAt?: string;
}

export function newAnswer(seed: StoredAnswer): Answer {
  return { ...seed, members: seed.members.map((member) => ({ ...member })), deliveredAt: seed.deliveredAt ?? null, failed: null, applied: new Set(), droppedWhileWithdrawing: new Set(), ended: new Set() };
}

export const storedOf = (answer: Answer): StoredAnswer => ({
  text: answer.text, origin: answer.origin, members: answer.members, unconfirmed: answer.unconfirmed, reportedAt: answer.reportedAt,
  ...(answer.deliveredAt === null ? {} : { deliveredAt: answer.deliveredAt }),
});

export function statusOf(answer: Answer): AnswerStatus {
  if (answer.deliveredAt !== null) return 'delivered';
  const open = answer.members.some((member) => member.life !== 'dead');
  if (answer.unconfirmed && (open || answer.members.length === 0)) return 'unconfirmed';
  return open ? 'queued' : 'unanswered';
}

// Still on its way: a member may yet carry it, or nothing can tell (unconfirmed).
export const onItsWay = (answer: Answer): boolean => statusOf(answer) === 'queued' || statusOf(answer) === 'unconfirmed';

/**
 * One question's answers, oldest first, sorted by what they came to. Each keeps its own text and members ("Answer again"
 * sends a new one, as does a follow-up Reply; legacy recognition adds one taken), so one answer's evidence settles that
 * answer only. The newest the engine took is the question's answer (`delivered`). An older one can no longer change
 * that, but it is still the question's: it is followed while a member may carry it, and kept for good once the engine
 * took it, so a prompt that carried it is never read as another question's answer (Design §6, legacy recognition); one
 * no member carries any more goes. After the delivered one, an answer no member carries any more is `dead` (its
 * refusal, if any, is the question's note), and the rest are `open`: the question's card reads the newest of them.
 * `kept` is what the question keeps, in order.
 */
export function settleAnswers(attempts: readonly Answer[]): { delivered: Answer | null; open: Answer[]; dead: Answer[]; kept: Answer[] } {
  const newest = attempts.findLastIndex((attempt) => statusOf(attempt) === 'delivered');
  const delivered = newest < 0 ? null : attempts[newest]!;
  const older = attempts.slice(0, Math.max(newest, 0)).filter((attempt) => statusOf(attempt) === 'delivered' || attempt.members.some((m) => m.life !== 'dead'));
  const later = attempts.slice(newest + 1);
  const open = later.filter((attempt) => statusOf(attempt) !== 'unanswered');
  return { delivered, open, dead: later.filter((attempt) => statusOf(attempt) === 'unanswered'), kept: [...older, ...(delivered === null ? [] : [delivered]), ...open] };
}

const memberOf = (answer: Answer, kind: AnswerMember['kind'], id: string | null) => (id === null ? undefined : answer.members.find((m) => m.kind === kind && m.id === id));

/**
 * Applies one event to an answer; true when the answer changed. `seen` answers the evidence observed before this event,
 * in order (the session's log, or the folded history): a uuid that joins is reconciled against its lifecycles there.
 */
export function applyEvent(answer: Answer, event: PromptEvent, seen: () => Iterable<PromptEvent>): boolean {
  if (answer.deliveredAt !== null || answer.applied.has(event.id)) return false;
  if (event.kind === 'command.lifecycle') return applyLifecycle(answer, event);
  const entry = memberOf(answer, 'entry', event.queueId);
  const uuid = memberOf(answer, 'uuid', event.messageUuid);
  if (entry === undefined && uuid === undefined) return false;
  answer.applied.add(event.id);
  const joined: string[] = [];
  const set = (kind: AnswerMember['kind'], id: string | null, life: Life | undefined) => {
    if (id === null || life === undefined) return;
    const member = memberOf(answer, kind, id);
    if (member) member.life = life;
    else {
      answer.members.push({ kind, id, life });
      if (kind === 'uuid') joined.push(id);
    }
  };
  let uuidLife = UUID_LIFE[event.action];
  if (event.messageUuid !== null) {
    // a giveback returns a steer the engine kept, unless the engine cancelled it while the host was withdrawing it; and
    // a uuid the engine ended stays ended whatever the host's claim says of it after (a withdrawal it then gives back)
    if (event.action === 'giveback' && answer.droppedWhileWithdrawing.has(event.messageUuid)) uuidLife = 'dead';
    if (answer.ended.has(event.messageUuid) && uuidLife !== undefined) uuidLife = 'dead';
    if (uuidLife !== 'withdrawing') answer.droppedWhileWithdrawing.delete(event.messageUuid);
  }
  set('entry', event.queueId, ENTRY_LIFE[event.action]);
  set('uuid', event.messageUuid, uuidLife);
  if (event.action === 'drop' && event.reason === 'refused') answer.failed = { reason: 'refused' };
  if (joined.length > 0) {
    for (const prior of seen()) if (prior.kind === 'command.lifecycle' && joined.includes(prior.commandUuid)) applyLifecycle(answer, prior);
  }
  return true;
}

function applyLifecycle(answer: Answer, event: Extract<PromptEvent, { kind: 'command.lifecycle' }>): boolean {
  if (answer.deliveredAt !== null || answer.applied.has(event.id)) return false;
  const member = memberOf(answer, 'uuid', event.commandUuid);
  if (member === undefined) return false;
  answer.applied.add(event.id);
  switch (event.state) {
    case 'started':
    case 'completed':
      answer.deliveredAt = event.at;
      answer.failed = null;
      return true;
    case 'discarded':
    case 'refused':
      member.life = 'dead';
      answer.ended.add(member.id);
      if (event.state === 'refused') answer.failed = { reason: 'refused' };
      return true;
    case 'cancelled':
      // the host's own withdrawal: its outcome row decides
      if (member.life === 'withdrawing') answer.droppedWhileWithdrawing.add(member.id);
      else {
        member.life = 'dead';
        answer.ended.add(member.id);
      }
      return true;
    default:
      return false; // `queued`: the engine has it waiting, which every member already reads as alive
  }
}
