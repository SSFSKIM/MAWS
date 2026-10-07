// Comment mode's checked half (E4d execution document, Design §5, §6, §9; Interfaces "comment.ts"): main's schema for
// what a browser tab's preload reports, the crop's bounds, and the X10 anchor main builds from a report it accepted.
// Nothing here trusts the page: the report is geometry and names under strict caps, the css must be inside the grammar
// `cssPath` writes, the page URL is main's own, and the anchor is parsed by X10's schema and E4c's locator schema
// before anyone sees it.
import * as z from 'zod';
import { AnchorSchema, type Anchor, type AnchorScreenshot } from '../anchor/anchor';
import { elementLabel, oneLine, REPORT_A11Y_MAX, REPORT_NAME_MAX, REPORT_TOKEN_MAX, type PickArmed, type PickRefused, type PickReport } from './comment-protocol';
import { CSS_PATH, CSS_PATH_MAX } from './describe';
import { BrowserLocatorSchema } from './locator';
import { validateBrowserUrl } from './url';

export { AnchorBoxSchema } from '../anchor/anchor';

// The composer's image rule (`MAX_IMAGE_EDGE`, `src/renderer/src/composer/editor/attachments.ts`) and A-34's byte cap.
export const CROP_MAX_EDGE = 1568;
export const CROP_MAX_BYTES = 3.5 * 1024 * 1024;
// A crop is read once, at send; the transcript then carries the image itself. The boot sweep's bounds.
export const CROP_RETENTION_MS = 7 * 86_400_000;
export const CROP_FILES_MAX = 200;

const LABEL_MAX = 200; // X10's
const PAGE_URL_MAX = 2000; // X10's

// `unavailable`: the page never confirmed an arm, or never answered a context-menu pick (Decision Log 34)
export const CommentDisarmReasonSchema = z.enum(['toggle', 'picked', 'escape', 'navigated', 'agent', 'closed', 'crashed', 'refused', 'other', 'unavailable']);
export type CommentDisarmReason = z.infer<typeof CommentDisarmReasonSchema>;

const ElementDescriptionSchema = z.strictObject({
  css: z.string().min(1).max(CSS_PATH_MAX),
  role: z.string().min(1).max(REPORT_TOKEN_MAX).nullable(),
  name: z.string().max(REPORT_NAME_MAX),
  a11y: z.string().max(REPORT_A11Y_MAX),
  tag: z.string().min(1).max(REPORT_TOKEN_MAX),
  confident: z.boolean(),
});
const Epoch = z.number().int().nonnegative();
const RequestId = z.string().min(1).max(64).nullable();

// zod 4's `number()` refuses NaN and the infinities, so every coordinate is finite.
export const PickReportSchema = z.strictObject({
  type: z.literal('picked'),
  epoch: Epoch,
  requestId: RequestId,
  mode: z.enum(['click', 'area']),
  description: ElementDescriptionSchema,
  nameOverLong: z.boolean(),
  rect: z.strictObject({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }),
  scroll: z.strictObject({ x: z.number(), y: z.number() }),
  viewport: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
}) satisfies z.ZodType<PickReport>;

export const PickRefusedSchema = z.strictObject({
  type: z.literal('refused'),
  epoch: Epoch,
  requestId: RequestId,
  reason: z.enum(['tooDeep', 'noElement']),
}) satisfies z.ZodType<PickRefused>;

export const PickArmedSchema = z.strictObject({ type: z.literal('armed'), epoch: Epoch }) satisfies z.ZodType<PickArmed>;

export const PreloadMessageSchema = z.discriminatedUnion('type', [PickReportSchema, PickRefusedSchema, PickArmedSchema]);

// main's URL for the anchor: as it is within X10's cap, else its origin and path, else none (the anchor stays valid
// without it; the lead then reads `element <css>`). Null for a URL that is not http or https.
function anchorPageUrl(pageUrl: string): string | undefined | null {
  const check = validateBrowserUrl(pageUrl);
  if (!check.ok) return null;
  if (check.url.length <= PAGE_URL_MAX) return check.url;
  const url = new URL(check.url);
  const short = `${url.origin}${url.pathname}`;
  return short.length <= PAGE_URL_MAX ? short : undefined;
}

// The X10 anchor of an accepted pick, or null when it cannot be one. `role` and `name` are sent only where E4c's
// `getByRole` will agree (Design §6, Decision Log 8): `role` when the description is confident; `name` when it is also
// whole and not empty, since E4c narrows the css match by the exact name and a cut or doubtful one would make a correct
// css fail to resolve. `locator` is the css (what the lead names and `browser_act {target: {css}}` takes).
export function browserElementAnchor(input: { report: PickReport; pageUrl: string; screenshot: AnchorScreenshot | null }): Anchor | null {
  const { report, screenshot } = input;
  const { description, rect, scroll } = report;
  if (description.css.length > CSS_PATH_MAX || !CSS_PATH.test(description.css)) return null;
  const pageUrl = anchorPageUrl(input.pageUrl);
  if (pageUrl === null) return null;
  const name = oneLine(description.name);
  const tag = oneLine(description.tag);
  const a11y = oneLine(description.a11y);
  const confident = description.confident;
  const anchor: Anchor = {
    kind: 'browser-element',
    locator: description.css,
    label: elementLabel({ role: description.role, name, tag }, LABEL_MAX),
    ...(pageUrl !== undefined && { pageUrl }),
    ...(screenshot !== null && { screenshot }),
    css: description.css,
    ...(confident && description.role !== null && { role: description.role }),
    ...(confident && !report.nameOverLong && name !== '' && { name }),
    ...(a11y !== '' && { a11y }),
    box: {
      x: Math.round(rect.x + scroll.x),
      y: Math.round(rect.y + scroll.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    },
  };
  const parsed = AnchorSchema.safeParse(anchor);
  if (!parsed.success || !BrowserLocatorSchema.safeParse({ css: anchor.css, role: anchor.role, name: anchor.name }).success) return null;
  return parsed.data;
}
