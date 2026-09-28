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

// C5 start: the notifier's events (C5 execution document, Interfaces "X2 — attention.*"). Owner main.
const c5Events = {
  // A notification was posted (or would have been: `fallback`, the unsigned-binary case); also what the smoke observes.
  'attention.notified': z.strictObject({ appSessionId: AppSessionIdSchema, attentionId: AttentionIdSchema, delivery: z.enum(['os', 'fallback']), at: z.string() }),
  // A notification click or a menu item: the renderer opens the session.
  'attention.navigate': z.strictObject({ appSessionId: AppSessionIdSchema, attentionId: AttentionIdSchema.nullable(), source: z.enum(['notification', 'menu']) }),
} as const satisfies Record<`attention.${string}`, z.ZodType>;
// C5 end

export const commands = {
  ...c3Commands, // C3
} as const satisfies Record<`attention.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  ...c3Events, // C3
  ...c5Events, // C5
} as const satisfies Record<`attention.${string}`, z.ZodType>;
