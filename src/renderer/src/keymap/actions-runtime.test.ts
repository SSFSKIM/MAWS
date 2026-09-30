import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import {
  createSession,
  enabledActions,
  isActionEnabled,
  isSessionCreatorRegistered,
  registerAction,
  registerSessionCreator,
  runAction,
} from './actions-runtime';
import { connectActions } from './dispatcher';

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
    const pane = useLayout.getState().main.panes[0];
    expect(pane.tabs.map((t) => t.id)).toEqual(['overview', `session:${NEW}`]);
    expect(pane.activeTabId).toBe(`session:${NEW}`);
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
