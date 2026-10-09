// The permission-mode menu over a started session's binding (`liveModeBinding`, the toolbar's Mode chip's): the status
// line's mode popover cases, ported here when the status line went (W2), and the menu on a binding that rejects.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { liveModeBinding, type ModeBinding } from './mode-menu';
import { ModeMenu } from './ModeMenu';

const A = 'app-a' as AppSessionId;
const settle = () => act(async () => void (await Promise.resolve()));
const OPUS = [{ value: 'claude-opus', resolvedModel: 'claude-opus', displayName: 'Opus', description: '', supportsAutoMode: false }];

afterEach(cleanup);

describe('the mode menu on a live session', () => {
  it('lists the modes with the effective one checked, disables auto with the reason, and sets through session.setPermissionMode', async () => {
    const fake = fakeClient({ 'session.setPermissionMode': { effective: 'plan', refusal: null, error: null } });
    const done = vi.fn();
    render(<ModeMenu binding={liveModeBinding(record('app-a'), status('app-a'), OPUS, fake.client)} onDone={done} />);
    const menu = screen.getByRole('menu', { name: 'Permission mode' });
    const items = within(menu).getAllByRole('menuitemradio');
    // W3: auto and bypass first; W9 (H4): the labels in the UI font, not mono
    expect(items.map((i) => i.firstElementChild?.textContent)).toEqual(['Auto', 'Bypass permissions', 'Manual', 'Accept edits', 'Plan']);
    expect(menu.querySelector('.font-mono')).toBeNull();
    expect(items[0].getAttribute('aria-checked')).toBe('true'); // auto
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    expect(items[0].textContent).toContain('This model does not support auto mode');
    fireEvent.click(items[4]); // plan
    await settle();
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: A, mode: 'plan' }]);
    expect(done).toHaveBeenCalledTimes(1); // closed on the engine's answer
  });

  it('bypassPermissions asks first, and a refusal stays in the menu in words', async () => {
    const fake = fakeClient({ 'session.setPermissionMode': { effective: 'default', refusal: 'auto_mode_settings', error: 'Auto mode is disabled in settings.json' } });
    render(<ModeMenu binding={liveModeBinding(record('app-a'), status('app-a'), [], fake.client)} />);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }));
    expect(fake.invoked('session.setPermissionMode')).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })); // a stray Enter keeps the mode
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Manual/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Auto mode is disabled by settings');
  });
});

describe('the mode menu on its own binding', () => {
  it('a binding whose set rejects shows the reason as the alert and leaves the menu usable', async () => {
    const binding: ModeBinding = {
      value: 'default', options: ['default', 'plan'], disabled: null, refusal: null, autoUnavailable: null,
      set: () => Promise.reject(new Error('the bridge went away')),
    };
    render(<ModeMenu binding={binding} />);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Plan/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('the bridge went away');
    expect((screen.getByRole('menuitemradio', { name: /^Plan/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// P2-A (2026-10-09; the execution document §5.6): on a session with no ready process a choice starts it first
describe('the mode menu on a session with no ready process', () => {
  it('Bypass asks before anything starts: Cancel starts nothing; the confirm says Starting… then sets the mode', async () => {
    let answer!: (value: unknown) => void;
    const invoke = vi.fn((name: string) =>
      name === 'session.acquire' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ ok: true, value: { effective: 'bypassPermissions', refusal: null, error: null } }),
    );
    const client = { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as Parameters<typeof liveModeBinding>[3];
    const done = vi.fn();
    render(<ModeMenu binding={liveModeBinding(record('app-a'), null, [], client)} onDone={done} />);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }));
    expect(invoke).not.toHaveBeenCalled(); // the confirm is UI state before `set`
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Bypass permissions' }));
    await settle();
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['session.acquire']);
    expect(screen.getByRole('status').textContent).toBe('Starting…');
    await act(async () => answer({ ok: true, value: { status: 'ready', appSessionId: A, launched: true, joined: false } }));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(['session.acquire', 'session.setPermissionMode']);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
