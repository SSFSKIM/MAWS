// Plain-text paste (C7 execution document, "Sizes and caps"): a short paste goes in line for line, one paragraph per
// line with blank lines kept (ProseMirror's own plain-text parser splits on runs of newlines and drops them), its first
// and last lines joined to the text around the caret. A copy made inside the editor carries ProseMirror's
// `data-pm-slice` HTML and is left to ProseMirror, whose slice parse restores atoms and chips with their attributes.
import { Fragment, Slice, type Schema } from '@tiptap/pm/model';
import { quotesGrant } from '@shared/engine/grant';

export function plainTextSlice(schema: Schema, text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, line === '' ? null : schema.text(line)));
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

// Whether the composer's own paste rule takes a text paste (anything but the editor's own copied slice).
export const handlesPlainText = ({ html }: { html: string }): boolean => !/data-pm-slice/.test(html);

// UX wave U1c (the architect's ruling of 2026-11-16): what a paste or a drop goes in as when it quotes the grant's
// opening: the text to frame as data, a pasted chip, or null when it quotes none. A grant by text is the person's only
// when they typed it; a text that arrives whole may be a model's. Either form the event carries is read: the plain
// text, and the slice ProseMirror parsed (from the HTML when there is some), its text blocks one line each and its
// atoms left out (a chip is framed already; a mention writes no line break). The chip holds the plain text, or the
// slice's when there is none.
export function framedText(plain: string, slice: Slice): string | null {
  const sliced = slice.content.textBetween(0, slice.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''));
  if (!quotesGrant(plain) && !quotesGrant(sliced)) return null;
  return plain !== '' ? plain : sliced;
}
