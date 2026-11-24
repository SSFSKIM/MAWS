// The question sheet's model: what a reader computes from a record (C2's I4, `sminos sheet show --json`), the record
// it is computed from, an inbox line as a surface writes it, and the shapes a surface exchanges with the machine that
// holds a record (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §B). Field for field as the pinned
// set's `schema/show.schema.json`, `state.schema.json` and `inbox-line.schema.json` state them
// (test/fixtures/sheet/set), each pattern matched against the whole string and each length counted in code points.
//
// Record-sourced shapes are loose objects (S5): a later sminos that adds a field does not blank a sheet. A record whose
// `v` is not 1 is not read at all (read.ts). The schemas the surfaces write (a line, a body request) are closed.
import * as z from 'zod';
import { AppSessionIdSchema } from '@shared/graph/ids';
import { codePoints } from './text';

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const ID = /^q[1-9][0-9]{0,8}$/;
const HANDLE = /^q[1-9][0-9]{0,8}(@[1-9][0-9]*)?$/;
const UPLOAD = /^uploads\/[A-Za-z0-9._-]{1,250}\.(png|jpg|jpeg|gif|webp)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TEXT_FILE = /^texts\/[0-9a-f]{64}\.txt$/;

/** An engine session id in the form `sminos sheet` takes, and the name of a record's directory. */
export const SheetSessionIdSchema = z.string().regex(SESSION);
export type SheetSessionId = z.infer<typeof SheetSessionIdSchema>;
/** The one rule for a session's name in the sheet: every path made from a session is made only when this holds. */
export const isSheetSession = (value: string): boolean => SESSION.test(value);

const Time = z.string().regex(TIME);
const Key = z.string().regex(KEY);
const QuestionId = z.string().regex(ID);
const Upload = z.string().regex(UPLOAD);
const Int0 = z.number().int().min(0);
const Int1 = z.number().int().min(1);
const atMost = (max: number) => z.string().refine((text) => codePoints(text) <= max, `at most ${max} characters`);

export const SheetBySchema = z.enum(['page', 'maws', 'desk', 'cli']);
export type SheetBy = z.infer<typeof SheetBySchema>;

const agent = (name: z.ZodType<string>) => z.looseObject({ agentId: z.string().min(1).pipe(atMost(128)), name });
export const SheetAskerSchema = z.union([z.literal('main'), agent(z.string())]);
export type SheetAsker = z.infer<typeof SheetAskerSchema>;
const CutAsker = z.union([z.literal('main'), agent(atMost(200))]);
const Recipient = z.union([z.literal('main'), z.looseObject({ agentId: z.string().min(1).pipe(atMost(128)) })]);

export const SheetOptionSchema = z.looseObject({
  label: z.string(),
  description: z.string().optional(),
  preview: z.string().optional(),
  recommended: z.boolean().optional(),
});
export type SheetOption = z.infer<typeof SheetOptionSchema>;

// A captured file: a text with Read's own line facts, or an image with its media type. The record stores it; the model
// adds `changed` (C2's I4 step 5). Each variant's shape is written out whole, so narrowing on `kind` gives a text its
// line facts as numbers and an image its media type as a string (a shape spread from a generic one typed them as absent).
const referenceBase = {
  path: z.string().min(1),
  abs: z.string().min(1),
  sha256: z.string().regex(SHA256),
  bytes: Int0,
  size: Int0,
  mtimeMs: Int0,
  lines: z.tuple([Int1, Int1]).optional(),
};
const textReference = { ...referenceBase, kind: z.literal('text'), startLine: Int1, numLines: Int0, totalLines: Int0, mediaType: z.string().optional() };
const imageReference = { ...referenceBase, kind: z.literal('image'), mediaType: z.string(), startLine: Int1.optional(), numLines: Int0.optional(), totalLines: Int0.optional() };
const changed = { changed: z.boolean().nullable() };
export const StoredReferenceSchema = z.discriminatedUnion('kind', [z.looseObject(textReference), z.looseObject(imageReference)]);
export type StoredReference = z.infer<typeof StoredReferenceSchema>;
export const SheetReferenceSchema = z.discriminatedUnion('kind', [z.looseObject({ ...textReference, ...changed }), z.looseObject({ ...imageReference, ...changed })]);
export type SheetReference = z.infer<typeof SheetReferenceSchema>;

const question = {
  id: QuestionId,
  revision: Int1,
  asker: SheetAskerSchema,
  question: z.string(),
  header: z.string().optional(),
  options: z.array(SheetOptionSchema),
  multiSelect: z.boolean(),
  context: z.string().optional(),
  askedAt: Time,
  callId: z.string().min(1),
  importedFrom: z.looseObject({ callId: z.string().min(1), index: Int0 }).optional(),
};
const StoredQuestionSchema = z.looseObject({ ...question, references: z.array(StoredReferenceSchema) });

/** A queued answer that stands on an open question: the first such line of the inbox's tail. */
export const SheetQueuedSchema = z.looseObject({
  key: Key,
  kind: z.literal('answer'),
  picks: z.array(z.string()),
  text: z.string(),
  images: z.array(Upload),
  revision: Int1,
  by: SheetBySchema,
  at: Time.optional(),
});
export type SheetQueued = z.infer<typeof SheetQueuedSchema>;

/** An open question as the model lists it: the record's, with its handle, each reference's `changed`, and `queued`. */
export const SheetQuestionSchema = z.looseObject({
  ...question,
  references: z.array(SheetReferenceSchema),
  handle: z.string().regex(HANDLE),
  queued: SheetQueuedSchema.optional(),
});
export type SheetQuestion = z.infer<typeof SheetQuestionSchema>;

// A pending outcome: the record holds it whole; the model cuts its question's strings and adds `places` (I4 step 7).
const outcome = <Q extends z.ZodType, A extends z.core.$ZodLooseShape>(snapshot: Q, answer: A) => {
  const base = {
    key: Key,
    id: QuestionId,
    revision: Int1,
    by: SheetBySchema,
    at: Time,
    acceptedAt: Time,
    batch: Key.optional(),
    recipient: Recipient,
    taken: z.boolean(),
    acrossStop: z.boolean(),
    question: snapshot,
  };
  return z.discriminatedUnion('kind', [
    z.looseObject({ ...base, kind: z.literal('answer'), images: z.array(Upload), textFile: z.string().regex(TEXT_FILE).optional(), ...answer }),
    z.looseObject({ ...base, kind: z.literal('dismiss') }),
  ]);
};
const snapshot = { multiSelect: z.boolean(), askedAt: Time };
const StoredOutcomeSchema = outcome(
  z.looseObject({ ...snapshot, asker: SheetAskerSchema, question: z.string(), header: z.string().optional(), options: z.array(z.string()) }),
  { picks: z.array(z.string()), text: z.string() },
);
export const SheetOutcomeSchema = outcome(
  z.looseObject({ ...snapshot, asker: CutAsker, question: atMost(2000), header: atMost(60).optional(), options: z.array(atMost(200)) }),
  { picks: z.array(atMost(200)), text: atMost(20000), places: z.array(Int1), textCut: z.literal(true).optional() },
);
export type SheetOutcome = z.infer<typeof SheetOutcomeSchema>;

const closed = { at: Time, revision: Int1, asker: SheetAskerSchema, header: z.string().optional() };
/** How a closed question closed, at which revision, and an answered one's receipt (I4 step 6). */
export const SheetClosedSchema = z.discriminatedUnion('how', [
  z.looseObject({ ...closed, how: z.literal('answered'), receipt: z.string(), places: z.array(Int1), deliveredAt: Time.optional() }),
  z.looseObject({ ...closed, how: z.literal('dismissed'), deliveredAt: Time.optional() }),
  z.looseObject({ ...closed, how: z.literal('withdrawn') }),
]);
export type SheetClosed = z.infer<typeof SheetClosedSchema>;

// A key's first verdict, as the record keeps it for its life (I2), each variant with its own fields.
const answerOrDismiss = z.enum(['answer', 'dismiss']);
const verdicts = {
  applied: { verdict: z.literal('applied'), kind: answerOrDismiss, at: Time, id: QuestionId },
  appliedDelivered: { verdict: z.literal('applied'), kind: z.literal('delivered'), at: Time },
  stale: { verdict: z.literal('stale'), kind: z.literal('answer'), at: Time, id: QuestionId, current: Int1 },
  closed: { verdict: z.literal('closed'), kind: answerOrDismiss, at: Time, id: QuestionId, how: z.enum(['answered', 'dismissed', 'withdrawn', 'unknown']) },
  retracted: { verdict: z.literal('retracted'), kind: answerOrDismiss, at: Time, id: QuestionId },
  retractedRetract: { verdict: z.literal('retracted'), kind: z.literal('retract'), at: Time, target: Key },
  retractedUnseen: { verdict: z.literal('retracted'), kind: z.literal('unseen'), at: Time, by: Key },
  tooLate: { verdict: z.literal('too-late'), kind: z.literal('retract'), at: Time, target: Key },
};
export const SheetVerdictSchema = z.union([
  z.looseObject(verdicts.applied),
  z.looseObject(verdicts.appliedDelivered),
  z.looseObject(verdicts.stale),
  z.looseObject(verdicts.closed),
  z.looseObject(verdicts.retracted),
  z.looseObject(verdicts.retractedRetract),
  z.looseObject(verdicts.retractedUnseen),
  z.looseObject(verdicts.tooLate),
]);
export type SheetVerdict = z.infer<typeof SheetVerdictSchema>;

export const SheetSentStateSchema = z.enum(['queued', 'accepted', 'delivered', 'stale', 'closed', 'retracted', 'too-late']);
export type SheetSentState = z.infer<typeof SheetSentStateSchema>;

/**
 * What became of each key the reader knows (I4 step 4): `queued` lines by kind (an answer or a dismissal with its `id`
 * and `cancelled` where a queued retract names it, a retract with its `target`, a `delivered` line with neither), and
 * every key with a verdict as its verdict's fields under its state.
 */
export const SheetSentSchema = z.union([
  z.looseObject({ key: Key, state: z.literal('queued'), kind: answerOrDismiss, id: QuestionId, cancelled: z.literal(true).optional() }),
  z.looseObject({ key: Key, state: z.literal('queued'), kind: z.literal('retract'), target: Key }),
  z.looseObject({ key: Key, state: z.literal('queued'), kind: z.literal('delivered') }),
  z.looseObject({ key: Key, ...verdicts.applied, state: z.enum(['accepted', 'delivered']) }),
  z.looseObject({ key: Key, ...verdicts.appliedDelivered, state: z.literal('delivered') }),
  z.looseObject({ key: Key, ...verdicts.stale, state: z.literal('stale') }),
  z.looseObject({ key: Key, ...verdicts.closed, state: z.literal('closed') }),
  z.looseObject({ key: Key, ...verdicts.retracted, state: z.literal('retracted') }),
  z.looseObject({ key: Key, ...verdicts.retractedRetract, state: z.literal('retracted') }),
  z.looseObject({ key: Key, ...verdicts.retractedUnseen, state: z.literal('retracted') }),
  z.looseObject({ key: Key, ...verdicts.tooLate, state: z.literal('too-late') }),
]);
export type SheetSent = z.infer<typeof SheetSentSchema>;

/** What a reader computes from a record: `sminos sheet show --json` (I4). */
export const SheetModelSchema = z.looseObject({
  v: z.literal(1),
  session: z.string().min(1),
  seq: Int0,
  open: z.array(SheetQuestionSchema),
  hidden: z.array(z.looseObject({ id: QuestionId, key: Key })),
  sent: z.array(SheetSentSchema),
  pending: z.array(SheetOutcomeSchema),
  closed: z.record(z.string(), SheetClosedSchema),
});
export type SheetModel = z.infer<typeof SheetModelSchema>;

// A map keyed by inbox keys, every own key kept: `__proto__` is a valid key, and `z.record` would drop it (its output is
// built by assignment, which sets a prototype for that name). Only a plain object is a map: anything else, a list of
// pairs included, reaches the entries' schema as null and is refused. `Object.fromEntries` defines each key as its own.
const isPlainObject = (raw: unknown): raw is object =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && [Object.prototype, null].includes(Object.getPrototypeOf(raw));
const ownRecord = <V extends z.ZodType>(value: V) =>
  z
    .preprocess((raw) => (isPlainObject(raw) ? Object.entries(raw) : null), z.array(z.tuple([z.string(), value])))
    .transform((entries): Record<string, z.infer<V>> => Object.fromEntries(entries));

/**
 * A record's `state.json` (I2), as far as a reader reads it: what the model is computed from, with the structure the
 * set's state schema gives it and none of the tool input's bounds (an imported question keeps whatever it was asked
 * with). The parts a reader ignores (`nextId`, `calls`, `log`, `import`) are kept and not checked.
 */
export const SheetStateSchema = z.looseObject({
  v: z.literal(1),
  session: z.string().min(1),
  seq: Int0,
  inbox: z.looseObject({ offset: Int0 }),
  questions: z.array(StoredQuestionSchema),
  pending: z.array(StoredOutcomeSchema),
  closed: z.record(z.string(), SheetClosedSchema),
  verdicts: ownRecord(SheetVerdictSchema),
});
export type SheetState = z.infer<typeof SheetStateSchema>;
export type StoredQuestion = z.infer<typeof StoredQuestionSchema>;
export type StoredOutcome = z.infer<typeof StoredOutcomeSchema>;

/**
 * One inbox line as a surface writes it (composite §4.1; I3's bounds). A surface writes no `at` and no `batch`, which
 * the door fills, and no `delivered` line, which only a deliverer writes. The rules across fields (an answer names `id`
 * and `revision` and has picks or text; a dismissal names `id`; a retract names `target`) are `lineError`'s (read.ts).
 */
export const SheetLineSchema = z.strictObject({
  v: z.literal(1),
  key: Key,
  kind: z.enum(['answer', 'dismiss', 'retract']),
  id: QuestionId.optional(),
  revision: Int1.optional(),
  picks: z.array(z.string()).max(12).optional(),
  text: atMost(20000).optional(),
  images: z.array(Upload).max(8).optional(),
  target: Key.optional(),
  by: SheetBySchema,
});
export type SheetLine = z.infer<typeof SheetLineSchema>;

/** A machine's summary of one record: small enough to announce on every change (S7). */
export const SheetSummarySchema = z.object({
  session: SheetSessionIdSchema,
  appSessionId: AppSessionIdSchema.nullable(),
  title: z.string().nullable(),
  live: z.boolean().nullable(),
  seq: Int0,
  open: Int0, // listed questions with no queued answer
  queued: Int0, // listed questions with a queued answer
  pending: Int0, // accepted outcomes not yet delivered
  hidden: Int0, // questions hidden by a queued dismissal
  oldestAskedAt: Time.nullable(), // of the questions counted in `open`
  unreadable: z.boolean(),
});
export type SheetSummary = z.infer<typeof SheetSummarySchema>;

/**
 * What the door printed for one inbox line it appended (I3): `queued` when no verdict came back, else the verdict the
 * session's step gave it, with the verdict's fields. A surface reads what became of an act from the model's `sent`
 * (S15); this is only the door's first word.
 */
export const SheetPutEntrySchema = z.union([
  z.looseObject({ key: Key, state: z.literal('queued') }),
  z.looseObject({ key: Key, state: z.enum(['applied', 'stale', 'closed', 'retracted', 'too-late']), kind: z.string(), at: Time }),
]);
export type SheetPutEntry = z.infer<typeof SheetPutEntrySchema>;

export const SheetPutResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), results: z.array(SheetPutEntrySchema) }),
  z.object({ ok: z.literal(false), why: z.enum(['unavailable', 'no-sheet', 'refused', 'busy', 'failed']), message: z.string() }),
]);
export type SheetPutResult = z.infer<typeof SheetPutResultSchema>;

export const SheetImageTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type SheetImageType = z.infer<typeof SheetImageTypeSchema>;

/**
 * A body a surface asks the record's machine for: a captured reference by its hash, an uploaded image by the path a
 * line names it with (`uploads/<name>`), or a long answer's text file by its hash. Each is resolved against the
 * record, never against a path a surface sent.
 */
export const SheetBodyRequestSchema = z.union([
  z.strictObject({ ref: z.string().regex(SHA256) }),
  z.strictObject({ upload: Upload }),
  z.strictObject({ text: z.string().regex(SHA256) }),
]);
export type SheetBodyRequest = z.infer<typeof SheetBodyRequestSchema>;

export const SheetBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('image'), mediaType: SheetImageTypeSchema, data: z.string() }), // base64
  z.object({ kind: z.literal('gone') }),
]);
export type SheetBody = z.infer<typeof SheetBodySchema>;
