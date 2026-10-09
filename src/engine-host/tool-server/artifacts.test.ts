import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { ARTIFACT_MAX_BYTES, ArtifactCreateResultSchema, ArtifactListResultSchema, ArtifactScreenshotResultSchema, ArtifactUpdateResultSchema, TOOL_ERRORS } from '@shared/maws/tools';
import { FileDeliverableStore, SessionChains } from '../deliverables/store';
import { artifactCreateTool, artifactListTool, artifactScreenshotTool, artifactUpdateTool, externalReferenceCount, type ArtifactCaptureRequest } from './artifacts';
import { HostBridge } from './bridge';
import type { McpToolContext, McpToolResult } from './server';

const A = 'app-1' as AppSessionId;
// a 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

let root: string;
let userData: string;
let written: [string, string][];
let store: FileDeliverableStore;
let n: number;
let clock: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-artifacts-cwd-'));
  userData = mkdtempSync(join(tmpdir(), 'maws-artifacts-data-'));
  writeFileSync(join(root, 'dashboard.html'), '<!doctype html><h1 style="color:red">Dashboard</h1><img src="https://example.com/a.png"><img src="data:image/png;base64,AA==">');
  writeFileSync(join(root, 'notes.txt'), 'notes');
  mkdirSync(join(root, 'folder.html'));
  written = [];
  store = new FileDeliverableStore(userData, { onWritten: (record, change) => written.push([record.id, change]) });
  n = 0;
  clock = 0;
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
});

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: A, cwd: root, toolUseId: 'toolu_01' as ToolUseId, requestId: 'r1' as RequestId, signal: new AbortController().signal, ...over });
const deps = () => ({ deliverables: store, now: () => new Date(Date.UTC(2026, 9, 6, 0, 0, clock++)), newId: () => `00000000-0000-4000-8000-00000000000${++n}` });
const textOf = (result: McpToolResult) => (result.content.find((block) => block.type === 'text') as { text: string }).text;
const jsonOf = (result: McpToolResult) => JSON.parse(textOf(result)) as unknown;
const at = (s: number) => new Date(Date.UTC(2026, 9, 6, 0, 0, s)).toISOString();
const ID1 = '00000000-0000-4000-8000-000000000001';
const dir = () => join(userData, 'deliverables', A);
const filesUnder = (path: string): string[] => {
  try {
    return readdirSync(path, { recursive: true }).map(String).sort();
  } catch {
    return [];
  }
};

async function created() {
  return artifactCreateTool(deps()).call({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }, ctx({ toolUseId: 'toolu_create' as ToolUseId }));
}

describe('artifact_create (G4, host half)', () => {
  it("copies the page as v1 under the store, writes the artifact's record, announces it and answers created v1", async () => {
    const result = await created();
    expect(result.isError).toBeUndefined();
    const answer = ArtifactCreateResultSchema.parse(jsonOf(result));
    expect(answer).toEqual({ status: 'created', id: 'dash', deliverableId: ID1, version: 1, title: 'Dashboard', externalReferences: 1 });
    expect(textOf(result)).toBe(JSON.stringify(answer, null, 2));
    const copy = join(dir(), ID1, 'v1.html');
    expect(readFileSync(copy, 'utf8')).toBe(readFileSync(join(root, 'dashboard.html'), 'utf8'));
    expect(await store.get(A, ID1)).toEqual({
      id: ID1, appSessionId: A, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy,
      versions: [{ path: copy, at: at(0), toolUseId: 'toolu_create', sourcePath: join(root, 'dashboard.html') }],
      toolUseId: 'toolu_create', createdAt: at(0), updatedAt: at(0),
    });
    expect(written).toEqual([[ID1, 'created']]);
  });

  it('takes an absolute path, and a call with no tool-use id records none', async () => {
    const result = await artifactCreateTool(deps()).call({ id: 'abs', html_path: join(root, 'dashboard.html'), title: 'Abs' }, ctx({ toolUseId: null }));
    expect(result.isError).toBeUndefined();
    const record = (await store.get(A, ID1))!;
    expect(record.toolUseId).toBeUndefined();
    expect(record.versions[0]).toEqual({ path: join(dir(), ID1, 'v1.html'), at: at(0), sourcePath: join(root, 'dashboard.html') });
  });

  it('refuses a duplicate id, a missing file, a directory, a non-HTML file, a file past the cap and invalid arguments, writing nothing', async () => {
    await created();
    const before = filesUnder(userData);
    const tool = artifactCreateTool(deps());
    expect(await tool.call({ id: 'dash', html_path: 'dashboard.html', title: 'Again' }, ctx())).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.artifactExists('dash') }], isError: true });
    expect(textOf(await tool.call({ id: 'x', html_path: 'gone.html', title: 'X' }, ctx()))).toBe(TOOL_ERRORS.artifactNotAFile('artifact_create', join(root, 'gone.html')));
    expect(textOf(await tool.call({ id: 'x', html_path: 'folder.html', title: 'X' }, ctx()))).toBe(TOOL_ERRORS.artifactNotAFile('artifact_create', join(root, 'folder.html')));
    expect(textOf(await tool.call({ id: 'x', html_path: 'notes.txt', title: 'X' }, ctx()))).toBe(TOOL_ERRORS.notHtml('artifact_create', join(root, 'notes.txt')));
    writeFileSync(join(root, 'big.HTM'), '');
    truncateSync(join(root, 'big.HTM'), ARTIFACT_MAX_BYTES + 1);
    expect(textOf(await tool.call({ id: 'x', html_path: 'big.HTM', title: 'X' }, ctx()))).toBe(TOOL_ERRORS.tooLarge('artifact_create', join(root, 'big.HTM'), ARTIFACT_MAX_BYTES + 1));
    const invalid = await tool.call({ id: '../x', html_path: 'dashboard.html', title: 'X' }, ctx());
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toMatch(/^artifact_create: invalid arguments: id: /);
    expect(filesUnder(userData)).toEqual(before);
    expect(written).toEqual([[ID1, 'created']]);
  });

  it('answers a store failure naming the path and the cause', async () => {
    const failing = Object.assign(Object.create(store) as FileDeliverableStore, { write: async () => Promise.reject(new Error('ENOSPC: no space left')) });
    const result = await artifactCreateTool({ ...deps(), deliverables: failing }).call({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }, ctx());
    expect(result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.notRecorded('artifact_create', join(root, 'dashboard.html'), 'ENOSPC: no space left') }], isError: true });
    expect(await store.list(A)).toEqual([]);
  });

  it('two creates of one id that overlap register it once', async () => {
    const tool = artifactCreateTool(deps());
    const results = await Promise.all([tool.call({ id: 'dash', html_path: 'dashboard.html', title: 'One' }, ctx()), tool.call({ id: 'dash', html_path: 'dashboard.html', title: 'Two' }, ctx())]);
    // which call enters the per-session chain first is not deterministic (the stat, extension and size checks before it are async)
    const winners = results.filter((r) => !r.isError);
    const losers = results.filter((r) => r.isError);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(textOf(losers[0]!)).toBe(TOOL_ERRORS.artifactExists('dash'));
    const winnerTitle = results[0] === winners[0] ? 'One' : 'Two';
    expect((await store.list(A)).map((r) => r.title)).toEqual([winnerTitle]);
  });
});

describe('artifact_update (G4, host half)', () => {
  it('adds v2 from the rewritten page, moves the path, replaces the title when given and announces updated', async () => {
    await created();
    writeFileSync(join(root, 'dashboard.html'), '<h1 style="color:blue">Dashboard</h1><link href="https://cdn.example/a.css" rel="stylesheet"><style>@import "https://x/y.css"; body{background:url(https://x/bg.png)}</style>');
    const result = await artifactUpdateTool(deps()).call({ id: 'dash', html_path: 'dashboard.html', title: 'Sales dashboard' }, ctx({ toolUseId: 'toolu_update' as ToolUseId }));
    expect(ArtifactUpdateResultSchema.parse(jsonOf(result))).toEqual({ status: 'updated', id: 'dash', deliverableId: ID1, version: 2, title: 'Sales dashboard', externalReferences: 3 });
    const v1 = join(dir(), ID1, 'v1.html');
    const v2 = join(dir(), ID1, 'v2.html');
    expect(readFileSync(v1, 'utf8')).toContain('color:red');
    expect(readFileSync(v2, 'utf8')).toContain('color:blue');
    expect(await store.get(A, ID1)).toMatchObject({
      path: v2, title: 'Sales dashboard', toolUseId: 'toolu_create', createdAt: at(0), updatedAt: at(1),
      versions: [{ path: v1, at: at(0), toolUseId: 'toolu_create' }, { path: v2, at: at(1), toolUseId: 'toolu_update', sourcePath: join(root, 'dashboard.html') }],
    });
    // without a title the title stays
    const third = await artifactUpdateTool(deps()).call({ id: 'dash', html_path: 'dashboard.html' }, ctx());
    expect(jsonOf(third)).toMatchObject({ version: 3, title: 'Sales dashboard' });
    expect(written).toEqual([[ID1, 'created'], [ID1, 'updated'], [ID1, 'updated']]);
  });

  it('two updates that overlap number 2 and 3', async () => {
    await created();
    const tool = artifactUpdateTool(deps());
    const results = await Promise.all([tool.call({ id: 'dash', html_path: 'dashboard.html' }, ctx()), tool.call({ id: 'dash', html_path: 'dashboard.html' }, ctx())]);
    expect(results.map((r) => (jsonOf(r) as { version: number }).version).sort()).toEqual([2, 3]);
    expect((await store.get(A, ID1))!.versions).toHaveLength(3);
  });

  it('refuses an unknown id and the file checks with its own name, writing nothing; a failed rewrite leaves the record as it was', async () => {
    await created();
    const before = await store.get(A, ID1);
    const tool = artifactUpdateTool(deps());
    expect(textOf(await tool.call({ id: 'nope', html_path: 'dashboard.html' }, ctx()))).toBe('artifact_update: no artifact "nope" in this session; use artifact_create');
    expect(textOf(await tool.call({ id: 'dash', html_path: 'gone.html' }, ctx()))).toBe(TOOL_ERRORS.artifactNotAFile('artifact_update', join(root, 'gone.html')));
    expect(textOf(await tool.call({ id: 'dash', html_path: 'notes.txt' }, ctx()))).toBe(TOOL_ERRORS.notHtml('artifact_update', join(root, 'notes.txt')));
    expect(filesUnder(join(dir(), ID1))).toEqual(['v1.html']);
    const failing = Object.assign(Object.create(store) as FileDeliverableStore, { update: async () => Promise.reject(new Error('EACCES: denied')) });
    const refused = await artifactUpdateTool({ ...deps(), deliverables: failing }).call({ id: 'dash', html_path: 'dashboard.html' }, ctx());
    expect(textOf(refused)).toBe(TOOL_ERRORS.notRecorded('artifact_update', join(root, 'dashboard.html'), 'EACCES: denied'));
    expect(await store.get(A, ID1)).toEqual(before);
    expect(written).toEqual([[ID1, 'created']]);
  });
});

describe('artifact_list (G4, host half)', () => {
  it("lists the session's artifacts oldest first with their version counts, and no delivered file", async () => {
    expect(jsonOf(await artifactListTool(deps()).call({}, ctx()))).toEqual({ status: 'listed', artifacts: [] });
    await created();
    await artifactUpdateTool(deps()).call({ id: 'dash', html_path: 'dashboard.html' }, ctx());
    await artifactCreateTool(deps()).call({ id: 'second', html_path: 'dashboard.html', title: 'Second' }, ctx());
    await store.write({ id: '00000000-0000-4000-8000-000000000009', appSessionId: A, kind: 'file', path: join(root, 'notes.txt'), versions: [{ path: join(root, 'notes.txt'), at: at(9) }], createdAt: at(9) });
    const result = ArtifactListResultSchema.parse(jsonOf(await artifactListTool(deps()).call({}, ctx())));
    expect(result).toEqual({
      status: 'listed',
      artifacts: [
        { id: 'dash', deliverableId: ID1, title: 'Dashboard', versions: 2, createdAt: at(0), updatedAt: at(1) },
        { id: 'second', deliverableId: '00000000-0000-4000-8000-000000000002', title: 'Second', versions: 1, createdAt: at(2), updatedAt: at(2) },
      ],
    });
    expect(textOf(await artifactListTool(deps()).call({ all: true }, ctx()))).toMatch(/^artifact_list: invalid arguments: /);
  });
});

describe('artifact_screenshot (G4, host half)', () => {
  function screenshot() {
    const sent: ArtifactCaptureRequest[] = [];
    const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS });
    const tool = artifactScreenshotTool({ deliverables: store, capture });
    return { sent, capture, tool };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  };

  it('asks main for the latest version at 1280 × 800 and answers the image block, then the text block', async () => {
    await created();
    await artifactUpdateTool(deps()).call({ id: 'dash', html_path: 'dashboard.html' }, ctx());
    const { sent, capture, tool } = screenshot();
    const pending = tool.call({ id: 'dash' }, ctx({ requestId: 'r-shot' as RequestId }));
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ requestId: 'r-shot', deliverableId: ID1, version: 2, width: 1280, height: 800 }]);
    expect(capture.answer('r-shot' as RequestId, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: ['Uncaught Error: E2_BOOM'] })).toBe('delivered');
    const result = await pending;
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: 'image', data: PNG, mimeType: 'image/png' });
    expect(result.content).toHaveLength(2);
    expect(ArtifactScreenshotResultSchema.parse(jsonOf(result))).toEqual({
      status: 'captured', id: 'dash', deliverableId: ID1, title: 'Dashboard', version: 2, width: 1280, height: 800, bytes: Buffer.from(PNG, 'base64').length, consoleErrors: ['Uncaught Error: E2_BOOM'],
    });
    expect(capture.answer('r-shot' as RequestId, { ok: true, png: PNG, width: 1, height: 1, consoleErrors: [] })).toBe('not_pending');
  });

  it('passes an explicit version and size, and answers a refusal from main as captureFailed', async () => {
    await created();
    const { sent, capture, tool } = screenshot();
    const pending = tool.call({ id: 'dash', version: 1, width: 320, height: 240 }, ctx());
    await until(() => sent.length > 0);
    expect(sent[0]).toMatchObject({ version: 1, width: 320, height: 240 });
    capture.answer('r1' as RequestId, { ok: false, error: 'did-fail-load -3 ERR_ABORTED' });
    expect(await pending).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.captureFailed('did-fail-load -3 ERR_ABORTED') }], isError: true });
  });

  it('refuses an unknown id and a version the artifact does not have before asking main', async () => {
    await created();
    const { sent, tool } = screenshot();
    expect(textOf(await tool.call({ id: 'nope' }, ctx()))).toBe('artifact_screenshot: no artifact "nope" in this session');
    expect(textOf(await tool.call({ id: 'dash', version: 3 }, ctx()))).toBe('artifact_screenshot: version 3 does not exist; "dash" has 1 version(s)');
    expect(textOf(await tool.call({ id: 'dash', width: 100 }, ctx()))).toMatch(/^artifact_screenshot: invalid arguments: width: /);
    expect(sent).toEqual([]);
  });

  it('answers the timeout text when main stays silent for CAPTURE_ANSWER_MS', async () => {
    await created();
    const { sent, tool } = screenshot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled: McpToolResult | null = null;
    void tool.call({ id: 'dash' }, ctx()).then((value) => (settled = value));
    for (let i = 0; i < 1000 && sent.length === 0; i++) await new Promise((r) => setImmediate(r)); // the record's read, at no fake time
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CAPTURE_ANSWER_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ content: [{ type: 'text', text: 'artifact_screenshot: MAWS did not answer within 45 s' }], isError: true });
  });
});

describe('artifact_screenshot with no app connected (E10)', () => {
  it('fails at once with appNotOpen and asks main nothing', async () => {
    await created();
    const sent: ArtifactCaptureRequest[] = [];
    const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS, hasClient: () => false });
    const result = await artifactScreenshotTool({ deliverables: store, capture }).call({ id: 'dash' }, ctx());
    expect(result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.appNotOpen('artifact_screenshot') }], isError: true });
    expect(TOOL_ERRORS.appNotOpen('artifact_screenshot')).toBe('artifact_screenshot: MAWS is not open; the artifact cannot be captured');
    expect(sent).toEqual([]);
  });
});

// P2-E1 start (2026-10-09): the artifact scope (G4, D10). A side thread's tools resolve over its own artifacts, then its
// ancestors' nearest first; each session has a store of its own, as the launcher builds them, sharing one SessionChains.
describe('the artifact scope of a side thread (P2-E1 G4)', () => {
  const P = 'app-parent' as AppSessionId;
  const T = 'app-thread' as AppSessionId;
  const T2 = 'app-thread-2' as AppSessionId;
  let family: { [K in 'parent' | 'thread' | 'thread2']: FileDeliverableStore };
  let announced: [AppSessionId, string, string][];
  beforeEach(() => {
    const chains = new SessionChains();
    announced = [];
    const storeOf = () => new FileDeliverableStore(userData, { chains, onWritten: (record, change) => announced.push([record.appSessionId, record.id, change]) });
    family = { parent: storeOf(), thread: storeOf(), thread2: storeOf() };
  });
  const parentDeps = () => ({ ...deps(), deliverables: family.parent });
  const threadDeps = () => ({ ...deps(), deliverables: family.thread, artifactScope: [P] });
  const parentCtx = (over: Partial<McpToolContext> = {}) => ctx({ appSessionId: P, ...over });
  const threadCtx = (over: Partial<McpToolContext> = {}) => ctx({ appSessionId: T, ...over });
  const underSession = (appSessionId: AppSessionId) => filesUnder(join(userData, 'deliverables', appSessionId));
  async function parentCreated() {
    const result = await artifactCreateTool(parentDeps()).call({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }, parentCtx({ toolUseId: 'toolu_create' as ToolUseId }));
    expect(result.isError).toBeUndefined();
  }

  it("artifact_update on the parent's id writes the parent's next version, names the owner and leaves nothing under the thread", async () => {
    await parentCreated();
    writeFileSync(join(root, 'dashboard.html'), '<h1 style="font-size:4em">Dashboard</h1>');
    const result = await artifactUpdateTool(threadDeps()).call({ id: 'dash', html_path: 'dashboard.html' }, threadCtx({ toolUseId: 'toolu_thread' as ToolUseId }));
    const answer = { status: 'updated', id: 'dash', deliverableId: ID1, version: 2, title: 'Dashboard', externalReferences: 0, ownerAppSessionId: P };
    expect(textOf(result)).toBe(JSON.stringify(answer, null, 2)); // the owner after today's fields
    expect(ArtifactUpdateResultSchema.parse(jsonOf(result))).toEqual(answer);
    const v2 = join(userData, 'deliverables', P, ID1, 'v2.html');
    expect(readFileSync(v2, 'utf8')).toContain('font-size:4em');
    expect(await family.parent.get(P, ID1)).toMatchObject({ appSessionId: P, path: v2, versions: [{ toolUseId: 'toolu_create' }, { path: v2, toolUseId: 'toolu_thread' }] });
    expect(underSession(T)).toEqual([]);
    expect(announced).toEqual([[P, ID1, 'created'], [P, ID1, 'updated']]); // announced under the record's own session
  });

  it('a thread of a thread updates the family root’s artifact through its chain', async () => {
    await parentCreated();
    const result = await artifactUpdateTool({ ...deps(), deliverables: family.thread2, artifactScope: [T, P] }).call({ id: 'dash', html_path: 'dashboard.html' }, ctx({ appSessionId: T2 }));
    expect(jsonOf(result)).toMatchObject({ version: 2, ownerAppSessionId: P });
    expect((await family.parent.get(P, ID1))!.versions).toHaveLength(2);
    expect(underSession(T)).toEqual([]);
    expect(underSession(T2)).toEqual([]);
  });

  it("a session's own artifact stays nearest: no owner on its own update, and a copy it holds of an ancestor's id is the one updated", async () => {
    await parentCreated();
    const own = await artifactCreateTool(threadDeps()).call({ id: 'notes', html_path: 'dashboard.html', title: 'Notes' }, threadCtx());
    const ownId = (jsonOf(own) as { deliverableId: string }).deliverableId;
    expect(textOf(await artifactUpdateTool(threadDeps()).call({ id: 'notes', html_path: 'dashboard.html' }, threadCtx()))).toBe(
      JSON.stringify({ status: 'updated', id: 'notes', deliverableId: ownId, version: 2, title: 'Notes', externalReferences: 1 }, null, 2),
    );
    // a copy registered under the thread before the scope existed (the tracker's kind): found first, being nearest
    const copyId = '00000000-0000-4000-8000-0000000000c0';
    await family.thread.write({ id: copyId, appSessionId: T, kind: 'artifact', artifactId: 'dash', title: 'Copy', path: '/x/v1.html', versions: [{ path: '/x/v1.html', at: at(0) }], createdAt: at(50) });
    expect(jsonOf(await artifactUpdateTool(threadDeps()).call({ id: 'dash', html_path: 'dashboard.html' }, threadCtx()))).toEqual({ status: 'updated', id: 'dash', deliverableId: copyId, version: 2, title: 'Copy', externalReferences: 1 });
    expect((await family.parent.get(P, ID1))!.versions).toHaveLength(1);
  });

  it('an id no session of the chain holds is refused as today', async () => {
    await parentCreated();
    expect(textOf(await artifactUpdateTool(threadDeps()).call({ id: 'nope', html_path: 'dashboard.html' }, threadCtx()))).toBe(TOOL_ERRORS.noArtifact('artifact_update', 'nope'));
  });

  it('artifact_list lists its own artifacts, then its ancestors’ with their owner, an id already listed nearer skipped', async () => {
    await parentCreated();
    await artifactCreateTool(parentDeps()).call({ id: 'shared', html_path: 'dashboard.html', title: 'Parent shared' }, parentCtx());
    await artifactCreateTool({ ...deps(), deliverables: family.thread }).call({ id: 'shared', html_path: 'dashboard.html', title: 'Thread shared' }, threadCtx()); // a copy made before the scope existed
    await artifactCreateTool(threadDeps()).call({ id: 'notes', html_path: 'dashboard.html', title: 'Notes' }, threadCtx());
    const listed = ArtifactListResultSchema.parse(jsonOf(await artifactListTool(threadDeps()).call({}, threadCtx())));
    expect(listed.artifacts.map((a) => [a.id, a.title, a.ownerAppSessionId])).toEqual([
      ['shared', 'Thread shared', undefined],
      ['notes', 'Notes', undefined],
      ['dash', 'Dashboard', P],
    ]);
    expect(Object.keys(listed.artifacts[2]!).at(-1)).toBe('ownerAppSessionId');
    expect('ownerAppSessionId' in listed.artifacts[0]!).toBe(false);
    // the parent does not see the thread's own artifacts (A-39: a thread's own stay its own)
    const parentList = ArtifactListResultSchema.parse(jsonOf(await artifactListTool(parentDeps()).call({}, parentCtx())));
    expect(parentList.artifacts.map((a) => a.id)).toEqual(['dash', 'shared']);
  });

  it("artifact_screenshot captures an ancestor's artifact: the capture names the owner, the answer too", async () => {
    await parentCreated();
    const sent: ArtifactCaptureRequest[] = [];
    const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS });
    const pending = artifactScreenshotTool({ deliverables: family.thread, capture, artifactScope: [P] }).call({ id: 'dash' }, threadCtx({ requestId: 'r-shot' as RequestId }));
    for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(sent).toEqual([{ requestId: 'r-shot', deliverableId: ID1, version: 1, width: 1280, height: 800, ownerAppSessionId: P }]);
    capture.answer('r-shot' as RequestId, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: [] });
    expect(ArtifactScreenshotResultSchema.parse(jsonOf(await pending))).toMatchObject({ deliverableId: ID1, version: 1, ownerAppSessionId: P });
  });

  it('artifact_create refuses an id an ancestor holds, with its own text, and writes nothing', async () => {
    await parentCreated();
    const result = await artifactCreateTool(threadDeps()).call({ id: 'dash', html_path: 'dashboard.html', title: 'Mine' }, threadCtx());
    expect(result).toEqual({ content: [{ type: 'text', text: 'artifact_create: an artifact "dash" already exists in the conversation this side thread was opened from; use artifact_update' }], isError: true });
    expect(TOOL_ERRORS.artifactExistsInParent('dash')).toBe(textOf(result));
    expect(underSession(T)).toEqual([]);
  });

  it("a parent update and a thread update racing on one artifact append v2 then v3 in the order they entered the owner's chain", async () => {
    await parentCreated();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let copying = false;
    const held = Object.assign(Object.create(family.parent) as FileDeliverableStore, {
      copyVersion: async (...args: Parameters<FileDeliverableStore['copyVersion']>) => {
        copying = true;
        await gate;
        return family.parent.copyVersion(...args);
      },
    });
    const first = artifactUpdateTool({ ...deps(), deliverables: held }).call({ id: 'dash', html_path: 'dashboard.html' }, parentCtx({ toolUseId: 'toolu_parent' as ToolUseId }));
    for (let i = 0; i < 100 && !copying; i++) await new Promise((r) => setTimeout(r, 1));
    expect(copying).toBe(true);
    const second = artifactUpdateTool(threadDeps()).call({ id: 'dash', html_path: 'dashboard.html' }, threadCtx({ toolUseId: 'toolu_thread' as ToolUseId }));
    await new Promise((r) => setTimeout(r, 20)); // the thread's call reaches the parent's chain and waits there
    release();
    const [parentAnswer, threadAnswer] = await Promise.all([first, second]);
    expect(jsonOf(parentAnswer)).toMatchObject({ version: 2 });
    expect(jsonOf(threadAnswer)).toMatchObject({ version: 3, ownerAppSessionId: P });
    expect((await family.parent.get(P, ID1))!.versions.map((v) => v.toolUseId)).toEqual(['toolu_create', 'toolu_parent', 'toolu_thread']);
    expect(filesUnder(join(userData, 'deliverables', P, ID1))).toEqual(['v1.html', 'v2.html', 'v3.html']);
  });
});
// P2-E1 end

describe('externalReferenceCount', () => {
  it('counts the http(s) URLs a page names in src, href, srcset, url( and @import positions, and no data: URL', () => {
    expect(externalReferenceCount('<img src="https://a/1.png"><img src=\'https://a/2.png\'><img src="data:image/png;base64,AA==">')).toBe(2);
    expect(externalReferenceCount('<a href="http://a/">x</a><a href="#top">y</a><script src="app.js"></script>')).toBe(1);
    expect(externalReferenceCount('<img srcset="https://a/1x.png 1x, https://a/2x.png 2x">')).toBe(2);
    expect(externalReferenceCount('<style>@import url("https://a/b.css"); @import \'https://a/c.css\'; div{background:url( https://a/bg.png )}</style>')).toBe(3);
    expect(externalReferenceCount('<p>see https://example.com in the text</p>')).toBe(0);
    expect(externalReferenceCount('')).toBe(0);
  });
});
