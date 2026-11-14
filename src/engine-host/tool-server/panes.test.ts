import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import { PANE_ANSWER_MS } from '@shared/maws/panes';
import { SHOW_PANE_NOTES /* U12a */, TOOL_ERRORS } from '@shared/maws/tools';
import { PaneBridge, type PaneShowRequest } from './panes';

const terminal = { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } as const;
const req = (id: string, over: Partial<PaneShowRequest> = {}): PaneShowRequest => ({ requestId: id as RequestId, pane: 'terminal', target: null, line: null, ...over });

afterEach(() => vi.useRealTimers());

describe('the pane bridge (residue 3)', () => {
  it('asks the windows once and takes the first answer; a second is not_pending', async () => {
    const shown: PaneShowRequest[] = [];
    const bridge = new PaneBridge({ show: (r) => shown.push(r) });
    const answer = bridge.request(req('r1'), new AbortController().signal);
    expect(shown).toEqual([req('r1')]);
    expect(bridge.answer('r1' as RequestId, { ok: true, opened: terminal })).toBe('delivered');
    expect(bridge.answer('r1' as RequestId, { ok: true, opened: terminal })).toBe('not_pending');
    expect(await answer).toEqual({ status: 'shown', pane: 'terminal', opened: terminal });
  });

  it("relays a window's refusal word for word", async () => {
    const bridge = new PaneBridge({ show: () => {} });
    const answer = bridge.request(req('r1', { pane: 'artifact', target: 'd1' }), new AbortController().signal);
    bridge.answer('r1' as RequestId, { ok: false, error: TOOL_ERRORS.paneUnavailable('artifact') });
    expect(await answer).toEqual({ error: 'show_pane: the artifact pane is not available in this build of MAWS' });
  });

  it('turns silence into the timeout error after PANE_ANSWER_MS', async () => {
    vi.useFakeTimers();
    const bridge = new PaneBridge({ show: () => {} });
    let settled: unknown = null;
    void bridge.request(req('r1'), new AbortController().signal).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(PANE_ANSWER_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ error: TOOL_ERRORS.paneTimeout });
    expect(bridge.answer('r1' as RequestId, { ok: true, opened: terminal })).toBe('not_pending');
  });

  it('settles a withdrawn request and every request at exit; a late answer is not_pending', async () => {
    const bridge = new PaneBridge({ show: () => {} });
    const controller = new AbortController();
    const withdrawn = bridge.request(req('r1'), controller.signal);
    const atExit = bridge.request(req('r2'), new AbortController().signal);
    expect(bridge.pending).toBe(2);
    controller.abort();
    expect(await withdrawn).toEqual({ error: 'show_pane: the request was withdrawn' });
    bridge.processExited();
    expect(await atExit).toEqual({ error: 'show_pane: the session ended' });
    expect(bridge.pending).toBe(0);
    expect(bridge.answer('r2' as RequestId, { ok: true, opened: terminal })).toBe('not_pending');
    const aborted = new AbortController();
    aborted.abort();
    expect(await bridge.request(req('r3'), aborted.signal)).toEqual({ error: 'show_pane: the request was withdrawn' });
  });

  it('fails at once with appNotOpen when no client is connected, asking no window (E10)', async () => {
    const shown: PaneShowRequest[] = [];
    const bridge = new PaneBridge({ show: (r) => shown.push(r), hasClient: () => false });
    expect(await bridge.request(req('r1'), new AbortController().signal)).toEqual({ error: TOOL_ERRORS.appNotOpen('show_pane') });
    expect(TOOL_ERRORS.appNotOpen('show_pane')).toBe('show_pane: MAWS is not open; the pane cannot be shown');
    expect(shown).toEqual([]);
    expect(bridge.pending).toBe(0);
  });
});

// U12a (M1; Interfaces §A, ruling R8): a browser answer carries the window's `page` and, in a session launched with a
// browser backend, the note that matches it, written here; the keys in the order the agent reads them.
describe('the pane bridge’s browser answer (U12a)', () => {
  const browser = { kind: 'panel-tool', toolId: 'browser', tabId: 'browser:1', title: 'Browser' } as const;
  const asked = (inAppBrowser: boolean | undefined, result: Parameters<PaneBridge['answer']>[1], over: Partial<PaneShowRequest> = { pane: 'browser', target: 'https://a.test/' }) => {
    const bridge = new PaneBridge({ show: () => {}, ...(inAppBrowser !== undefined && { inAppBrowser }) });
    const answer = bridge.request(req('r1', over), new AbortController().signal);
    bridge.answer('r1' as RequestId, result);
    return answer;
  };

  it('with a backend: page and the note, browserKept for a kept page and browser otherwise, in the order status, pane, opened, page, note', async () => {
    for (const page of ['opened', 'reloaded'] as const) {
      const answer = await asked(true, { ok: true, opened: browser, page });
      expect(JSON.stringify(answer)).toBe(JSON.stringify({ status: 'shown', pane: 'browser', opened: browser, page, note: SHOW_PANE_NOTES.browser }));
    }
    expect(JSON.stringify(await asked(true, { ok: true, opened: browser, page: 'kept' }))).toBe(JSON.stringify({ status: 'shown', pane: 'browser', opened: browser, page: 'kept', note: SHOW_PANE_NOTES.browserKept }));
  });

  it('with a backend and no page (no target, or a window of another build): the browser note alone', async () => {
    expect(JSON.stringify(await asked(true, { ok: true, opened: browser }, { pane: 'browser', target: null }))).toBe(JSON.stringify({ status: 'shown', pane: 'browser', opened: browser, note: SHOW_PANE_NOTES.browser }));
  });

  it('without a backend (or not told): page and no note', async () => {
    expect(await asked(false, { ok: true, opened: browser, page: 'reloaded' })).toEqual({ status: 'shown', pane: 'browser', opened: browser, page: 'reloaded' });
    expect(await asked(undefined, { ok: true, opened: browser, page: 'kept' })).toEqual({ status: 'shown', pane: 'browser', opened: browser, page: 'kept' });
  });

  it('another pane’s answer has neither; a refusal reaches the agent as the tool’s error', async () => {
    expect(await asked(true, { ok: true, opened: terminal }, { pane: 'terminal' })).toEqual({ status: 'shown', pane: 'terminal', opened: terminal });
    expect(await asked(true, { ok: false, error: TOOL_ERRORS.browserOpenFailed('https://a.test/', 'unknown session') })).toEqual({ error: 'show_pane: MAWS could not open "https://a.test/" in its browser: unknown session' });
  });
});
