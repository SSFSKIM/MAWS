// X10, the anchor (P1 spec §10 X10; E3 execution document, Interfaces "X10" and Design §2): what a message is about.
// One shape for every producer: E5's file line, E6's PR line, E4's browser element, E2's artifact element, and `none`
// for an anchorless comment (a `/btw` exchange promoted to a side thread). The field caps are the security caps of
// Design §9, so the renderer and main validate with the one schema; `screenshot` is a MAWS-private file main reads
// (never written into the text the agent receives).
import * as z from 'zod';

export const ANCHOR_KINDS = ['browser-element', 'artifact-element', 'file-line', 'pr-line', 'none'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

export const AnchorScreenshotSchema = z.strictObject({ path: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });
export type AnchorScreenshot = z.infer<typeof AnchorScreenshotSchema>;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/; // no control characters: the lead line and the tag embed these fields, and E4's and E2's values are page- or artifact-controlled

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
});
export type Anchor = z.infer<typeof AnchorSchema>;
export type FileLineAnchor = Anchor & { kind: 'file-line'; path: string; line: number }; // E5's shape, now the union's member
