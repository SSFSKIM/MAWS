// A pre-P3 X12 record after P3-L's cutover (M6b; the P3-A document's Decision Log 40a had imported it lazily on touch
// until then): the host's start-time import (`../library/import.ts`) lands it under its record's id with its versions
// and links, credited to its session, and a tool that names it, by its id or by a handle in the session's lineage,
// finds it as any artifact.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { importDeliverables } from '../library/import';
import { holdForImport } from '../library/import-gate';
import { mawsTools } from './tools';

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
  return write(record);
}
function write(record: DeliverableRecord): DeliverableRecord {
  mkdirSync(join(w.userData, 'deliverables', record.appSessionId), { recursive: true });
  writeFileSync(join(w.userData, 'deliverables', record.appSessionId, `${record.id}.json`), JSON.stringify(record));
  return record;
}
// The host's import at store open, over what the test wrote.
const started = () => importDeliverables(w.store, join(w.userData, 'deliverables'), (line) => w.logs.push(line));

describe('a pre-P3 X12 record a tool names, after the cutover’s import', () => {
  // Fix wave 1 (Decision Log 39a): no start-up window. A call the engine makes while the host's start import is still
  // landing waits for it (the `maws` server's artifact tools, `mawsTools`), then finds the record as any artifact.
  it('a tool call issued during a slow import waits, then finds the old record', async () => {
    await pre(SELF, ['<p>v1</p>']);
    let land!: () => void;
    const slow = new Promise<void>((resolve) => (land = resolve));
    holdForImport(w.store, slow.then(started));
    const read = mawsTools({ ...(w.deps() as object), bridge: {} as never, capture: {} as never, asks: {} as never, askCancelled: () => {} }).find((tool) => tool.name === 'artifact_read')!;
    let answered = false;
    const call = read.call({ artifact: 'dash' }, w.ctx()).finally(() => (answered = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(answered).toBe(false);
    land();
    expect(jsonOf(await call)).toMatchObject({ artifactId: RECORD, files: { 'index.html': '<p>v1</p>' } });
  });

  it('reads by handle with its id, versions and link, credited to its session; a publish over it adds its third version', async () => {
    await pre(SELF, ['<p>v1</p>', '<p>v2</p>']);
    await started();
    const read = jsonOf<{ artifactId: string; revision: number; files: Record<string, string> }>(await artifactReadTool(w.deps()).call({ artifact: 'dash' }, w.ctx()));
    expect(read).toMatchObject({ artifactId: RECORD, files: { 'index.html': '<p>v2</p>' } });
    expect(w.store.get(RECORD)).toMatchObject({ kind: 'html', handle: 'dash', title: 'Dashboard', createdBy: { kind: 'session', appSessionId: SELF } });
    expect(w.store.listVersions(RECORD).map((v) => [v.kind, v.actor])).toEqual([['import', { kind: 'session', appSessionId: SELF }], ['import', { kind: 'session', appSessionId: SELF }]]);
    expect(w.store.links(RECORD).map((l) => l.role).sort()).toEqual(['created', 'viewed']);
    const published = jsonOf(await artifactPublishTool(w.deps()).call({ artifact: 'dash', baseRevision: read.revision, files: { 'index.html': '<p>v3</p>' } }, w.ctx()));
    expect(published).toMatchObject({ id: 'dash', deliverableId: RECORD, version: 3 });
    expect(w.store.listVersions(RECORD).map((v) => readFileSync(w.store.contentRef(RECORD, v.seq).path, 'utf8'))).toEqual(['<p>v1</p>', '<p>v2</p>', '<p>v3</p>']);
    expect(existsSync(join(w.userData, 'deliverables', SELF, RECORD, 'v3.html'))).toBe(false); // X12's tree is read, never written
  });

  it('is screenshotted at its version by a side thread of its session, named as the owner', async () => {
    await pre(PARENT, ['<p>v1</p>']);
    await started();
    const sent: ArtifactCaptureRequest[] = [];
    const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS });
    const pending = artifactScreenshotTool({ ...w.deps({ artifactScope: [PARENT] }), capture }).call({ id: 'dash' }, w.ctx({ requestId: 'r-pre' as RequestId }));
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(sent).toEqual([{ requestId: 'r-pre', artifactId: RECORD, revision: w.store.listVersions(RECORD)[0]!.seq, width: 1280, height: 800 }]);
    capture.answer('r-pre' as RequestId, { ok: true, png: 'iVBORw0KGgo=', width: 1280, height: 800, consoleErrors: [] });
    expect(JSON.parse(((await pending).content[1] as { text: string }).text)).toMatchObject({ deliverableId: RECORD, ownerAppSessionId: PARENT });
    expect(w.store.get(RECORD)).toMatchObject({ createdBy: { kind: 'session', appSessionId: PARENT } });
  });

  it('is imported without its handle when the session already holds that handle in the store', async () => {
    const mine = jsonOf<{ artifactId: string }>(await artifactCreateTool(w.deps()).call({ handle: 'dash', content: '<p>new</p>', title: 'New' }, w.ctx()));
    await pre(SELF, ['<p>old</p>']);
    await started();
    expect(jsonOf(await artifactReadTool(w.deps()).call({ artifact: RECORD }, w.ctx()))).toMatchObject({ artifactId: RECORD, files: { 'index.html': '<p>old</p>' } });
    expect(w.store.get(RECORD)!.handle).toBeUndefined();
    expect(jsonOf(await artifactReadTool(w.deps()).call({ artifact: 'dash' }, w.ctx()))).toMatchObject({ artifactId: mine.artifactId });
  });

  it('imports a pre-P3 screenshot record named by its id as a file artifact', async () => {
    const path = join(w.cwd, 'screenshot.png');
    writeFileSync(path, Buffer.from([137, 80, 78, 71]));
    write({ id: RECORD, appSessionId: SELF, kind: 'screenshot', path, title: 'Screenshot', versions: [{ path, at: '2026-10-01T00:00:00.000Z' }], createdAt: '2026-10-01T00:00:00.000Z' });
    await started();
    expect(jsonOf(await artifactReadTool(w.deps()).call({ artifact: RECORD }, w.ctx()))).toMatchObject({ artifactId: RECORD, kind: 'file', file: { path, size: 4, exists: true } });
    expect(w.store.get(RECORD)).toMatchObject({ kind: 'file', title: 'Screenshot', linkedPath: path });
  });

  it('keeps E2’s refusal of a create whose handle a record of the session or above it holds; a record outside the lineage is not found', async () => {
    await pre(SELF, ['<p>v1</p>']);
    await pre(PARENT, ['<p>p</p>'], '1c6f2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', 'theirs');
    await started();
    expect(textOf(await artifactCreateTool(w.deps()).call({ handle: 'dash', content: '<p/>', title: 'Again' }, w.ctx()))).toBe(TOOL_ERRORS.artifactExists('dash'));
    expect(textOf(await artifactCreateTool(w.deps({ artifactScope: [PARENT] })).call({ handle: 'theirs', content: '<p/>', title: 'Mine' }, w.ctx()))).toBe(TOOL_ERRORS.artifactExistsInParent('theirs'));
    expect(textOf(await artifactReadTool(w.deps()).call({ artifact: 'theirs' }, w.ctx()))).toBe(TOOL_ERRORS.noArtifact('artifact_read', 'theirs'));
  });
});
