// X10, the anchor (P1 spec §10 X10; E3 execution document, Interfaces "X10" and Design §2): what a message is about.
// One shape for every producer: E5's file line, E6's PR line, E4's browser element, E2's artifact element, P3-B's
// document comment, and `none` for an anchorless comment (a `/btw` exchange promoted to a side thread). The field caps are the security caps of
// Design §9, so the renderer and main validate with the one schema; `screenshot` is a MAWS-private file main reads
// (never written into the text the agent receives).
import * as z from 'zod';

export const ANCHOR_KINDS = ['browser-element', 'artifact-element', 'file-line', 'pr-line', 'none', 'artifact-comment' /* P3-B */] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

// `path` carries the anchor's path cap: it is the one path main opens (E3 M1's review)
export const AnchorScreenshotSchema = z.strictObject({ path: z.string().max(1000), width: z.number().int().positive(), height: z.number().int().positive() });
export type AnchorScreenshot = z.infer<typeof AnchorScreenshotSchema>;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/; // no control characters: the lead line and the tag embed these fields, and E4's and E2's values are page- or artifact-controlled
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\x00-\x1f\x7f]/g; // the characters ONE_LINE refuses

export interface AnchorFieldOptions {
  control?: 'space' | 'mark' | 'drop'; // a space (then whitespace runs collapse and the ends trim), U+FFFD, or nothing
  keep?: 'head' | 'tail'; // the end a cut keeps: a label's start, or a path's end
  ellipsis?: boolean; // a cut is marked with `…` (counted in `max`) unless false (a locator, an address cut bare)
}

// E11: the one strip-and-fit helper the producers build a field with (E2's artifact pick, E6's pr-line label), so a
// value a page, an artifact or a repository controls meets ONE_LINE and its cap: control characters handled per
// `control`, then at most `max` UTF-16 units (what the schema's `max` counts), never half a surrogate pair. E4d's
// `src/shared/browser/describe.ts` keeps its own copy: the browser preload bundles it without zod.
export function anchorField(text: string, max: number, options: AnchorFieldOptions = {}): string {
  const { control = 'space', keep = 'head', ellipsis = true } = options;
  const line = control === 'space' ? text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : text.replace(CONTROL, control === 'mark' ? '\uFFFD' : '');
  if (line.length <= max) return line;
  const mark = ellipsis ? '…' : '';
  const room = Math.max(0, max - mark.length);
  if (keep === 'tail') {
    let kept = line.slice(line.length - room);
    if (/^[\uDC00-\uDFFF]/.test(kept)) kept = kept.slice(1);
    return `${mark}${kept}`;
  }
  let kept = line.slice(0, room);
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return `${kept}${mark}`;
}

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
  // P3-B start: artifact-comment (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9; the P3 ledger's X26 row, the
  // X10 amendment): a comment on a document's passage, its thread kept in the document; `locator` the quoted passage,
  // `label` the document's title and tab
  artifactId: z.string().min(1).max(200).regex(ONE_LINE).optional(),
  threadId: z.string().min(1).max(200).regex(ONE_LINE).optional(),
  // P3-B end
});
export type Anchor = z.infer<typeof AnchorSchema>;
export type FileLineAnchor = Anchor & { kind: 'file-line'; path: string; line: number }; // E5's shape, now the union's member
