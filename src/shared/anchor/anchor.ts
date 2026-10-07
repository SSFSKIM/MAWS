// X10, the anchor (P1 spec §10 X10; E3 execution document, Interfaces "X10" and Design §2): what a message is about.
// One shape for every producer: E5's file line, E6's PR line, E4's browser element, E2's artifact element, and `none`
// for an anchorless comment (a `/btw` exchange promoted to a side thread). The field caps are the security caps of
// Design §9, so the renderer and main validate with the one schema; `screenshot` is a MAWS-private file main reads
// (never written into the text the agent receives).
import * as z from 'zod';

export const ANCHOR_KINDS = ['browser-element', 'artifact-element', 'file-line', 'pr-line', 'none'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

// `path` carries the anchor's path cap: it is the one path main opens (E3 M1's review)
export const AnchorScreenshotSchema = z.strictObject({ path: z.string().max(1000), width: z.number().int().positive(), height: z.number().int().positive() });
export type AnchorScreenshot = z.infer<typeof AnchorScreenshotSchema>;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/; // no control characters: the lead line and the tag embed these fields, and E4's and E2's values are page- or artifact-controlled

// E4d start: the element's box at the pick, in whole CSS pixels of the page's document (E4d execution document, Design §6)
export const AnchorBoxSchema = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() });
export type AnchorBox = z.infer<typeof AnchorBoxSchema>;
// E4d end

export const AnchorSchema = z.strictObject({
  kind: z.enum(ANCHOR_KINDS),
  locator: z.string().max(2000).regex(ONE_LINE), // `<path>#L<line>` (file-line, E5); E6's PR files URL + fragment; E4 and E2 encode theirs
  label: z.string().max(200).regex(ONE_LINE),
  pageUrl: z.string().max(2000).regex(ONE_LINE).optional(),
  path: z.string().max(1000).regex(ONE_LINE).optional(),
  line: z.number().int().positive().optional(),
  screenshot: AnchorScreenshotSchema.optional(),
  side: z.enum(['old', 'new']).optional(), // pr-line (E6's document, 2026-10-06)
  prNumber: z.number().int().positive().optional(), // pr-line
  // E4d start: browser-element (E4d execution document, Design §6; P1 ledger §5; A-19): a locator's three fields flat, so
  // `{css, role, name}` is what E4c's `browser_act` resolves, with `locator` the css again
  css: z.string().min(1).max(2000).regex(ONE_LINE).optional(), // the CSS selector, unique in the document at the pick
  role: z.string().min(1).max(64).regex(ONE_LINE).optional(), // the ARIA role E4c narrows by
  name: z.string().max(200).regex(ONE_LINE).optional(), // the accessible name, whole or absent (never cut)
  a11y: z.string().max(2000).regex(ONE_LINE).optional(), // the role-and-name path, a human label
  box: AnchorBoxSchema.optional(),
  // E4d end
});
export type Anchor = z.infer<typeof AnchorSchema>;
export type FileLineAnchor = Anchor & { kind: 'file-line'; path: string; line: number }; // E5's shape, now the union's member
