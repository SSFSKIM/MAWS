// The app's side of its service worker (§4, the PWA): registering `/sw.js` (built apart from the app; the dev server
// has none), and following where a tapped notification sends the owner — a cold start's URL, or a message from the
// worker to a window already open, which navigates in place and keeps its socket and key.
import { create } from 'zustand';
import { OPEN_MESSAGE, type OpenMessage } from '../sw/handlers';
import { landingOf, type Landing } from '../sw/notice';
import { parseRoute, useDeskLayout } from '../shell/layout';

let registration: Promise<ServiceWorkerRegistration> | null = null;

/** Registers the service worker once, in a build served where service workers run; null where none is. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | null {
  if (registration || !import.meta.env.PROD || !('serviceWorker' in navigator)) return registration;
  registration = navigator.serviceWorker.register('/sw.js', { scope: '/' });
  registration.catch(() => (registration = null));
  return registration;
}

/** The card a notification opened, in the session channel it names, until the owner leaves it. */
export type Landed = { project: string; session: string; landing: Landing };
export const useLanding = create<{ landed: Landed | null; clear(): void }>()((set) => ({ landed: null, clear: () => set({ landed: null }) }));

/** Lands on the URL's card (a notification's URL), navigating there when `navigate` is set; the query is dropped. */
export function land(url: URL, navigate: boolean): void {
  const route = parseRoute(url.pathname);
  const landing = landingOf(url.search);
  if (navigate) useDeskLayout.getState().navigate(route);
  if (route.view === 'project' && route.channel.kind === 'session' && landing) {
    useLanding.setState({ landed: { project: route.project, session: route.channel.session, landing } });
  }
  if (url.search) history.replaceState(history.state, '', url.pathname);
}

/**
 * Lands on the start URL's card, then on each card the worker sends an open window to. Called once, as the page starts
 * (main.tsx), before the sign-in is known: a message that reaches a loaded page with no listener is dropped.
 */
export function followLandings(): () => void {
  land(new URL(location.href), false);
  if (!('serviceWorker' in navigator)) return () => {};
  const onMessage = (event: MessageEvent) => {
    const message = event.data as Partial<OpenMessage> | null;
    if (message?.type !== OPEN_MESSAGE || typeof message.url !== 'string') return;
    const url = new URL(message.url, location.origin);
    if (url.origin === location.origin) land(url, true);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  navigator.serviceWorker.startMessages();
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
