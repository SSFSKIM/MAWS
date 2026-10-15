// DX7's Web Push endpoints, the signed-in member's own: the hub's VAPID public key (the `applicationServerKey` a device
// subscribes with) and this device's subscription, kept by its endpoint. The one place the push contract's endpoints
// live; what a push carries is `src/sw/notice.ts`'s.
import {
  PUSH_KEY_PATH,
  PUSH_SUBSCRIPTIONS_PATH,
  type PushKey,
  type PushSubscriptionDeleted,
  type PushSubscriptionKept,
  type PushSubscriptionRecord,
  type PushSubscriptionRequest,
  type PushSubscriptions,
} from 'desk-hub/protocol';
import { hubJson, withJson } from '../hub/http';

/** The hub's VAPID public key: the uncompressed P-256 point, base64url. `503 not-configured` when it has none. */
export async function hubPushKey(): Promise<string> {
  return (await hubJson<PushKey>(PUSH_KEY_PATH)).key;
}

/** Has the hub keep this device's subscription (replacing one with the same endpoint). */
export async function keepSubscription(subscription: PushSubscriptionRequest): Promise<void> {
  await hubJson<PushSubscriptionKept>(PUSH_SUBSCRIPTIONS_PATH, withJson('PUT', subscription));
}

/** Has the hub forget this device's subscription. */
export async function forgetSubscription(endpoint: string): Promise<void> {
  await hubJson<PushSubscriptionDeleted>(PUSH_SUBSCRIPTIONS_PATH, withJson('DELETE', { endpoint }));
}

/** The signed-in member's subscriptions the hub holds: the one way to know this device's is kept. */
export async function hubSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return (await hubJson<PushSubscriptions>(PUSH_SUBSCRIPTIONS_PATH)).subscriptions;
}
