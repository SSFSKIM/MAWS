// The desk's service worker (§4, the PWA): it draws each Web Push from its payload and opens the app at the card a tap
// names. It holds no org key and imports nothing that could (§6): its bundle is this file, `handlers.ts`, and
// `notice.ts`, built apart from the app as one script at `/sw.js` (vite.config.ts) and pinned by `sw-imports.test.ts`.
// It caches nothing: the app is served behind Access, and a cached shell would outlive the sign-in it needs.
import { onNotificationClick, onPush, type PushData, type WorkerScope } from './handlers';

type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type Worker = WorkerScope & {
  skipWaiting(): Promise<void>;
  clients: WorkerScope['clients'] & { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'push', listener: (event: ExtendableEvent & { data: PushData }) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: ExtendableEvent & { notification: { data: unknown; close(): void } }) => void): void;
};

const worker = self as unknown as Worker;

// A new worker takes over at once: it holds no state an open page depends on.
worker.addEventListener('install', (event) => event.waitUntil(worker.skipWaiting()));
worker.addEventListener('activate', (event) => event.waitUntil(worker.clients.claim()));
worker.addEventListener('push', (event) => event.waitUntil(onPush(worker, event.data)));
worker.addEventListener('notificationclick', (event) => event.waitUntil(onNotificationClick(worker, event.notification)));
