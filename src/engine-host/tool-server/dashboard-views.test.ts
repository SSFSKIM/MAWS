// P3-E2 M3 (ledger X25's `viewWarnings`, E's Decision Log 9): a dashboard's create, edit and read answers say what its
// chart specs drop or cannot draw, block by block. Create and edit normalise the specs they write before the write
// commits (a replay answering the same); a read reports a retained spec's problems and writes nothing; a document's
// answers carry no such field and its specs stay as written.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chartSpecs } from '@artifacts/dashboard/views';
import { importMarkdown } from '@artifacts/document/import/markdown';
import { createDocument } from '@artifacts/document/tabs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { registerDashboards, type Dashboards } from '../dashboards';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-views' as AppSessionId;
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

const ctx = (toolUseId = `toolu_v${++calls}`): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: toolUseId as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const call = (name: string, args: unknown, context = ctx()) => tools.get(name)!.call(args, context);
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};
const chart = (spec: object, source = 'sales') => `:::chart {spec-json='${JSON.stringify(spec)}'}\n${source}\n:::`;
const specsOf = (id: string) => chartSpecs(world.service.live(id)).map(({ spec }) => spec);
interface Answer {
  artifactId: string;
  revision: number;
  viewWarnings?: { blockId: string; message: string }[];
}

describe('a dashboard\'s view warnings', () => {
  it('normalises the specs a create writes, answering what each block dropped; a replay answers the same', async () => {
    const content = ['# Sales', '', chart({ view: 'bar', x: 'region', y: 'sales', colour: 'red' }), '', chart({ view: 'sankey', title: 'Flows' }, 'flows')].join('\n');
    const context = ctx();
    const created = json<Answer>(await call('artifact_create', { kind: 'dashboard', title: 'Board', content }, context));
    const [bar, sankey] = chartSpecs(world.service.live(created.artifactId));
    expect(created.viewWarnings).toEqual([
      { blockId: bar.blockId, message: 'unknown key "colour" ignored' },
      { blockId: sankey.blockId, message: 'unknown view "sankey"; the view draws as an error' },
    ]);
    expect(specsOf(created.artifactId)).toEqual([{ view: 'bar', x: 'region', y: 'sales' }, { view: 'sankey', title: 'Flows' }]);
    expect(json<Answer>(await call('artifact_create', { kind: 'dashboard', title: 'Board', content }, context))).toEqual(created);
  });

  it('normalises only the specs an edit writes; a retained spec stays as it was and a read reports it without writing', async () => {
    // a dashboard whose retained chart predates the grammar (written before E2's normalisation)
    const { id } = await world.store.create({ kind: 'dashboard', title: 'Old', initial: (doc) => void createDocument(doc, { title: 'Old', body: importMarkdown(chart({ view: 'line', x: 'at', y: 'v', smooth: true })) }) }, HUMAN);
    const read = json<Answer>(await call('artifact_read', { artifact: id }));
    const [old] = chartSpecs(world.service.live(id));
    expect(read.viewWarnings).toEqual([{ blockId: old.blockId, message: 'unknown key "smooth" ignored' }]);
    expect(world.store.revision(id)).toBe(read.revision); // the read wrote nothing
    const edited = json<Answer>(await call('artifact_edit', { artifact: id, baseRevision: read.revision, ops: [{ op: 'insert', after: old.blockId, markdown: chart({ view: 'table', columns: ['a'], wrap: true }) }] }));
    const [, added] = chartSpecs(world.service.live(id));
    expect(edited.viewWarnings).toEqual([{ blockId: added.blockId, message: 'unknown key "wrap" ignored' }]);
    expect(specsOf(id)).toEqual([{ view: 'line', x: 'at', y: 'v', smooth: true }, { view: 'table', columns: ['a'] }]);
  });

  it('answers no view warnings when the specs are the grammar\'s', async () => {
    const created = json<Answer>(await call('artifact_create', { kind: 'dashboard', title: 'Clean', content: chart({ view: 'bar', x: 'region', y: 'sales' }) }));
    expect(created.viewWarnings).toBeUndefined();
    expect(json<Answer>(await call('artifact_read', { artifact: created.artifactId })).viewWarnings).toBeUndefined();
  });
});

describe('a document', () => {
  it('carries no view warnings and keeps its chart specs as written', async () => {
    const created = json<Answer>(await call('artifact_create', { kind: 'document', title: 'Doc', content: chart({ view: 'bar', colour: 'red' }) }));
    expect(created.viewWarnings).toBeUndefined();
    expect(specsOf(created.artifactId)).toEqual([{ view: 'bar', colour: 'red' }]);
    const read = json<Answer>(await call('artifact_read', { artifact: created.artifactId }));
    expect(read.viewWarnings).toBeUndefined();
    const edited = json<Answer>(await call('artifact_edit', { artifact: created.artifactId, baseRevision: read.revision, ops: [{ op: 'insert', after: chartSpecs(world.service.live(created.artifactId))[0].blockId, markdown: chart({ view: 'pie', odd: 1 }) }] }));
    expect(specsOf(created.artifactId)).toEqual([{ view: 'bar', colour: 'red' }, { view: 'pie', odd: 1 }]);
    expect(edited.viewWarnings).toBeUndefined();
  });
});
