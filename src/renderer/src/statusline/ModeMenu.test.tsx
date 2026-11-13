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
    // UX wave U4a (l3-input-10): Auto, Manual, Accept edits, Plan, then Bypass permissions; W9 (H4): the UI font, not mono
    expect(items.map((i) => i.firstElementChild?.textContent)).toEqual(['Auto', 'Manual', 'Accept edits', 'Plan', 'Bypass permissions']);
    expect(menu.querySelector('.font-mono')).toBeNull();
    expect(items[0].getAttribute('aria-checked')).toBe('true'); // auto
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    expect(items[0].textContent).toContain('This model does not support auto mode');
    fireEvent.click(items[3]); // plan
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

// UX wave U4a (l3-input-10, decision 25): Bypass permissions set apart, after a separator, in the warning tone with its
// mark after the label and its line; (l3-input-12, decision 21) a digit 1 to 9 picks the row drawn at that place.
describe('Bypass permissions set apart, and the digits', () => {
  const own = (over: Partial<ModeBinding> = {}): ModeBinding => ({
    value: 'default', options: ['auto', 'default', 'acceptEdits', 'plan', 'bypassPermissions'], disabled: null, refusal: null, autoUnavailable: null, set: async () => ({ ok: true }), ...over,
  });

  it('draws a separator before Bypass permissions, which is in the warning tone with its mark after the label and its line', () => {
    render(<ModeMenu binding={own()} />);
    const menu = screen.getByRole('menu', { name: 'Permission mode' });
    const bypass = within(menu).getByRole('menuitemradio', { name: /Bypass permissions/ });
    expect(bypass.previousElementSibling?.getAttribute('role')).toBe('separator');
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
    expect(bypass.firstElementChild?.textContent).toBe('Bypass permissions');
    expect(bypass.className).toContain('text-warning');
    expect(bypass.textContent).toBe('Bypass permissions⚠Every tool runs without asking');
    const plain = within(menu).getByRole('menuitemradio', { name: /^Plan/ });
    expect(plain.className).not.toContain('text-warning');
  });

  it('a digit picks the row at that place; a disabled row is not picked; Bypass still asks, the focus on Cancel', async () => {
    const set = vi.fn(async () => ({ ok: true }) as const);
    const done = vi.fn();
    render(<ModeMenu binding={own({ set, autoUnavailable: 'This model does not support auto mode' })} onDone={done} />);
    const menu = screen.getByRole('menu', { name: 'Permission mode' });
    const items = within(menu).getAllByRole('menuitemradio');
    act(() => items[1].focus());
    fireEvent.keyDown(items[1], { key: '1' }); // Auto, disabled here
    fireEvent.keyDown(items[1], { key: '9' }); // no ninth row
    await settle();
    expect(set).not.toHaveBeenCalled();
    fireEvent.keyDown(items[1], { key: '3' }); // Accept edits
    await settle();
    expect(set.mock.calls).toEqual([['acceptEdits']]);
    expect(done).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(within(screen.getByRole('menu', { name: 'Permission mode' })).getAllByRole('menuitemradio')[0], { key: '5' }); // Bypass
    expect(set).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('takes no digit with a modifier, and counts only the rows drawn', async () => {
    const set = vi.fn(async () => ({ ok: true }) as const);
    render(<ModeMenu binding={own({ set, options: ['default', 'plan'] })} />);
    const items = within(screen.getByRole('menu', { name: 'Permission mode' })).getAllByRole('menuitemradio');
    fireEvent.keyDown(items[0], { key: '2', metaKey: true });
    await settle();
    expect(set).not.toHaveBeenCalled();
    fireEvent.keyDown(items[0], { key: '2' });
    await settle();
    expect(set.mock.calls).toEqual([['plan']]);
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
