import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { machineKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { useMachines } from '../stores/machines';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import {
  createSession,
  currentRow,
  enabledActions,
  focusedProject,
  isActionEnabled,
  isSessionCreatorRegistered,
  registerAction,
  registerSessionCreator,
  runAction,
  sessionRow,
} from './actions-runtime';
import { connectActions } from './dispatcher';
import { currentSet } from '../stores/layout-model';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const disposers: (() => void)[] = [];
const register = (...args: Parameters<typeof registerAction>) => {
  const off = registerAction(...args);
  disposers.push(off);
  return off;
};

describe('action runtime', () => {
  afterEach(() => disposers.splice(0).forEach((off) => off()));

  it('runs the registered handler with its arg, and an unregistered action is a no-op', () => {
    const handler = vi.fn();
    register('tab.select', handler);
    runAction('tab.select', 3);
    runAction('panel.toggle');
    expect(handler).toHaveBeenCalledWith(3);
    expect(isActionEnabled('tab.select')).toBe(true);
    expect(isActionEnabled('panel.toggle')).toBe(false);
  });

  it('passes a null arg when none is given', () => {
    const handler = vi.fn();
    register('sidebar.toggle', handler);
    runAction('sidebar.toggle');
    expect(handler).toHaveBeenCalledWith(null);
  });

  it('the last registration wins, and an older disposer leaves the newer handler in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = register('panel.toggle', first);
    register('panel.toggle', second);
    offFirst();
    runAction('panel.toggle');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('logs a failed handler instead of throwing into the caller', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    register('panel.toggle', () => Promise.reject(new Error('boom')));
    register('sidebar.toggle', () => {
      throw new Error('sync boom');
    });
    expect(() => runAction('panel.toggle')).not.toThrow();
    expect(() => runAction('sidebar.toggle')).not.toThrow();
    await settle();
    expect(error.mock.calls.map(([line]) => line)).toEqual(['[actions] sidebar.toggle failed', '[actions] panel.toggle failed']);
    error.mockRestore();
  });
});

describe('menu actions reach the page', () => {
  afterEach(() => disposers.splice(0).forEach((off) => off()));

  it('runs the action a layout.action event names', () => {
    const fake = fakeClient({ 'layout.setEnabledActions': undefined });
    const handler = vi.fn();
    register('tab.select', handler);
    const off = connectActions(fake.client);
    fake.event('layout.action', { action: 'tab.select', arg: 2 });
    expect(handler).toHaveBeenCalledWith(2);
    off();
    fake.event('layout.action', { action: 'tab.select', arg: 5 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports the enabled set to main at connect and once per burst of registrations', async () => {
    const fake = fakeClient({ 'layout.setEnabledActions': undefined });
    register('sidebar.toggle', vi.fn());
    const off = connectActions(fake.client);
    await settle();
    expect(fake.invoked('layout.setEnabledActions')).toEqual([{ actions: ['sidebar.toggle'] }]);
    const offPanel = register('panel.toggle', vi.fn());
    register('panel.maximize', vi.fn());
    await settle();
    expect(fake.invoked('layout.setEnabledActions').at(-1)).toEqual({ actions: ['sidebar.toggle', 'panel.toggle', 'panel.maximize'] });
    expect(fake.invoked('layout.setEnabledActions')).toHaveLength(2);
    offPanel();
    await settle();
    expect(fake.invoked('layout.setEnabledActions').at(-1)).toEqual({ actions: ['sidebar.toggle', 'panel.maximize'] });
    expect(enabledActions()).toEqual(['sidebar.toggle', 'panel.maximize']);
    off();
    register('theme.dark', vi.fn());
    await settle();
    expect(fake.invoked('layout.setEnabledActions')).toHaveLength(3);
  });
});

describe('session creator', () => {
  const P = 'proj-maws' as ProjectId;
  const NEW = 'app-new-1' as AppSessionId;
  afterEach(() => {
    disposers.splice(0).forEach((off) => off());
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useSessions.setState({ unstarted: new Map() });
    resetComposerStore(); // W9 (H3): no focus mark outlives its case
  });

  it('is unavailable until a creator registers, and createSession then does nothing', async () => {
    expect(isSessionCreatorRegistered()).toBe(false);
    await createSession(P);
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main);
  });

  it('asks the creator, records the unstarted session with its project and opens its tab in the focused pane', async () => {
    const creator = vi.fn(async () => NEW);
    disposers.push(registerSessionCreator(creator));
    expect(isSessionCreatorRegistered()).toBe(true);
    await expect(createSession(P)).resolves.toBe(NEW); // C12: the id, for the Worktrees… dialog's location
    expect(creator).toHaveBeenCalledWith(P);
    expect(useSessions.getState().unstarted.get(NEW)).toEqual({ projectId: P, createdAt: expect.any(String) });
    const pane = currentSet(useLayout.getState().main).panes[0];
    expect(pane.tabs.map((t) => t.id)).toEqual([`session:${NEW}`]);
    expect(pane.activeTabId).toBe(`session:${NEW}`);
  });

  // W9 (H3): every entry point (the strip's "+", the sidebar's New chat and "+", ⌘N, the Overview, the empty pane) comes
  // through here, so the new tab's composer frame takes the keyboard when it mounts: once, and not for another session
  it('marks the new tab so its composer takes the focus as it registers, once', async () => {
    disposers.push(registerSessionCreator(async () => NEW));
    await createSession(P);
    const target = () => ({ focusEditor: vi.fn(), focusFrame: vi.fn(), insertText: vi.fn() });
    const other = target();
    disposers.push(registerFocusTarget('app-other' as AppSessionId, other));
    expect(other.focusFrame).not.toHaveBeenCalled();
    const mounted = target();
    disposers.push(registerFocusTarget(NEW, mounted));
    expect(mounted.focusFrame).toHaveBeenCalledTimes(1); // the frame: a docked card there would take it first
    expect(mounted.focusEditor).not.toHaveBeenCalled();
    const remounted = target();
    disposers.push(registerFocusTarget(NEW, remounted)); // a later mount (a tab switch back) leaves the focus alone
    expect(remounted.focusFrame).not.toHaveBeenCalled();
  });

  it('opens nothing when the creator declines, and logs a creator that fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    disposers.push(registerSessionCreator(async () => null));
    await expect(createSession(null)).resolves.toBeNull(); // C12: createSession answers the id, null when none was made
    expect(useSessions.getState().unstarted.size).toBe(0);
    disposers.push(registerSessionCreator(() => Promise.reject(new Error('boom'))));
    await expect(createSession(null)).resolves.toBeNull(); // C12
    expect(error).toHaveBeenCalledWith('[actions] session creator failed', expect.any(Error));
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main);
    error.mockRestore();
  });

  it('the last registration wins and an older disposer leaves the newer creator in place', async () => {
    const first = vi.fn(async () => 'a' as AppSessionId);
    const second = vi.fn(async () => NEW);
    const offFirst = registerSessionCreator(first);
    disposers.push(registerSessionCreator(second));
    offFirst();
    await createSession(null);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(null);
  });
});

// UX wave U13a (its section's rules 4 and 5): the current project is the row of the session in front, the one whose
// card column and side surfaces the window shows; a page in front keeps it. New chat preselects its folder here.
describe('the current project', () => {
  const P = at('proj-here' as ProjectId);
  const HIDDEN = at('proj-hidden' as ProjectId);
  const THERE = addressOf(OTHER_MACHINE, 'proj-there' as ProjectId);
  const [IN_P, IN_HIDDEN, LOOSE] = ['in-p', 'in-hidden', 'loose'].map((id) => at(id as AppSessionId));
  const ON_B = addressOf(OTHER_MACHINE, 'on-b' as AppSessionId);
  const front = (id: AppSessionId) => useLayout.getState().openTab({ kind: 'session', appSessionId: id });
  const records = (...entries: [AppSessionId, ProjectId | null][]) => new Map(entries.map(([id, projectId]) => [id, record(id, { projectId })]));
  afterEach(() => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    useSessions.setState({ projects: new Map(), records: new Map() });
    useMachines.setState({ loaded: new Set() });
    delete (window as { maws?: PreloadBridge }).maws;
  });
  const setUp = () => {
    window.maws = fakeClient().client as unknown as PreloadBridge;
    useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) });
    useSessions.setState({
      projects: new Map([[P, project(P, 0)], [HIDDEN, project(HIDDEN, 1, { hidden: true })], [THERE, project(THERE, 2)]]),
      records: records([IN_P, P], [IN_HIDDEN, HIDDEN], [LOOSE, null], [ON_B, THERE]),
    });
  };

  it('follows the session in front, and stays on it while a tab of no session is in front', () => {
    setUp();
    expect(currentRow(), 'nothing open').toBeNull();
    front(IN_P);
    expect(currentRow()).toBe(P);
    expect(focusedProject()).toBe(P);
    useLayout.getState().openTab({ kind: 'diagnostics' });
    expect(currentRow(), 'a page in front changes no project').toBe(P);
    front(LOOSE);
    expect(currentRow(), 'a session in no project: its machine’s row').toBe(machineKey(TEST_MACHINE));
    useLayout.getState().openTab({ kind: 'diagnostics' }); // a tab of no session in front
    expect(currentRow()).toBe(machineKey(TEST_MACHINE));
  });

  it('is unknown while the machine of the session in front has not answered', () => {
    setUp();
    useMachines.setState({ loaded: new Set() });
    front(IN_P);
    expect(sessionRow(IN_P)).toBeUndefined();
    expect(currentRow()).toBeNull();
    expect(focusedProject()).toBeNull();
  });

  it('New chat preselects the folder here, and none for a machine’s row, a hidden project or a project with no folder here', () => {
    setUp();
    front(IN_P);
    expect(focusedProject()).toBe(P);
    front(LOOSE);
    expect(focusedProject(), 'a machine’s own row').toBeNull();
    front(IN_HIDDEN);
    expect(currentRow(), 'a hidden project is still the session’s row').toBe(HIDDEN);
    expect(focusedProject(), 'a hidden project').toBeNull();
    front(ON_B);
    expect(currentRow()).not.toBeNull();
    expect(focusedProject(), 'another machine’s project: no folder here').toBeNull();
  });
});
