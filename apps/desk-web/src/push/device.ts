// This device's notifications (§4: Web Push): the browser's permission, its push subscription under the hub's VAPID
// key, and the hub's record of it (DX7). Written against the few browser pieces it touches (`PushEnv`) so the suites
// can stand in for a push service. A push reaches a device only while the hub keeps its subscription, so "on" means
// the hub holds it (`GET /api/push/subscriptions` lists it), never the browser's subscription alone: one the hub did
// not keep reads `unsynced`, with why when the hub said, and `retryPush` hands it over again. The app does that at
// every start too (`resyncPush`); a rotated hub key means subscribing anew.
import { base64urlDecode, base64urlEncode, type PushSubscriptionRequest } from 'desk-hub/protocol';
import { boundPushDevice } from './bound-device';
import { forgetSubscription, hubPushKey, hubSubscriptions, keepSubscription } from './hub-push';

export type PushState =
  /** No Push API here, but an iPhone's installed app would have one (an iOS Safari tab). */
  | { kind: 'needs-install' }
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; endpoint: string }
  /** Subscribed here, but the hub does not hold it (or could not be asked: `error`), so no push reaches this device. */
  | { kind: 'unsynced'; endpoint: string; error: unknown };

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
  /**
   * The org-state device a subscription is bound to (P5 O13 M3, Decision Log 41): this browser's `web-cards` device
   * while the head lists it, so revoking the device ends its pushes at the hub; null keeps it unbound.
   */
  device?: () => string | null;
};

const off: PushState = { kind: 'off' };

/** This browser's push pieces; `registration` is the service worker's, null where none is registered (the dev server). */
export function browserPushEnv(registration: Promise<ServiceWorkerRegistration> | null): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = typeof nav.standalone === 'boolean' ? nav.standalone : null;
  if (registration === null || typeof Notification === 'undefined' || typeof PushManager === 'undefined') return { notifications: null, pushManager: null, standalone };
  return {
    notifications: { permission: () => Notification.permission, requestPermission: () => Notification.requestPermission() },
    // Through the worker that is active, never the registration as `register` resolved it: on a first install its worker
    // may still be installing, and subscribing then fails (InvalidStateError) though the permission was granted. The
    // registration is awaited first, so one that failed rejects rather than waiting on `ready` for good.
    pushManager: async () => {
      await registration;
      return (await navigator.serviceWorker.ready).pushManager as unknown as PushManagerLike;
    },
    standalone,
    device: boundPushDevice,
  };
}

export async function pushState(env: PushEnv): Promise<PushState> {
  if (!env.notifications || !env.pushManager) return env.standalone === false ? { kind: 'needs-install' } : { kind: 'unsupported' };
  const permission = env.notifications.permission();
  if (permission === 'denied') return { kind: 'denied' };
  if (permission !== 'granted') return off;
  const subscription = await (await env.pushManager()).getSubscription();
  return subscription ? held(subscription.endpoint) : off;
}

/** On when the hub lists the endpoint among the member's subscriptions; otherwise not, with the hub's error if any. */
async function held(endpoint: string): Promise<PushState> {
  try {
    return (await hubSubscriptions()).some((s) => s.endpoint === endpoint) ? { kind: 'on', endpoint } : { kind: 'unsynced', endpoint, error: null };
  } catch (error) {
    return { kind: 'unsynced', endpoint, error };
  }
}

/** Hands the subscription to the hub, answering on, or unsynced with the hub's refusal. */
async function handOver(subscription: SubscriptionLike, device: string | null): Promise<PushState> {
  try {
    await keepSubscription(requestOf(subscription, device));
    return { kind: 'on', endpoint: subscription.endpoint };
  } catch (error) {
    return { kind: 'unsynced', endpoint: subscription.endpoint, error };
  }
}

/**
 * Turns notifications on for this device. The permission prompt comes first, straight from the owner's tap (iOS shows
 * it only then), before anything is fetched. Throws the hub's refusal of its key
 * (`HubRequestError`: `not-configured`), when nothing was subscribed; a subscription the hub then refuses to keep
 * (`too-many`) is answered as `unsynced`, with the refusal, for Retry.
 */
export async function enablePush(env: PushEnv): Promise<PushState> {
  if (!env.notifications || !env.pushManager) return pushState(env);
  const answer = await env.notifications.requestPermission();
  if (answer === 'denied') return { kind: 'denied' };
  if (answer !== 'granted') return off;
  return handOver(await subscribed(env.pushManager), env.device?.() ?? null);
}

/** Hands this device's subscription to the hub again (Retry), without turning anything off. */
export async function retryPush(env: PushEnv): Promise<PushState> {
  if (!env.notifications || !env.pushManager || env.notifications.permission() !== 'granted') return pushState(env);
  if (!(await (await env.pushManager()).getSubscription())) return off;
  try {
    return await handOver(await subscribed(env.pushManager), env.device?.() ?? null);
  } catch (error) {
    const held = await (await env.pushManager()).getSubscription();
    return held ? { kind: 'unsynced', endpoint: held.endpoint, error } : off;
  }
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

/**
 * At start: a device already subscribed hands its subscription to the hub again, never asking the owner anything.
 * Answers what came of it (null when the device is not subscribed), so a failure is kept rather than dropped.
 */
export async function resyncPush(env: PushEnv): Promise<PushState | null> {
  if (!env.notifications || !env.pushManager || env.notifications.permission() !== 'granted') return null;
  if (!(await (await env.pushManager()).getSubscription())) return null;
  return retryPush(env);
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

/** What the hub keeps, its keys in canonical base64url (no padding) whatever spelling the browser gave, bound to `device`
 * when one is given. */
function requestOf(subscription: SubscriptionLike, device: string | null): PushSubscriptionRequest {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error('the push subscription carries no keys');
  const canonical = (value: string) => base64urlEncode(base64urlDecode(value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')));
  const request: PushSubscriptionRequest = { endpoint: subscription.endpoint, keys: { p256dh: canonical(keys.p256dh), auth: canonical(keys.auth) } };
  if (device !== null) request.device = device;
  return request;
}
