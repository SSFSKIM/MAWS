import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { resetShellStores } from '../test-support/shell-stores';
import { BudgetSheets } from './BudgetSheets';
import { resetBudgetStore, useBudget } from './store';

const TURN = 'app-turn' as AppSessionId;
const SLEEP = 'app-sleep' as AppSessionId;
const KERNEL = 'app-kernel' as AppSessionId;
const GiB = 1024 * 1024;
const state: BudgetState = {
  enabled: true, limitKiB: 2 * GiB, totalKiB: 3 * GiB, sampledAt: '2026-09-29T14:02:00.000Z', over: true, overWithoutCandidate: true, candidates: 0, settling: 0, releasing: null,
  blocked: [
    { appSessionId: TURN, reasons: ['turn'] },
    { appSessionId: SLEEP, reasons: ['background_tasks'] },
    { appSessionId: KERNEL, reasons: ['queued_messages', 'stateful_mcp'] },
  ],
  lastRelease: null,
};

let fake: FakeClient;
beforeEach(() => {
  resetShellStores();
  resetBudgetStore();
  fake = fakeClient({ 'session.stop': { exited: true, code: 0, signal: null } });
  const statuses = [
    status(TURN, { engineState: 'running', turn: humanTurn }),
    status(SLEEP, { backgroundTasks: [{ taskId: 'b1' as TaskId, taskType: 'local_bash', description: 'sleep 900', ambient: false }] }),
    status(KERNEL, { queue: { length: 1, paused: true }, mcpServers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }] }),
  ];
  useSessions.setState({
    records: new Map([TURN, SLEEP, KERNEL].map((id) => [id, record(id, { title: { text: `Session ${id.slice(4)}`, source: 'user' } })])),
    engine: new Map(statuses.map((s) => [s.appSessionId, s])),
  });
  useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V11, engine: { ...SETTINGS_DEFAULTS_V11.engine, statefulMcpServers: ['c12-kernel'] } }, resolvedTheme: 'light' } });
  useBudget.getState().apply(state);
});
afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
});

const mount = () => render(<BudgetSheets client={fake.client} />);

describe('the blocked sessions sheet and the stop sheet', () => {
  it('shows nothing until Review… opens it; then lists each session holding work with why, in words', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useBudget.getState().open({ kind: 'blocked' }));
    const list = screen.getByRole('list', { name: 'Sessions holding work' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Session turnmid-turnStop…',
      'Session sleep1 background taskStop…',
      'Session kernel1 queued message · stateful server c12-kernelStop…',
    ]);
    expect(screen.getByRole('dialog').textContent).toContain('MAWS is using 3 GB of its 2 GB memory budget');
  });

  it('Stop… shows C10’s disclosure first; Cancel stops nothing and goes back to the list', async () => {
    const user = userEvent.setup();
    mount();
    act(() => useBudget.getState().open({ kind: 'blocked' }));
    await user.click(within(screen.getByRole('listitem', { name: 'Session sleep' })).getByRole('button', { name: 'Stop…' }));
    const sheet = screen.getByRole('dialog', { name: 'Stop “Session sleep”?' });
    expect(within(sheet).getByRole('note').textContent).toBe('1 background task is still running and will be stopped:sleep 900');
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(fake.invoked('session.stop')).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'Sessions holding work' })).toBeTruthy();
  });

  it('Stop confirmed stops exactly that session with reason stop, and closes', async () => {
    const user = userEvent.setup();
    mount();
    act(() => useBudget.getState().open({ kind: 'stop', appSessionId: SLEEP }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(fake.invoked('session.stop')).toEqual([{ appSessionId: SLEEP, reason: 'stop' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // W7: the budget switched off in settings
  it('shows neither sheet while the host reports the budget off, and the switch going off closes an open one', () => {
    mount();
    act(() => useBudget.getState().open({ kind: 'blocked' }));
    expect(screen.getByRole('dialog', { name: 'Sessions holding work' })).toBeTruthy();
    act(() => useBudget.getState().apply({ ...state, enabled: false, over: false, overWithoutCandidate: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useBudget.getState().sheet).toBeNull();
    act(() => useBudget.getState().open({ kind: 'stop', appSessionId: SLEEP }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused stop says why and keeps the sheet', async () => {
    fake = fakeClient();
    const user = userEvent.setup();
    mount();
    act(() => useBudget.getState().open({ kind: 'stop', appSessionId: TURN }));
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await fake.fail('session.stop', 'unknown session');
    expect(screen.getByRole('dialog', { name: 'Stop “Session turn”?' }).textContent).toContain('unknown session');
  });
});
