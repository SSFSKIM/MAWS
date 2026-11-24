// A surface's memory of one session's sheet (S13 to S15; the C3 plan's §G): the drafts, the revision of each question
// the person last saw, the questions marked updated, the acts this surface sent, and a Send in flight. A consumer keeps
// it per session, outside the components, so it survives a tab's unmount; the components read it and hand back the next.
// `reconcile` is the one place a new model changes it; the acts below are the person's.
import type { SheetLine, SheetModel, SheetPutResult, SheetQuestion, SheetSent, SheetSentState } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { SHEET_WORDS } from './copy';

export interface SentAct {
  key: string;
  kind: 'answer' | 'dismiss' | 'retract';
  id: string | null; // the question: an answer's or a dismissal's own, a retract's target's
  draft: QuestionDraft | null; // an answer's draft as it was sent: restored when the answer is refused as stale
  sentAt: number;
  state: 'sending' | SheetSentState | 'failed'; // 'sending' until the model knows the key (S15)
  note: string | null; // what the sheet's head says of it: an act that came second, a retract too late
}

export interface SheetMemory {
  drafts: ReadonlyMap<string, QuestionDraft>;
  seen: ReadonlyMap<string, number>;
  marked: ReadonlySet<string>;
  acts: readonly SentAct[];
  sending: { lines: readonly SheetLine[]; state: 'sending' | 'failed'; note: string | null } | null;
}

export const EMPTY_MEMORY: SheetMemory = { drafts: new Map(), seen: new Map(), marked: new Set(), acts: [], sending: null };

function noteOf(act: SentAct, sent: SheetSent): string | null {
  const id = act.id ?? ('id' in sent && typeof sent.id === 'string' ? sent.id : '');
  if (sent.state === 'too-late') return SHEET_WORDS.notes.tooLate(id);
  if (sent.state !== 'closed') return null;
  return SHEET_WORDS.notes[sent.how === 'answered' ? 'answered' : sent.how === 'dismissed' ? 'dismissed' : sent.how === 'withdrawn' ? 'withdrawn' : 'unknown'](id);
}

/**
 * The memory as it stands against a new model. A question listed for the first time has its revision seen; one whose
 * revision passed the seen one is marked, its draft left at the revision it was typed against. Each act reads its state
 * from the model's `sent` by key: one the model knows drops the draft it carried, if the person typed nothing since; one
 * refused as stale puts that draft back and marks its question; one delivered or retracted is forgotten; one closed or
 * too late keeps its note until the person closes it. A question the model no longer lists loses its draft, its seen
 * revision and its mark. Answers the same memory when nothing changed.
 */
export function reconcile(memory: SheetMemory, model: SheetModel): SheetMemory {
  const listed = new Map(model.open.map((question) => [question.id, question]));
  const sent = new Map(model.sent.map((entry) => [entry.key, entry]));
  const drafts = new Map(memory.drafts);
  const seen = new Map(memory.seen);
  const marked = new Set(memory.marked);
  let actsChanged = false;

  const acts: SentAct[] = [];
  for (const act of memory.acts) {
    const entry = sent.get(act.key);
    if (!entry) {
      acts.push(act);
      continue;
    }
    if (entry.state === 'delivered' || entry.state === 'retracted') {
      actsChanged = true;
      continue;
    }
    const awaiting = act.state === 'sending' || act.state === 'failed';
    if (awaiting && act.id !== null && act.draft !== null && drafts.get(act.id) === act.draft) drafts.delete(act.id);
    if (entry.state === 'stale' && act.state !== 'stale' && act.id !== null) {
      if (act.draft !== null) drafts.set(act.id, act.draft);
      marked.add(act.id);
    }
    const note = act.note ?? noteOf(act, entry);
    if (act.state === entry.state && act.note === note) acts.push(act);
    else {
      actsChanged = true;
      acts.push({ ...act, state: entry.state, note });
    }
  }

  for (const id of [...drafts.keys()]) if (!listed.has(id)) drafts.delete(id);
  for (const id of [...seen.keys()]) if (!listed.has(id)) seen.delete(id);
  for (const id of [...marked]) if (!listed.has(id)) marked.delete(id);
  for (const question of model.open) {
    const was = seen.get(question.id);
    if (was === undefined) seen.set(question.id, question.revision);
    else if (was < question.revision) marked.add(question.id);
  }

  const sameMap = <V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((k) => b.has(k));
  const sameDrafts = sameMap(memory.drafts, drafts);
  const sameSeen = sameMap(memory.seen, seen);
  const sameMarked = sameSet(memory.marked, marked);
  if (sameDrafts && sameSeen && sameMarked && !actsChanged) return memory;
  return {
    drafts: sameDrafts ? memory.drafts : drafts,
    seen: sameSeen ? memory.seen : seen,
    marked: sameMarked ? memory.marked : marked,
    acts: actsChanged ? acts : memory.acts,
    sending: memory.sending,
  };
}

/**
 * The person's act on a card: its draft set (null: none), which confirms what they see. The question's revision is seen
 * again, and its mark, with the stale act behind it, clears (S14).
 */
export function editDraft(memory: SheetMemory, question: SheetQuestion, next: QuestionDraft | null): SheetMemory {
  const drafts = new Map(memory.drafts);
  if (next === null) drafts.delete(question.id);
  else drafts.set(question.id, next);
  const seen = new Map(memory.seen).set(question.id, question.revision);
  const marked = new Set(memory.marked);
  marked.delete(question.id);
  const acts = memory.acts.filter((act) => !(act.id === question.id && act.state === 'stale'));
  return { ...memory, drafts, seen, marked, acts };
}

/**
 * A Send pressed, or sent again: its exact lines held until the door answers, and an act per line, an act already
 * recorded under the key (a Send sent again) taken back to `sending`. `targets` names the question of each key a
 * retract may name.
 */
export function startSend(memory: SheetMemory, lines: readonly SheetLine[], now: number, targets: Readonly<Record<string, string>> = {}): SheetMemory {
  const acts = [...memory.acts];
  for (const line of lines) {
    const at = acts.findIndex((act) => act.key === line.key);
    if (at >= 0) {
      acts[at] = { ...acts[at], state: 'sending', sentAt: now };
      continue;
    }
    const id = line.kind === 'retract' ? (targets[line.target ?? ''] ?? null) : (line.id ?? null);
    const draft = line.kind === 'answer' && id !== null ? (memory.drafts.get(id) ?? null) : null;
    acts.push({ key: line.key, kind: line.kind, id, draft, sentAt: now, state: 'sending', note: null });
  }
  return { ...memory, acts, sending: { lines, state: 'sending', note: null } };
}

/**
 * The door's answer to the Send held. Sent: nothing is held, and what became of each act is the model's to say (S15).
 * Not sent: every draft stays and the same lines are held to be sent again, keys and all.
 */
export function sendAnswered(memory: SheetMemory, lines: readonly SheetLine[], result: SheetPutResult): SheetMemory {
  if (result.ok) return { ...memory, sending: null };
  const keys = new Set(lines.map((line) => line.key));
  const acts = memory.acts.map((act) => (keys.has(act.key) ? { ...act, state: 'failed' as const } : act));
  return { ...memory, acts, sending: { lines, state: 'failed', note: result.message } };
}

/** The person closed an act's note. */
export const closeNote = (memory: SheetMemory, key: string): SheetMemory => ({ ...memory, acts: memory.acts.filter((act) => act.key !== key) });
