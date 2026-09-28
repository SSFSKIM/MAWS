import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { digest, item, project, record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { createAttentionStore } from '../stores/attention';
import { createLayoutStore } from '../stores/layout';
import { createSessionsStore } from '../stores/sessions';
import { connectShell } from './events';

const A = 'a' as AppSessionId;

function setup() {
  const fake = fakeClient({ 'layout.list': { keys: ['main.tabs'] } , 'layout.get': ({ key }: { key: string }) => ({
    value: key === 'main.tabs'
      ? { ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [...LAYOUT_DEFAULTS.main.panes[0].tabs, { id: 'session:a', kind: 'session', appSessionId: 'a', pinned: false }, { id: 'session:gone', kind: 'session', appSessionId: 'gone', pinned: false }], activeTabId: 'overview' }] }
      : null,
  }) });
  const stores = { sessions: createSessionsStore(), attention: createAttentionStore(), layout: createLayoutStore() };
  const disconnect = connectShell(fake.client, stores);
  return { fake, stores, disconnect };
}

async function answerSnapshots(fake: ReturnType<typeof fakeClient>) {
  await fake.reply('session.list', { sessions: [record('a')], revision: 1 });
  await fake.reply('session.projects.list', { projects: [project('p1', 0)], revision: 1 });
  await fake.reply('session.digests', { digests: [digest('a')] });
  await fake.reply('attention.list', [item('a', 'permission', '2026-09-28T10:00:00Z')]);
}

describe('shell event subscription', () => {
  it('subscribes to every event the shell consumes before any snapshot command runs', () => {
    const { fake } = setup();
    const firstInvoke = fake.calls.findIndex((c) => c.startsWith('invoke'));
    const subscriptions = fake.calls.slice(0, firstInvoke);
    expect(subscriptions.sort()).toEqual(
      [
        'attention.changed', 'attention.notified', 'session.changed', 'session.digest', 'session.projects.changed', 'session.removed', 'session.status',
      ].map((n) => `on ${n}`),
    );
    expect(fake.calls.slice(firstInvoke).filter((c) => c.startsWith('on'))).toEqual([]);
  });

  it('loads the stores from the snapshots and hydrates the layout against the sessions that exist', async () => {
    const { fake, stores } = setup();
    expect(stores.sessions.getState().loaded).toBe(false);
    await answerSnapshots(fake);
    expect(stores.sessions.getState()).toMatchObject({ loaded: true });
    expect(stores.sessions.getState().records.has(A)).toBe(true);
    expect(stores.attention.getState().loaded).toBe(true);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
  });

  it('feeds events to the stores, buffering attention changes until its snapshot lands', async () => {
    const { fake, stores } = setup();
    fake.event('attention.changed', { appSessionId: 'a', items: [] });
    fake.event('session.digest', digest('a', { phase: 'working', revision: 9 }));
    await answerSnapshots(fake);
    expect(stores.attention.getState().bySession.get(A)).toEqual([]);
    expect(stores.sessions.getState().digests.get(A)?.phase).toBe('working');
  });

  it('closes a removed session’s tabs', async () => {
    const { fake, stores } = setup();
    await answerSnapshots(fake);
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('session.removed', { appSessionId: 'a', revision: 2 });
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview']);
    expect(stores.sessions.getState().records.has(A)).toBe(false);
  });

  it('keeps a session’s tabs when its removal is older than what the store knows', async () => {
    const { fake, stores } = setup();
    await answerSnapshots(fake); // session.list at revision 1
    await vi.waitFor(() => expect(stores.layout.getState().hydrated).toBe(true));
    fake.event('session.changed', { record: record('a'), cause: 'update', revision: 4 });
    fake.event('session.removed', { appSessionId: 'a', revision: 3 });
    expect(stores.sessions.getState().records.has(A)).toBe(true);
    expect(stores.layout.getState().main.panes[0].tabs.map((t) => t.id)).toEqual(['overview', 'session:a']);
  });

  it('ignores replies and events after disconnect', async () => {
    const { fake, stores, disconnect } = setup();
    disconnect();
    fake.event('session.digest', digest('a', { revision: 1 }));
    await answerSnapshots(fake);
    expect(stores.sessions.getState().records.size).toBe(0);
    expect(stores.sessions.getState().digests.size).toBe(0);
    expect(stores.attention.getState().loaded).toBe(false);
  });

  it('still loads when a snapshot command has no answerer, warning about it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fake, stores } = setup();
    await fake.fail('session.list', 'no main handler registered for session.list');
    await fake.reply('session.projects.list', { projects: [], revision: 0 });
    await fake.reply('session.digests', { digests: [] });
    await fake.fail('attention.list');
    expect(stores.sessions.getState().loaded).toBe(true);
    expect(stores.attention.getState().loaded).toBe(true);
    expect(warn.mock.calls.map(([line]) => line)).toEqual(['[shell] session.list unavailable; starting empty', '[shell] attention.list unavailable; starting empty']);
    warn.mockRestore();
  });
});
