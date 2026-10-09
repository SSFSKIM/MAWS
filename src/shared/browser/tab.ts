// The browser tab (E4a execution document, Design §2; P1 interface ledger §5): MAWS's record of one web page, owned by
// main, belonging to one session (P-21). The ledger's fields come first, E4a's additive ones after; E4b, E4c and E4d
// read this model and the constants beside it. Main sends the whole list per session (`browser.tabs.changed`); every
// page string in it (title, URL, favicon) is data the renderer shows as text or a `data:` image, never as markup.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';
import { LOAD_ERROR_KINDS } from './errors';

export const BROWSER_TAB_ID = /^b_[0-9a-f]{12}$/;
// Main's `invalid_input` message for a tab id it does not know (a tab closed meanwhile); the renderer drops only this one.
export const UNKNOWN_BROWSER_TAB = 'unknown browser tab';
export const BrowserTabIdSchema = z.string().regex(BROWSER_TAB_ID);
// cua #90: a Chrome extension id, as `import.ts`'s EXTENSION_ID (which imports this file, so it cannot be imported here)
const EXTENSION_ID = /^[a-p]{32}$/;

// The tab's own Chromium session: the default partition, or one per imported Chrome profile (E4b). Never the app's
// default session, nor E2's `maws-capture`.
export const DEFAULT_PARTITION = 'persist:maws-browser';
const PROFILE_PARTITION_PREFIX = 'persist:maws-chrome-';
export const profilePartition = (profileDir: string): string => `${PROFILE_PARTITION_PREFIX}${profileDir}`;
export const BrowserPartitionSchema = z
  .string()
  .refine((partition) => partition === DEFAULT_PARTITION || (partition.startsWith(PROFILE_PARTITION_PREFIX) && partition.length > PROFILE_PARTITION_PREFIX.length), {
    message: 'not a browser partition',
  });

// Who drives the page: E4c moves it; E4a only returns it to `idle` through `browser.control.handBack`.
export const BrowserControlSchema = z.enum(['idle', 'agent', 'human']);
export type BrowserControl = z.infer<typeof BrowserControlSchema>;

export const BROWSER_HANDBACK_IDLE_MS = 3000; // E4c: the human's control lapses after this long without input
export const BROWSER_AGENT_IDLE_MS = 10_000; // E4c: `control: 'agent'` lapses to idle this long after the agent's last action
export const BROWSER_LOADED_TABS_MAX = 12; // loaded tabs across the app (Design §2; Decision Log 6)
export const BROWSER_TABS_MEMORY_MAX_MIB = 2048; // the soft cap on loaded tabs' sampled working sets
export const BROWSER_DENIED_MAX = 8; // a document's denied permission requests kept for the banner
export const BROWSER_PLACEHOLDER_MAX_BYTES = 400 * 1024; // the cover's JPEG; larger, and main sends null
export const BROWSER_SUGGESTIONS_MAX = 8; // the address field's history rows
export const BROWSER_AGENT_BADGE_MAX_CHARS = 40; // E13: an agent tab's badge text

const count = z.number().int().min(0);

export const BrowserTabSchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  appSessionId: AppSessionIdSchema,
  partition: BrowserPartitionSchema,
  url: z.string(), // '' for a tab that never navigated
  title: z.string(),
  favicon: z.string().startsWith('data:image/').nullable(), // a data: URL main built from the icon's bytes, never the page's URL
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  zoom: z.number().positive(), // Chromium's factor, 1 = 100%
  control: BrowserControlSchema,
  controlSince: z.string(), // ISO
  suspended: z.boolean(), // no view: only {url, title, favicon} kept
  // E4a additive
  loadError: z
    .strictObject({ url: z.string(), host: z.string(), kind: z.enum(LOAD_ERROR_KINDS), code: z.number().int(), description: z.string() })
    .nullable(),
  crashed: z.strictObject({ reason: z.string() }).nullable(), // render-process-gone's reason until the next committed navigation
  failed: z.strictObject({ message: z.string() }).nullable(), // the view could not be created; Retry clears it
  unresponsive: z.boolean(),
  blockedPopups: count, // window.open calls the gate denied since the last navigation
  find: z.strictObject({ active: count, matches: count }).nullable(), // the open find bar's last result
  denied: z.array(z.strictObject({ host: z.string(), permission: z.string() })).max(BROWSER_DENIED_MAX), // cleared on navigation
  download: z
    .strictObject({ name: z.string(), state: z.enum(['progressing', 'done', 'cancelled', 'failed']), received: count, total: count, path: z.string().nullable() })
    .nullable(),
  memoryKiB: count.nullable(), // the renderer process's working set from the last sample; null while suspended or unsampled
  placedIn: z.strictObject({ paneId: z.string().min(1), surface: z.enum(['panel', 'main']) }).nullable(), // the owning pane's token
  covered: z.boolean(), // main hid the view for a layer
  createdAt: z.string(),
  lastShownAt: z.string(),
  // E13 additive (the in-app browser spec of 2026-10-08): the panel's badge on a tab an agent created through cua (or a
  // page it drives opened), the group's title when the agent named its session, else "agent"; null for every other tab
  // and once the agent's connection let the tab go. Never persisted.
  agentBadge: z.string().max(BROWSER_AGENT_BADGE_MAX_CHARS).nullable(),
  // cua #90 additive (its spec's "The popup view", options): an extension's options page MAWS opened as a tab, the one
  // place a `chrome-extension://` URL loads in a tab; `title` is what the tab and its address field show ("<name> ·
  // Options"). Such a tab is transient: never persisted, never suspended (closed instead), closed with its extension.
  // null for every other tab.
  internal: z.strictObject({ kind: z.literal('extension'), extensionId: z.string().regex(EXTENSION_ID), title: z.string() }).nullable(),
});
export type BrowserTab = z.infer<typeof BrowserTabSchema>;

// cua #90: whether a URL is a page of the extension (`chrome-extension://<id>/…`), the one origin an internal tab of that
// extension may show.
export function isExtensionPage(url: string, extensionId: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' && parsed.host === extensionId; // Node gives the scheme an opaque origin
  } catch {
    return false;
  }
}
