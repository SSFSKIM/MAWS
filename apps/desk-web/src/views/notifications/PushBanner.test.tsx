// @vitest-environment happy-dom
// The first-run opt-in (mockups/desk/05-phone.html, 9a): after the first unlock in the installed app the grid shows one
// banner; Turn on asks for the permission straight from the tap, and Not now hides it for good on this device.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushEnv } from '../../push/device';
import { BANNER_KEY, bannerDue } from '../../push/banner';
import { PushBanner } from './PushBanner';

describe('bannerDue', () => {
  const due = { installed: true, unlocked: true, state: { kind: 'off' as const }, dismissed: false };
  it('is due in the installed app, once unlocked, while notifications are off and it was never dismissed', () => {
    expect(bannerDue(due)).toBe(true);
    expect(bannerDue({ ...due, installed: false })).toBe(false); // a browser tab: iOS has no push there
    expect(bannerDue({ ...due, unlocked: false })).toBe(false);
    expect(bannerDue({ ...due, dismissed: true })).toBe(false);
    for (const kind of ['on', 'denied', 'unsupported', 'needs-install'] as const) expect(bannerDue({ ...due, state: { kind, endpoint: 'e' } as never })).toBe(false);
  });
});

describe('PushBanner', () => {
  let asked: number;
  const env = (): PushEnv => ({
    notifications: { permission: () => 'default', requestPermission: async () => ((asked += 1), 'denied') },
    pushManager: async () => ({ getSubscription: async () => null, subscribe: async () => Promise.reject(new Error('unused')) }),
    standalone: true,
  });
  beforeEach(() => {
    asked = 0;
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('asks for the permission from the Turn on tap, and goes once answered', async () => {
    render(<PushBanner env={env} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Turn on' })));
    expect(asked).toBe(1);
    expect(screen.queryByTestId('push-banner')).toBeNull();
  });

  it('is gone for good after Not now, on this device', () => {
    const { unmount } = render(<PushBanner env={env} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('push-banner')).toBeNull();
    expect(localStorage.getItem(BANNER_KEY)).toBe('dismissed');
    unmount();
    expect(asked).toBe(0);
  });
});

vi.mock('../../push/hub-push', () => ({ hubPushKey: async () => 'k', keepSubscription: async () => {}, forgetSubscription: async () => {}, hubSubscriptions: async () => [] }));
