// What a viewer reads of an agent's tabs on a machine (P5 O17; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §G): the inventory of a session's tabs as its tab engine holds them, stamped with `mawsd`'s epoch for the
// session's route (§B). M4: the inventory; M6 adds the frames, the input, the subscription, the feed and the limits.
//
// Every page string here (a title, a URL) is the page's own data, shown as text, never as markup. An engine bounds what it
// sends (BROWSER_SUMMARY_BOUNDS): a longer title or URL is cut at the bound, so one page cannot make the inventory's line
// unbounded; the summary is for showing, never for navigating.
import * as z from 'zod';
import { BrowserControlSchema, BrowserTabIdSchema } from './tab';

export type BrowserEpoch = string; // `mawsd`'s, opaque: minted each time a session's tab engine changes (§B)

export const BROWSER_SUMMARY_BOUNDS = { title: 4_096, url: 8_192, tabs: 256 } as const; // characters; tabs per inventory

export const BrowserTabSummarySchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  title: z.string().max(BROWSER_SUMMARY_BOUNDS.title),
  url: z.string().max(BROWSER_SUMMARY_BOUNDS.url),
  control: BrowserControlSchema,
});
export type BrowserTabSummary = z.infer<typeof BrowserTabSummarySchema>;

export interface BrowserInventory {
  epoch: BrowserEpoch;
  tabs: BrowserTabSummary[];
  selected: string | null;
  state: 'ready' | 'unavailable';
  reason?: string;
}
