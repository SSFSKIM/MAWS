// The agent's read of a document (D7 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.3, §4.4; S5's read
// format): one tab as the dialect of markdown.ts, ranged by a top-level block id and a count, open comments written as
// `<c:ID>…</c:ID>` milestones, and a footer naming the open threads and orphans of the range. The host's tool (M7)
// adds the live revision, captures the session's base and answers `sinceRevision` from its provenance.
import type { Doc, Node } from '../yjs';
import { YNode } from '../yjs/document';
import { ynodeToPmnode } from '../yjs/prosemirror';
import { docMarkdown } from './markdown';
import { schemaFor } from './schema';
import { listTabs, tabBody } from './tabs';
import { liveThreadIds, locate, markExtents, threadStates, type ThreadState } from './threads';

export const DEFAULT_COUNT = 200;
export const MAX_COUNT = 1000;

export interface ReadOptions {
  /** The tab to read; the first tab when absent. */
  tab?: string;
  /** The top-level block the range starts at (inclusive); a nested block's id starts at the block that holds it. */
  from?: string;
  /** How many top-level blocks, 1 to 1,000; 200 when absent. */
  count?: number;
}

export interface DocumentRead {
  kind: 'document';
  tabs: Array<{ id: string; title: string; blocks: number }>;
  /** The tab read. */
  tab: string;
  markdown: string;
  /** The first top-level block after the range (where the next read starts), or null at the end of the tab. */
  next: string | null;
}

/** A read that cannot be answered: the reason and what it named, for the tool's machine-readable error. */
export class ReadError extends Error {
  constructor(
    readonly reason: 'notFound' | 'invalid',
    readonly target: string,
  ) {
    super(reason === 'notFound' ? `No block or tab ${target} in this document` : `Invalid ${target}`);
    this.name = 'ReadError';
  }
}

const blocksOf = (body: Node): Node[] => body.toArray().filter((child): child is Node => child instanceof YNode);
const contains = (node: Node, id: string): boolean => node.getAttr('id') === id || blocksOf(node).some((child) => contains(child, id));

// The blocks whose ids the dialect shows (markdown.ts): textblocks in the doc, a quote or a callout; items; rows.
const TEXTBLOCKS = new Set(['paragraph', 'heading']);
const SHOWN_IN = new Set(['doc', 'blockquote', 'callout']);
const SHOWN = new Set(['listItem', 'taskItem', 'tableRow']);
/** The innermost block around `node` whose id the read shows. */
function shownBlock(node: Node, body: Node): string | null {
  for (let at: Node | null = node; at && at !== body; at = at.parent) {
    const id = at.getAttr('id');
    if (typeof id !== 'string') continue;
    const parent = at.parent;
    if (parent === body || SHOWN.has(String(at.name)) || (TEXTBLOCKS.has(String(at.name)) && parent && SHOWN_IN.has(String(parent.name)))) return id;
  }
  return null;
}

const quoted = (thread: ThreadState): string => JSON.stringify(thread.quote);
const messages = (thread: ThreadState): string => `${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}`;

/** The tab's top-level blocks `from` (inclusive) for `count` as the agent's markdown, with the comments footer. */
export function readDocument(doc: Doc, { tab, from, count = DEFAULT_COUNT }: ReadOptions = {}): DocumentRead {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new ReadError('invalid', `count ${count} (1 to ${MAX_COUNT})`);
  const tabs = listTabs(doc);
  const tabId = tab ?? tabs[0]?.id;
  const body = tabId == null ? undefined : tabBody(doc, tabId);
  if (tabId == null || !body) throw new ReadError('notFound', tab ?? 'tab');
  const blocks = blocksOf(body);
  const start = from == null ? 0 : blocks.findIndex((block) => contains(block, from));
  if (start < 0) throw new ReadError('notFound', from!);
  const range = blocks.slice(start, start + count);
  const whole = range.length === blocks.length;

  const states = threadStates(doc, liveThreadIds(doc));
  const extents = markExtents(body);
  const show = new Set(states.filter((thread) => thread.status === 'open').map((thread) => thread.id));
  const md = docMarkdown();
  const schema = schemaFor();
  const text = range.map((block) => md.block(ynodeToPmnode(block, schema), { milestones: show })).join('\n\n');

  // The footer: this tab's open threads that are live in the range or orphaned near it.
  const inRange = new Set(range.map((block) => block.getAttr('id')));
  const topOf = (node: Node): Node => {
    let top = node;
    while (top.parent && top.parent !== body) top = top.parent;
    return top;
  };
  const open = states.filter((thread) => thread.status === 'open' && (extents.has(thread.id) || (thread.orphan && thread.tabId === tabId)));
  const resolved = states.filter((thread) => thread.status === 'resolved' && thread.tabId === tabId).length;
  const lines: string[] = [];
  let outside = 0;
  for (const thread of open) {
    const extent = extents.get(thread.id);
    if (extent) {
      if (!inRange.has(topOf(extent.first.node).getAttr('id'))) outside += 1;
      else lines.push(`- c:${thread.id} on ^${shownBlock(extent.first.node, body) ?? '?'} · ${quoted(thread)} · ${messages(thread)}`);
      continue;
    }
    const near = locate(doc, thread).blockId;
    const nearTop = near == null ? undefined : blocks.find((block) => contains(block, near));
    if (!whole && (!nearTop || !inRange.has(nearTop.getAttr('id')))) outside += 1;
    else lines.push(`- c:${thread.id} orphaned, near ^${near ?? '?'} · ${quoted(thread)} · ${messages(thread)}`);
  }
  let footer = '';
  if (open.length > 0 || resolved > 0) {
    const orphaned = open.filter((thread) => thread.orphan).length;
    const summary = `Comments: ${open.length} open${orphaned ? ` (${orphaned} orphaned)` : ''}${resolved ? `, ${resolved} resolved (not shown; artifact_comments {status: "all"})` : ''}${outside ? `; ${outside} outside this range` : ''}`;
    footer = `\n\n---\n${[summary, ...lines].join('\n')}`;
  }

  return {
    kind: 'document',
    tabs: tabs.map((entry) => ({ id: entry.id, title: entry.title, blocks: blocksOf(tabBody(doc, entry.id)!).length })),
    tab: tabId,
    markdown: `${text}${footer}\n`,
    next: (blocks[start + count]?.getAttr('id') as string | undefined) ?? null,
  };
}
