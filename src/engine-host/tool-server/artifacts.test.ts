import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { ArtifactScreenshotResultSchema, TOOL_ERRORS } from '@shared/maws/tools';
import { artifactPublishTool } from './artifact-publish';
import { artifactCreateTool } from './artifact-tools';
import { HUMAN, jsonOf, openWorld, textOf, type World } from './artifact-world.fixture';
import { artifactScreenshotTool, externalReferenceCount, type ArtifactCaptureRequest } from './artifacts';
import { HostBridge } from './bridge';
import type { McpToolResult } from './server';

// a 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PARENT = 'app-parent' as AppSessionId;

let w: World;
beforeEach(() => {
  w = openWorld();
});
afterEach(() => {
  vi.useRealTimers();
  w.close();
});

type Ctx = Parameters<World['ctx']>[0];
async function created(over: Ctx = {}): Promise<{ artifactId: string; revision: number }> {
  return jsonOf(await artifactCreateTool(w.deps()).call({ id: 'dash', content: '<h1>Dashboard</h1>', title: 'Dashboard' }, w.ctx(over)));
}
function screenshot(options: { hasClient?: () => boolean; artifactScope?: AppSessionId[] } = {}) {
  const sent: ArtifactCaptureRequest[] = [];
  const capture = new HostBridge<ArtifactCaptureRequest, MawsArtifactCapturedResult>({ send: (r) => sent.push(r), answerMs: CAPTURE_ANSWER_MS, hasClient: options.hasClient });
  const tool = artifactScreenshotTool({ ...w.deps({ artifactScope: options.artifactScope }), capture });
  return { sent, capture, tool };
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
};

describe('artifact_screenshot (G4, host half; P3-A: resolved through the store, captured from the X12 mirror)', () => {
  it('asks main for the latest version at 1280 × 800 and answers the image block, then the text block', async () => {
    const page = await created();
    await artifactPublishTool(w.deps()).call({ artifact: 'dash', baseRevision: page.revision, files: { 'index.html': '<h1>v2</h1>' } }, w.ctx());
    const { sent, capture, tool } = screenshot();
    const pending = tool.call({ id: 'dash' }, w.ctx({ requestId: 'r-shot' as RequestId }));
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ requestId: 'r-shot', deliverableId: page.artifactId, version: 2, width: 1280, height: 800 }]);
    expect(capture.answer('r-shot' as RequestId, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: ['Uncaught Error: E2_BOOM'] })).toBe('delivered');
    const result = await pending;
    expect(result.content[0]).toEqual({ type: 'image', data: PNG, mimeType: 'image/png' });
    expect(result.content).toHaveLength(2);
    expect(ArtifactScreenshotResultSchema.parse(JSON.parse((result.content[1] as { text: string }).text))).toEqual({
      status: 'captured', id: 'dash', deliverableId: page.artifactId, title: 'Dashboard', version: 2, width: 1280, height: 800, bytes: Buffer.from(PNG, 'base64').length, consoleErrors: ['Uncaught Error: E2_BOOM'],
    });
  });

  it('takes the artifact’s id as well as its handle, an explicit version and size, and answers a refusal from main as captureFailed', async () => {
    const page = await created();
    const { sent, capture, tool } = screenshot();
    const pending = tool.call({ id: page.artifactId, version: 1, width: 320, height: 240 }, w.ctx({ requestId: 'r-x' as RequestId }));
    await until(() => sent.length > 0);
    expect(sent[0]).toMatchObject({ deliverableId: page.artifactId, version: 1, width: 320, height: 240 });
    capture.answer('r-x' as RequestId, { ok: false, error: 'did-fail-load -3 ERR_ABORTED' });
    expect(await pending).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.captureFailed('did-fail-load -3 ERR_ABORTED') }], isError: true });
  });

  it('refuses an unknown artifact, one with no X12 record (a page the user made) and a version it does not have, before asking main', async () => {
    await created();
    const own = await w.store.create({ kind: 'html', title: 'Human', content: { bytes: Buffer.from('<p/>') } }, HUMAN);
    const { sent, tool } = screenshot();
    expect(textOf(await tool.call({ id: 'nope' }, w.ctx()))).toBe('artifact_screenshot: no artifact "nope" in this session');
    expect(textOf(await tool.call({ id: own.id }, w.ctx()))).toBe(TOOL_ERRORS.noArtifact('artifact_screenshot', own.id));
    expect(textOf(await tool.call({ id: 'dash', version: 3 }, w.ctx()))).toBe('artifact_screenshot: version 3 does not exist; "dash" has 1 version(s)');
    expect(textOf(await tool.call({ id: 'dash', width: 100 }, w.ctx()))).toMatch(/^artifact_screenshot: invalid arguments: width: /);
    expect(sent).toEqual([]);
  });

  it('answers the timeout text when main stays silent for CAPTURE_ANSWER_MS', async () => {
    await created();
    const { sent, tool } = screenshot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled: McpToolResult | null = null;
    void tool.call({ id: 'dash' }, w.ctx()).then((value) => (settled = value));
    for (let i = 0; i < 1000 && sent.length === 0; i++) await new Promise((r) => setImmediate(r)); // the store's read and the record's, at no fake time
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CAPTURE_ANSWER_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ content: [{ type: 'text', text: 'artifact_screenshot: MAWS did not answer within 45 s' }], isError: true });
  });

  it('fails at once with appNotOpen and asks main nothing when no app is connected (E10)', async () => {
    await created();
    const { sent, tool } = screenshot({ hasClient: () => false });
    expect(await tool.call({ id: 'dash' }, w.ctx())).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.appNotOpen('artifact_screenshot') }], isError: true });
    expect(sent).toEqual([]);
  });

  it("captures a side thread's ancestor's page: the capture names the owner, the answer too (P2-E1)", async () => {
    const page = await created({ appSessionId: PARENT });
    const { sent, capture, tool } = screenshot({ artifactScope: [PARENT] });
    const pending = tool.call({ id: 'dash' }, w.ctx({ requestId: 'r-thread' as RequestId }));
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ requestId: 'r-thread', deliverableId: page.artifactId, version: 1, width: 1280, height: 800, ownerAppSessionId: PARENT }]);
    capture.answer('r-thread' as RequestId, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: [] });
    const result = await pending;
    expect(JSON.parse((result.content[1] as { text: string }).text)).toMatchObject({ deliverableId: page.artifactId, ownerAppSessionId: PARENT });
  });
});

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
