// E2 (M6): comment mode's two halves in the app (Design §10): the messages the bridge script posts from an artifact's
// frame, read with a schema (anything else is ignored), and the X10 `artifact-element` anchor built from a pick. Every
// field of a picked message is the page's to choose (a page can post the same shapes itself) and the title is the
// agent's, so the builder makes each field one line, cuts the element's text to 40 characters and the label to 200
// (E3's `AnchorSchema` caps), and puts the page's text nowhere but the label. The anchor carries X10's fields alone; a
// screenshot of the element is Deferred.
import * as z from 'zod';
import type { Anchor } from '@shared/anchor/anchor';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { titleOf } from '../model';

// What the app posts to the frame to start or end picking.
export const pickMessage = (on: boolean) => ({ type: 'maws:pick', on }) as const;

const PickedMessageSchema = z.looseObject({
  type: z.literal('maws:picked'),
  selector: z.string(),
  label: z.string(),
  text: z.string(),
  rect: z.looseObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
const PickCancelledMessageSchema = z.looseObject({ type: z.literal('maws:pick-cancelled') });
const PickMessageSchema = z.discriminatedUnion('type', [PickedMessageSchema, PickCancelledMessageSchema]);

export type PickedMessage = z.infer<typeof PickedMessageSchema>;
export type PickMessage = z.infer<typeof PickMessageSchema>;

export const parsePickMessage = (data: unknown): PickMessage | null => {
  const parsed = PickMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

const LABEL_MAX = 200; // X10's label cap
const LOCATOR_MAX = 2_000; // X10's locator cap
const TEXT_MAX = 40; // the element's text in the label (Design §10)
const ELEMENT_MAX = 60; // `<tag>#<id>`: the id is the page's, of any length

// eslint-disable-next-line no-control-regex -- the control characters are what is matched
const CONTROL = /[\x00-\x1f\x7f]/g;
const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

// At most `max` UTF-16 units (what the schema's `max` counts), an ellipsis marking a cut, never half a surrogate pair.
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return `${kept}…`;
}

// `<title> v<n> › <element> “<text>”`, the title shortened first so the element always shows.
export function artifactElementAnchor(record: DeliverableRecord, version: number, picked: PickedMessage): Anchor {
  const element = fit(oneLine(picked.label), ELEMENT_MAX);
  const text = fit(oneLine(picked.text), TEXT_MAX);
  const rest = ` v${version} › ${element}${text === '' ? '' : ` “${text}”`}`;
  const title = fit(oneLine(titleOf(record)), Math.max(1, LABEL_MAX - rest.length));
  let locator = picked.selector.replace(CONTROL, '').slice(0, LOCATOR_MAX);
  if (/[\uD800-\uDBFF]$/.test(locator)) locator = locator.slice(0, -1);
  return {
    kind: 'artifact-element',
    locator,
    label: fit(`${title}${rest}`, LABEL_MAX),
    pageUrl: deliverableUrl(record.appSessionId, record.id, version),
  };
}
