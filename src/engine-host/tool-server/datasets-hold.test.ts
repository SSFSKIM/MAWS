// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1, R1b): `artifact_dataset`'s bind by `ref` holds the
// asset from its lookup to its write, so a collection landing between them (a retired query snapshot, its collection
// asked while the bind waited on the read barrier) never leaves the new descriptor naming bytes that are gone; the bind
// then adopts the snapshot (ordinary, never collected).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDataset, setDataset } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { registerDashboards, type Dashboards } from '../dashboards';
import { ArtifactFiles } from '../documents/bytes';
import { openDocuments, type Documents } from '../documents';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition } from './server';
import { mawsTools } from './tools';

const human: Actor = { kind: 'human' };
let data: string;
let documents: Documents;
let dashboards: Dashboards;
let tools: Map<string, McpToolDefinition>;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maws-datasets-hold-'));
  documents = openDocuments(data, () => {})!;
  dashboards = registerDashboards({ documents });
  const list = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => documents.store });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => {
  dashboards.close();
  documents.close();
  rmSync(data, { recursive: true, force: true });
});

let serial = 0;
async function refresh(artifactId: string): Promise<string> {
  let ref = '';
  const at = Date.now();
  serial += 1;
  await documents.store.writeWithAssets(
    artifactId,
    human,
    [{ bytes: new TextEncoder().encode(`[{"v":${serial}}]`), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
    (doc, refs) => {
      ref = refs[0]!.ref;
      setDataset(doc, 'live', { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
    },
    { inFrame: (revision) => documents.store.retainQuerySnapshots(artifactId, 'live', ref, revision) },
  );
  return ref;
}
const ctx = (): McpToolContext => ({ appSessionId: 'app-self' as AppSessionId, cwd: data, toolUseId: `toolu_h${++serial}` as ToolUseId, requestId: `r${serial}` as RequestId, signal: new AbortController().signal, fromSubagent: false });

describe('artifact_dataset’s bind by ref (E3)', () => {
  it('holds the asset across its reads, so a collection meanwhile never takes the bytes its descriptor names', async () => {
    const { id } = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const old = await refresh(id);
    await refresh(id);
    await refresh(id); // `old` retired, no version pins it
    const asset = documents.store.listAssets(id).find((candidate) => candidate.ref === old)!;
    // the moment the bind looks the asset up, a write opens a batch and a collection is asked: it runs once that batch
    // commits, before the bind reads the bytes and writes its descriptor
    const listAssets = documents.store.listAssets.bind(documents.store);
    let writing: Promise<number> | null = null;
    vi.spyOn(documents.store, 'listAssets').mockImplementation((artifactId) => {
      const rows = listAssets(artifactId);
      if (writing === null) {
        writing = documents.service.writeAs(id, human, (doc) => doc.get('root').setAttr('note', 'x'));
        documents.store.collectRetiredAssets(id);
      }
      return rows;
    });
    const answer = await tools.get('artifact_dataset')!.call({ artifact: id, baseRevision: documents.store.revision(id), id: 'kept', ref: old }, ctx());
    expect(writing).not.toBeNull();
    await writing;
    expect(answer.isError, (answer.content[0] as { text: string }).text).toBeFalsy();
    const descriptor = readDataset(documents.service.live(id), 'kept')!;
    expect(descriptor.source).toMatchObject({ kind: 'file', ref: old });
    documents.store.collectRetiredAssets(id);
    expect(documents.store.listAssets(id).some((candidate) => candidate.ref === old)).toBe(true);
    expect(existsSync(join(documents.store.files.dirOf(id), ArtifactFiles.assetPath(asset.sha256)))).toBe(true);
    expect(documents.storage.db.prepare('SELECT querySnapshot, retiredAt FROM artifact_assets WHERE artifactId = ? AND assetId = ?').get(id, asset.assetId)).toEqual({ querySnapshot: 0, retiredAt: null }); // adopted
  });
});
