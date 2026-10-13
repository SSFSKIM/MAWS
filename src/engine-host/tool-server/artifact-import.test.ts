// The lazy import on touch (the P3-A document's Decision Log 40a): an X12 record written before the artifact store (a
// pre-P3 page or file) that a tool names, by its id or by a handle in the session's lineage, is imported through
// `importArtifact` with its id, versions and links, credited to the record's session, and the tool proceeds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { artifactPublishTool } from './artifact-publish';
import { artifactCreateTool, artifactReadTool } from './artifact-tools';
import { jsonOf, openWorld, SELF, textOf, type World } from './artifact-world.fixture';
import { artifactScreenshotTool, type ArtifactCaptureRequest } from './artifacts';
import { HostBridge } from './bridge';

const PARENT = 'app-parent' as AppSessionId;
const RECORD = '0b5e1c2d-3a4f-4b6c-8d7e-9f0a1b2c3d4e';

let w: World;
beforeEach(() => {
  w = openWorld();
});
afterEach(() => w.close());

// An E2 record as E2's tools wrote it: its version copies beside it.
async function pre(owner: AppSessionId, pages: string[], id = RECORD, handle = 'dash'): Promise<DeliverableRecord> {
  const dir = join(w.userData, 'deliverables', owner, id);
  mkdirSync(dir, { recursive: true });
  const versions = pages.map((html, k) => {
    const path = join(dir, `v${k + 1}.html`);
    writeFileSync(path, html);
    return { path, at: new Date(Date.UTC(2026, 9, 1, 0, k)).toISOString(), sourcePath: join(w.cwd, 'dashboard.html') };
  });
  const record: DeliverableRecord = { id, appSessionId: owner, kind: 'artifact', artifactId: handle, title: 'Dashboard', path: versions.at(-1)!.path, versions, createdAt: versions[0]!.at, updatedAt: versions.at(-1)!.at };
  await w.deliverables.write(record);
  return record;
}

describe('a pre-P3 X12 record a tool names', () => {
  it('is imported on its first read, by handle, with its id, versions and link, credited to its session; a publish over it extends its record', async () => {
    await pre(SELF, ['<p>v1</p>', '<p>v2</p>']);
    const read = jsonOf<{ artifactId: string; revision: number; files: Record<string, string> }>(await artifactReadTool(w.deps()).call({ artifact: 'dash' }, w.ctx()));
    expect(read).toMatchObject({ artifactId: RECORD, files: { 'index.html': '<p>v2</p>' } });
    expect(w.store.get(RECORD)).toMatchObject({ kind: 'html', handle: 'dash', title: 'Dashboard', createdBy: { kind: 'session', appSessionId: SELF } });
    expect(w.store.listVersions(RECORD).map((v) => [v.kind, v.actor])).toEqual([['import', { kind: 'session', appSessionId: SELF }], ['import', { kind: 'session', appSessionId: SELF }]]);
    expect(w.store.links(RECORD).map((l) => l.role).sort()).toEqual(['created', 'viewed']);
    const published = jsonOf(await artifactPublishTool(w.deps()).call({ artifact: 'dash', baseRevision: read.revision, files: { 'index.html': '<p>v3</p>' } }, w.ctx()));
    expect(published).toMatchObject({ id: 'dash', deliverableId: RECORD, version: 3 });
    const record = (await w.deliverables.get(SELF, RECORD))!;
    expect(record.versions.map((v) => readFileSync(v.path, 'utf8'))).toEqual(['<p>v1</p>', '<p>v2</p>', '<p>v3</p>']);
  });

  it('is screenshotted as its record by a side thread of its session, named as the owner', async () => {
    await pre(PARENT, ['<p>v1</p>']);
    const sent: ArtifactCaptureRequest[] = [];
    const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS });
    const pending = artifactScreenshotTool({ ...w.deps({ artifactScope: [PARENT] }), capture }).call({ id: 'dash' }, w.ctx({ requestId: 'r-pre' as RequestId }));
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(sent).toEqual([{ requestId: 'r-pre', deliverableId: RECORD, version: 1, width: 1280, height: 800, ownerAppSessionId: PARENT }]);
    capture.answer('r-pre' as RequestId, { ok: true, png: 'iVBORw0KGgo=', width: 1280, height: 800, consoleErrors: [] });
    expect(JSON.parse(((await pending).content[1] as { text: string }).text)).toMatchObject({ deliverableId: RECORD, ownerAppSessionId: PARENT });
    expect(w.store.get(RECORD)).toMatchObject({ createdBy: { kind: 'session', appSessionId: PARENT } });
  });

  it('is imported without its handle when the session already holds that handle in the store', async () => {
    const mine = jsonOf<{ artifactId: string }>(await artifactCreateTool(w.deps()).call({ handle: 'dash', content: '<p>new</p>', title: 'New' }, w.ctx()));
    await pre(SELF, ['<p>old</p>']);
    expect(jsonOf(await artifactReadTool(w.deps()).call({ artifact: RECORD }, w.ctx()))).toMatchObject({ artifactId: RECORD, files: { 'index.html': '<p>old</p>' } });
    expect(w.store.get(RECORD)!.handle).toBeUndefined();
    expect(jsonOf(await artifactReadTool(w.deps()).call({ artifact: 'dash' }, w.ctx()))).toMatchObject({ artifactId: mine.artifactId });
  });

  it('keeps E2’s refusal of a create whose handle a record of the session or above it holds; a record outside the lineage is not found', async () => {
    await pre(SELF, ['<p>v1</p>']);
    expect(textOf(await artifactCreateTool(w.deps()).call({ handle: 'dash', content: '<p/>', title: 'Again' }, w.ctx()))).toBe(TOOL_ERRORS.artifactExists('dash'));
    await pre(PARENT, ['<p>p</p>'], '1c6f2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', 'theirs');
    expect(textOf(await artifactCreateTool(w.deps({ artifactScope: [PARENT] })).call({ handle: 'theirs', content: '<p/>', title: 'Mine' }, w.ctx()))).toBe(TOOL_ERRORS.artifactExistsInParent('theirs'));
    expect(textOf(await artifactReadTool(w.deps()).call({ artifact: 'theirs' }, w.ctx()))).toBe(TOOL_ERRORS.noArtifact('artifact_read', 'theirs'));
  });
});
