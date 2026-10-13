// The Markdown export (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the agent's dialect (GFM plus the
// kind's lossless forms, X26) with block ids and comment milestones off, so the file is plain GFM wherever GFM can say
// the content and reads back through the import as the content it was written from. M8's linked-directory mirror
// writes a document's `.md` through it. Several tabs are written in order, each introduced by its title as a
// top-level heading.
import { docMarkdown } from '../markdown';
import { schemaFor } from '../schema';
import { tabsOf, type ExportSource } from './source';

export function exportMarkdown(source: ExportSource, { tab }: { tab?: string } = {}): string {
  const md = docMarkdown();
  const schema = schemaFor();
  const tabs = tabsOf(source, tab);
  const parts = tabs.map(({ title, body }) => {
    const text = md.serialize(body, { ids: false });
    if (tabs.length === 1) return text;
    const heading = schema.node('heading', { level: 1 }, title ? [schema.text(title)] : []);
    return `${md.block(heading, { ids: false })}\n\n${text}`;
  });
  return `${parts.join('\n\n')}\n`;
}
