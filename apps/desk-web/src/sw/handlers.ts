// The service worker's two jobs, written against the few parts of its global scope they touch so the suites can stand
// in for it: a push becomes a notification drawn from its payload alone, and a tap opens the app at the card.
import { describeNotice, parseNotice } from './notice';

/** A window of the app, as `clients.matchAll` gives it. */
export type WindowLike = {
  url: string;
  visibilityState: DocumentVisibilityState;
  focused: boolean;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
};

export type WorkerScope = {
  /** The worker's navigator: the Badging API's `setAppBadge` where the platform has it (an installed app). */
  navigator: { setAppBadge?(count: number): Promise<void> };
  registration: { showNotification(title: string, options?: NotificationOptions): Promise<void> };
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
};

/** What the worker posts to an open window to send it to a card; the app navigates in place. */
export const OPEN_MESSAGE = 'desk-open';
export type OpenMessage = { type: typeof OPEN_MESSAGE; url: string };

/** A push's data, as `PushEvent.data` gives it (null for a push without a payload). */
export type PushData = { json(): unknown } | null;

/**
 * Every push shows a notification, one it cannot read included: a push the worker leaves silent counts against the
 * subscription (iOS revokes it after a few), and the hub only pushes when something needs the owner.
 */
export async function onPush(scope: WorkerScope, data: PushData): Promise<void> {
  const notice = parseNotice(payloadOf(data));
  const { title, options } = describeNotice(notice);
  await Promise.all([scope.registration.showNotification(title, options), badge(scope, notice?.waiting)]);
}

/**
 * The app icon's badge, set to the org's waiting count when the push carries one (0 clears it); left as it is when
 * the push carries none or the platform has no badge. A refusal is let go: the notification is what must show.
 */
async function badge(scope: WorkerScope, waiting: number | undefined): Promise<void> {
  if (waiting === undefined || typeof scope.navigator.setAppBadge !== 'function') return;
  await scope.navigator.setAppBadge(waiting).catch(() => {});
}

/** The push's JSON, or null for none or for data that is not JSON. */
function payloadOf(data: PushData): unknown {
  try {
    return data?.json() ?? null;
  } catch {
    return null;
  }
}

/** Only a path of the app's own origin is opened; anything else opens the grid. */
function appPath(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

/**
 * A tap opens the app at the card: an open window is brought forward and told where to go (so it keeps its socket,
 * its key, and its place), preferring one the owner can see; with none, or one that will not come forward, a new one.
 */
export async function onNotificationClick(scope: WorkerScope, notification: { data: unknown; close(): void }): Promise<void> {
  notification.close();
  const url = appPath((notification.data as { url?: unknown } | null)?.url);
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const target = windows.find((w) => w.focused) ?? windows.find((w) => w.visibilityState === 'visible') ?? windows[0];
  if (target) {
    try {
      await target.focus();
      target.postMessage({ type: OPEN_MESSAGE, url } satisfies OpenMessage);
      return;
    } catch {
      // Focus refused (no user activation reached it): open a window instead.
    }
  }
  await scope.clients.openWindow(url);
}
