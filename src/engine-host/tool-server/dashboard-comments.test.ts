// P3-E2 M4 (E's Decision Log 28; the execution document's acceptance 3): a comment on a dashboard's chart block, as the
// agent meets it through B's tools unchanged, over A's real store with the dashboard kind registered. `artifact_read`'s
// footer names the live block thread on its block and an orphan with its quote kept; `artifact_comments` lists it with
// its block either way; `artifact_reply` and `artifact_resolve` (reopen too) serve it as a text thread.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { addThread, getThread } from '@artifacts/document/threads';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { registerDashboards, type Dashboards } from '../dashboards';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-board' as AppSessionId;
let world: DocumentWorld;
let dashboards: Dashboards;
let tools: Map<string, McpToolDefinition>;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  dashboards = registerDashboards({ documents: world });
  const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => {
  dashboards.close();
  world.close();
});

const ctx = (): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_c${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const call = (name: string, args: unknown) => tools.get(name)!.call(args, ctx());
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};

const QUOTE = 'chart: Sales by region';
/** A dashboard of a paragraph, a chart and a paragraph, its chart commented by the user. */
async function board(): Promise<string> {
  const body = schemaFor().nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Sales rose.' }] },
      { type: 'chart', attrs: { id: 'c1', source: 'sales', spec: { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' } } },
      { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'More soon.' }] },
    ],
  });
  const { id } = await world.store.create(
    {
      kind: 'dashboard',
      title: 'Board',
      initial: (doc) => {
        const tab = createDocument(doc, { title: 'Board', body, id: 'tab1' });
        addThread(doc, { threadId: 'tb', tabId: tab, blockId: 'c1', quote: QUOTE, anchor: { kind: 'block' }, by: HUMAN, at: 1_760_000_000_000, body: 'Why does the west dip?' });
      },
    },
    HUMAN,
  );
  return id;
}

interface Listed {
  threadId: string;
  status: string;
  orphaned: boolean;
  tab: string;
  block: string | null;
  quote: string;
  messages: { body: string }[];
}
const thread = async (id: string, status: 'open' | 'all' = 'all') => json<{ threads: Listed[] }>(await call('artifact_comments', { artifact: id, status })).threads.find((t) => t.threadId === 'tb');

describe('a dashboard chart’s comment through B’s tools (P3-E2 M4)', () => {
  it('reads and lists a live block thread on its block', async () => {
    const id = await board();
    const read = json<{ markdown: string; revision: number }>(await call('artifact_read', { artifact: id }));
    expect(read.markdown).toContain(`- c:tb on ^c1 · ${JSON.stringify(QUOTE)} · 1 message`);
    expect(read.markdown).toContain('Comments: 1 open');
    expect(await thread(id)).toMatchObject({ status: 'open', orphaned: false, tab: 'tab1', block: 'c1', quote: QUOTE });
    // a range that does not hold the chart counts it outside
    const ranged = json<{ markdown: string }>(await call('artifact_read', { artifact: id, from: 'p2', count: 1 }));
    expect(ranged.markdown).toContain('Comments: 1 open; 1 outside this range');
  });

  it('the chart deleted: the thread is orphaned with its quote and block, replies, resolves and reopens', async () => {
    const id = await board();
    const read = json<{ revision: number }>(await call('artifact_read', { artifact: id }));
    json(await call('artifact_edit', { artifact: id, baseRevision: read.revision, ops: [{ op: 'delete', id: 'c1' }] }));
    expect(await thread(id)).toMatchObject({ status: 'open', orphaned: true, block: 'c1', quote: QUOTE });
    const after = json<{ markdown: string }>(await call('artifact_read', { artifact: id }));
    expect(after.markdown).toContain('Comments: 1 open (1 orphaned)');
    expect(after.markdown).toContain(`- c:tb orphaned, near ^? · ${JSON.stringify(QUOTE)} · 1 message`);

    expect(json(await call('artifact_reply', { artifact: id, threadId: 'tb', body: 'The chart was replaced by a table.' }))).toMatchObject({ status: 'replied' });
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 'tb' }))).toMatchObject({ status: 'resolved' });
    expect(await thread(id, 'open')).toBeUndefined();
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 'tb', reopen: true }))).toMatchObject({ status: 'reopened' });
    const back = await thread(id);
    expect(back).toMatchObject({ status: 'open', orphaned: true });
    expect(back!.messages.map((m) => m.body)).toEqual(['Why does the west dip?', 'The chart was replaced by a table.']);
    expect(getThread(world.service.live(id), 'tb')!.anchor).toEqual({ kind: 'block' });
  });
});
