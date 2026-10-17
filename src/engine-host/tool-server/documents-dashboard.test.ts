// P3-E2 M2 (ledger X25: kind-aware dispatch in B's tools; the execution document's provenance regression): B's tools on
// a dashboard as on a document. A batch's provenance carries must reach the adapter whose hooks run its update: a block
// the user wrote, moved or retyped by the agent, stays the user's on both kinds (carries registered on the wrong
// adapter would credit the agent). B's thread tools serve a dashboard's threads; A's publish refuses a dashboard.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { charSlots } from '@artifacts/document/structs';
import { nodeOf, seedDoc } from '@artifacts/document/writer.fixture';
import { applyV1, carriedBy, diffV1, insertedBy } from '@artifacts/yjs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { artifactRefusalOf } from '@shared/maws/tools';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { registerDashboards, type Dashboards } from '../dashboards';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-kinds' as AppSessionId;
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

const ctx = (): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_k${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const call = (name: string, args: unknown) => tools.get(name)!.call(args, ctx());
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};

/** An artifact of `kind` holding B's seed, written by the user. */
async function seeded(kind: 'document' | 'dashboard'): Promise<string> {
  const seed = diffV1(seedDoc());
  return (await world.store.create({ kind, title: 'Plan', initial: (doc) => applyV1(doc, seed) }, HUMAN)).id;
}
const firstChar = (id: string, block: string) => {
  const [client, clock] = charSlots(nodeOf(world.service.live(id), block))[0]!.slot;
  return { client, clock };
};

describe.each(['document', 'dashboard'] as const)('B’s tools on a %s', (kind) => {
  it('carries the user’s authorship through an agent’s move and retype, on the adapter of the artifact’s kind', async () => {
    const id = await seeded(kind);
    const read = json<{ revision: number; kind: string }>(await call('artifact_read', { artifact: id }));
    expect(read.kind).toBe(kind);
    json(await call('artifact_edit', { artifact: id, baseRevision: read.revision, ops: [
      { op: 'move', id: 'p2', after: null },
      { op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the **lazy** [dog](https://example.com). It has two sentences.' },
    ] }));
    const map = world.service.provenance(id);
    expect(insertedBy(map, firstChar(id, 'p2'))?.actor).toBe('human');
    expect(carriedBy(map, firstChar(id, 'p2'))).toBe('move');
    expect(insertedBy(map, firstChar(id, 'p1'))?.actor).toBe('human');
    expect(carriedBy(map, firstChar(id, 'p1'))).toBe('retype');
    expect(world.persistedAuthors(id, 'p2')).toEqual(['human']);
  });

  it('lists, replies to and resolves its comment threads with B’s three tools', async () => {
    const id = await seeded(kind);
    const listed = json<{ threads: { threadId: string; quote: string }[] }>(await call('artifact_comments', { artifact: id }));
    expect(listed.threads.map((thread) => thread.threadId)).toEqual(expect.arrayContaining(['t1', 't3']));
    expect(json(await call('artifact_reply', { artifact: id, threadId: 't3', body: 'Moved to Monday.' }))).toMatchObject({ status: 'replied' });
    expect(json(await call('artifact_resolve', { artifact: id, threadId: 't3' }))).toMatchObject({ status: 'resolved' });
  });
});

describe('a dashboard among the kinds', () => {
  it('is refused by A’s publish, and its create answers its own kind and guide once', async () => {
    const created = json<{ artifactId: string; kind: string; guide?: unknown }>(await call('artifact_create', { kind: 'dashboard', title: 'Board', content: 'Hello ^p1' }));
    expect(created).toMatchObject({ kind: 'dashboard', guide: expect.anything() });
    expect(json<{ guide?: unknown }>(await call('artifact_create', { kind: 'dashboard', title: 'Second' })).guide).toBeUndefined();
    const refusal = await call('artifact_publish', { artifact: created.artifactId, baseRevision: 0, files: { 'a.md': 'x' } });
    expect(refusal.isError).toBe(true);
    expect(artifactRefusalOf(text(refusal))).toMatchObject({ reason: 'invalid', kind: 'dashboard' });
  });
});
