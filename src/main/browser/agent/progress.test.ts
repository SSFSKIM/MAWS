import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { BrowserCall } from './handlers';
import { waitingReporter } from './progress';

const A = 'App-A' as AppSessionId;
const rid = (n: number) => `req-${n}` as RequestId;
const TAB = 'b_000000000001';

describe('waitingReporter (the host\'s paused deadline and the row\'s waiting line, Design §10)', () => {
  it('tells the host about a host request and the windows about every request, for the person and for a cover', () => {
    const dispatch = vi.fn(() => Promise.resolve({ ok: true }) as never);
    const emitted: unknown[] = [];
    const report = waitingReporter({ hosts: { dispatch }, emit: ((name: string, payload: unknown) => void emitted.push([name, payload])) as never, now: () => Date.parse('2026-10-07T00:00:00.000Z') });
    const call = { appSessionId: A, requestId: rid(9), toolUseId: 'toolu_1', tool: 'browser_act' } as unknown as BrowserCall;
    report(call, TAB, 'human', 'host');
    report(call, TAB, 'cover', 'host');
    report(call, TAB, null, 'seam');
    expect(dispatch.mock.calls).toEqual([
      ['engine-host', 'maws.browser.waiting', { appSessionId: A, requestId: rid(9), waiting: 'human' }],
      ['engine-host', 'maws.browser.waiting', { appSessionId: A, requestId: rid(9), waiting: 'cover' }],
    ]);
    expect(emitted).toEqual([
      ['maws.browser.progress', { appSessionId: A, toolUseId: 'toolu_1', tabId: TAB, tool: 'browser_act', waiting: 'human', since: '2026-10-07T00:00:00.000Z' }],
      ['maws.browser.progress', { appSessionId: A, toolUseId: 'toolu_1', tabId: TAB, tool: 'browser_act', waiting: 'cover', since: '2026-10-07T00:00:00.000Z' }],
      ['maws.browser.progress', { appSessionId: A, toolUseId: 'toolu_1', tabId: TAB, tool: 'browser_act', waiting: null, since: '2026-10-07T00:00:00.000Z' }],
    ]);
  });
});
