// The marks' identity (X18; the P2-C document, Design §4): what of a finalized assistant text block main keeps state
// for. A question is a `need-input` part and an essential an `essential` part of the block's grammar-2 parse; to-human
// and insight marks need no state. A mark is `(appSessionId, message uuid, block index, span)`, where `span` is the
// ordinal among the block's parts of the mark's own kind, so a question's id holds when an essential is added to or
// removed from the same block.
import * as z from 'zod';
import { MessageUuidSchema, type AppSessionId, type MessageUuid } from '../graph/ids';
import { parse, type Choice } from './to-human-parser';

export type MarkKind = 'need-input' | 'essential';

export const MarkIdSchema = z.string().min(1).brand<'MarkId'>();
export type MarkId = z.infer<typeof MarkIdSchema>;

export const MarkAnchorSchema = z.strictObject({ messageUuid: MessageUuidSchema, blockIndex: z.number().int().nonnegative(), span: z.number().int().nonnegative() });
export type MarkAnchor = z.infer<typeof MarkAnchorSchema>;

export const markIdOf = (appSessionId: AppSessionId, kind: MarkKind, anchor: MarkAnchor): MarkId =>
  `${appSessionId}:${anchor.messageUuid}:${anchor.blockIndex}:${kind === 'need-input' ? 'q' : 'e'}${anchor.span}` as MarkId;

export type BlockMark = { kind: MarkKind; anchor: MarkAnchor; head: string; choices?: Choice[] };

/** The questions and essentials of one assistant text block, in the block's order. */
export function marksOf(text: string, block: { messageUuid: MessageUuid; blockIndex: number }): BlockMark[] {
  const seen: Record<MarkKind, number> = { 'need-input': 0, essential: 0 };
  const marks: BlockMark[] = [];
  for (const part of parse(text)) {
    if (part.kind !== 'need-input' && part.kind !== 'essential') continue;
    const anchor = { messageUuid: block.messageUuid, blockIndex: block.blockIndex, span: seen[part.kind]++ };
    marks.push({ kind: part.kind, anchor, head: questionHead(part.text), ...(part.choices ? { choices: part.choices } : {}) });
  }
  return marks;
}

// Ported character for character from the doperpowers mod (`hooks/mods/to-human.tsx`, `questionHead`): the head an
// answer quotes is the legacy contract (Design §1).
const HEAD_MAX = 120;

function cut(text: string, max: number): string {
  const points = Array.from(text);
  return points.length >= max ? `${points.slice(0, max - 1).join('')}…` : text;
}

/**
 * The line an answer quotes to name its question: the question's first non-blank line, with double quotes replaced
 * before it is cut so the answer form has one unambiguous closing quote.
 */
export function questionHead(text: string): string {
  const line = (text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '').replace(/"/g, "'");
  return cut(line, HEAD_MAX);
}
