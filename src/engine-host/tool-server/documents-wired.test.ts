// The document tools as the `maws` server lists them (M7's wiring; X25's document part): A's `mawsTools` list with the
// four document tools appended after A's and A's `artifact_create` and `artifact_read` answering a document through this
// child's wrappers; driven through the server's own definitions with an `McpToolContext`, over A's real store.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocIndex } from '@artifacts/document/block-index';
import { fingerprint } from '@artifacts/document/fingerprint';
import committedFingerprint from '@artifacts/document/fingerprint.json';
import { schemaFor } from '@artifacts/document/schema';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { mawsToolList, parseToolArguments } from '@shared/maws/tools';
import { MemoryDeliverableStore } from '../deliverables/store';
import { openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-wired' as AppSessionId;
let world: DocumentWorld;
let tools: Map<string, McpToolDefinition>;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  const list = mawsTools({
    deliverables: new MemoryDeliverableStore({}), bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }),
    asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store,
  });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => world.close());

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_w${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, ...over });
const call = (name: string, args: unknown, over: Partial<McpToolContext> = {}) => tools.get(name)!.call(args, ctx(over));
const index = (id: string, top: Parameters<ReturnType<typeof DocIndex.of>['pm']>[0]) => DocIndex.of(world.service.live(id)).pm(top).textContent;
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};

describe('the document tools on the maws server', () => {
  it('lists the four document tools after A’s, each as `tools/list` describes it', () => {
    const names = [...tools.keys()];
    expect(names.slice(-4)).toEqual(['artifact_edit', 'artifact_comments', 'artifact_reply', 'artifact_resolve']);
    expect([...tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }))).toEqual(mawsToolList());
  });

  it('creates a document from markdown through artifact_create, reads it in the kind’s format and edits it', async () => {
    const created = json<{ artifactId: string; kind: string; revision: number; guide?: { guide: string } }>(await call('artifact_create', { kind: 'document', title: 'Brief', handle: 'brief', content: '# Brief ^h1\n\nThe review is scheduled for Friday. ^p1' }));
    expect(created).toMatchObject({ kind: 'document' });
    expect(created.guide?.guide).toBe(KIND_GUIDES.document.guide);
    const read = json<{ revision: number; markdown: string; tabs: unknown[] }>(await call('artifact_read', { artifact: 'brief' }));
    expect(read.markdown).toBe('# Brief ^h1\n\nThe review is scheduled for Friday. ^p1\n');
    const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: 'brief', baseRevision: read.revision, ops: [{ op: 'replace_text', block: 'p1', old: 'Friday', new: 'Monday' }] }));
    expect(edited.revision).toBeGreaterThan(read.revision);
    const index = DocIndex.of(world.service.live(created.artifactId));
    const pm = index.pm(index.find('p1')!.top);
    expect(pm.textContent).toBe('The review is scheduled for Monday.');
    // D4, the host half, on the registered server: the nodes its writer builds are the schema module's one schema
    expect(pm.type.schema).toBe(schemaFor());
    expect(fingerprint(pm.type.schema)).toEqual(committedFingerprint);
  });

  it('hands A every other kind: an html create and read answer as A’s tools do', async () => {
    const page = json<{ artifactId: string; kind: string }>(await call('artifact_create', { title: 'Page', content: '<p>Hi</p>' }));
    expect(page.kind).toBe('html');
    expect(json<{ files: Record<string, string> }>(await call('artifact_read', { artifact: page.artifactId })).files['index.html']).toBe('<p>Hi</p>');
  });

  it('replays a repeated tool-use id through the server, and serves the comment tools on a document’s threads', async () => {
    const id = await world.seeded();
    const { revision } = json<{ revision: number }>(await call('artifact_read', { artifact: id }));
    const args = { artifact: id, baseRevision: revision, ops: [{ op: 'insert', after: 'h1', markdown: 'Once.' }] };
    const toolUseId = 'toolu_wired_once' as ToolUseId;
    const first = await call('artifact_edit', args, { toolUseId });
    expect(await call('artifact_edit', args, { toolUseId })).toEqual(first);
    expect(DocIndex.of(world.service.live(id)).tops('tab1').filter((top) => index(id, top) === 'Once.')).toHaveLength(1);
    const open = json<{ threads: { threadId: string }[] }>(await call('artifact_comments', { artifact: id }));
    expect(open.threads.map((thread) => thread.threadId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(json(await call('artifact_reply', { artifact: id, threadId: 't1', body: 'Done.' }))).toMatchObject({ status: 'replied', threadId: 't1' });
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 't1' }))).toMatchObject({ status: 'resolved', threadId: 't1' });
    expect(json<{ threads: { threadId: string }[] }>(await call('artifact_comments', { artifact: id, status: 'resolved' })).threads.map((thread) => thread.threadId)).toEqual(['t1']);
  });

  // The re-merge wave: one definition (A's shared schemas) serves `tools/list`, the normaliser's parser and the handlers.
  it('advertises the document calls it serves: a ranged read with tab, from, count and sinceRevision, and a create with content', () => {
    const read = { artifact: 'brief', tab: 'tab1', from: 'p1', count: 50, sinceRevision: 3 };
    const create = { kind: 'document', title: 'Brief', handle: 'brief', content: '# Brief ^h1' };
    expect(parseToolArguments('artifact_read', read)).toMatchObject({ ok: true, data: read });
    expect(parseToolArguments('artifact_create', create)).toMatchObject({ ok: true, data: create });
    const schemaOf = (name: string) => tools.get(name)!.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schemaOf('artifact_read').properties)).toEqual(expect.arrayContaining(['tab', 'from', 'count', 'sinceRevision']));
    expect(Object.keys(schemaOf('artifact_create').properties)).toContain('content');
  });

  it('refuses a document call in the shared parser’s words, the ones the normaliser reads it by', async () => {
    const create = { kind: 'document', title: 'Brief', files: { 'a.md': 'x' } };
    const parsed = parseToolArguments('artifact_create', create);
    expect(parsed.ok).toBe(false);
    expect(text(await call('artifact_create', create))).toBe((parsed as { error: string }).error);
    const id = await world.seeded();
    const read = { artifact: id, count: 1001 };
    expect(text(await call('artifact_read', read))).toBe((parseToolArguments('artifact_read', read) as { error: string }).error);
  });

  it('artifact_describe_type answers the document kind’s written guide and format reference', async () => {
    expect(json(await call('artifact_describe_type', { kind: 'document' }))).toEqual({ status: 'described', kind: 'document', ...KIND_GUIDES.document });
  });
});
