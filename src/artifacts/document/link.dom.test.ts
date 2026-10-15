// The link mark's narrowed contract in a real Tiptap editor (happy-dom; Decision Log 18 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): `href` and `title` never hold an ASCII control character, so
// pasted HTML and the link commands store them stripped, and the stored link reads back through the agent's markdown
// exactly.
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { coreExtensionOptions } from './ids';
import { docMarkdown } from './markdown';
import { extensions, schemaFor } from './schema';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const make = (content: JSONContent | string): Editor => (editor = new Editor({ extensions: extensions(), coreExtensionOptions, content }));
const links = (doc: JSONContent): unknown[] =>
  [...(doc.marks ?? []).filter((mark) => mark.type === 'link').map((mark) => mark.attrs), ...(doc.content ?? []).flatMap(links)];
/** serialize → parse of the editor's doc gives the same links back. */
const roundTrips = (doc: JSONContent): void => {
  const md = docMarkdown();
  const schema = schemaFor();
  const back = schema.nodes.doc.create(null, md.parse(md.serialize(schema.nodeFromJSON(doc))));
  expect(links(back.toJSON() as JSONContent)).toEqual(links(doc));
};

describe('a link’s href and title (Decision Log 18)', () => {
  it('are stored without control characters when parsed from HTML', () => {
    make('<p><a href="https://example.com/a&#10;b&#1;c&#127;" title="say&#9;&quot;hi&quot;&#13;">Link</a></p>');
    const doc = editor!.getJSON();
    expect(links(doc)).toEqual([{ href: 'https://example.com/abc', title: 'say"hi"' }]);
    roundTrips(doc);
  });

  it('are stored without control characters when set or toggled through the link commands', () => {
    make({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two' }] }] });
    editor!.chain().setTextSelection({ from: 1, to: 4 }).setLink({ href: 'https://example.com/a\nb', title: 'x\ty\u001f' }).run();
    editor!.chain().setTextSelection({ from: 5, to: 8 }).toggleLink({ href: 'https://example.com/\u0007c', title: null }).run();
    const doc = editor!.getJSON();
    expect(links(doc)).toEqual([
      { href: 'https://example.com/ab', title: 'xy' },
      { href: 'https://example.com/c', title: null },
    ]);
    roundTrips(doc);
  });
});
