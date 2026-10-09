// X2 `attention.*` (charter §12 C1 *IPC registry composition*). Owner main: answered by C3's attention service in main
// (ruling 1 of the wave-2 ledger); C5 adds `attention.notified` and `attention.navigate` as its own block.
import * as z from 'zod';
// C3 start
import { AttentionItemSchema } from '../../graph/attention';
import { SessionEventSchema } from '../../graph/events';
import { AppSessionIdSchema, RequestIdSchema } from '../../graph/ids';
// C3 end
import { AttentionIdSchema } from '../../graph/ids'; // C5
import type { CommandSpec } from './common';

// C3 start: the Needs-you surface (C3 execution document, Interfaces "Broker" and "X2"): every session's merged items,
// one session's whole list on each change, and the originating request event of a broker item.
const c3Commands = {
  'attention.list': { input: z.void(), output: z.array(AttentionItemSchema), owner: 'main' }, // every session's pending and delivered items
  'attention.request': { input: z.strictObject({ appSessionId: AppSessionIdSchema, requestId: RequestIdSchema }), output: z.strictObject({ event: SessionEventSchema.nullable() }), owner: 'main' }, // answered through session.pendingRequest
} as const;
const c3Events = {
  'attention.changed': z.strictObject({ appSessionId: AppSessionIdSchema, items: z.array(AttentionItemSchema) }), // the session's whole merged list: replace
} as const;

export const C3_ATTENTION_COMMANDS = Object.keys(c3Commands) as (keyof typeof c3Commands)[];
export const C3_ATTENTION_EVENTS = Object.keys(c3Events) as (keyof typeof c3Events)[];
// C3 end

// C5 start: the notifier's events and the queued navigation (C5 execution document, Interfaces "X2 — attention.*"). Owner
// main.
// A notification click (or a menu item): the renderer opens the session.
export const AttentionNavigateSchema = z.strictObject({ appSessionId: AppSessionIdSchema, attentionId: AttentionIdSchema.nullable(), source: z.enum(['notification', 'menu']) });
export type AttentionNavigate = z.infer<typeof AttentionNavigateSchema>;
const c5Commands = {
  // Snapshot in C1's pattern: the navigation main queued while no page could hear it, cleared on read. The renderer
  // subscribes to `attention.navigate` first, then calls this once; the call also tells main this page is listening.
  'attention.pendingNavigate': { input: z.void(), output: z.strictObject({ navigate: AttentionNavigateSchema.nullable() }), owner: 'main' },
} as const satisfies Record<`attention.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c5Events = {
  // A notification was posted (or would have been: `fallback`, the unsigned-binary case); also what the smoke observes.
  'attention.notified': z.strictObject({ appSessionId: AppSessionIdSchema, attentionId: AttentionIdSchema, delivery: z.enum(['os', 'fallback']), at: z.string() }),
  'attention.navigate': AttentionNavigateSchema,
} as const satisfies Record<`attention.${string}`, z.ZodType>;
// C5 end

// E11 F2b (plan 2.4; owner decision 1): an error item seen in its opened session leaves Needs you (`seen`: confirmed,
// its notice still shown in the session) and Dismiss retires it (`dismissed`); either way the session keeps the fact
// ("Ended with an error") until its next human turn. Only error items are acknowledged; anything else is left as is.
const e11Commands = {
  'attention.acknowledge': { input: z.strictObject({ appSessionId: AppSessionIdSchema, attentionId: AttentionIdSchema, how: z.enum(['seen', 'dismissed']) }), output: z.void(), owner: 'main' },
} as const satisfies Record<`attention.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const commands = {
  ...c3Commands, // C3
  ...c5Commands, // C5
  ...e11Commands, // E11 F2b
} as const satisfies Record<`attention.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  ...c3Events, // C3
  ...c5Events, // C5
} as const satisfies Record<`attention.${string}`, z.ZodType>;
