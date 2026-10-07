import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { runAction } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { connectAttention } from './navigation';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const active = () => activeTab(useLayout.getState().main)?.id;
let fake: ReturnType<typeof fakeClient>;
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useNotices.setState({ notices: [] });
  fake = fakeClient({ 'attention.pendingNavigate': { navigate: null } });
  disconnect = connectAttention(fake.client);
});
afterEach(() => disconnect());

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

describe('the fallback toast', () => {
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

  // E11 (W-C; E10's crash screenshot; A-47): the toast names an item; once that item is no longer open (answered,
  // retired, or cleared with its dead host), the toast goes with it
  describe('leaves with its item', () => {
    const fix = () => nine.attention.find((a) => a.appSessionId === idOf('Fix sidebar drag'))!.items[0];
    const toasted = () => useNotices.getState().notices.map((n) => n.id);
    const notify = (item: AttentionItem) => fake.event('attention.notified', { appSessionId: item.appSessionId, attentionId: item.id, delivery: 'fallback', at: item.createdAt });

    it('a permission request answered: its item confirmed, the toast is dismissed', () => {
      const item = fix();
      expect(item.kind).toBe('permission');
      notify(item);
      expect(toasted()).toEqual([`attention:${item.id}`]);
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [{ ...item, state: 'delivered' }] }));
      expect(toasted()).toEqual([`attention:${item.id}`]); // delivered is still open
      act(() => useAttention.getState().applyChanged({ appSessionId: item.appSessionId, items: [{ ...item, state: 'confirmed' }] }));
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

it.each(['next', 'notification'] as const)('restores main when attention arrives through %s while the panel is maximized', (via) => {
  useLayout.getState().setPanel({ maximized: true, collapsed: false, width: 444 });
  if (via === 'next') runAction('attention.next');
  else fake.event('attention.navigate', { appSessionId: idOf('Fix sidebar drag'), attentionId: null, source: 'notification' });
  expect(active()).toBe(`session:${idOf('Fix sidebar drag')}`);
  expect(useLayout.getState().regions.panel).toEqual({ maximized: false, collapsed: false, width: 444 });
});
