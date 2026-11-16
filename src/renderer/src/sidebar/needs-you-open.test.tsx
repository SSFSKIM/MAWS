// UX wave U1b M5 (the U1b document, Interfaces §E `showWaiting` and §I's row for `sidebar/NeedsYou.tsx`; the architect's
// ruling of 2026-11-15 on M5's open question): a Needs-you row opens its session its way and then goes to its request
// through the one way to a request from outside its transcript: its oldest item's when that item waits on an answer,
// else the session's oldest waiting request. A row of an owner-channel item opens at its mark and goes to no request.
// The session's transcript stands in as one mounted view, so the request each open shows is read where `show` is asked.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionId } from '@shared/graph/ids';
import { item } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import type { PreloadBridge } from '@shared/ipc/schema';
import { useAttention } from '../stores/attention';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { preloadOf } from '../test-support/preload-of';
import { Sidebar } from './Sidebar';

const shown: [string, AttentionId][] = [];
vi.mock('../transcript/view/waiting-view', async (original) => {
  const real = await original<typeof import('../transcript/view/waiting-view')>();
  return { ...real, waitingViewsOf: (key: string) => [{ show: (id: AttentionId) => (shown.push([key, id]), 'shown' as const) }] };
});

const nine = scenarioFile('nine-sessions');
const page = pageScenario(nine);
const idOf = (title: string) => page.sessions.find((r) => r.title.text === title)!.appId;
const pageItem = (...args: Parameters<typeof item>) => {
  const bare = item(...args);
  return { ...bare, id: at(bare.id), appSessionId: at(bare.appSessionId) };
};
const rowOf = (title: string) => within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button').find((b) => b.dataset.needsYou === idOf(title))!;

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  shown.length = 0;
  window.maws = preloadOf(fakeClient({ 'attention.request': () => ({ event: null }) }));
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('a Needs-you row’s open', () => {
  it('a click and a ⌘-click (a tab of its own) go to the row’s request, its oldest item’s', () => {
    const session = idOf('Fix sidebar drag');
    const oldest = useAttention.getState().bySession.get(session)!.find((i) => i.kind === 'permission')!;
    render(<Sidebar />);
    fireEvent.click(rowOf('Fix sidebar drag'));
    fireEvent.click(rowOf('Fix sidebar drag'), { metaKey: true });
    expect(shown).toEqual([
      [session, oldest.id],
      [session, oldest.id],
    ]);
  });

  it('a row whose oldest item waits on no answer names none, and reaches the session’s oldest waiting request', () => {
    const session = idOf('Fix sidebar drag');
    const failed = pageItem(session, 'error', '2026-09-01T00:00:00.000Z', { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const later = pageItem(session, 'permission', '2026-09-02T00:00:00.000Z');
    act(() => useAttention.getState().applyChanged({ appSessionId: session, items: [failed, later] }, TEST_MACHINE));
    render(<Sidebar />);
    fireEvent.click(rowOf('Fix sidebar drag'));
    expect(shown).toEqual([[session, later.id]]);
  });

  it('a row of an owner-channel item opens at its mark and goes to no request', () => {
    const session = idOf('Fix sidebar drag');
    const anchored = pageItem(session, 'async_input', '2026-09-01T00:00:00.000Z', {
      request: { requestId: null, toolUseId: null, taskId: null, agentId: null },
      summary: 'Which name should it take?',
      anchor: { messageUuid: 'msg-owner-1' as never, blockIndex: 0, span: 0 },
    });
    const later = pageItem(session, 'permission', '2026-09-02T00:00:00.000Z');
    act(() => useAttention.getState().applyChanged({ appSessionId: session, items: [anchored, later] }, TEST_MACHINE));
    render(<Sidebar />);
    fireEvent.click(rowOf('Fix sidebar drag'));
    fireEvent.click(rowOf('Fix sidebar drag'), { metaKey: true });
    expect(shown).toEqual([]);
  });
});
