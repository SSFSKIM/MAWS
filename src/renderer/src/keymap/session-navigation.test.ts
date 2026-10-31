import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { visibleSessionStep } from './session-navigation';

// P5 O6 M2: the rows render the page's ids, addresses
const [a, b, c] = [at('a'), at('b'), at('c')];

// P5 O7 M2: a lane B session on another machine is marked in this app's memory; its owner's record is never written
describe('the unread toggle', () => {
  it('marks a session on another machine in memory, and sends this Mac’s through session.update', async () => {
    const { addressOf } = await import('@shared/machine/address');
    const { OTHER_MACHINE } = await import('../../../../test/support/machine');
    const { fakeClient } = await import('../../../../test/support/fake-client');
    const { useSessions } = await import('../stores/sessions');
    const { resetRemoteReadMarks, useRemoteReadMarks } = await import('../lane-b/read-marks');
    const { setSessionUnread } = await import('./session-navigation');
    const remote = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useSessions.setState({ listed: new Map(), listedMachines: new Set([OTHER_MACHINE]) });
    const fake = fakeClient({ 'session.update': () => undefined });
    await setSessionUnread(remote, true, fake.client);
    expect(useRemoteReadMarks.getState().unread.get(remote)).toBe(true);
    expect(fake.invoked('session.update')).toEqual([]);
    void setSessionUnread(a as AppSessionId, true, fake.client);
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: a, patch: { unread: true } }]);
    resetRemoteReadMarks();
  });
});

describe('session stepping follows rendered sidebar rows', () => {
  it('walks Needs-you first, skips duplicate rows, and wraps across projects', () => {
    document.body.innerHTML = `<div data-testid="sidebar-tree"><button data-menu="session:${b}"></button><div data-menu="project:${at('p')}"></div><div data-menu="session:${a}"></div><div data-menu="session:${b}"></div><div data-menu="session:${c}"></div></div>`;
    expect(visibleSessionStep(b, 1)).toBe(a);
    expect(visibleSessionStep(a, -1)).toBe(b);
    expect(visibleSessionStep(c, 1)).toBe(b);
    expect(visibleSessionStep(null, -1)).toBe(c);
  });
  it('does not walk sessions outside the sidebar or invent a row when none is shown', () => {
    document.body.innerHTML = `<div data-menu="session:${at('outside')}"></div><div data-testid="sidebar-tree"></div>`;
    expect(visibleSessionStep(at('outside'), 1)).toBeNull();
  });
});

 it('keeps Cmd+Shift+T on one mixed most-recent-first closed history', async () => {
  const { ACTIONS } = await import('@shared/keymap/actions');
  const { registerShellActions } = await import('../app/shell-actions');
  const { runAction } = await import('./actions-runtime');
  const { useLayout } = await import('../stores/layout');
  const { activeTab } = await import('../stores/layout-model');
  const { resetShellStores } = await import('../test-support/shell-stores');
  resetShellStores();
  const off = registerShellActions();
  try {
    const layout = () => useLayout.getState();
    layout().openTab({ kind: 'file', path: '/work/readme.md', line: null, appSessionId: null, machine: TEST_MACHINE });
    layout().closeTab(activeTab(layout().main)!.id);
    layout().openSession(at('closed-session') as never);
    layout().closeTab(activeTab(layout().main)!.id);
    expect(ACTIONS['tab.reopen'].chord).toBe('Cmd+Shift+T');
    runAction('tab.reopen');
    expect(activeTab(layout().main)?.kind).toBe('session');
    runAction('tab.reopen');
    expect(activeTab(layout().main)?.kind).toBe('file');
  } finally { off(); resetShellStores(); }
 });
