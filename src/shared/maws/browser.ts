// X9 as E4c extends it (P1 spec §3 A, §3 D and §10 X9; E4c execution document, Design §2 and Interfaces): the six
// browser tools of the `maws` server: names, descriptions, annotations, input and result schemas, the constants of the
// contract and the exact error texts. `tools.ts` appends them to MAWS_TOOL_NAMES, MAWS_TOOLS and TOOL_ERRORS, so the
// engine host and the normaliser admit a call by the same schema; main formats its refusals from the same texts.
// This module never imports `tools.ts` (which imports it).
import * as z from 'zod';
import { BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX } from '../browser/dialog';
import { BrowserLocatorSchema, locatorText, roleNameText, type BrowserLocator } from '../browser/locator';
import { BrowserControlSchema, BrowserTabIdSchema } from '../browser/tab';
import type { LoadErrorKind } from '../browser/errors';
import { BrowserUrlSchema } from '../ipc/schema/browser';

export const BROWSER_TOOL_NAMES = ['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_act', 'browser_eval', 'browser_screenshot'] as const;
export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];
export const isBrowserToolName = (name: unknown): name is BrowserToolName => typeof name === 'string' && (BROWSER_TOOL_NAMES as readonly string[]).includes(name);

// The roles a snapshot may be rooted at and its outline lists (Design §5).
export const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary', 'region', 'form'] as const;
export type LandmarkRole = (typeof LANDMARK_ROLES)[number];

export const BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT = 24_000; // A-33 item 5
export const BROWSER_SNAPSHOT_MAX_CHARS_CEILING = 64_000; // under the engine's 25,000-token MCP result cap at 4 characters per token
export const BROWSER_SNAPSHOT_OUTLINE_MAX_LINES = 40;
export const BROWSER_EVAL_MAX_CHARS = 16_000;
export const BROWSER_SCREENSHOT_MAX_BYTES = 3.5 * 1024 * 1024; // A-34: PNG, else the JPEG retake, else an error
export const BROWSER_ANSWER_MS = 30_000; // the host's deadline on main's own work, paused while the person or a cover holds the action
export const BROWSER_ACTION_TIMEOUT_MS = 10_000; // the readiness wait, not counting time under a cover
export const BROWSER_COVER_WAIT_MAX_MS = 60_000; // A-47 (Decision Log 82): a call's waits under covers, summed, end in pageCovered past this
export const BROWSER_LOCATE_MS = 2_000; // how long a locator with no match waits before targetNotFound
export const BROWSER_AGENT_IDLE_MS = 10_000; // `control: 'agent'` lapses to idle this long after the last action
export const BROWSER_BRIDGE_IDLE_MS = 300_000; // a driver with no command for this long closes
// An error text's pieces MAWS did not write itself (a page's exception or load error, a page URL, a download's file name,
// an element's accessible name, an argument echoed back) are cut at BROWSER_ERROR_DETAIL_MAX_CHARS with an ellipsis, so
// the answer, the tool result and the journaled `maws.browser.action` stay bounded whatever the page throws; a text holds
// at most three such pieces, and the answer's schema refuses anything past BROWSER_ERROR_MAX_CHARS.
export const BROWSER_ERROR_DETAIL_MAX_CHARS = 1_000;
export const BROWSER_ERROR_MAX_CHARS = 4_000;
export const clipErrorDetail = (text: string): string =>
  text.length <= BROWSER_ERROR_DETAIL_MAX_CHARS ? text : `${text.slice(0, BROWSER_ERROR_DETAIL_MAX_CHARS - 1)}…`;
// Decision Log 33 and A-42: the page dialogs MAWS answered during a call, reported in its result as plain text (and the
// excerpt a hidden tab's notice carries); defined in a leaf module the notice schema imports too
export { BROWSER_DIALOG_EXCERPT_MAX_CHARS, BROWSER_DIALOG_MESSAGE_MAX_CHARS, BROWSER_DIALOGS_MAX } from '../browser/dialog';

// Annotations (A-31): the three tools that change the page are not read-only, so the permission modes gate them (eval
// included); the reads carry the maws default (`MAWS_TOOL_ANNOTATIONS`, equal by test).
const BROWSER_READ_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;
const BROWSER_ACT_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Inputs (strict; validators never default: `maxChars`, `fullPage` and check's value take their defaults where read)

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
  maxChars: z.number().int().min(1000).max(BROWSER_SNAPSHOT_MAX_CHARS_CEILING).optional(), // BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT where read
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

// ---------------------------------------------------------------------------------------------------------------------
// The tools as `tools/list` describes them (descriptions exact; A-18: the fallback sentence first)

export const BROWSER_TOOLS = {
  browser_tabs: {
    title: 'Browser tabs',
    description:
      'List, open, close or select this session\'s tabs in the MAWS browser; without this tool, ask the user to open the page and describe what you need from it. "list" returns the session\'s tabs with their ids, URLs, titles and who controls each; "open" takes a url (http or https) and opens it in a new tab that stays open until you close it; "close" and "select" take a tabId. Tabs the user opened are listed too; the user sees the tab you act on. Returns the tab list and, for open, the new tab\'s id.',
    input: BrowserTabsInputSchema,
    annotations: BROWSER_READ_ANNOTATIONS,
  },
  browser_navigate: {
    title: 'Browser navigate',
    description:
      'Navigate a MAWS browser tab to a URL, or go back, forward or reload; without this tool, ask the user to open the page. url is an http or https URL or one of "back", "forward", "reload" (reload also loads a tab the user left unloaded). Waits for the page to load (up to 30 s). A page that starts a download is refused: the user downloads files, you do not. Returns the tab\'s URL and title after the load.',
    input: BrowserNavigateInputSchema,
    annotations: BROWSER_ACT_ANNOTATIONS,
  },
  browser_snapshot: {
    title: 'Browser snapshot',
    description:
      "Read a MAWS browser tab as an accessibility snapshot with element refs; without this tool, ask the user to describe the page or paste its text. Each interactive or named element has a ref like e12 that browser_act and browser_screenshot accept as a target. Refs are valid for the current document and until your next snapshot of it: after a navigation or a later snapshot, take a new snapshot before acting. The snapshot is cut at maxChars (default 24000, at most 64000) on a line boundary with a trailer saying how much was omitted and an outline of the page's landmarks and their refs, so you can call again with root set to a ref or a landmark role (banner, navigation, main, contentinfo, search, complementary, region, form) for one subtree; a rooted snapshot invalidates refs outside that subtree until the next whole-page snapshot. Returns the snapshot as text after a JSON header with the tab's URL, title and the cut.",
    input: BrowserSnapshotInputSchema,
    annotations: BROWSER_READ_ANNOTATIONS,
  },
  browser_act: {
    title: 'Browser act',
    description:
      'Act on an element in a MAWS browser tab: click, fill, select, check, press, hover or scroll; without this tool, ask the user to do it and tell you the result. target is a ref from browser_snapshot (e.g. "e12") or a locator {css, role?, name?} such as a comment anchor carries. fill types value into a field (replacing its content); select picks the option whose label or value is value; check sets a checkbox to value ("true" or "false", default true); press sends a key or chord (e.g. "Enter", "Control+a") to the element; scroll scrolls the element into view and then by value pixels when given (negative scrolls up). The action waits for the element to be visible and enabled (up to 10 s). If the user is using the page, the action waits until they stop or hand it back, and the result says so. A ref that no longer resolves is an error naming it: take a new snapshot. Returns the tab\'s URL and title after the action and whether it navigated.',
    input: BrowserActInputSchema,
    annotations: BROWSER_ACT_ANNOTATIONS,
  },
  browser_eval: {
    title: 'Browser eval',
    description:
      "Evaluate a JavaScript expression in a MAWS browser tab's page and return its value; without this tool, use browser_snapshot or ask the user. Use it to read page state (text, attributes, computed values, JSON the page holds); it runs in the page with the page's permissions, so prefer browser_act for changes. A promise is awaited; the value is returned as JSON (cut at 16000 characters). If the user is using the page, the evaluation waits until they stop. Returns the value and the tab's URL and title.",
    input: BrowserEvalInputSchema,
    annotations: BROWSER_ACT_ANNOTATIONS,
  },
  browser_screenshot: {
    title: 'Browser screenshot',
    description:
      'Take a screenshot of a MAWS browser tab and receive it as an image; without this tool, use browser_snapshot. target (a ref or a locator) screenshots one element; fullPage captures the whole scrollable page; neither captures the viewport. The picture is also saved as a deliverable the user can open from the transcript. Pictures are kept under 3.5 MB (JPEG when a PNG would exceed it). Returns the image and a JSON record with the deliverable id, size and format.',
    input: BrowserScreenshotInputSchema,
    annotations: BROWSER_READ_ANNOTATIONS,
  },
} as const satisfies Record<BrowserToolName, { title: string; description: string; input: z.ZodType; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }>;

// ---------------------------------------------------------------------------------------------------------------------
// Refusals (exact; each names the calling tool; main formats its answers with these, the host its own)

// A target as the texts and the row name it: a ref as itself, a locator in braces.
export function browserTargetText(target: BrowserTarget): string {
  return typeof target === 'string' ? target : locatorText(target);
}

const on = (action: string, target: string) => (target === '' ? action : `${action} on ${clipErrorDetail(target)}`);
const clip = clipErrorDetail;

const SNAPSHOT_AGAIN = '; call browser_snapshot again and use a ref from it';

// A locator that names an element by role or name, which is what can disagree with the element its css matched.
export type NamedBrowserLocator = BrowserLocator & ({ role: string } | { name: string });
// What such a locator wanted, as the disagreement names it: an empty name is printed as `""`, never dropped.
const wantedText = (locator: NamedBrowserLocator) =>
  clip([locator.role, locator.name === undefined ? undefined : JSON.stringify(locator.name)].filter((part) => part !== undefined).join(' '));

// No element; or (Decision Log 30) css alone matched exactly one element, `found`, whose role or name is not the
// locator's, so nothing was acted on. Several matches are never an error (the result's `matches`). Only a locator with
// a role or a name can disagree (Decision Log 44 (d)).
function targetNotFound(tool: BrowserToolName, locator: BrowserLocator): string;
function targetNotFound(tool: BrowserToolName, locator: NamedBrowserLocator, found: { role: string; name: string }): string;
function targetNotFound(tool: BrowserToolName, locator: BrowserLocator, found?: { role: string; name: string }): string {
  return found === undefined
    ? `${tool}: no element matches ${clip(locatorText(locator))} (0 matches)`
    : `${tool}: ${clip(locatorText({ css: locator.css }))} matches one element, ${clip(roleNameText(found))}, not ${wantedText(locator as NamedBrowserLocator)}`;
}

export const BROWSER_TOOL_ERRORS = {
  tabNotFound: (tool: BrowserToolName, tabId: string) => `${tool}: no tab "${tabId}" in this session; call browser_tabs {action: "list"}`,
  tabNotLoaded: (tool: BrowserToolName, tabId: string, url: string) => `${tool}: tab "${tabId}" is not loaded (${clip(url)}); call browser_navigate {tabId, url: "reload"} first`,
  tabClosed: (tool: BrowserToolName, tabId: string) => `${tool}: tab "${tabId}" was closed during the action`,
  tabCrashed: (tool: BrowserToolName, tabId: string) => `${tool}: the page in tab "${tabId}" crashed; call browser_navigate {tabId, url: "reload"} to revive it`,
  staleRef: (tool: BrowserToolName, ref: string, reason: 'previous-document' | 'missing') =>
    `${tool}: ref "${clip(ref)}" ${reason === 'previous-document' ? 'is stale: it belongs to a previous document' : 'is stale or missing in the current snapshot'}${SNAPSHOT_AGAIN}`,
  targetNotFound,
  // Internal (an abort): the action was cancelled while the person held the page; nothing is written.
  humanHasPage: (tool: BrowserToolName) => `${tool}: the user has the page; the action was cancelled before they handed it back`,
  // `kind`: E4a's classification; `code`: Chromium's error description (its number when the description is empty).
  navigationFailed: (tool: BrowserToolName, url: string, kind: LoadErrorKind, code: string | number) => `${tool}: ${clip(url)} failed to load (${kind}, ${clip(String(code))})`,
  downloadRefused: (tool: BrowserToolName, url: string, filename: string) => `${tool}: ${clip(url)} started a download (${clip(filename)}), which MAWS refuses for the agent; the user downloads files`,
  // `target`: `browserTargetText` of it, or '' when the action has none (back, forward)
  actionTimeout: (tool: BrowserToolName, action: string, target: string, ms: number) => `${tool}: ${on(action, target)} was not actionable within ${ms / 1000} s (the element must be visible and enabled)`,
  actionFailed: (tool: BrowserToolName, action: string, target: string, message: string) => `${tool}: ${on(action, target)} failed: ${clip(message)}`,
  evalFailed: (message: string) => `browser_eval: ${clip(message)}`,
  rootNotFound: (root: string) => `browser_snapshot: no element for root "${clip(root)}"`,
  screenshotFailed: (message: string) => `browser_screenshot: could not capture: ${clip(message)}`,
  screenshotTooLarge: (bytes: number) => `browser_screenshot: the picture is ${bytes} bytes after the JPEG fallback and exceeds ${BROWSER_SCREENSHOT_MAX_BYTES / (1024 * 1024)} MiB; screenshot a target instead of fullPage`,
  // A-47 (Decision Log 82): a call held by covers (a sheet, the palette, a notice over the pane) past BROWSER_COVER_WAIT_MAX_MS
  pageCovered: (tool: BrowserToolName, seconds: number) => `${tool}: the page has been covered by a MAWS sheet or notice for ${seconds} s; nothing was done; call it again once the page is shown`,
  browserTimeout: (tool: BrowserToolName) => `${tool}: MAWS did not answer within ${BROWSER_ANSWER_MS / 1000} s`,
  // Internal: never written (the engine abandoned the call); the row reads it.
  interrupted: (tool: BrowserToolName) => `${tool}: cancelled, the turn was interrupted`,
} as const;

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
