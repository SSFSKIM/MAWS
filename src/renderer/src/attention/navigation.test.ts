import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, RequestId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { fakeClient } from '../../../../test/support/fake-client';
import { runAction } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { registerFocusTarget, resetComposerStore, useComposerStore } from '../stores/composer';
import { hideSideChild, showSideChild } from '../side/store';
import { hideCardThread, showCardThread } from '../side/card/store'; // P2-E1
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { applyAskEvents, resetAskSheets } from '../tools/maws/ask/store';
import { closeCard, floatSplit, useFloatingCard } from '../shell/floating'; // P4-B3
import { connectAttention } from './navigation';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const active = () => activeTab(useLayout.getState().main)?.id;
let fake: ReturnType<typeof fakeClient>;
let disconnect: () => void;
const showSurface = (appSessionId: AppSessionId, toolId: string) => {
  const tab = { id: `${toolId}:probe`, toolId, pinned: false };
  useLayout.getState().setPanelTabs(appSessionId, { tabs: [...useLayout.getState().effectivePanelTabs(appSessionId), tab], activeTabId: tab.id });
  return tab.id;
};

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  fillStores(nine);
  useNotices.setState({ notices: [] });
  fake = fakeClient({ 'attention.pendingNavigate': { navigate: null } });
  disconnect = connectAttention(fake.client);
});
afterEach(() => {
  disconnect();
  resetAskSheets();
  useFloatingCard.setState({ closed: false }); // P4-B3
});

// A blocking `maws` ask's originating event (what the Question sheet's store follows and `attention.request` answers).
const askOpened = (requestId: string): SessionEvent =>
  ({ id: `ev-${requestId}`, sessionId: 'eng', at: '2026-09-28T10:00:00Z', seq: 1, agentId: null, parentToolUseId: null, kind: 'maws.ask.opened', askId: `ask-${requestId}`, toolUseId: null, requestId, blocking: true, title: 'Setup', context: null, questions: [] }) as unknown as SessionEvent;

describe('⌘⇧J (attention.next)', () => {
  it('opens the oldest Needs-you session’s tab in the focused pane, then the next one from there', () => {
    runAction('attention.next');
    expect(active()).toBe(`session:${idOf('Fix sidebar drag')}`);
    runAction('attention.next');
    expect(active()).toBe(`session:${idOf('Sidebar interaction pass')}`);
  });

  it('opens into the focused pane of a split', () => {
    useLayout.getState().openSession(idOf('Settings idle probe')); // the left pane's tab (an empty pane takes a split's tab itself)
    useLayout.getState().openSession(idOf('Charter + research'), { split: true });
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(1);
    runAction('attention.next');
    expect(currentSet(useLayout.getState().main).panes[1]?.activeTabId).toBe(`session:${idOf('Fix sidebar drag')}`);
  });

  it('does nothing when nothing needs you', () => {
    useAttention.setState({ bySession: new Map(), version: useAttention.getState().version + 1 });
    runAction('attention.next');
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main); // still the empty pane: no tab opened
  });
});

describe('attention.navigate', () => {
  it('opens the session’s tab, with an item or without', () => {
    const appSessionId = idOf('Charter + research');
    fake.event('attention.navigate', { appSessionId, attentionId: 'att-1', source: 'notification' });
    expect(active()).toBe(`session:${appSessionId}`);
    const other = idOf('Quota reset recovery');
    fake.event('attention.navigate', { appSessionId: other, attentionId: null, source: 'menu' });
    expect(active()).toBe(`session:${other}`);
  });
});

describe('a navigation queued while no page could hear it (attention.pendingNavigate)', () => {
  it('subscribes first, then asks once; a late answer still opens the session', async () => {
    disconnect();
    const late = fakeClient();
    disconnect = connectAttention(late.client);
    const calls = late.calls.filter((c) => c.includes('attention.navigate') || c.includes('attention.pendingNavigate'));
    expect(calls).toEqual(['on attention.navigate', 'invoke attention.pendingNavigate']);
    const appSessionId = idOf('Quota reset recovery');
    await late.reply('attention.pendingNavigate', { navigate: { appSessionId, attentionId: 'att-q', source: 'notification' } });
    expect(active()).toBe(`session:${appSessionId}`);
  });

  it('an empty answer opens nothing', async () => {
    disconnect();
    const late = fakeClient();
    disconnect = connectAttention(late.client);
    await late.reply('attention.pendingNavigate', { navigate: null });
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main); // still the empty pane: no tab opened
  });
});

describe('failed notification actions', () => {
  it('retains an unsent reply after dismissing its error and adds it to the restored draft without replacing it', async () => {
    const appSessionId = idOf('Charter + research');
    fake.event('attention.notified', { appSessionId, attentionId: null, delivery: 'in-app', at: '2026-10-23T00:00:00Z', error: 'Session unavailable', reply: 'Continue with the next task' });
    const [notice] = useNotices.getState().notices;
    expect(notice).toMatchObject({ level: 'danger', text: expect.stringContaining('Session unavailable') });
    useNotices.getState().dismiss(notice.id);
    expect(useComposerStore.getState().attachmentQueue.get(appSessionId)).toEqual([{ files: [], text: 'Continue with the next task' }]);
    let draft = 'Existing draft';
    const off = registerFocusTarget(appSessionId, {
      focusEditor() {}, focusFrame() {}, attachFiles: async () => true,
      insertText: (text, options) => { draft += `${options?.separated ? ' ' : ''}${text}`; },
    });
    try {
      await vi.waitFor(() => expect(draft).toBe('Existing draft Continue with the next task'));
      expect(useComposerStore.getState().attachmentQueue.has(appSessionId)).toBe(false);
      expect(useComposerStore.getState().prefills.has(appSessionId)).toBe(false);
    } finally { off(); }
  });
});

describe('the fallback toast', () => {
  it('uses the complete layout for the floating card and toasts only once that card closes', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const notify = () => fake.event('attention.notified', { appSessionId: fix.appSessionId, attentionId: fix.id, delivery: 'fallback', at: fix.createdAt });
    useLayout.getState().openSession(fix.appSessionId);
    showSurface(fix.appSessionId, 'terminal');
    useLayout.getState().setPanel({ floating: true });
    notify();
    expect(useNotices.getState().notices).toEqual([]);
    closeCard();
    notify();
    expect(useNotices.getState().notices.map((notice) => notice.id)).toEqual([`attention:${fix.id}`]);
  });

  it('counts the remembered context’s top Side slot while another tool is active, but not once that slot hides', () => {
    const parent = idOf('Fix sidebar drag');
    const child = idOf('Quota reset recovery');
    const item = nine.attention.find((a) => a.appSessionId === child)!.items[0];
    const notify = () => fake.event('attention.notified', { appSessionId: child, attentionId: item.id, delivery: 'fallback', at: item.createdAt });
    useLayout.getState().openSession(parent);
    showSurface(parent, 'side');
    const terminal = showSurface(parent, 'terminal');
    useLayout.getState().openTab({ kind: 'artifact', artifactId: 'doc' });
    showSideChild(parent, child);
    try {
      notify();
      expect(useNotices.getState().notices).toEqual([]);
      useLayout.getState().setSurfaceStack(parent, [terminal]);
      notify();
      expect(useNotices.getState().notices.map((notice) => notice.id)).toEqual([`attention:${item.id}`]);
    } finally { hideSideChild(parent, child); }
  });

  it('counts an Ask sheet in either slot rather than any open panel', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const question: AttentionItem = { ...fix, id: 'att-stacked-ask' as AttentionId, kind: 'question', request: { ...fix.request, requestId: 'req-stacked' as RequestId } };
    act(() => useAttention.getState().applyChanged({ appSessionId: fix.appSessionId, items: [question] }));
    applyAskEvents(fix.appSessionId, [askOpened('req-stacked')]);
    useLayout.getState().openSession(fix.appSessionId);
    showSurface(fix.appSessionId, ASK_SHEET_TOOL_ID);
    const terminal = showSurface(fix.appSessionId, 'terminal');
    useLayout.getState().openTab({ kind: 'file', path: '/p/a.ts', line: null, appSessionId: fix.appSessionId });
    const notify = () => fake.event('attention.notified', { appSessionId: question.appSessionId, attentionId: question.id, delivery: 'fallback', at: question.createdAt });
    notify();
    expect(useNotices.getState().notices).toEqual([]);
    useLayout.getState().setSurfaceStack(fix.appSessionId, [terminal]);
    notify();
    expect(useNotices.getState().notices.map((notice) => notice.id)).toEqual([`attention:${question.id}`]);
  });

  it('reads "<title> needs you · <summary>" when delivery falls back, and its action opens the session', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    fake.event('attention.notified', { appSessionId: fix.appSessionId, attentionId: fix.id, delivery: 'fallback', at: fix.createdAt });
    const [toast] = useNotices.getState().notices;
    expect(toast).toMatchObject({ kind: 'toast', text: `Fix sidebar drag needs you · ${fix.summary}`, dismissible: true });
    toast.actions[0].run();
    expect(active()).toBe(`session:${fix.appSessionId}`);
  });

  it('posts no toast when the OS delivered the notification', () => {
    fake.event('attention.notified', { appSessionId: idOf('Fix sidebar drag'), attentionId: 'att-x' as AttentionId, delivery: 'os', at: '2026-09-28T10:00:00Z' });
    expect(useNotices.getState().notices).toEqual([]);
  });

  // E11 (W-C; E1's live sitting): the session in front of the reader shows its own request (the docked card, or the
  // Question sheet E1 opens for the shown session), so a toast would only cover the panel's action bar
  it('posts no toast for the shown session, and still one for another session', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const plan = nine.attention.find((a) => a.appSessionId === idOf('Quota reset recovery'))!.items[0];
    useLayout.getState().openSession(fix.appSessionId);
    fake.event('attention.notified', { appSessionId: fix.appSessionId, attentionId: fix.id, delivery: 'fallback', at: fix.createdAt });
    expect(useNotices.getState().notices).toEqual([]);
    fake.event('attention.notified', { appSessionId: plan.appSessionId, attentionId: plan.id, delivery: 'fallback', at: plan.createdAt });
    expect(useNotices.getState().notices.map((n) => n.id)).toEqual([`attention:${plan.id}`]);
    useLayout.getState().openTab({ kind: 'file', path: '/p/a.ts', line: null, appSessionId: fix.appSessionId }); // the docked card is not in a file tab
    fake.event('attention.notified', { appSessionId: fix.appSessionId, attentionId: fix.id, delivery: 'fallback', at: fix.createdAt });
    expect(useNotices.getState().notices.map((n) => n.id)).toEqual([`attention:${plan.id}`, `attention:${fix.id}`]);
  });

  // P4-B3 (its Decision Log 11): a pane that yielded into the split's card keeps its tab active, but the request shows
  // only in the card: on screen while the card is open, not behind its pill
  it('counts the split’s card: its session’s request is on screen while the card is open, not behind the pill', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const notify = () => fake.event('attention.notified', { appSessionId: fix.appSessionId, attentionId: fix.id, delivery: 'fallback', at: fix.createdAt });
    useLayout.getState().openSession(fix.appSessionId);
    useLayout.getState().openTab({ kind: 'diagnostics' }, { pane: 1 });
    floatSplit(`session:${fix.appSessionId}`);
    notify();
    expect(useNotices.getState().notices).toEqual([]);
    closeCard();
    notify();
    expect(useNotices.getState().notices.map((n) => n.id)).toEqual([`attention:${fix.id}`]);
  });

  // W-C review m1: a maximized panel covers the main region, so a session tab in front there shows nothing; an ask's
  // surface is the panel's Question sheet, which E1 opens for the shown session (a file tab of it counts)
  it('counts the panel: a maximized one hides the session tab’s card; an open one shows the shown session’s Question sheet', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const question: AttentionItem = { ...fix, id: 'att-ask' as AttentionId, kind: 'question', request: { ...fix.request, requestId: 'req-ask' as RequestId } };
    act(() => useAttention.getState().applyChanged({ appSessionId: fix.appSessionId, items: [fix, question] }));
    applyAskEvents(fix.appSessionId, [askOpened('req-ask')]); // a maws ask: the Question sheet's store holds it
    const notify = (item: AttentionItem) => fake.event('attention.notified', { appSessionId: item.appSessionId, attentionId: item.id, delivery: 'fallback', at: item.createdAt });
    const toasted = () => useNotices.getState().notices.map((n) => n.id);
    useLayout.getState().openSession(fix.appSessionId);
    showSurface(fix.appSessionId, ASK_SHEET_TOOL_ID);
    useLayout.getState().setPanel({ maximized: true, collapsed: false });
    notify(fix); // the docked card is under the maximized panel
    expect(toasted()).toEqual([`attention:${fix.id}`]);
    notify(question); // the Question sheet is in the panel, in front
    expect(toasted()).toEqual([`attention:${fix.id}`]);
    useNotices.setState({ notices: [] });
    useLayout.getState().setPanel({ maximized: false });
    useLayout.getState().openTab({ kind: 'file', path: '/p/a.ts', line: null, appSessionId: fix.appSessionId });
    notify(question); // a file tab of the session shows its sheet in the open panel
    expect(toasted()).toEqual([]);
    notify(fix); // but not its docked card
    expect(toasted()).toEqual([`attention:${fix.id}`]);
    useLayout.getState().setPanel({ collapsed: true });
    notify(question); // a collapsed panel shows no sheet
    expect(toasted()).toEqual([`attention:${fix.id}`, `attention:${question.id}`]);
  });

  // scale-review C scalpel-3#1: only a `maws` ask is on the panel's Question sheet; the engine's AskUserQuestion is a
  // `question` item too, but its card docks in the session's own composer, so the open panel does not show it
  it('an engine AskUserQuestion is not on the panel: a file tab of its session in front still toasts; a maws ask read as one does not', () => {
    const fix = nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const engineAsk: AttentionItem = { ...fix, id: 'att-auq' as AttentionId, kind: 'question', request: { ...fix.request, requestId: 'req-auq' as RequestId } };
    const mawsAsk: AttentionItem = { ...fix, id: 'att-maws' as AttentionId, kind: 'question', request: { ...fix.request, requestId: 'req-maws' as RequestId } };
    act(() => useAttention.getState().applyChanged({ appSessionId: fix.appSessionId, items: [fix, engineAsk, mawsAsk] }));
    useAttention.setState({ requests: new Map([[engineAsk.id, { ...askOpened('req-auq'), kind: 'question.requested' } as unknown as SessionEvent], [mawsAsk.id, askOpened('req-maws')]]) });
    const notify = (item: AttentionItem) => fake.event('attention.notified', { appSessionId: item.appSessionId, attentionId: item.id, delivery: 'fallback', at: item.createdAt });
    useLayout.getState().openSession(fix.appSessionId);
    showSurface(fix.appSessionId, ASK_SHEET_TOOL_ID);
    useLayout.getState().setPanel({ maximized: false, collapsed: false });
    useLayout.getState().openTab({ kind: 'file', path: '/p/a.ts', line: null, appSessionId: fix.appSessionId });
    notify(engineAsk);
    notify(mawsAsk); // its originating event read as `maws.ask.opened`, as swapOf reads it
    expect(useNotices.getState().notices.map((n) => n.id)).toEqual([`attention:${engineAsk.id}`]);
  });

  // scale-review C scalpel-2#3: a side thread drawn in its parent's Side pane is its whole session pane, docked card and
  // all, as visibility.ts counts it, so its request is on screen while the panel is open
  it('posts no toast for a thread drawn in the open Side pane, and one once the panel is collapsed or the thread hidden', () => {
    const parent = idOf('Fix sidebar drag');
    const child = idOf('Quota reset recovery') as AppSessionId;
    const item = nine.attention.find((a) => a.appSessionId === child)!.items[0];
    const notify = () => fake.event('attention.notified', { appSessionId: child, attentionId: item.id, delivery: 'fallback', at: item.createdAt });
    const toasted = () => useNotices.getState().notices.map((n) => n.id);
    useLayout.getState().openSession(parent);
    showSurface(parent, 'side');
    useLayout.getState().setPanel({ maximized: false, collapsed: false });
    showSideChild(parent, child);
    try {
      notify();
      expect(toasted()).toEqual([]);
      useLayout.getState().setPanel({ collapsed: true });
      notify();
      expect(toasted()).toEqual([`attention:${item.id}`]);
      useNotices.setState({ notices: [] });
      useLayout.getState().setPanel({ collapsed: false });
      hideSideChild(parent, child);
      notify();
      expect(toasted()).toEqual([`attention:${item.id}`]);
    } finally {
      hideSideChild(parent, child);
    }
  });

  // P2-E1: a thread a comment card shows draws its requests inline (C7's card in the card's thread), so its request is
  // on screen while the card publishes it, whatever the panel shows; once the card closes, a toast again
  it('posts no toast for a thread a comment card shows, and one once the card closes', () => {
    const parent = idOf('Fix sidebar drag');
    const child = idOf('Quota reset recovery') as AppSessionId;
    const item = nine.attention.find((a) => a.appSessionId === child)!.items[0];
    const notify = () => fake.event('attention.notified', { appSessionId: child, attentionId: item.id, delivery: 'fallback', at: item.createdAt });
    const toasted = () => useNotices.getState().notices.map((n) => n.id);
    useLayout.getState().setPanel({ collapsed: true });
    showCardThread(parent, child);
    try {
      notify();
      expect(toasted()).toEqual([]);
      hideCardThread(child);
      notify();
      expect(toasted()).toEqual([`attention:${item.id}`]);
    } finally {
      hideCardThread(child);
    }
  });

  // E11 (W-C; E10's crash screenshot; A-47): the toast names an item; once that item is no longer open (answered,
  // retired, or cleared with its dead host), the toast goes with it
  describe('leaves with its item', () => {
    const fix = () => nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const toasted = () => useNotices.getState().notices.map((n) => n.id);
    const notify = (item: AttentionItem) => fake.event('attention.notified', { appSessionId: item.appSessionId, attentionId: item.id, delivery: 'fallback', at: item.createdAt });

    // W-C review m2: main lists only pending and delivered items (attention/service.ts drops the rest), so an answered
    // request reaches the page as its item leaving the session's list
    it('a permission request answered: its item, held in the list, leaves it and the toast is dismissed', () => {
      const item = fix();
      expect(item.kind).toBe('permission');
      notify(item);
      expect(toasted()).toEqual([`attention:${item.id}`]);
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [{ ...item, state: 'delivered' }] }));
      expect(toasted()).toEqual([`attention:${item.id}`]); // delivered is still open
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [] })); // answered: main lists it no more
      expect(toasted()).toEqual([]);
    });

    it('its item cleared with a dead host (gone from the list), or retired, while another toast stays', () => {
      const item = fix();
      const plan = nine.attention.find((a) => a.appSessionId === idOf('Quota reset recovery'))!.items[0];
      notify(item);
      notify(plan);
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [] }));
      expect(toasted()).toEqual([`attention:${plan.id}`]);
      act(() => useAttention.getState().applyChanged({ appSessionId: plan.appSessionId, items: [{ ...plan, state: 'retired' }] }));
      expect(toasted()).toEqual([]);
    });

    it('an item the page’s list does not hold yet keeps its toast until it has been seen open and then leaves', () => {
      const item = { ...fix(), id: 'att-late' as AttentionId };
      notify(item);
      act(() => useAttention.getState().applyChanged({ appSessionId: idOf('Quota reset recovery'), items: [] })); // another session's change
      expect(toasted()).toEqual([`attention:${item.id}`]);
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [fix(), item] }));
      expect(toasted()).toEqual([`attention:${item.id}`]);
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [fix()] }));
      expect(toasted()).toEqual([]);
    });

    it('an item already settled when its notice arrives raises no toast', () => {
      const item = fix();
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [{ ...item, state: 'retired' }] }));
      notify(item);
      expect(toasted()).toEqual([]);
    });
  });
});

// P3-G (§D1.2, the table's last row): a floating panel docks the same way.
it.each([
  ['next', 'maximized'],
  ['notification', 'maximized'],
  ['next', 'floating'],
  ['notification', 'floating'],
] as const)('restores main when attention arrives through %s while the panel is %s', (via, state) => {
  const idle = idOf('Settings idle probe');
  useLayout.getState().openSession(idle);
  showSurface(idle, 'terminal');
  useLayout.getState().setPanel({ [state]: true, collapsed: false, width: 444 });
  if (via === 'next') runAction('attention.next');
  else fake.event('attention.navigate', { appSessionId: idOf('Fix sidebar drag'), attentionId: null, source: 'notification' });
  expect(active()).toBe(`session:${idOf('Fix sidebar drag')}`);
  expect(useLayout.getState().regions.panel).toEqual({ maximized: false, floating: false, collapsed: false, width: 444 });
});
