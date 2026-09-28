import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeClient } from '../../../../test/support/fake-client';
import { enabledActions, isActionEnabled, registerAction, runAction } from './actions-runtime';
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
