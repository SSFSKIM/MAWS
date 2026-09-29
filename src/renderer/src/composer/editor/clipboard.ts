// Plain-text paste (C7 execution document, "Sizes and caps"): a short paste goes in line for line, one paragraph per
// line with blank lines kept (ProseMirror's own plain-text parser splits on runs of newlines and drops them), its first
// and last lines joined to the text around the caret. A copy made inside the editor carries ProseMirror's
// `data-pm-slice` HTML and is left to ProseMirror, whose slice parse restores atoms and chips with their attributes.
import { Fragment, Slice, type Schema } from '@tiptap/pm/model';

export function plainTextSlice(schema: Schema, text: string): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, line === '' ? null : schema.text(line)));
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

// Whether the composer's own paste rule takes a text paste (anything but the editor's own copied slice).
export const handlesPlainText = ({ html }: { html: string }): boolean => !/data-pm-slice/.test(html);
