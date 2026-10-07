// E4c (E4c execution document, Design §3; Acceptance "Also pinned": browser.test.ts): the six browser tools in the host.
// Each parses its arguments with the schema the normaliser admits by, asks main once through the browser bridge, and
// formats main's answer: JSON first; a snapshot's text as a second block; a screenshot's image before its JSON, the file
// read from the path the host named and its `screenshot` record written (X12, `sourceUrl` additive). A malformed answer
// is an error, never a success the model would trust.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import { BROWSER_ANSWER_MS, BROWSER_SCREENSHOT_MAX_BYTES, BROWSER_TOOL_NAMES, type BrowserToolName } from '@shared/maws/browser';
import { screenshotPath } from '@shared/maws/deliverable-files';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { MemoryDeliverableStore } from '../deliverables/store';
import { BrowserBridge, type BrowserRequest } from './browser-bridge';
import { browserTools } from './browser';
import type { McpToolContext, McpToolDefinition } from './server';

const A = 'app-1' as AppSessionId;
const TAB = 'b_0123456789ab';
const UUID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const page = { status: 'ok', tabId: TAB, url: 'http://127.0.0.1:17391/form.html', title: 'E4c order form', ms: 42 } as const;

let userData: string;
let sent: BrowserRequest[];
let cancelled: RequestId[];
let connected: boolean;
let bridge: BrowserBridge;
let store: MemoryDeliverableStore;
let written: string[];
let tools: Map<string, McpToolDefinition>;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-e4c-browser-'));
  sent = [];
  cancelled = [];
  connected = true;
  bridge = new BrowserBridge({ send: (r) => sent.push(r), cancel: (id) => cancelled.push(id), connected: () => connected });
  written = [];
  store = new MemoryDeliverableStore({ onWritten: (record) => written.push(record.id) });
  tools = new Map(browserTools({ bridge, deliverables: store, userData, now: () => new Date('2026-10-07T10:00:00.000Z'), newId: () => UUID }).map((tool) => [tool.name, tool]));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(userData, { recursive: true, force: true });
});

let n = 0;
const ctx = (signal = new AbortController().signal): McpToolContext => ({ appSessionId: A, cwd: '/nowhere', toolUseId: 'toolu_b' as ToolUseId, requestId: `mcp-${++n}` as RequestId, signal });

// Calls the tool, waits for its request, answers it with `answer` (or leaves it when null), and returns the result.
async function run(tool: BrowserToolName, args: unknown, answer: MawsBrowserAnswerResult | ((request: BrowserRequest) => MawsBrowserAnswerResult)) {
  const before = sent.length;
  const context = ctx();
  const pending = tools.get(tool)!.call(args, context);
  await vi.waitFor(() => expect(sent.length).toBe(before + 1));
  const request = sent.at(-1)!;
  expect(bridge.answer(context.requestId, typeof answer === 'function' ? answer(request) : answer)).toBe('delivered');
  return { result: await pending, request, context };
}

const jsonOf = (block: unknown) => JSON.parse((block as { text: string }).text) as Record<string, unknown>;

describe('the browser tools in the host (E4c Design §3)', () => {
  it('serves the six tools in list order, each the X9 entry', () => {
    expect([...tools.keys()]).toEqual([...BROWSER_TOOL_NAMES]);
  });

  it('refuses arguments the schema refuses with invalidArguments and asks main nothing', async () => {
    const result = await tools.get('browser_tabs')!.call({ action: 'open' }, ctx());
    expect(result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.invalidArguments('browser_tabs', 'url: open needs a url') }], isError: true });
    expect((await tools.get('browser_snapshot')!.call({ tabId: TAB, maxChars: 64_001 }, ctx())).isError).toBe(true);
    expect((await tools.get('browser_navigate')!.call({ tabId: TAB, url: 'file:///etc/passwd' }, ctx())).isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it('asks main with the call’s ids and its parsed arguments, and answers the result as one JSON block', async () => {
    const args = { tabId: TAB, action: 'click', target: 'e12' };
    const result = { ...page, action: 'click', target: { ref: 'e12', role: 'button', name: 'Submit' }, navigated: true, waitedFor: 'human', waitedMs: 3012 };
    const { result: answered, request, context } = await run('browser_act', args, { ok: true, result });
    expect(request).toEqual({ requestId: context.requestId, toolUseId: 'toolu_b', tool: 'browser_act', args });
    expect(answered).toEqual({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  });

  it('answers each of tabs, navigate and eval with its JSON; main’s refusal is written as its text', async () => {
    const summary = { tabId: TAB, url: page.url, title: page.title, selected: true, loaded: true, control: 'agent', owner: 'self' };
    const opened = { status: 'ok', action: 'open', tabId: TAB, url: page.url, title: page.title, tabs: [summary], ms: 120 };
    expect(jsonOf((await run('browser_tabs', { action: 'open', url: page.url }, { ok: true, result: opened })).result.content[0])).toEqual(opened);
    const navigated = { ...page, waitedFor: null, waitedMs: null };
    expect(jsonOf((await run('browser_navigate', { tabId: TAB, url: 'back' }, { ok: true, result: navigated })).result.content[0])).toEqual(navigated);
    const evaluated = { ...page, value: { n: 1 }, truncated: false, dialogs: [{ type: 'alert', message: 'hi' }] };
    expect(jsonOf((await run('browser_eval', { tabId: TAB, expression: '({n: 1})' }, { ok: true, result: evaluated })).result.content[0])).toEqual(evaluated);
    const refusal = TOOL_ERRORS.tabNotFound('browser_eval', TAB);
    expect((await run('browser_eval', { tabId: TAB, expression: '1' }, { ok: false, error: refusal })).result).toEqual({ content: [{ type: 'text', text: refusal }], isError: true });
  });

  it('answers a snapshot as two text blocks, the JSON header then the snapshot text', async () => {
    const header = { ...page, root: null, rootMatches: null, chars: 120, lines: 4, refs: 3, truncated: false, omitted: null };
    const text = '- heading "E4c order form" [level=1] [ref=e2]\n- textbox "Name" [ref=e3]\n- textbox "Email" [ref=e4]\n- button "Submit" [disabled] [ref=e5]';
    const { result } = await run('browser_snapshot', { tabId: TAB }, { ok: true, result: header, text });
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(header, null, 2) }, { type: 'text', text }] });
    // a snapshot answered without its text is malformed
    expect((await run('browser_snapshot', { tabId: TAB }, { ok: true, result: header })).result).toEqual({
      content: [{ type: 'text', text: TOOL_ERRORS.actionFailed('browser_snapshot', 'answer', '', 'malformed answer from MAWS') }], isError: true,
    });
  });

  it('refuses a result its schema refuses as a malformed answer, never a success', async () => {
    const malformed = TOOL_ERRORS.actionFailed('browser_act', 'answer', '', 'malformed answer from MAWS');
    const act = { ...page, action: 'click', target: { ref: 'e12' }, navigated: false, waitedFor: null, waitedMs: null };
    for (const result of [{ ...act, ms: 41.7 }, { ...act, extra: true }, { ...act, waitedFor: 'sheet' }, { status: 'ok' }]) {
      expect((await run('browser_act', { tabId: TAB, action: 'click', target: 'e12' }, { ok: true, result })).result, JSON.stringify(result)).toEqual({ content: [{ type: 'text', text: malformed }], isError: true });
    }
  });

  it('answers browserTimeout after 30 s of main’s silence and tells main to stop', async () => {
    vi.useFakeTimers();
    const context = ctx();
    const pending = tools.get('browser_eval')!.call({ tabId: TAB, expression: '1' }, context);
    await vi.advanceTimersByTimeAsync(BROWSER_ANSWER_MS);
    expect(await pending).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.browserTimeout('browser_eval') }], isError: true });
    expect(cancelled).toEqual([context.requestId]);
  });

  it('a withdrawn call tells main to stop (its answer is never written)', async () => {
    const controller = new AbortController();
    const context = ctx(controller.signal);
    const pending = tools.get('browser_act')!.call({ tabId: TAB, action: 'click', target: 'e1' }, context);
    controller.abort('withdrawn');
    expect((await pending).isError).toBe(true);
    expect(cancelled).toEqual([context.requestId]);
  });

  it('answers appNotOpen at once with no app connected (X13)', async () => {
    connected = false;
    expect(await tools.get('browser_tabs')!.call({ action: 'list' }, ctx())).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.appNotOpen('browser_tabs') }], isError: true });
    expect(sent).toEqual([]);
  });

  describe('browser_screenshot', () => {
    const shot = (path: string, over: Record<string, unknown> = {}) => ({ ...page, deliverableId: UUID, path, width: 1, height: 1, bytes: PNG.length, mimeType: 'image/png', target: null, fullPage: false, ...over });
    const write = (path: string, bytes: Buffer = PNG) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    };
    const answerWith = (over: Record<string, unknown> = {}, ext: 'png' | 'jpg' = 'png') => (request: BrowserRequest): MawsBrowserAnswerResult => {
      const path = screenshotPath(userData, A, request.deliverableId!, ext);
      write(path);
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      return { ok: true, result: shot(path, { mimeType, ...over }), image: { path, mimeType, width: 1, height: 1, bytes: PNG.length } };
    };

    it('names the record and its .png path in the request, answers the image then the JSON, and writes the screenshot record', async () => {
      const { result, request, context } = await run('browser_screenshot', { tabId: TAB }, answerWith());
      const path = screenshotPath(userData, A, UUID, 'png');
      expect(request).toEqual({ requestId: context.requestId, toolUseId: 'toolu_b', tool: 'browser_screenshot', args: { tabId: TAB }, deliverableId: UUID, path });
      expect(result.content).toEqual([{ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(shot(path), null, 2) }]);
      expect(await store.get(A, UUID)).toEqual({
        id: UUID, appSessionId: A, kind: 'screenshot', path, title: 'E4c order form', sourceUrl: page.url,
        versions: [{ path, at: '2026-10-07T10:00:00.000Z', toolUseId: 'toolu_b' }], toolUseId: 'toolu_b', createdAt: '2026-10-07T10:00:00.000Z',
      });
      expect(written).toEqual([UUID]);
    });

    it('accepts the .jpg main wrote after the JPEG fallback', async () => {
      const { result } = await run('browser_screenshot', { tabId: TAB, fullPage: true }, answerWith({ fullPage: true }, 'jpg'));
      expect(result.content[0]).toEqual({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/jpeg' });
      expect((await store.get(A, UUID))?.path).toBe(screenshotPath(userData, A, UUID, 'jpg'));
    });

    it('titles a page with no title by its host, and leaves sourceUrl out for a tab that never navigated (Decision Log 40)', async () => {
      await run('browser_screenshot', { tabId: TAB }, answerWith({ title: '' }));
      expect(await store.get(A, UUID)).toMatchObject({ title: '127.0.0.1', sourceUrl: page.url });
      store = new MemoryDeliverableStore();
      tools = new Map(browserTools({ bridge, deliverables: store, userData, newId: () => UUID }).map((tool) => [tool.name, tool]));
      const { result } = await run('browser_screenshot', { tabId: TAB }, answerWith({ url: '', title: '' }));
      expect(result.isError).toBeUndefined();
      const record = await store.get(A, UUID);
      expect(record).not.toHaveProperty('sourceUrl');
      expect(record).not.toHaveProperty('title');
    });

    it('refuses an answer naming another file, another record, or a format its path does not carry, and writes no record', async () => {
      const malformed = { content: [{ type: 'text', text: TOOL_ERRORS.actionFailed('browser_screenshot', 'answer', '', 'malformed answer from MAWS') }], isError: true };
      const elsewhere = join(userData, 'elsewhere.png');
      const cases: ((request: BrowserRequest) => MawsBrowserAnswerResult)[] = [
        () => {
          write(elsewhere);
          return { ok: true, result: shot(elsewhere), image: { path: elsewhere, mimeType: 'image/png', width: 1, height: 1, bytes: 1 } };
        },
        answerWith({ deliverableId: '00000000-0000-4000-8000-000000000000' }),
        (request) => ({ ...(answerWith()(request) as Extract<MawsBrowserAnswerResult, { ok: true }>), image: { path: screenshotPath(userData, A, UUID, 'png'), mimeType: 'image/jpeg', width: 1, height: 1, bytes: 1 } }),
        (request) => ({ ...(answerWith()(request) as Extract<MawsBrowserAnswerResult, { ok: true }>), image: undefined }),
      ];
      for (const answer of cases) expect((await run('browser_screenshot', { tabId: TAB }, answer)).result).toEqual(malformed);
      expect(written).toEqual([]);
    });

    it('answers screenshotFailed when the file cannot be read and screenshotTooLarge over 3.5 MiB, writing no record', async () => {
      const missing = (request: BrowserRequest): MawsBrowserAnswerResult => {
        const path = screenshotPath(userData, A, request.deliverableId!, 'png');
        return { ok: true, result: shot(path), image: { path, mimeType: 'image/png', width: 1, height: 1, bytes: 1 } };
      };
      const failed = (await run('browser_screenshot', { tabId: TAB }, missing)).result;
      expect(failed.isError).toBe(true);
      expect((failed.content[0] as { text: string }).text).toMatch(/^browser_screenshot: could not capture: the picture MAWS wrote could not be read \(.*ENOENT/);
      const huge = (request: BrowserRequest): MawsBrowserAnswerResult => {
        const path = screenshotPath(userData, A, request.deliverableId!, 'png');
        write(path, Buffer.alloc(BROWSER_SCREENSHOT_MAX_BYTES + 1));
        return { ok: true, result: shot(path), image: { path, mimeType: 'image/png', width: 1, height: 1, bytes: 1 } };
      };
      expect((await run('browser_screenshot', { tabId: TAB }, huge)).result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.screenshotTooLarge(BROWSER_SCREENSHOT_MAX_BYTES + 1) }], isError: true });
      expect(written).toEqual([]);
    });
  });
});
