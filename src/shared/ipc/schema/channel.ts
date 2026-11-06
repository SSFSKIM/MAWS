// X2 `channel.*` (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §O): the to-human
// entries this machine's sessions wrote, per org project, as the spine's journal keeps them (src/services/channel/). A
// project is sminos's project id (OX3's `smnsId`). Lane B's entries are read from the owner channel's event batches
// through the one extraction (`@shared/owner/to-human-items`); lane A's are sminos's sub-less RL10 host messages, which the
// endpoint hands in. `history` pages them newest first; `changed` carries each entry once, as it is recorded. Owned by the
// machine and main-only: main (the channel's machines, O8 M7b Task 3) and the endpoint (its view-filtered offer and feed,
// Task 2) read them, never a window. Additive on the wire (WIRE_MINOR 29).
import * as z from 'zod';
import { AppSessionIdSchema, SessionIdSchema } from '../../graph/ids';
import type { CommandSpec } from './common';

export const HISTORY_LIMIT_MAX = 200; // a page's bound, and its size when none is asked

// One entry. `id` is the journal's, a cursor for `history`'s `before`; `src` is the entry's origin, unique in the
// journal (lane A: the host event's `<project>/<writer>/<seq>`; lane B: `<project>/lane-b/<appSessionId>/<anchor>`), so
// a resend or a replay records nothing new. `at` is when it was said (a question asked, an answer given), normalized to
// ISO-8601 in UTC.
export const HostEntrySchema = z.strictObject({
  id: z.string().min(1),
  project: z.string().min(1),
  appSessionId: AppSessionIdSchema.nullable(), // lane B's session; null on lane A, whose sessions MAWS holds no record of
  engineSessionId: SessionIdSchema.nullable(),
  lane: z.enum(['A', 'B']),
  kind: z.enum(['message', 'question', 'answered']),
  text: z.string(),
  choices: z.array(z.string()).optional(), // a question's options, in order
  at: z.iso.datetime({ offset: true }),
  src: z.string().min(1),
});
export type HostEntry = z.infer<typeof HostEntrySchema>;
// What a source hands the journal: everything but the journal's own id.
export const NewHostEntrySchema = HostEntrySchema.omit({ id: true });
export type NewHostEntry = z.infer<typeof NewHostEntrySchema>;

export const commands = {
  // Newest first, at most `limit` (HISTORY_LIMIT_MAX when absent), from before the entry `before` names when it is given;
  // `more` when older entries remain. A `before` the journal no longer holds (pruned past the bounds) answers none.
  'channel.history': {
    input: z.strictObject({ project: z.string().min(1), before: z.string().min(1).optional(), limit: z.number().int().min(1).max(HISTORY_LIMIT_MAX).optional() }),
    output: z.strictObject({ entries: z.array(HostEntrySchema), more: z.boolean() }),
    owner: 'machine',
  },
} as const satisfies Record<`channel.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'channel.changed': z.strictObject({ project: z.string().min(1), entry: HostEntrySchema }),
} as const satisfies Record<`channel.${string}`, z.ZodType>;
