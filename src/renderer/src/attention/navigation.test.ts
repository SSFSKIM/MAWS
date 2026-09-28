import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { runAction } from '../keymap/actions-runtime';
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
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
  fake = fakeClient();
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
    useLayout.getState().openSession(idOf('Charter + research'), { split: true });
    expect(useLayout.getState().main.focusedPane).toBe(1);
    runAction('attention.next');
    expect(useLayout.getState().main.panes[1]?.activeTabId).toBe(`session:${idOf('Fix sidebar drag')}`);
  });

  it('does nothing when nothing needs you', () => {
    useAttention.setState({ bySession: new Map(), version: useAttention.getState().version + 1 });
    runAction('attention.next');
    expect(active()).toBe('overview');
  });
});

describe('attention.navigate', () => {
  it('opens the session’s tab and records the item for the transcript to jump to', () => {
    const appSessionId = idOf('Charter + research');
    fake.event('attention.navigate', { appSessionId, attentionId: 'att-1', source: 'notification' });
    expect(active()).toBe(`session:${appSessionId}`);
    expect(useLayout.getState().focusRequest).toEqual({ appSessionId, attentionId: 'att-1' });
  });

  it('with no item, opens the tab and records nothing to jump to', () => {
    const appSessionId = idOf('Quota reset recovery');
    fake.event('attention.navigate', { appSessionId, attentionId: null, source: 'menu' });
    expect(active()).toBe(`session:${appSessionId}`);
    expect(useLayout.getState().focusRequest).toBeNull();
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
});
