import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { fakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { connectPluginToasts } from './plugin-toasts';

const nine = scenarioFile('nine-sessions');
const [shown, other] = nine.sessions.map((r) => r.appId);
const event = (n: number, payload: Record<string, unknown>) =>
  ({ id: `${shown}:L:${n}:0`, sessionId: 's', at: '2026-10-01T10:00:00.000Z', seq: n, agentId: null, parentToolUseId: null, ...payload }) as SessionEvent;
const toastOf = (n: number, text: string, timeoutMs = 4000) => event(n, { kind: 'plugin.toast', plugin: 'mods-probe', text, timeoutMs });

let fake: ReturnType<typeof fakeClient>;
let disconnect: () => void;
beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useNotices.setState({ notices: [] });
  useLayout.getState().openSession(shown!);
  fake = fakeClient();
  disconnect = connectPluginToasts(fake.client);
});
afterEach(() => disconnect());

describe('a plugin toast (R1)', () => {
  it('shows "<plugin>: <text>" for a session shown in a pane, dismissible, for the toast’s own time', () => {
    fake.event('session.eventBatch', { appSessionId: shown, events: [event(1, { kind: 'plugin.log', plugin: 'mods-probe', text: 'a log line' }), toastOf(2, 'MODS_PROBE_TOAST start', 2500)] });
    expect(useNotices.getState().notices).toEqual([
      { id: `plugin:${shown}:L:2:0`, kind: 'toast', level: 'info', text: 'mods-probe: MODS_PROBE_TOAST start', actions: [], dismissible: true, durationMs: 2500 },
    ]);
  });

  it('shows nothing for a session no pane of this window shows, and a repeated delivery replaces its toast in place', () => {
    fake.event('session.eventBatch', { appSessionId: other, events: [toastOf(1, 'elsewhere')] });
    expect(useNotices.getState().notices).toEqual([]);
    fake.event('session.eventBatch', { appSessionId: shown, events: [toastOf(3, 'once')] });
    fake.event('session.eventBatch', { appSessionId: shown, events: [toastOf(3, 'once')] });
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['mods-probe: once']);
  });

  it('stops listening once disconnected', () => {
    disconnect();
    fake.event('session.eventBatch', { appSessionId: shown, events: [toastOf(4, 'late')] });
    expect(useNotices.getState().notices).toEqual([]);
    disconnect = () => {};
  });
});
