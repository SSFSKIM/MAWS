// The reader's computation (C2's I4, steps 2 to 7): the model of a record from its `state.json` and the inbox's tail,
// held to the pinned set's `show.*.json` (read.test.ts) and ported from sminos's own reader (`model`, `queued_lines`,
// `line_error`, `pick_error`, `bounded` in sminos_sheet.py at the pin). Step 1, reading the pair, is the caller's
// (src/services/sheet/reader.ts). Pure: no Node builtin, no DOM.
import type { SheetBy, SheetModel, SheetOutcome, SheetQuestion, SheetSent, SheetState, SheetSummary, StoredOutcome, StoredReference } from './model';
import { codePoints, cut, hasLoneSurrogate, wellFormed } from './text';

const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const ID = /^q[1-9][0-9]{0,8}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const UPLOAD = /^uploads\/[A-Za-z0-9._-]{1,250}\.(png|jpg|jpeg|gif|webp)$/;
const KINDS = ['answer', 'dismiss', 'retract', 'delivered'];
const BYS = ['page', 'maws', 'desk', 'cli'];
const FIELDS = ['v', 'key', 'kind', 'id', 'revision', 'picks', 'text', 'images', 'target', 'keys', 'batch', 'by', 'at'];
// What a pending outcome carries, each string at most (I4 step 7): an imported question has no input bounds.
const CUT_QUESTION = 2000;
const CUT_LABEL = 200;
const CUT_HEADER = 60;
const CUT_NAME = 200;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
// A JSON integer at least `least`: 1.0 is the integer 1, as JSON Schema counts it (JSON.parse cannot tell them apart).
const isCount = (value: unknown, least: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= least;
const isString = (value: unknown): value is string => typeof value === 'string';
const holds = (pattern: RegExp, value: unknown): boolean => isString(value) && pattern.test(value);
const has = (value: object, field: string): boolean => Object.hasOwn(value, field);

/** Why an inbox line fails the line's schema (`schema/inbox-line.schema.json`), or null. */
export function lineError(line: unknown): string | null {
  if (!isObject(line)) return 'a line is a JSON object';
  const extra = Object.keys(line)
    .filter((field) => !FIELDS.includes(field))
    .sort();
  if (extra.length > 0) return `unknown field ${extra[0]}`;
  if (!(isCount(line.v, 1) && line.v === 1)) return 'v is 1';
  for (const field of ['key', 'kind', 'by']) if (!has(line, field)) return `${field} is required`;
  if (!holds(KEY, line.key)) return 'key is 8 to 128 of [A-Za-z0-9._:-]';
  if (!KINDS.includes(line.kind as string)) return `kind is one of ${KINDS.join(', ')}`;
  if (!BYS.includes(line.by as string)) return `by is one of ${BYS.join(', ')}`;
  if (has(line, 'at') && !holds(TIME, line.at)) return 'at is a UTC time with milliseconds';
  if (has(line, 'id') && !holds(ID, line.id)) return 'id is q<n>, n at most 999999999';
  if (has(line, 'revision') && !isCount(line.revision, 1)) return 'revision is an integer from 1';
  if (has(line, 'picks') && !(Array.isArray(line.picks) && line.picks.length <= 12 && line.picks.every(isString))) {
    return 'picks are at most 12 labels';
  }
  if (has(line, 'text') && !(isString(line.text) && codePoints(line.text) <= 20000)) return 'text is at most 20,000 characters';
  if (has(line, 'images') && !(Array.isArray(line.images) && line.images.length <= 8 && line.images.every((image) => holds(UPLOAD, image)))) {
    return 'images are at most 8 uploads/<name>.png|jpg|jpeg|gif|webp, its name before the final dot 1 to 250 characters';
  }
  for (const field of ['target', 'batch']) if (has(line, field) && !holds(KEY, line[field])) return `${field} is a key`;
  if (has(line, 'keys') && !(Array.isArray(line.keys) && line.keys.length >= 1 && line.keys.length <= 200 && line.keys.every((key) => holds(KEY, key)))) {
    return 'keys are 1 to 200 keys';
  }
  // Last: every field is known by now, each a string or a list of strings.
  if (holdsLoneSurrogate(line)) return 'a string holds a lone UTF-16 surrogate';
  const filled = (field: 'picks' | 'text'): boolean => {
    const value = line[field];
    return Array.isArray(value) ? value.length > 0 : isString(value) && value.length > 0;
  };
  switch (line.kind) {
    case 'answer':
      if (!has(line, 'id') || !has(line, 'revision')) return 'an answer names id and revision';
      if (!filled('picks') && !filled('text')) return 'an answer has picks or text';
      break;
    case 'dismiss':
      if (!has(line, 'id')) return 'a dismissal names id';
      break;
    case 'retract':
      if (!has(line, 'target')) return 'a retract names target';
      break;
    case 'delivered':
      if (!has(line, 'keys')) return 'a delivered line names keys';
      break;
  }
  return null;
}

function holdsLoneSurrogate(value: unknown): boolean {
  if (isString(value)) return hasLoneSurrogate(value);
  if (Array.isArray(value)) return value.some(holdsLoneSurrogate);
  if (isObject(value)) return Object.entries(value).some(([key, inner]) => hasLoneSurrogate(key) || holdsLoneSurrogate(inner));
  return false;
}

// Why an answer's picks are no labels of the question it answers at its current revision, or more than one on a
// single-select question (U2); null otherwise, and for every other line.
function pickError(line: Json, questions: SheetState['questions']): string | null {
  if (line.kind !== 'answer') return null;
  const question = questions.find((q) => q.id === line.id);
  if (question === undefined || question.revision !== line.revision) return null;
  const labels = question.options.map((option) => option.label);
  const picks = (line.picks as string[] | undefined) ?? [];
  for (const pick of picks) {
    if (!labels.includes(pick)) return `${question.id} has no option ${JSON.stringify(pick).slice(0, 210)} at revision ${question.revision}`;
  }
  if (picks.length > 1 && !question.multiSelect) return `${question.id} takes one pick`;
  return null;
}

const NEWLINE = 0x0a;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// The tail's lines up to its last newline: bytes after it are a write that did not finish (I4 step 1).
function linesOf(tail: Uint8Array): Uint8Array[] {
  const end = tail.lastIndexOf(NEWLINE);
  const out: Uint8Array[] = [];
  let start = 0;
  while (start <= end) {
    const stop = tail.indexOf(NEWLINE, start);
    out.push(tail.subarray(start, stop));
    start = stop + 1;
  }
  return out;
}

// The tail's valid lines whose key has no verdict and did not occur earlier in the tail, in file order (I4 step 2).
// A line is dropped when it is not valid UTF-8, is not JSON (NaN and the infinities are not, nor is a leading byte
// order mark), fails the line's schema, holds a lone surrogate, or picks what its question at that revision does not
// offer; a dropped line shadows no later line of its key.
function queuedLines(state: SheetState, tail: Uint8Array): Json[] {
  const seen = new Set(Object.keys(state.verdicts));
  const out: Json[] = [];
  for (const raw of linesOf(tail)) {
    let line: unknown;
    try {
      line = JSON.parse(utf8.decode(raw));
    } catch {
      continue;
    }
    if (lineError(line) !== null || pickError(line as Json, state.questions) !== null) continue;
    const key = (line as Json).key as string;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line as Json);
  }
  return out;
}

const cutAsker = <A>(asker: A): A => (isObject(asker) ? ({ ...asker, name: cut(String(asker.name ?? ''), CUT_NAME) } as A) : asker);

// A pending outcome as the model carries it (I4 step 7): an answer's picks also as `places`, integers from 1 among
// the options of the answered revision, read from the whole snapshot before any label is cut (two imported labels can
// share their first 200 characters); then the question's strings cut.
function bounded(outcome: StoredOutcome): SheetOutcome {
  const labels = outcome.question.options;
  const question = {
    ...outcome.question,
    question: cut(outcome.question.question, CUT_QUESTION),
    ...(outcome.question.header === undefined ? {} : { header: cut(outcome.question.header, CUT_HEADER) }),
    options: labels.map((label) => cut(label, CUT_LABEL)),
    asker: cutAsker(outcome.question.asker),
  };
  if (outcome.kind !== 'answer') return { ...outcome, question };
  return {
    ...outcome,
    question,
    places: outcome.picks.filter((pick) => labels.includes(pick)).map((pick) => labels.indexOf(pick) + 1),
    picks: outcome.picks.map((pick) => cut(pick, CUT_LABEL)),
  };
}

// Every string of a value, keys included, with each lone surrogate written as U+FFFD (the README's "A reader never
// fails on a record's strings").
function printable<T>(value: T): T {
  if (isString(value)) return wellFormed(value) as T;
  if (Array.isArray(value)) return value.map(printable) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [wellFormed(key), printable(inner)])) as T;
  return value;
}

/**
 * The model of a record (C2's I4, steps 2 to 7) from a `state.json` and the inbox's bytes from `state.inbox.offset` to
 * the end of the file. `changedOf` says whether a reference's file differs from the one captured, or null where the
 * reader is not on the session's machine.
 */
export function modelOf(state: SheetState, tail: Uint8Array, changedOf: (reference: StoredReference) => boolean | null): SheetModel {
  const queued = queuedLines(state, tail);
  const retracted = new Set(queued.filter((line) => line.kind === 'retract').map((line) => line.target as string));
  const cancelled = new Set(
    queued.filter((line) => (line.kind === 'answer' || line.kind === 'dismiss') && retracted.has(line.key as string)).map((line) => line.key as string),
  );
  const live = queued.filter((line) => !cancelled.has(line.key as string));
  const pendingKeys = new Set(state.pending.map((outcome) => outcome.key));

  // Keys with a verdict sorted by code unit (keys are ASCII), then the queued lines in inbox order (I4 step 4).
  const sent: Json[] = Object.keys(state.verdicts)
    .sort()
    .map((key) => {
      const verdict = state.verdicts[key] as Json;
      const st = pendingKeys.has(key) ? 'accepted' : verdict.verdict === 'applied' ? 'delivered' : verdict.verdict;
      return { key, state: st, ...verdict };
    });
  // A queued entry by its kind, as the show schema separates them: an answer or a dismissal names its question (and
  // reads cancelled where a queued retract names it), a retract its target, a `delivered` line neither, whatever other
  // field the line carried.
  for (const line of queued) {
    const key = line.key as string;
    if (line.kind === 'answer' || line.kind === 'dismiss') {
      sent.push({ key, kind: line.kind, state: 'queued', id: line.id, ...(cancelled.has(key) ? { cancelled: true } : {}) });
    } else if (line.kind === 'retract') {
      sent.push({ key, kind: line.kind, state: 'queued', target: line.target });
    } else {
      sent.push({ key, kind: line.kind, state: 'queued' });
    }
  }

  const hidden: { id: string; key: string }[] = [];
  const open: SheetQuestion[] = [];
  for (const question of state.questions) {
    const dismissal = live.find((line) => line.kind === 'dismiss' && line.id === question.id);
    if (dismissal !== undefined) {
      hidden.push({ id: question.id, key: dismissal.key as string });
      continue;
    }
    const answer = live.find((line) => line.kind === 'answer' && line.id === question.id);
    open.push({
      ...question,
      references: question.references.map((reference) => ({ ...reference, changed: changedOf(reference) })),
      handle: question.revision === 1 ? question.id : `${question.id}@${question.revision}`,
      ...(answer === undefined
        ? {}
        : {
            queued: {
              key: answer.key as string,
              kind: 'answer' as const,
              picks: (answer.picks as string[] | undefined) ?? [],
              text: (answer.text as string | undefined) ?? '',
              images: (answer.images as string[] | undefined) ?? [],
              revision: answer.revision as number,
              by: answer.by as SheetBy,
              ...(has(answer, 'at') ? { at: answer.at as string } : {}),
            },
          }),
    });
  }

  const closed = Object.fromEntries(
    Object.entries(state.closed).map(([id, entry]) => {
      const kept: Json = {};
      for (const field of ['how', 'at', 'revision', 'asker', 'header', 'receipt', 'places', 'deliveredAt']) {
        if (has(entry, field)) kept[field] = (entry as Json)[field];
      }
      return [id, kept];
    }),
  );

  return printable({
    v: 1,
    session: state.session,
    seq: state.seq,
    open,
    hidden,
    sent: sent as SheetSent[],
    pending: state.pending.map(bounded),
    closed: closed as SheetModel['closed'],
  });
}

/** A record's summary: its counts from the model, and what the app's index knows of its session. */
export function summaryOf(model: SheetModel, facts: Pick<SheetSummary, 'appSessionId' | 'title' | 'live'>): SheetSummary {
  const waiting = model.open.filter((question) => question.queued === undefined);
  const asked = waiting.map((question) => question.askedAt).sort();
  return {
    session: model.session,
    appSessionId: facts.appSessionId,
    title: facts.title,
    live: facts.live,
    seq: model.seq,
    open: waiting.length,
    queued: model.open.length - waiting.length,
    pending: model.pending.length,
    hidden: model.hidden.length,
    oldestAskedAt: asked[0] ?? null,
    unreadable: false,
  };
}
