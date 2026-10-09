// E2 (M6): comment mode's two halves in the app (Design §10): the messages the bridge script posts from an artifact's
// frame, read with a schema (anything else is ignored), and the X10 `artifact-element` anchor built from a pick. Every
// field of a picked message is the page's to choose (a page can post the same shapes itself) and the title is the
// agent's, so the builder makes each field one line, cuts the element's text to 40 characters and the label to 200
// (E3's `AnchorSchema` caps), and puts the page's text nowhere but the label. The anchor carries X10's fields alone; a
// screenshot of the element is Deferred.
import * as z from 'zod';
import { anchorField, type Anchor } from '@shared/anchor/anchor';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import type { CardRect } from '../../code/anchor/anchor';
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

// P2-E1 (M3): re-pin (P2-E1 document, D8): the app asks the frame's page where the element a card is pinned to is now,
// by its selector, under an id of the ask's own that the answer echoes (two asks of one selector in flight, or an answer
// arriving after its ask gave up, must not be mistaken for each other); the answer's rect is the page's to choose, like
// a pick's, so it is read for its four finite numbers alone (the placement's clamps bound any value).
export const locateMessage = (id: number, selector: string) => ({ type: 'maws:locate', id, selector }) as const;

const LocatedMessageSchema = z.looseObject({
  type: z.literal('maws:located'),
  id: z.number().int(),
  selector: z.string(),
  rect: z.looseObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
});

export interface LocatedMessage {
  type: 'maws:located';
  id: number;
  selector: string;
  rect: CardRect | null;
}

export const parseLocatedMessage = (data: unknown): LocatedMessage | null => {
  const parsed = LocatedMessageSchema.safeParse(data);
  if (!parsed.success) return null;
  const { id, selector, rect } = parsed.data;
  return { type: 'maws:located', id, selector, rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
};

const LABEL_MAX = 200; // X10's label cap
const LOCATOR_MAX = 2_000; // X10's locator cap
const TEXT_MAX = 40; // the element's text in the label (Design §10)
const ELEMENT_MAX = 60; // `<tag>#<id>`: the id is the page's, of any length

// `<title> v<n> › <element> “<text>”`, the title shortened first so the element always shows. Each field is one line
// and fitted by X10's `anchorField`; the locator drops control characters and is cut bare.
export function artifactElementAnchor(record: DeliverableRecord, version: number, picked: PickedMessage): Anchor {
  const element = anchorField(picked.label, ELEMENT_MAX);
  const text = anchorField(picked.text, TEXT_MAX);
  const rest = ` v${version} › ${element}${text === '' ? '' : ` “${text}”`}`;
  const title = anchorField(titleOf(record), Math.max(1, LABEL_MAX - rest.length));
  return {
    kind: 'artifact-element',
    locator: anchorField(picked.selector, LOCATOR_MAX, { control: 'drop', ellipsis: false }),
    label: anchorField(`${title}${rest}`, LABEL_MAX, { control: 'drop' }), // its parts are one line already
    pageUrl: deliverableUrl(record.appSessionId, record.id, version),
  };
}
