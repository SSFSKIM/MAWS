// The Markdown export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the agent's dialect (GFM plus the
// kind's lossless forms, X26) with block ids and comment milestones off, so the file is plain GFM wherever GFM can say
// the content and reads back through the import as the content it was written from, with one exception. It is written
// for people to read (`forReaders`, P3-F tracker L166): a line ending inside text is rendered as a line break (a
// backslash break, or `<br>` in a heading and at a block's end) rather than the agent read's `&#10;`, and the import
// reads that back as a hardBreak, or `<br>` as literal text: text holding a line ending does not read back exactly.
// M8's linked-directory mirror writes a document's `.md` through it. Several tabs are written in order, each
// introduced by its title as a top-level heading.
import { docMarkdown } from '../markdown';
import { schemaFor } from '../schema';
import { tabsOf, type ExportSource, type ViewRenderer } from './source';

export function exportMarkdown(source: ExportSource, { tab, renderView }: { tab?: string; renderView?: ViewRenderer /* P3-E */ } = {}): string {
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
    const text = md.serialize(body, { ids: false, forReaders: true, ...(charts.size > 0 && { charts }) });
    if (tabs.length === 1) return text;
    const heading = schema.node('heading', { level: 1 }, title ? [schema.text(title)] : []);
    return `${md.block(heading, { ids: false, forReaders: true })}\n\n${text}`;
  });
  return `${parts.join('\n\n')}\n`;
}
