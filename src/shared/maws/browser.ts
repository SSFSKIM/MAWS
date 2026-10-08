// The six browser tools E4c added to the `maws` server (P1 spec §3 D and §10 X9; E4c execution document, Design §2), kept
// as a historical record since they left the server on 2026-10-08 (P1 A-54: cua_repl drives the in-app browser). They
// are no longer in `MAWS_TOOL_NAMES` and nothing serves them; their names, input and result schemas and how a call is
// summarised stay frozen so the journals and X8 fixtures written before the removal still map to X1's
// `maws.browser.action` (the normaliser) and still render as `browser_action` rows (the renderer).
import * as z from 'zod';
import { BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX } from '../browser/dialog';
import { BrowserLocatorSchema } from '../browser/locator';
import { BrowserControlSchema, BrowserTabIdSchema } from '../browser/tab';
import { BrowserUrlSchema } from '../ipc/schema/browser';

export const BROWSER_TOOL_NAMES = ['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_eval', 'browser_screenshot'] as const;
export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];
export const isBrowserToolName = (name: unknown): name is BrowserToolName => typeof name === 'string' && (BROWSER_TOOL_NAMES as readonly string[]).includes(name);

// The roles a snapshot may be rooted at and its outline lists (Design §5).
export const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary', 'region', 'form'] as const;
export type LandmarkRole = (typeof LANDMARK_ROLES)[number];

export const BROWSER_SNAPSHOT_MAX_CHARS_CEILING = 64_000; // a snapshot call's `maxChars` bound

// ---------------------------------------------------------------------------------------------------------------------
// Inputs (strict, as the server parsed them: a call the schema refused was answered invalidArguments and maps to no event)

// A snapshot's element ref (Playwright's `aria-ref`): an optional frame ordinal and an element number, `e12`, `f2e7`.
export const BrowserRefSchema = z.string().regex(/^(f\d+)?e\d+$/);
export const BrowserTargetSchema = z.union([BrowserRefSchema, BrowserLocatorSchema]);
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;

const need = (ctx: z.RefinementCtx, path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

export const BrowserTabsInputSchema = z
  .strictObject({ action: z.enum(['list', 'open', 'close', 'select']), url: BrowserUrlSchema.optional(), tabId: BrowserTabIdSchema.optional() })
  .superRefine((input, ctx) => {
    if (input.action === 'open' && input.url === undefined) need(ctx, 'url', 'open needs a url');
    if ((input.action === 'close' || input.action === 'select') && input.tabId === undefined) need(ctx, 'tabId', `${input.action} needs a tabId`);
    if (input.action === 'list' && input.url !== undefined) need(ctx, 'url', 'list takes no url');
    if (input.action === 'list' && input.tabId !== undefined) need(ctx, 'tabId', 'list takes no tabId');
  });
export type BrowserTabsInput = z.infer<typeof BrowserTabsInputSchema>;

export const BrowserNavigateInputSchema = z.strictObject({ tabId: BrowserTabIdSchema, url: z.union([BrowserUrlSchema, z.enum(['back', 'forward', 'reload'])]) });
export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInputSchema>;

export const BrowserSnapshotInputSchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  root: z.union([BrowserRefSchema, z.enum(LANDMARK_ROLES)]).optional(),
  maxChars: z.number().int().min(1000).max(BROWSER_SNAPSHOT_MAX_CHARS_CEILING).optional(),
});
export type BrowserSnapshotInput = z.infer<typeof BrowserSnapshotInputSchema>;

export const BROWSER_ACT_ACTIONS = ['click', 'fill', 'select', 'check', 'press', 'hover', 'scroll'] as const;
export type BrowserActAction = (typeof BROWSER_ACT_ACTIONS)[number];

export const BrowserActInputSchema = z
  .strictObject({ tabId: BrowserTabIdSchema, action: z.enum(BROWSER_ACT_ACTIONS), target: BrowserTargetSchema, value: z.string().max(20_000).optional() })
  .superRefine((input, ctx) => {
    if ((input.action === 'fill' || input.action === 'select' || input.action === 'press') && input.value === undefined) need(ctx, 'value', `${input.action} needs a value`);
    if (input.action === 'check' && input.value !== undefined && input.value !== 'true' && input.value !== 'false') need(ctx, 'value', 'check takes "true" or "false"');
    if (input.action === 'scroll' && input.value !== undefined && !/^[+-]?\d+$/.test(input.value)) need(ctx, 'value', 'scroll takes a signed integer number of pixels');
  });
export type BrowserActInput = z.infer<typeof BrowserActInputSchema>;

export const BrowserEvalInputSchema = z.strictObject({ tabId: BrowserTabIdSchema, expression: z.string().min(1).max(20_000) });
export type BrowserEvalInput = z.infer<typeof BrowserEvalInputSchema>;

export const BrowserScreenshotInputSchema = z
  .strictObject({ tabId: BrowserTabIdSchema, target: BrowserTargetSchema.optional(), fullPage: z.boolean().optional() })
  .superRefine((input, ctx) => {
    if (input.target !== undefined && input.fullPage === true) need(ctx, 'fullPage', 'fullPage captures the page; give it or a target, not both');
  });
export type BrowserScreenshotInput = z.infer<typeof BrowserScreenshotInputSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Results (the first text block, pretty JSON; every result names the tab, its URL and title and main's own `ms`)

const count = z.number().int().min(0);

// A page dialog MAWS answered for the agent (Decision Log 33): its kind and its message as plain text, cut.
export const BrowserDialogSchema = z.strictObject({ type: z.enum(['alert', 'confirm', 'prompt']), message: z.string().max(BROWSER_DIALOG_MESSAGE_MAX_CHARS) });
export type BrowserDialog = z.infer<typeof BrowserDialogSchema>;
const dialogs = z.array(BrowserDialogSchema).max(BROWSER_DIALOGS_MAX).optional();

// What the target resolved to: a ref (with the role and name of its snapshot line when main read them, for the row's
// heading), or a locator with how many elements matched (several: the first was used).
export const BrowserResolvedTargetSchema = z.union([
  z.strictObject({ ref: BrowserRefSchema, role: z.string().optional(), name: z.string().optional() }),
  z.strictObject({ css: z.string(), role: z.string().optional(), name: z.string().optional(), matches: z.number().int().min(1) }),
]);
export type BrowserResolvedTarget = z.infer<typeof BrowserResolvedTargetSchema>;

// Why an action waited (Design §6 and §8): the person held the page, or a sheet covered it. One enum for the results, the
// X1 event and the IPC (Decision Log 44 (d)).
export const BrowserWaitReasonSchema = z.enum(['human', 'cover']);
export type BrowserWaitReason = z.infer<typeof BrowserWaitReasonSchema>;

const waited = { waitedFor: BrowserWaitReasonSchema.nullable(), waitedMs: count.nullable() };
const onPage = { status: z.literal('ok'), tabId: BrowserTabIdSchema, url: z.string(), title: z.string(), ms: count };

// `owner` (P-24, Decision Log 29): a side thread also reaches its parent session's tabs, marked `parent`.
export const BrowserTabSummarySchema = z.strictObject({
  tabId: BrowserTabIdSchema, url: z.string(), title: z.string(), selected: z.boolean(), loaded: z.boolean(), control: BrowserControlSchema, owner: z.enum(['self', 'parent']),
});
export type BrowserTabSummary = z.infer<typeof BrowserTabSummarySchema>;

export const BrowserTabsResultSchema = z.strictObject({
  status: z.literal('ok'), action: z.enum(['list', 'open', 'close', 'select']), tabId: BrowserTabIdSchema.nullable(), url: z.string().nullable(), title: z.string().nullable(),
  tabs: z.array(BrowserTabSummarySchema), ms: count, dialogs,
});
export type BrowserTabsResult = z.infer<typeof BrowserTabsResultSchema>;

export const BrowserNavigateResultSchema = z.strictObject({ ...onPage, ...waited, dialogs });
export type BrowserNavigateResult = z.infer<typeof BrowserNavigateResultSchema>;

export const BrowserSnapshotResultSchema = z.strictObject({
  ...onPage, root: z.string().nullable(), rootMatches: count.nullable(), chars: count, lines: count, refs: count, truncated: z.boolean(),
  omitted: z.strictObject({ lines: count, refs: count }).nullable(), dialogs,
});
export type BrowserSnapshotResult = z.infer<typeof BrowserSnapshotResultSchema>;

export const BrowserActResultSchema = z.strictObject({ ...onPage, action: z.enum(BROWSER_ACT_ACTIONS), target: BrowserResolvedTargetSchema, navigated: z.boolean(), ...waited, dialogs });
export type BrowserActResult = z.infer<typeof BrowserActResultSchema>;

export const BrowserEvalResultSchema = z.strictObject({ ...onPage, value: z.unknown(), truncated: z.boolean(), dialogs });
export type BrowserEvalResult = z.infer<typeof BrowserEvalResultSchema>;

export const BrowserScreenshotResultSchema = z.strictObject({
  ...onPage, deliverableId: z.uuid(), path: z.string(), width: count, height: count, bytes: count, mimeType: z.enum(['image/png', 'image/jpeg']),
  target: BrowserResolvedTargetSchema.nullable(), fullPage: z.boolean(), dialogs,
});
export type BrowserScreenshotResult = z.infer<typeof BrowserScreenshotResultSchema>;

const RESULT_SCHEMAS = {
  browser_tabs: BrowserTabsResultSchema,
  browser_navigate: BrowserNavigateResultSchema,
  browser_snapshot: BrowserSnapshotResultSchema,
  browser_act: BrowserActResultSchema,
  browser_eval: BrowserEvalResultSchema,
  browser_screenshot: BrowserScreenshotResultSchema,
} as const satisfies Record<BrowserToolName, z.ZodType>;

export function browserToolResultSchemaOf<N extends BrowserToolName>(tool: N): (typeof RESULT_SCHEMAS)[N] {
  return RESULT_SCHEMAS[tool];
}

// The input schema a historical call is admitted by (the server's own parse before the removal).
const INPUT_SCHEMAS = {
  browser_tabs: BrowserTabsInputSchema,
  browser_navigate: BrowserNavigateInputSchema,
  browser_snapshot: BrowserSnapshotInputSchema,
  browser_act: BrowserActInputSchema,
  browser_eval: BrowserEvalInputSchema,
  browser_screenshot: BrowserScreenshotInputSchema,
} as const satisfies Record<BrowserToolName, z.ZodType>;

// A historical call's arguments through its tool's input schema, as `parseToolArguments` parsed them while the tools
// were served (residue 1: the normaliser maps only the calls the server admitted).
export function parseBrowserToolArguments<N extends BrowserToolName>(tool: N, args: unknown): { ok: true; data: z.infer<(typeof INPUT_SCHEMAS)[N]> } | { ok: false } {
  const parsed = INPUT_SCHEMAS[tool].safeParse(args);
  return parsed.success ? { ok: true, data: parsed.data as z.infer<(typeof INPUT_SCHEMAS)[N]> } : { ok: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// One call as its transcript row and `maws.browser.action` name it (Design §10, Decision Log 48)

// What a call does and to what, from its arguments alone, so the normaliser's event and the renderer's row (which on the
// disk path has the call and its result, no event) name it the same way. The action is `action` for tabs and act,
// back/forward/reload or `url` for navigate, else the tool's noun; the target is the act's (or a targeted screenshot's)
// ref or css, the URL navigated to or opened, the snapshot's root, an untargeted screenshot's `page` or `fullPage`.
// Read leniently: arguments the schema refused (the host answered invalidArguments) still name what they can.
export interface BrowserCallSummary {
  action: string;
  tabId: string | null;
  target: string | null;
}

export function browserCallOf(tool: BrowserToolName, input: unknown): BrowserCallSummary {
  const args: Record<string, unknown> = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const targetOf = (target: unknown) => text(target) ?? (typeof target === 'object' && target !== null ? text((target as { css?: unknown }).css) : null);
  const tabId = text(args.tabId);
  switch (tool) {
    case 'browser_tabs':
      return { action: text(args.action) ?? 'tabs', tabId, target: text(args.url) };
    case 'browser_navigate': {
      const url = text(args.url);
      const named = url === 'back' || url === 'forward' || url === 'reload';
      return { action: named ? url : 'url', tabId, target: named ? null : url };
    }
    case 'browser_snapshot':
      return { action: 'snapshot', tabId, target: text(args.root) };
    case 'browser_act':
      return { action: text(args.action) ?? 'act', tabId, target: targetOf(args.target) };
    case 'browser_eval':
      return { action: 'eval', tabId, target: null };
    case 'browser_screenshot':
      return { action: 'screenshot', tabId, target: args.target !== undefined ? targetOf(args.target) : args.fullPage === true ? 'fullPage' : 'page' };
  }
}
