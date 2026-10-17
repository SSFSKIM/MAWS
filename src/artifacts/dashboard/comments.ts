// A dashboard's block comments (P3-E2 M4; E's Decision Log 28 (2), (5)): B's editor comments a selected block whole when
// its host names the block's quote (`blockCommentQuote`, DocumentEditor's prop); a dashboard names its views, so a chart
// or table is commented as a block and every other block as B's passage. The quote is also the comment's locator in
// the agent's lead (`content "<locator>" in dashboard <id>`), written as `<view>: <caption or dataset id>` so the agent
// reads which kind of block it is. Portable.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseSpec } from './spec';

/** `chart: <caption>` or `table: <caption>` for a dashboard view block, the dataset id without a caption; else none. */
export function blockCommentQuote(node: PMNode): string | undefined {
  if (node.type.name !== 'chart') return undefined;
  const parsed = parseSpec(node.attrs.spec);
  const view = parsed.ok && parsed.spec.view === 'table' ? 'table' : 'chart';
  const caption = (parsed.ok ? parsed.spec.title : parsed.title)?.trim();
  const source = typeof node.attrs.source === 'string' ? node.attrs.source.trim() : '';
  return `${view}: ${caption || source || '(no dataset)'}`;
}
