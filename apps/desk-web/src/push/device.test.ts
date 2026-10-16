// This device's Web Push subscription against DX7's endpoints, served by the double's implementation of the hub's rules
// through a stubbed fetch, with the browser's push pieces stood in for (a real `pushManager.subscribe` needs a push
// service; the owner's walk proves it on the iPhone).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64urlDecode, base64urlEncode } from 'desk-hub/protocol';
import { DOUBLE_MEMBER } from '../../test/double/hub-double';
import { PushDouble } from '../../test/double/push';
import { browserPushEnv, disablePush, enablePush, pushState, resyncPush, retryPush, type PushEnv } from './device';
import { HubRequestError } from '../hub/http';

type FakeSubscription = { endpoint: string; options: { applicationServerKey: ArrayBuffer | null }; toJSON(): PushSubscriptionJSON; unsubscribe(): Promise<boolean> };

let hub: PushDouble;
let endpoints = 0;

function fakeEnv(over: { permission?: NotificationPermission; answer?: NotificationPermission; pushManager?: boolean; standalone?: boolean } = {}) {
  let permission: NotificationPermission = over.permission ?? 'default';
  let current: FakeSubscription | null = null;
  const subscribeCalls: Array<{ applicationServerKey: string }> = [];
  const make = (key: Uint8Array): FakeSubscription => {
    const endpoint = `https://push.example/send/${++endpoints}`;
    const sub: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: Uint8Array.from(key).buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: base64urlEncode(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))), auth: base64urlEncode(new Uint8Array(16).fill(7)) } }),
      unsubscribe: async () => {
        if (current === sub) current = null;
        return true;
      },
    };
    return sub;
  };
  const env: PushEnv = {
    notifications:
      over.pushManager === false
        ? null
        : {
            permission: () => permission,
            requestPermission: async () => (permission = over.answer ?? 'granted'),
          },
    pushManager:
      over.pushManager === false
        ? null
        : async () => ({
            getSubscription: async () => current,
            subscribe: async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
              if (!options.userVisibleOnly) throw new Error('userVisibleOnly is required');
              subscribeCalls.push({ applicationServerKey: base64urlEncode(options.applicationServerKey) });
              current = make(options.applicationServerKey);
              return current;
            },
          }),
    standalone: over.standalone ?? null,
  };
  return { env, subscribeCalls, current: () => current, setCurrent: (key: Uint8Array) => (current = make(key)) };
}

beforeEach(() => {
  hub = new PushDouble();
  vi.stubGlobal('fetch', hub.fetch(DOUBLE_MEMBER));
});
afterEach(() => vi.unstubAllGlobals());

describe('pushState', () => {
  it('says the app must be on the home screen where push exists only there (an iPhone Safari tab)', async () => {
    expect(await pushState(fakeEnv({ pushManager: false, standalone: false }).env)).toEqual({ kind: 'needs-install' });
  });

  it('says a browser without push cannot have it', async () => {
    expect(await pushState(fakeEnv({ pushManager: false }).env)).toEqual({ kind: 'unsupported' });
  });

  it('reads blocked, off, and on', async () => {
    expect(await pushState(fakeEnv({ permission: 'denied' }).env)).toEqual({ kind: 'denied' });
    expect(await pushState(fakeEnv().env)).toEqual({ kind: 'off' });
    const granted = fakeEnv({ permission: 'granted' });
    expect(await pushState(granted.env)).toEqual({ kind: 'off' });
    await enablePush(granted.env);
    expect(await pushState(granted.env)).toEqual({ kind: 'on', endpoint: granted.current()!.endpoint });
  });

  it('reads on only while the hub holds the subscription; a device subscribed alone is not on', async () => {
    const device = fakeEnv({ permission: 'granted' });
    device.setCurrent(base64urlDecode(hub.key)); // subscribed here, never kept by the hub
    expect(await pushState(device.env)).toEqual({ kind: 'unsynced', endpoint: device.current()!.endpoint, error: null });
    hub.configured = false; // the hub cannot be asked
    expect(await pushState(device.env)).toMatchObject({ kind: 'unsynced', error: { status: 503, code: 'not-configured' } });
  });
});

describe('enablePush', () => {
  it("asks for permission, subscribes with the hub's key, and has the hub keep the subscription", async () => {
    const device = fakeEnv();
    const state = await enablePush(device.env);
    expect(state).toEqual({ kind: 'on', endpoint: device.current()!.endpoint });
    expect(device.subscribeCalls).toEqual([{ applicationServerKey: hub.key }]);
    expect(hub.subscriptions.map((s) => s.endpoint)).toEqual([device.current()!.endpoint]);
    expect(hub.subscriptions[0].member).toBe(DOUBLE_MEMBER.id);
  });

  it('stops at a refusal or a dismissal, subscribing nothing', async () => {
    const refused = fakeEnv({ answer: 'denied' });
    expect(await enablePush(refused.env)).toEqual({ kind: 'denied' });
    const dismissed = fakeEnv({ answer: 'default' });
    expect(await enablePush(dismissed.env)).toEqual({ kind: 'off' });
    expect(refused.subscribeCalls).toEqual([]);
    expect(dismissed.subscribeCalls).toEqual([]);
    expect(hub.subscriptions).toEqual([]);
  });

  it('keeps a subscription made with the same key, and replaces one made with another (a rotated VAPID key)', async () => {
    const same = fakeEnv({ permission: 'granted' });
    same.setCurrent(base64urlDecode(hub.key));
    await enablePush(same.env);
    expect(same.subscribeCalls).toEqual([]);

    const stale = fakeEnv({ permission: 'granted' });
    stale.setCurrent(new Uint8Array(65).fill(9));
    const old = stale.current()!.endpoint;
    await enablePush(stale.env);
    expect(stale.subscribeCalls).toEqual([{ applicationServerKey: hub.key }]);
    expect(stale.current()!.endpoint).not.toBe(old);
  });

  it("names the hub's refusals by their code", async () => {
    hub.configured = false;
    await expect(enablePush(fakeEnv().env)).rejects.toMatchObject({ status: 503, code: 'not-configured' });
    hub.configured = true;
    const keys = { p256dh: base64urlEncode(new Uint8Array(65).fill(4)), auth: base64urlEncode(new Uint8Array(16)) };
    for (let i = 0; i < 20; i++) await hub.handle(DOUBLE_MEMBER, 'PUT', '/api/push/subscriptions', { endpoint: `https://push.example/other/${i}`, keys });
    expect(hub.subscriptions).toHaveLength(20);
    // Subscribed here but not kept there: not on, with the refusal to show beside Retry.
    const state = await enablePush(fakeEnv().env);
    expect(state.kind).toBe('unsynced');
    expect((state as { error: unknown }).error).toBeInstanceOf(HubRequestError);
    expect(state).toMatchObject({ error: { status: 409, code: 'too-many' } });
  });
});

describe('a subscription the hub did not keep', () => {
  it('is kept as not on, with the failure, and Retry hands it over again', async () => {
    const device = fakeEnv();
    const keep = hub.fetch(DOUBLE_MEMBER);
    let refuse = true;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      refuse && init?.method === 'PUT' ? Promise.resolve(new Response(JSON.stringify({ error: 'too-many' }), { status: 409 })) : keep(input, init),
    );
    const failed = await enablePush(device.env);
    expect(failed).toMatchObject({ kind: 'unsynced', endpoint: device.current()!.endpoint, error: { status: 409, code: 'too-many' } });
    expect(hub.subscriptions).toEqual([]);
    expect(await pushState(device.env)).toMatchObject({ kind: 'unsynced', error: null }); // reopened: still not on
    refuse = false;
    expect(await retryPush(device.env)).toEqual({ kind: 'on', endpoint: device.current()!.endpoint });
    expect(hub.subscriptions.map((s) => s.endpoint)).toEqual([device.current()!.endpoint]);
  });

  it("at start is answered with the hub's refusal rather than dropped", async () => {
    const device = fakeEnv();
    await enablePush(device.env);
    hub.subscriptions = [];
    hub.configured = false;
    expect(await resyncPush(device.env)).toMatchObject({ kind: 'unsynced', error: { status: 503, code: 'not-configured' } });
  });
});

describe('disablePush', () => {
  it('unsubscribes the device and has the hub forget it', async () => {
    const device = fakeEnv();
    await enablePush(device.env);
    expect(await disablePush(device.env)).toEqual({ kind: 'off' });
    expect(device.current()).toBeNull();
    expect(hub.subscriptions).toEqual([]);
  });
});

describe('resyncPush', () => {
  it("hands the hub this device's subscription again, so one the hub dropped is kept anew", async () => {
    const device = fakeEnv();
    await enablePush(device.env);
    hub.subscriptions = [];
    await resyncPush(device.env);
    expect(hub.subscriptions.map((s) => s.endpoint)).toEqual([device.current()!.endpoint]);
  });

  it('does nothing for a device that is not subscribed, and never asks for permission', async () => {
    const device = fakeEnv();
    const ask = vi.spyOn(device.env.notifications!, 'requestPermission');
    await resyncPush(device.env);
    expect(ask).not.toHaveBeenCalled();
    expect(hub.subscriptions).toEqual([]);
  });

  it('resubscribes under a rotated key without asking', async () => {
    const device = fakeEnv({ permission: 'granted' });
    device.setCurrent(new Uint8Array(65).fill(9));
    await resyncPush(device.env);
    expect(device.subscribeCalls).toEqual([{ applicationServerKey: hub.key }]);
    expect(hub.subscriptions.map((s) => s.endpoint)).toEqual([device.current()!.endpoint]);
  });
});

describe("this browser's push pieces", () => {
  it('reach the push manager only through the active worker (`serviceWorker.ready`), never a registration still installing', async () => {
    const installing = { pushManager: 'installing' };
    let activate!: (registration: { pushManager: string }) => void;
    const ready = new Promise<{ pushManager: string }>((resolve) => (activate = resolve));
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: async () => 'granted' });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('navigator', { serviceWorker: { ready } });
    try {
      const env = browserPushEnv(Promise.resolve(installing as unknown as ServiceWorkerRegistration));
      let got: unknown = null;
      void env.pushManager!().then((manager) => (got = manager));
      await new Promise((r) => setTimeout(r, 10));
      expect(got).toBeNull(); // registered, not yet active: subscribe would fail with InvalidStateError
      activate({ pushManager: 'active' });
      await vi.waitFor(() => expect(got).toBe('active'));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
