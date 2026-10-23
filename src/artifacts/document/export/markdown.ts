// The Markdown export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): GFM plus the kind's forms (X26),
// with block ids and comment milestones off. Reader exports flatten chips to values and omit trailing editing space;
// mirror mode retains the chip metadata and empty paragraphs. Both keep the existing reader-formatted line breaks.
// Per the parent's ruling of 2026-10-18 (P3-F, tracker L166), a line ending inside text and a line break are written
// for a reader (`forReaders`):
// a backslash break, or `<br>` in a heading, a table cell and at a block's end (a last line of bare whitespace is no
// line), never the agent read's `&#10;`, and that part is judged by how a CommonMark reader renders it, not by reading
// back exactly (the import reads a backslash break as a hardBreak and `<br>` as text). A cell's hardBreak (the
// tracker's P4 row) and a line ending in a cell's inline code (where `<br>` would be literal) keep its table as
// structure blocks. The canonical dialect is exact for a line ending inside text and a hardBreak with a line after it; a hardBreak
// with none (a block's end, alone, a heading) and a break's own marks do not read back exactly (the same P4 row). M8's
// linked-directory mirror (a searchable read-only copy, not what `artifact_read` or an edit's quotes use) writes a
// document's `.md` through it.
// Several tabs are written in order, each introduced by its title as a top-level heading.
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { docMarkdown } from '../markdown';
import { schemaFor } from '../schema';
import { tabsOf, type ExportSource, type ViewRenderer } from './source';

// Reader exports are not the agent's lossless editing dialect. Chips become their visible values; trailing empty
// paragraphs are editing space, not content in a Markdown file. Neither transformation touches the stored document.
function readerBody(body: PMNode): PMNode {
  const readable = (node: JSONContent): JSONContent[] => {
    const field = node.type === 'date' ? 'iso' : node.type === 'mention' ? 'label' : node.type === 'dropdown' ? 'value' : null;
    if (field) {
      const text = String(node.attrs?.[field] ?? '');
      return text ? [{ type: 'text', text, ...(node.marks && { marks: node.marks }) }] : [];
    }
    return [{ ...node, ...(node.content && { content: node.content.flatMap(readable) }) }];
  };
  const json = readable(body.toJSON())[0];
  while (json.content?.length && json.content.at(-1)?.type === 'paragraph' && !json.content.at(-1)?.content?.length) json.content.pop();
  return body.type.schema.nodeFromJSON(json);
}

export function exportMarkdown(source: ExportSource, { tab, renderView, mode = 'reader' }: { tab?: string; renderView?: ViewRenderer /* P3-E */; mode?: 'reader' | 'mirror' } = {}): string {
  const md = docMarkdown();
  const schema = schemaFor();
  const tabs = tabsOf(source, tab);
  // P3-E (E2 M5): each chart block's drawn view, by its id, written where the block is
  const charts = new Map<string, string>();
  if (renderView)
    for (const { body } of tabs)
      body.descendants((node) => {
        const view = node.type.name === 'chart' && typeof node.attrs.id === 'string' ? renderView(node) : undefined;
        if (view) charts.set(node.attrs.id as string, view.markdown);
        return true;
      });
  const parts = tabs.map(({ title, body }) => {
    const text = md.serialize(mode === 'reader' ? readerBody(body) : body, { ids: false, forReaders: true, ...(charts.size > 0 && { charts }) });
    if (tabs.length === 1) return text;
    const heading = schema.node('heading', { level: 1 }, title ? [schema.text(title)] : []);
    return `${md.block(heading, { ids: false, forReaders: true })}\n\n${text}`;
  });
  return `${parts.join('\n\n')}\n`;
}
