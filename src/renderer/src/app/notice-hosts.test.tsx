import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayout } from '../stores/layout';
import { banner, toast, useNotices } from '../stores/notices';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { BannerHost } from './BannerHost';
import { Shell } from './Shell';
import { TOAST_DURATION_MS, ToastHost } from './ToastHost';

vi.mock('./Diagnostics', () => ({ Diagnostics: () => null }));

const nine = scenarioFile('nine-sessions');

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useNotices.setState({ notices: [] });
  window.maws = { invoke: vi.fn(async () => ({ ok: true, value: { event: null } })), on: vi.fn(() => () => {}) } as never;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('banner host', () => {
  it('shows banners only, newest last, each with its actions and a dismiss control when dismissible', async () => {
    const user = userEvent.setup();
    const renew = vi.fn();
    render(<BannerHost />);
    act(() => {
      banner({ id: 'near-limit', level: 'warning', text: '80% of the 5-hour window used', actions: [{ label: 'Details', run: renew }], dismissible: true });
      toast({ level: 'info', text: 'a toast', actions: [], dismissible: true });
      banner({ level: 'danger', text: 'Gateway unreachable', actions: [], dismissible: false });
    });
    const banners = screen.getAllByRole('status');
    expect(banners.map((b) => b.textContent)).toEqual([expect.stringContaining('80% of the 5-hour window used'), expect.stringContaining('Gateway unreachable')]);
    expect(screen.queryByText('a toast')).toBeNull();
    await user.click(within(banners[0]).getByRole('button', { name: 'Details' }));
    expect(renew).toHaveBeenCalledOnce();
    expect(within(banners[1]).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await user.click(within(banners[0]).getByRole('button', { name: 'Dismiss' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('sits once in the shell outside both panes of a split and survives panel maximization', () => {
    render(<Shell />);
    act(() => {
      useLayout.getState().openSession(nine.sessions[0].appId, { split: true });
      banner({ id: 'near-limit', level: 'warning', text: 'near the limit', actions: [], dismissible: true });
    });
    const main = document.querySelector<HTMLElement>('[data-region="main"]')!;
    const hosts = document.querySelectorAll<HTMLElement>('[data-banner-host]');
    expect(hosts).toHaveLength(1);
    expect(main.contains(hosts[0])).toBe(false);
    act(() => useLayout.getState().setPanel({ maximized: true, collapsed: false }));
    expect(screen.getByText('near the limit').closest('[inert]')).toBeNull();
    expect(document.querySelectorAll('[data-banner-host]')).toHaveLength(1);
  });
});

describe('toast host', () => {
  it('shows toasts at the shell’s corner with their actions, and a toast goes after six seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const open = vi.fn();
    render(<ToastHost />);
    act(() => {
      toast({ id: 'attention:1', level: 'warning', text: 'Charter + research needs you · Read docs/charter.md', actions: [{ label: 'Open session', run: open }], dismissible: true });
      banner({ level: 'info', text: 'a banner', actions: [], dismissible: true });
    });
    expect(screen.getByText('Charter + research needs you · Read docs/charter.md')).toBeTruthy();
    expect(screen.queryByText('a banner')).toBeNull();
    act(() => screen.getByRole('button', { name: 'Open session' }).click());
    expect(open).toHaveBeenCalledOnce();
    expect(useNotices.getState().notices.map((n) => n.kind)).toEqual(['banner']); // acting on a toast dismisses it
    act(() => toast({ level: 'info', text: 'goes by itself', actions: [], dismissible: true }));
    await act(async () => vi.advanceTimersByTime(TOAST_DURATION_MS + 500));
    expect(useNotices.getState().notices.map((n) => n.kind)).toEqual(['banner']);
  });

  // C11 start: a toast with its own duration (the ClaudeUsage hand-off's instruction, 8 s)
  it('keeps a toast for its own duration when it names one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ToastHost />);
    act(() => void toast({ level: 'info', text: 'read me for eight seconds', actions: [], dismissible: true, durationMs: 8000 }));
    await act(async () => vi.advanceTimersByTime(TOAST_DURATION_MS + 500));
    expect(screen.getByText('read me for eight seconds')).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(8000 - TOAST_DURATION_MS));
    expect(useNotices.getState().notices.filter((n) => n.kind === 'toast')).toEqual([]);
  });
  // C11 end
});
