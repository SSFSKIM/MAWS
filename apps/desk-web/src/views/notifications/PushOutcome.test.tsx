// @vitest-environment happy-dom
// What a Turn on from the grid's banner came to stays in sight: the banner, dismissed for good either way, says at once
// when it failed, and the Notifications panel shows the same failure afterwards — a refused push key before anything
// was subscribed, or a subscription the hub refused to keep.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubRequestError } from '../../hub/http';
import { BANNER_KEY } from '../../push/banner';
import { browserPushEnv } from '../../push/device';
import { registerServiceWorker } from '../../pwa/service-worker';
import { NotificationsDialog } from './NotificationsDialog';
import { PushBanner } from './PushBanner';

const hub = vi.hoisted(() => ({
  hubPushKey: vi.fn<() => Promise<string>>(),
  keepSubscription: vi.fn<() => Promise<void>>(),
  forgetSubscription: vi.fn(async () => {}),
  hubSubscriptions: vi.fn<() => Promise<Array<{ endpoint: string }>>>(),
}));
vi.mock('../../push/hub-push', () => hub);

// The browser's push pieces: a permission the tap grants, and a push manager holding what was subscribed.
let permission: NotificationPermission;
let held: { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON(): PushSubscriptionJSON; unsubscribe(): Promise<boolean> } | null;
const pushManager = {
  getSubscription: async () => held,
  subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
    held = {
      endpoint: 'https://push.example/send/1',
      options: { applicationServerKey: Uint8Array.from(applicationServerKey).buffer },
      toJSON: () => ({ endpoint: 'https://push.example/send/1', keys: { p256dh: 'BAEC', auth: 'AQID' } }),
      unsubscribe: async () => ((held = null), true),
    };
    return held;
  },
};
vi.mock('../../pwa/service-worker', () => ({ registerServiceWorker: () => Promise.resolve({ pushManager }) }));

const env = () => browserPushEnv(registerServiceWorker());

beforeEach(() => {
  permission = 'default';
  held = null;
  localStorage.clear();
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission: async () => (permission = 'granted') });
  vi.stubGlobal('PushManager', function PushManager() {});
  // The worker is active: the push manager is reached through `serviceWorker.ready`.
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  hub.hubPushKey.mockResolvedValue('BAEC');
  hub.keepSubscription.mockResolvedValue();
  hub.hubSubscriptions.mockImplementation(async () => (held ? [{ endpoint: held.endpoint }] : []));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function turnOnFromBanner() {
  const banner = render(<PushBanner env={env} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Turn on' })));
  return banner;
}

async function openPanel() {
  render(<NotificationsDialog onClose={() => {}} />);
  return screen.findByTestId('notifications', {}, { timeout: 2000 }).then(async (panel) => {
    await vi.waitFor(() => expect(panel.dataset.state).not.toBe('loading'));
    return panel;
  });
}

describe('a Turn on from the banner', () => {
  it('that the hub refuses for want of a push key says so at once, and the panel still says so after', async () => {
    hub.hubPushKey.mockRejectedValue(new HubRequestError(503, 'not-configured'));
    const banner = await turnOnFromBanner();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull(); // the offer is gone, for good
    expect(localStorage.getItem(BANNER_KEY)).toBe('dismissed');
    expect(screen.getByTestId('push-banner-result').textContent).toContain('no push key configured');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('push-banner-result')).toBeNull();
    banner.unmount();

    const panel = await openPanel();
    expect(panel.dataset.state).toBe('off');
    expect(screen.getByRole('alert').textContent).toContain('no push key configured');
  });

  it('whose subscription the hub refuses to keep says so at once, and the panel offers Retry with the refusal', async () => {
    hub.keepSubscription.mockRejectedValue(new HubRequestError(409, 'too-many'));
    hub.hubSubscriptions.mockResolvedValue([]);
    const banner = await turnOnFromBanner();
    expect(screen.getByTestId('push-banner-result').textContent).toContain('20 of your devices');
    banner.unmount();

    const panel = await openPanel();
    expect(panel.dataset.state).toBe('unsynced');
    expect(screen.getByTestId('push-error').textContent).toContain('20 of your devices');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('that turns them on leaves nothing behind but an On panel', async () => {
    await turnOnFromBanner();
    expect(screen.queryByTestId('push-banner')).toBeNull();
    expect(screen.queryByTestId('push-banner-result')).toBeNull();
    cleanup();
    const panel = await openPanel();
    expect(panel.dataset.state).toBe('on');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
