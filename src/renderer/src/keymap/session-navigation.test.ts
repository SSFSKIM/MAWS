import { describe, expect, it } from 'vitest';
import { visibleSessionStep } from './session-navigation';

describe('session stepping follows rendered sidebar rows', () => {
  it('walks Needs-you first, skips duplicate rows, and wraps across projects', () => {
    document.body.innerHTML = `<div data-testid="sidebar-tree"><button data-menu="session:b"></button><div data-menu="project:p"></div><div data-menu="session:a"></div><div data-menu="session:b"></div><div data-menu="session:c"></div></div>`;
    expect(visibleSessionStep('b', 1)).toBe('a');
    expect(visibleSessionStep('a', -1)).toBe('b');
    expect(visibleSessionStep('c', 1)).toBe('b');
    expect(visibleSessionStep(null, -1)).toBe('c');
  });
  it('does not walk sessions outside the sidebar or invent a row when none is shown', () => {
    document.body.innerHTML = '<div data-menu="session:outside"></div><div data-testid="sidebar-tree"></div>';
    expect(visibleSessionStep('outside', 1)).toBeNull();
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
    layout().openTab({ kind: 'file', path: '/work/readme.md', line: null, appSessionId: null });
    layout().closeTab(activeTab(layout().main)!.id);
    layout().openSession('closed-session' as never);
    layout().closeTab(activeTab(layout().main)!.id);
    expect(ACTIONS['tab.reopen'].chord).toBe('Cmd+Shift+T');
    runAction('tab.reopen');
    expect(activeTab(layout().main)?.kind).toBe('session');
    runAction('tab.reopen');
    expect(activeTab(layout().main)?.kind).toBe('file');
  } finally { off(); resetShellStores(); }
 });
