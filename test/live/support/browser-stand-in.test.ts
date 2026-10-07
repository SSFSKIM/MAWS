// Offline, before any money is spent: the live browser recording's stand-in answers the recorded sequence in a shape the
// host's own browser tools accept (no malformed answer, the snapshot's two blocks, the screenshot's image and record),
// with the refs, page and tab the real app produces (E4c execution document, Design §13).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { BrowserToolName } from '@shared/maws/browser';
import { MemoryDeliverableStore } from '../../../src/engine-host/deliverables/store';
import { BrowserBridge } from '../../../src/engine-host/tool-server/browser-bridge';
import { browserTools } from '../../../src/engine-host/tool-server/browser';
import type { McpToolDefinition } from '../../../src/engine-host/tool-server/server';
import { BrowserStandIn, DONE_SNAPSHOT, DONE_TITLE, DONE_URL, FORM_SNAPSHOT, FORM_URL, GREEN_SQUARE_PNG, TAB_ID } from './browser-stand-in';

const A = 'live-e4c' as AppSessionId;
let userData: string;
let store: MemoryDeliverableStore;
let tools: Map<string, McpToolDefinition>;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-e4c-stand-in-'));
  const standIn = new BrowserStandIn();
  const bridge: BrowserBridge = new BrowserBridge({
    send: (request) => queueMicrotask(() => bridge.answer(request.requestId, standIn.answer({ appSessionId: A, ...request }))),
    cancel: () => {},
  });
  store = new MemoryDeliverableStore({});
  tools = new Map(browserTools({ bridge, deliverables: store, userData }).map((tool) => [tool.name, tool]));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

let n = 0;
const call = (tool: BrowserToolName, args: unknown) =>
  tools.get(tool)!.call(args, { appSessionId: A, cwd: '/nowhere', toolUseId: `toolu_${++n}` as ToolUseId, requestId: `mcp-${n}` as RequestId, signal: new AbortController().signal });
const json = (block: unknown) => JSON.parse((block as { text: string }).text) as Record<string, unknown>;

describe('the live browser recording’s stand-in (E4c Design §13)', () => {
  it('answers the recorded sequence as the real app would, and the host accepts every answer', async () => {
    const opened = await call('browser_tabs', { action: 'open', url: FORM_URL });
    expect(opened.isError).toBeUndefined();
    expect(json(opened.content[0])).toMatchObject({ action: 'open', tabId: TAB_ID, url: FORM_URL, tabs: [{ tabId: TAB_ID, control: 'agent' }] });

    const form = await call('browser_snapshot', { tabId: TAB_ID });
    expect(form.isError).toBeUndefined();
    expect(form.content).toHaveLength(2);
    expect(json(form.content[0])).toMatchObject({ refs: 11, truncated: false, omitted: null });
    expect((form.content[1] as { text: string }).text).toBe(FORM_SNAPSHOT);

    const fills = [await call('browser_act', { tabId: TAB_ID, action: 'fill', target: 'e7', value: 'Ada Lovelace' }), await call('browser_act', { tabId: TAB_ID, action: 'fill', target: 'e10', value: 'ada@example.test' })];
    expect(fills.map((r) => [r.isError, json(r.content[0]).target, json(r.content[0]).navigated])).toEqual([
      [undefined, { ref: 'e7', role: 'textbox', name: 'Name' }, false],
      [undefined, { ref: 'e10', role: 'textbox', name: 'Email' }, false],
    ]);
    const click = await call('browser_act', { tabId: TAB_ID, action: 'click', target: 'e12' });
    expect(json(click.content[0])).toMatchObject({ url: DONE_URL, title: DONE_TITLE, target: { ref: 'e12', role: 'button', name: 'Submit' }, navigated: true });

    const done = await call('browser_snapshot', { tabId: TAB_ID });
    expect((done.content[1] as { text: string }).text).toBe(DONE_SNAPSHOT);
    expect(DONE_SNAPSHOT).toContain('MAWS-7731');

    const shot = await call('browser_screenshot', { tabId: TAB_ID });
    expect(shot.isError).toBeUndefined();
    expect(shot.content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(shot.content[0]).toEqual({ type: 'image', data: GREEN_SQUARE_PNG, mimeType: 'image/png' });
    const result = json(shot.content[1]);
    expect(await store.list(A)).toEqual([expect.objectContaining({ id: result.deliverableId, kind: 'screenshot', sourceUrl: DONE_URL, title: DONE_TITLE })]);
  });

  it('refuses a tab id the recording never minted, as main does for another session’s tab', async () => {
    const result = await call('browser_snapshot', { tabId: 'b_0000000000ff' });
    expect(result.isError).toBe(true);
  });
});
