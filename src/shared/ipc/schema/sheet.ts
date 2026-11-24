// X2 `sheet.*` (the question sheet's C3, M2; docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §D): the
// machine's question sheets as its spine's service reads and answers them (src/services/sheet/). Owned by `machine`,
// which the wire manifest carries, so a change here moves WIRE_MINOR.
//
// A session is named by the engine's session id in the form `sminos sheet` takes (`SheetSessionIdSchema`), never by
// MAWS's own `SessionIdSchema`, which takes any non-empty string: a record's directory is named by this value. What a
// record holds is parsed loosely (`@shared/sheet/model`, S5); what a window writes is closed. `sheet.put` stamps
// `by: 'maws'` on every line, and the service refuses a call of more than fifty lines, or a line `lineError` refuses,
// before any process starts, as `{ ok: false, why: 'refused' }` (so no count bound here: a refusal is an answer, not a
// malformed input). No remote caller reaches these in this child: each is graded by effect with a `no-rule` row
// (src/endpoint/by-effect.ts) until C6 reads what each does for one.
import * as z from 'zod';
import {
  SheetBodyRequestSchema,
  SheetBodySchema,
  SheetImageTypeSchema,
  SheetLineSchema,
  SheetModelSchema,
  SheetPutResultSchema,
  SheetSessionIdSchema,
  SheetSummarySchema,
} from '../../sheet/model';
import type { CommandSpec } from './common';

/** What is known now of the command MAWS appends with: nothing yet (nothing was answerable), or whether it can. */
export const DoorStateSchema = z.union([
  z.strictObject({ known: z.literal(false) }),
  z.strictObject({ known: z.literal(true), available: z.literal(true) }),
  z.strictObject({ known: z.literal(true), available: z.literal(false), reason: z.string() }),
]);
export type DoorState = z.infer<typeof DoorStateSchema>;

/** An image a window pasted, as base64, for `uploads/` of a record. */
export const SheetUploadOutputSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), path: z.string() }),
  z.strictObject({ ok: z.literal(false), why: z.string() }),
]);
export type SheetUploadOutput = z.infer<typeof SheetUploadOutputSchema>;

const session = { session: SheetSessionIdSchema };

export const commands = {
  'sheet.list': { input: z.strictObject({}), output: z.strictObject({ sessions: z.array(SheetSummarySchema), door: DoorStateSchema }), owner: 'machine' },
  'sheet.read': { input: z.strictObject(session), output: z.strictObject({ model: SheetModelSchema.nullable(), door: DoorStateSchema }), owner: 'machine' },
  'sheet.put': { input: z.strictObject({ ...session, lines: z.array(SheetLineSchema) }), output: SheetPutResultSchema, owner: 'machine' },
  'sheet.body': { input: z.strictObject({ ...session, of: SheetBodyRequestSchema }), output: SheetBodySchema, owner: 'machine' },
  'sheet.upload': { input: z.strictObject({ ...session, mediaType: SheetImageTypeSchema, data: z.string() }), output: SheetUploadOutputSchema, owner: 'machine' },
} as const satisfies Record<`sheet.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // To every window of this machine: a record appeared, changed or went (null). Small on purpose (S7): a window reads a
  // model with `sheet.read` only for a session it shows.
  'sheet.changed': z.strictObject({ ...session, summary: SheetSummarySchema.nullable() }),
} as const satisfies Record<`sheet.${string}`, z.ZodType>;
