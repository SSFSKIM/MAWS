// P3-E1 M2 (acceptance 1; the parent's §1 "Publish" and Decision Log 11 (1)): a design through A's real tool server,
// store and SQLite file with the host's design module registered. The agent creates four boards of different sizes
// (the guide attached), reads its files with the held boards and missing pictures named by board path, publishes the
// manifest and boards at one revision, has a property conflict refused naming the board and property with nothing
// written, rereads and publishes; a replayed tool-use id answers the first result; a suggestion is refused. A design an
// earlier build stored as files is migrated by the session's first live read, credited to it, before any answer; its
// version reads as its files; after a restart a publish lands; the export and thread tools migrate first too.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boardPath, CANVAS_PATH, parseCanvasJson, serializeCanvasJson } from '@artifacts/design/canvas';
import { setStyle } from '@artifacts/slides/model';
import { addThread, getThread } from '@artifacts/slides/threads';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { ArtifactCreateResultSchema, ArtifactPublishResultSchema, ArtifactReadResultSchema, artifactRefusalOf, type ArtifactPublishResult, type ArtifactReadResult } from '@shared/maws/tools';
import { openDocuments, type Documents } from '../documents';
import { ArtifactSession, type ArtifactToolDeps } from '../tool-server/artifact-context';
import type { ExportBridge } from '../tool-server/artifact-export';
import { artifactExportTool } from '../tool-server/artifact-export';
import { artifactPublishTool } from '../tool-server/artifact-publish';
import { artifactCreateTool, artifactReadTool } from '../tool-server/artifact-tools';
import { DocumentToolSession, documentTools, type DocumentToolDeps } from '../tool-server/documents';
import type { McpToolContext, McpToolResult } from '../tool-server/server';
import { presentationThreadTools } from '../presentations/threads';
import { AskTable } from '../tool-server/asks';
import { HostBridge } from '../tool-server/bridge';
import { PaneBridge } from '../tool-server/panes';
import { mawsTools } from '../tool-server/tools';
import { registerDesigns, type Designs } from '.';
import { LEGACY_FILES, logRows, makeLegacyDesign } from './legacy.fixture';
import { designThreadTools } from './threads';

const SELF = 'app-self' as AppSessionId;
const HUMAN = { kind: 'human' } as const;

let userData: string;
let documents: Documents;
let designs: Designs;
let session: ArtifactSession;
let calls = 0;
const start = () => {
  documents = openDocuments(userData, () => {})!;
  designs = registerDesigns({ documents, chain: null, refresh: () => {} });
  session = new ArtifactSession(); // a session's memory goes with its process
};
const stop = () => {
  designs.close();
  documents.close();
};
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-design-tools-'));
});
afterEach(() => {
  stop();
  rmSync(userData, { recursive: true, force: true });
});

const deps = (over: Partial<ArtifactToolDeps> = {}): ArtifactToolDeps => ({ artifacts: () => documents.store, session, log: () => {}, ...over });
const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: userData, toolUseId: `toolu_d${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const textOf = (result: McpToolResult): string => (result.content[0] as { text: string }).text;
const jsonOf = <T>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as T;
};
const read = async (artifact: string, args: Record<string, unknown> = {}): Promise<ArtifactReadResult> => ArtifactReadResultSchema.parse(jsonOf(await artifactReadTool(deps()).call({ artifact, ...args }, ctx())));
const publish = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => artifactPublishTool(deps()).call(args, ctx(over));
const published = async (args: Record<string, unknown>, over: Partial<McpToolContext> = {}): Promise<ArtifactPublishResult> => ArtifactPublishResultSchema.parse(jsonOf(await publish(args, over)));
const liveFiles = (id: string) => documents.service.adapterFor('design')!.readFiles!(documents.service.live(id));
const edit = (manifest: string, change: (canvas: ReturnType<typeof parsed>) => void) => {
  const canvas = parsed(manifest);
  change(canvas);
  return serializeCanvasJson(canvas);
};
const parsed = (manifest: string) => {
  const result = parseCanvasJson(manifest);
  if (!result.ok) throw new Error(result.problems.join('; '));
  return result.canvas;
};

const PHONE = boardPath('phone');
const POSTER = boardPath('poster');
const FOUR = {
  [CANVAS_PATH]: JSON.stringify({
    v: 1,
    title: 'Launch',
    boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, tablet: { x: 500, y: 0, w: 834, h: 1194 }, desktop: { x: 1500, y: 0, w: 1440, h: 1024 }, poster: { x: 3100, y: 0, w: 1080, h: 10_000 } },
    order: ['phone', 'tablet', 'desktop', 'poster'],
  }),
  [PHONE]: '<section id="phone" style="background:#ffffff"><h1 id="t" style="font-size:32px; color:#1a1a1a">Sign in</h1></section>',
  [boardPath('tablet')]: '<section id="tablet"><p id="p" style="font-size:16px">Tablet</p></section>',
  [boardPath('desktop')]: '<section id="desktop"><p id="p" style="font-size:16px">Desktop</p><img id="hero" src="assets/hero.png" alt="" style="width:400px; height:300px"></section>',
  [POSTER]: '<section id="poster"><h1 id="t" style="font-size:96px">Poster</h1></section>',
};

describe('a design through A’s tool server', () => {
  it('creates four boards of different sizes with the guide attached, and reads them back naming missing pictures by board', async () => {
    start();
    const created = ArtifactCreateResultSchema.parse(jsonOf(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FOUR }, ctx())));
    expect(created.guide).toEqual(KIND_GUIDES.design);
    const answer = await read(created.artifactId);
    expect(Object.keys(answer.files!)).toEqual([CANVAS_PATH, PHONE, boardPath('tablet'), boardPath('desktop'), POSTER]);
    expect(parsed(answer.files![CANVAS_PATH]!).boards.poster).toMatchObject({ w: 1080, h: 10_000 });
    expect(answer.json).toBeUndefined();
    expect(answer.warnings).toEqual([{ path: boardPath('desktop'), slide: 'desktop', element: 'hero', property: 'src', message: expect.stringContaining('no asset assets/hero.png') }]);
    expect(answer.held).toBeUndefined();
  });

  it('holds a board that fails structurally with its reasons, naming it by its board path, and keeps its source', async () => {
    start();
    const held = '<section id="phone"><div id="box">loose text</div></section>';
    const created = ArtifactCreateResultSchema.parse(jsonOf(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: { ...FOUR, [PHONE]: held } }, ctx())));
    expect(created.held).toEqual([{ path: PHONE, reasons: [expect.stringMatching(/text/)] }]);
    const answer = await read(created.artifactId);
    expect(answer.held).toEqual(created.held);
    expect(answer.files![PHONE]).toBe(held);
  });

  it('publishes the manifest and boards at one revision, refuses a property conflict by board and property writing nothing, and lands after a reread', async () => {
    start();
    const { artifactId: id } = jsonOf<{ artifactId: string }>(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FOUR }, ctx()));
    const first = await read(id);
    // the owner meanwhile moves the phone and recolours its heading; the agent restyles the same heading and moves the poster
    await documents.service.writeAs(id, HUMAN, (doc) => setStyle(doc, 'phone', 't', { color: '#ff0000' }));
    const sent = { [CANVAS_PATH]: edit(first.files![CANVAS_PATH]!, (c) => (c.boards.poster!.x = 3200)), [PHONE]: first.files![PHONE]!.replace('color:#1a1a1a', 'color:#00ff00') };
    const before = liveFiles(id);
    const refused = await publish({ artifact: id, baseRevision: first.revision, files: sent });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'conflict', paths: [PHONE] });
    expect(textOf(refused)).toMatch(/element t: color changed since your read/);
    expect(liveFiles(id)).toEqual(before);

    const again = await read(id);
    const args = { artifact: id, baseRevision: again.revision, files: { [CANVAS_PATH]: edit(again.files![CANVAS_PATH]!, (c) => (c.boards.poster!.x = 3200)), [POSTER]: again.files![POSTER]!.replace('Poster', 'Launch day') } };
    const landed = await published(args, { toolUseId: 'toolu_land' as ToolUseId });
    expect(landed.changed).toEqual([POSTER, CANVAS_PATH]); // sorted
    expect(landed.revision).toBe(documents.store.revision(id));
    expect(liveFiles(id)[PHONE]).toContain('color:#ff0000'); // the owner's edit intact
    // the same tool-use id answers the first result and writes nothing
    const revision = documents.store.revision(id);
    expect(jsonOf(await publish(args, { toolUseId: 'toolu_land' as ToolUseId }))).toEqual(landed);
    expect(documents.store.revision(id)).toBe(revision);
  });

  it('refuses a suggestion, asked for or set by the owner, writing nothing', async () => {
    start();
    const { artifactId: id } = jsonOf<{ artifactId: string }>(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FOUR }, ctx()));
    const { revision, files } = await read(id);
    const sent = { [POSTER]: files![POSTER]!.replace('Poster', 'Other') };
    expect(artifactRefusalOf(textOf(await publish({ artifact: id, baseRevision: revision, files: sent, mode: 'suggest' })))).toMatchObject({ reason: 'invalid', kind: 'design', mode: 'suggest' });
    await documents.store.update(id, { agentEditsAsSuggestions: true });
    expect(artifactRefusalOf(textOf(await publish({ artifact: id, baseRevision: revision, files: sent })))).toMatchObject({ reason: 'invalid', kind: 'design', setting: true });
    expect(liveFiles(id)).toEqual(files);
  });
});

describe('a design whose adapter is not registered (the parent’s Decision Log 21 (2))', () => {
  it('still refuses a suggestion, writing nothing: no design takes suggestions in this build', async () => {
    documents = openDocuments(userData, () => {})!;
    designs = { close: () => {} }; // no design module: the generic file model
    session = new ArtifactSession();
    const created = jsonOf<{ artifactId: string; revision: number }>(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Site', files: { 'a.html': 'A' } }, ctx()));
    const read = jsonOf<{ revision: number }>(await artifactReadTool(deps()).call({ artifact: created.artifactId }, ctx()));
    const asked = await publish({ artifact: created.artifactId, baseRevision: read.revision, files: { 'a.html': 'A2' }, mode: 'suggest' });
    expect(artifactRefusalOf(textOf(asked))).toMatchObject({ reason: 'invalid', kind: 'design', mode: 'suggest' });
    expect(documents.store.revision(created.artifactId)).toBe(read.revision);
    expect(logRows(userData, `${created.artifactId}:suggest`)).toEqual([]);
  });
});

describe('a design an earlier build stored as generic files', () => {
  it('is migrated once by the session’s first live read, credited to it, before the read answers; its version reads as its files', async () => {
    const { id, versionId } = await makeLegacyDesign(userData, { version: true });
    start();
    const answer = await read(id);
    expect(Object.keys(answer.files!)).toEqual([CANVAS_PATH, PHONE, POSTER]);
    expect(answer.json).toBeUndefined();
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', `session:${SELF}`]);
    expect(answer.revision).toBe(logRows(userData, id).at(-1)!.seq);
    await read(id);
    expect(logRows(userData, id)).toHaveLength(2);
    const old = await read(id, { version: versionId });
    expect(old.files).toEqual(LEGACY_FILES);
  });

  it('reads a version of a legacy design that cannot migrate as its files, and refuses its live read by name', async () => {
    const files = { ...LEGACY_FILES, [CANVAS_PATH]: '{"v":' };
    const { id, versionId } = await makeLegacyDesign(userData, { files, version: true });
    start();
    expect((await read(id, { version: versionId })).files).toEqual(files);
    const refused = await artifactReadTool(deps()).call({ artifact: id }, ctx());
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'invalid', artifactId: id });
    expect(textOf(refused)).toMatch(/canvas\.json is not JSON/);
    expect(logRows(userData, id)).toHaveLength(1);
  });

  it('takes an agent publish after a restart', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    await read(id);
    stop();
    start(); // MAWS restarted: the session's base is gone, the migration stays
    const fresh = await read(id);
    const landed = await published({ artifact: id, baseRevision: fresh.revision, files: { [POSTER]: fresh.files![POSTER]!.replace('Poster', 'Launch day') } });
    expect(landed.changed).toEqual([POSTER]);
    expect(liveFiles(id)[POSTER]).toContain('Launch day');
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', `session:${SELF}`, `session:${SELF}`]);
  });

  it('is migrated by the session before an export asks main for its live state', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    let rowsAtRequest: string[] = [];
    const exporter = { request: async () => ((rowsAtRequest = logRows(userData, id).map((r) => r.actor)), { kind: 'answered', answer: { ok: false, unavailable: true, error: 'no design exporter yet' } }) } as unknown as ExportBridge;
    const result = await artifactExportTool({ ...deps(), exporter }).call({ artifact: id, format: 'pdf' }, ctx());
    expect(artifactRefusalOf(textOf(result))).toMatchObject({ reason: 'exportUnavailable' });
    expect(rowsAtRequest).toEqual(['session:app-legacy', `session:${SELF}`]);
  });

  it('is migrated by the session before its thread tools answer', async () => {
    const { id } = await makeLegacyDesign(userData);
    start();
    const d: DocumentToolDeps = { artifacts: () => documents.store, session: new DocumentToolSession(), now: () => 5_000 };
    const tools = Object.fromEntries(designThreadTools(d, presentationThreadTools(d, documentTools(d))).map((tool) => [tool.name, tool]));
    const listed = jsonOf<{ threads: unknown[] }>(await tools.artifact_comments!.call({ artifact: id }, ctx()));
    expect(listed.threads).toEqual([]);
    expect(logRows(userData, id).map((r) => r.actor)).toEqual(['session:app-legacy', `session:${SELF}`]);
  });
});

describe('the design’s thread tools', () => {
  it('list board and element threads by board and element, reply and resolve as the session', async () => {
    start();
    const { artifactId: id } = jsonOf<{ artifactId: string }>(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FOUR }, ctx()));
    await documents.service.writeAs(id, HUMAN, (doc) => {
      addThread(doc, { threadId: 'b', slideId: 'poster', elementId: '', quote: 'Poster', by: HUMAN, at: 1_000, body: 'Taller?' });
      addThread(doc, { threadId: 'e', slideId: 'phone', elementId: 't', quote: 'Sign in', by: HUMAN, at: 2_000, body: 'Bolder' });
    });
    const d: DocumentToolDeps = { artifacts: () => documents.store, session: new DocumentToolSession(), now: () => 5_000 };
    const tools = Object.fromEntries(designThreadTools(d, presentationThreadTools(d, documentTools(d))).map((tool) => [tool.name, tool]));
    const listed = jsonOf<{ threads: { threadId: string; slideId: string; elementId: string; orphaned: boolean }[] }>(await tools.artifact_comments!.call({ artifact: id }, ctx()));
    expect(listed.threads.map(({ threadId, slideId, elementId, orphaned }) => ({ threadId, slideId, elementId, orphaned }))).toEqual([
      { threadId: 'b', slideId: 'poster', elementId: '', orphaned: false },
      { threadId: 'e', slideId: 'phone', elementId: 't', orphaned: false },
    ]);
    expect(jsonOf(await tools.artifact_reply!.call({ artifact: id, threadId: 'e', body: 'Done.' }, ctx()))).toMatchObject({ status: 'replied', threadId: 'e' });
    expect(jsonOf(await tools.artifact_resolve!.call({ artifact: id, threadId: 'b' }, ctx()))).toMatchObject({ status: 'resolved' });
    const live = documents.service.live(id);
    expect(getThread(live, 'e')!.messages.at(-1)).toMatchObject({ by: { kind: 'session', appSessionId: SELF }, body: 'Done.' });
    expect(getThread(live, 'b')!.status).toBe('resolved');
  });

  it('is what the maws server serves: the wired list answers a design from its threads', async () => {
    start();
    const { artifactId: id } = jsonOf<{ artifactId: string }>(await artifactCreateTool(deps()).call({ kind: 'design', title: 'Launch', files: FOUR }, ctx()));
    await documents.service.writeAs(id, HUMAN, (doc) => addThread(doc, { threadId: 'b', slideId: 'poster', elementId: '', quote: 'Poster', by: HUMAN, at: 1_000, body: 'Taller?' }));
    const wired = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => documents.store });
    const comments = wired.find((tool) => tool.name === 'artifact_comments')!;
    expect(jsonOf<{ threads: { threadId: string; slideId: string }[] }>(await comments.call({ artifact: id }, ctx())).threads.map((t) => [t.threadId, t.slideId])).toEqual([['b', 'poster']]);
  });
});
