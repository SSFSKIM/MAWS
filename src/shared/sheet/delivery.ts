// The delivery's block (contract X3; C2's I7; the pinned set's `schema/delivery.schema.json`): the last line of an
// envelope, in the terminal form and the steer alike. A reader reads the block and nothing above it: the prose is the
// model's to read, and its labels can be cut where the block's places never are. Pure.
import * as z from 'zod';
import { codePoints } from './text';

const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const ID = /^q[1-9][0-9]{0,8}$/;
const Int1 = z.number().int().min(1);

// Loose, as every shape sminos writes is read here (S5): a field a later sminos adds does not lose an answer's receipt.
export const SheetDeliverySchema = z.looseObject({
  v: z.literal(1),
  keys: z.array(z.string().regex(KEY)).max(200),
  answered: z.array(
    z.looseObject({
      id: z.string().regex(ID),
      revision: Int1,
      picks: z.array(Int1), // places among the options of the answered revision, from 1
      text: z.string().refine((text) => codePoints(text) <= 500),
      textCut: z.literal(true).optional(),
      textFile: z.string().min(1).optional(),
      images: z.array(z.string().min(1)),
    }),
  ),
  dismissed: z.array(z.string().regex(ID)),
  more: z.literal(true).optional(),
});

export interface SheetDelivery {
  v: 1;
  keys: string[];
  answered: { id: string; revision: number; picks: number[]; text: string; textCut?: true; textFile?: string; images: string[] }[];
  dismissed: string[];
  more?: true;
}

// The block is one line: `<`, `>` and `&` inside it are written as `\u` escapes, so its first closing tag is its own.
const BLOCK = /<sheet-delivery>([^<]*)<\/sheet-delivery>/g;

/** Every `<sheet-delivery>` block of a text that holds to the pinned schema, in order; none for a text without one. */
export function parseSheetDeliveries(text: string): SheetDelivery[] {
  const out: SheetDelivery[] = [];
  for (const [, body] of text.matchAll(BLOCK)) {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      continue;
    }
    const parsed = SheetDeliverySchema.safeParse(json);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
