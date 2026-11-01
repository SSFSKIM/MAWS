// X2 `browserEngine.*` (P5 O17; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §E, §F; D8): the tab
// engines' machine-local wire to `mawsd`. A tab engine (the render host serving cua from offscreen tabs, M4) is a
// `machine.sock` client; what it sends `mawsd` are commands of this namespace, owned by `machine` (the services front's,
// as `render.answer` is), main-only and graded `internal` whole, never a window's or a remote caller's. Every message is
// bound to the connection it arrives on and the session it names (§F's rules).
//
// M3: `browserEngine.work`, the engine's report of browser work for a session (every tab it holds for the session plus a
// creation in flight). `held: true` is taken from the session's selected engine connection alone and answers only once
// the engine host has acknowledged a `host.browserWork` snapshot naming the session (the fence, §E), or fails with the
// reason, so the engine makes no tab; `held: false` is taken from any connection holding the session and answers at
// once.
//
// M4: `browserEngine.request`, `mawsd`'s request to the engine connection it selected for a session (an event to that
// connection alone, as `render.request` is: a reverse request kind would be a new envelope kind), answered once with
// `browserEngine.answer`: `prepare` (the engine serves the session's cua socket: answered null once it listens and the
// daemon's relay pass is confirmed; P5 O17 M5: it names the session's parent when the session is a side thread, which
// `mawsd` reads from its own index, so the engine reads no lineage over the link), `drop` (answered null once the session's views, connections and socket there are
// gone) and `inventory` (the session's tabs). `browserEngine.state`: the session's inventory, pushed at each change of
// its tabs or of its readiness. Request ids are `mawsd`'s; engines carry no epoch (D7). M6 adds the subscription's
// operations, `browserEngine.frame` and `browserEngine.ended`.
import * as z from 'zod';
import { BROWSER_SUMMARY_BOUNDS, BrowserTabSummarySchema } from '../../browser/screencast';
import { BrowserTabIdSchema } from '../../browser/tab';
import { AppSessionIdSchema } from '../../graph/ids';
import type { CommandSpec } from './common';

const RequestIdSchema = z.string().min(1).max(128);

// A session's tabs as an engine holds them; `mawsd` stamps its epoch (§G's BrowserInventory)
export const EngineInventorySchema = z.strictObject({
  tabs: z.array(BrowserTabSummarySchema).max(BROWSER_SUMMARY_BOUNDS.tabs),
  selected: BrowserTabIdSchema.nullable(),
  state: z.enum(['ready', 'unavailable']),
  reason: z.string().max(1_024).optional(),
});
export type EngineInventory = z.infer<typeof EngineInventorySchema>;

export const BrowserEngineOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('prepare'), parent: AppSessionIdSchema.optional() }), // the render host only; M5: a side thread's parent, whose tabs it reaches
  z.strictObject({ op: z.literal('drop') }), // the render host only
  z.strictObject({ op: z.literal('inventory') }),
]);
export type BrowserEngineOperation = z.infer<typeof BrowserEngineOperationSchema>;

export const BrowserEngineRequestSchema = z.strictObject({ id: RequestIdSchema, appSessionId: AppSessionIdSchema, operation: BrowserEngineOperationSchema });
export type BrowserEngineRequest = z.infer<typeof BrowserEngineRequestSchema>;

export const BrowserEngineResultSchema = z.union([z.strictObject({ ok: z.literal(true), value: EngineInventorySchema.nullable() }), z.strictObject({ ok: z.literal(false), error: z.string().max(4_096) })]);
export type BrowserEngineResult = z.infer<typeof BrowserEngineResultSchema>;

export const commands = {
  'browserEngine.work': { input: z.strictObject({ appSessionId: AppSessionIdSchema, held: z.boolean() }), output: z.void(), owner: 'machine' }, // main-only: from an engine's connection alone
  'browserEngine.answer': { input: z.strictObject({ id: RequestIdSchema, result: BrowserEngineResultSchema }), output: z.void(), owner: 'machine' }, // M4: main-only, for a request pending on that connection
  'browserEngine.state': { input: z.strictObject({ appSessionId: AppSessionIdSchema, inventory: EngineInventorySchema }), output: z.void(), owner: 'machine' }, // M4: main-only, from the session's selected connection
} as const satisfies Record<`browserEngine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'browserEngine.request': BrowserEngineRequestSchema, // M4: to the session's selected engine connection alone, never the bus's fan-out
} as const satisfies Record<`browserEngine.${string}`, z.ZodType>;
