// This device's notifications (§4: Web Push): the browser's permission, its push subscription under the hub's VAPID
// key, and the hub's record of it (DX7). Written against the few browser pieces it touches (`PushEnv`) so the suites
// can stand in for a push service. A push reaches a device only while the hub keeps its subscription, so the app hands
// it over again at every start (`resyncPush`); a rotated hub key means subscribing anew.
import { base64urlDecode, base64urlEncode, type PushSubscriptionRequest } from 'desk-hub/protocol';
import { forgetSubscription, hubPushKey, keepSubscription } from './hub-push';

export type PushState =
  /** No Push API here, but an iPhone's installed app would have one (an iOS Safari tab). */
  | { kind: 'needs-install' }
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; endpoint: string };

type SubscriptionLike = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
};
type PushManagerLike = {
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubscriptionLike>;
};

export type PushEnv = {
  /** The Notifications API, or null where the browser has no Web Push. */
  notifications: { permission(): NotificationPermission; requestPermission(): Promise<NotificationPermission> } | null;
  /** The service worker registration's push manager, or null where the browser has no Web Push. */
  pushManager: (() => Promise<PushManagerLike>) | null;
  /** iOS Safari's `navigator.standalone` (true in a home-screen app); null in every other browser. */
  standalone: boolean | null;
};

const off: PushState = { kind: 'off' };

/** This browser's push pieces; `registration` is the service worker's, null where none is registered (the dev server). */
export function browserPushEnv(registration: Promise<ServiceWorkerRegistration> | null): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = typeof nav.standalone === 'boolean' ? nav.standalone : null;
  if (registration === null || typeof Notification === 'undefined' || typeof PushManager === 'undefined') return { notifications: null, pushManager: null, standalone };
  return {
    notifications: { permission: () => Notification.permission, requestPermission: () => Notification.requestPermission() },
    pushManager: async () => (await registration).pushManager as unknown as PushManagerLike,
    standalone,
  };
}

export async function pushState(env: PushEnv): Promise<PushState> {
  if (!env.notifications || !env.pushManager) return env.standalone === false ? { kind: 'needs-install' } : { kind: 'unsupported' };
  const permission = env.notifications.permission();
  if (permission === 'denied') return { kind: 'denied' };
  if (permission !== 'granted') return off;
  const subscription = await (await env.pushManager()).getSubscription();
  return subscription ? { kind: 'on', endpoint: subscription.endpoint } : off;
}

/**
 * Turns notifications on for this device. The permission prompt comes first, straight from the owner's tap (iOS shows
 * it only then), before anything is fetched. Throws the hub's refusal (`HubRequestError`: `not-configured`, `too-many`).
 */
export async function enablePush(env: PushEnv): Promise<PushState> {
  if (!env.notifications || !env.pushManager) return pushState(env);
  const answer = await env.notifications.requestPermission();
  if (answer === 'denied') return { kind: 'denied' };
  if (answer !== 'granted') return off;
  const subscription = await subscribed(env.pushManager);
  await keepSubscription(requestOf(subscription));
  return { kind: 'on', endpoint: subscription.endpoint };
}

/**
 * Turns them off: the device unsubscribes, and the hub is asked to forget it. A forget that fails is let go: the push
 * service refuses the next push to an endpoint the device gave up, and the hub drops a subscription refused so (DX7).
 */
export async function disablePush(env: PushEnv): Promise<PushState> {
  if (!env.pushManager) return pushState(env);
  const subscription = await (await env.pushManager()).getSubscription();
  if (subscription) {
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await forgetSubscription(endpoint).catch(() => {});
  }
  return pushState(env);
}

/** At start: a device already subscribed hands its subscription to the hub again, never asking the owner anything. */
export async function resyncPush(env: PushEnv): Promise<void> {
  if (!env.notifications || !env.pushManager || env.notifications.permission() !== 'granted') return;
  if (!(await (await env.pushManager()).getSubscription())) return;
  await keepSubscription(requestOf(await subscribed(env.pushManager)));
}

/** The subscription under the hub's current key: the one held when its key matches, else a fresh one. */
async function subscribed(manager: () => Promise<PushManagerLike>): Promise<SubscriptionLike> {
  const key = await hubPushKey();
  const pushManager = await manager();
  const held = await pushManager.getSubscription();
  if (held && held.options.applicationServerKey && base64urlEncode(new Uint8Array(held.options.applicationServerKey)) === key) return held;
  if (held) await held.unsubscribe();
  return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(base64urlDecode(key)) });
}

/** What the hub keeps, its keys in canonical base64url (no padding) whatever spelling the browser gave. */
function requestOf(subscription: SubscriptionLike): PushSubscriptionRequest {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error('the push subscription carries no keys');
  const canonical = (value: string) => base64urlEncode(base64urlDecode(value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')));
  return { endpoint: subscription.endpoint, keys: { p256dh: canonical(keys.p256dh), auth: canonical(keys.auth) } };
}
