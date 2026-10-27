// Main's clients (P5 O1 M2): one `ClientRef` per page instance. A page instance is a window's top-frame document from its
// load until it ends, and it ends on the first of `destroyed`, `render-process-gone`, or a `did-start-navigation` with
// `isMainFrame && !isSameDocument`. Every piece of per-client state releases on that one moment, so a reloaded page
// loses what its previous document held, and asks again on mount.
//
// The race this does not resolve: a request the old document sent after its navigation started arrives after the end,
// and `clientOf` attributes it to the new instance (as the visibility handler always did). Telling them apart would
// need the sender's frame token at invoke time; the new document re-asks on mount, so the stray request is harmless.
import type { WebContents, WebContentsDidStartNavigationEventParams } from 'electron';
import type { ClientId, ClientRef } from '@shared/ipc/client';

interface PageInstance extends ClientRef {
  end(): void;
}

interface PageState {
  generation: number;
  live: PageInstance | null;
}

const states = new WeakMap<WebContents, PageState>();
const pages = new WeakMap<ClientRef, WebContents>(); // the live instances only

// The live instance's ref, minting the next generation's on the first call after the previous instance ended.
export function clientOf(contents: WebContents): ClientRef {
  let state = states.get(contents);
  if (!state) {
    const current: PageState = (state = { generation: 0, live: null });
    states.set(contents, state);
    const end = () => {
      current.live?.end();
      current.live = null;
    };
    contents.on('destroyed', end);
    contents.on('render-process-gone', end);
    contents.on('did-start-navigation', (details: WebContentsDidStartNavigationEventParams) => {
      if (details.isMainFrame && !details.isSameDocument) end();
    });
  }
  if (state.live) return state.live;
  state.generation += 1;
  const instance = pageInstance(`page:${contents.id}.${state.generation}` as ClientId);
  if (contents.isDestroyed()) {
    instance.end(); // a destroyed page emits nothing more; its ref is gone from the start
    return instance;
  }
  state.live = instance;
  pages.set(instance, contents);
  return instance;
}

// The page itself while its instance lives, for the client-shell handlers that act on it; null once it has ended.
export function pageOf(client: ClientRef): WebContents | null {
  return pages.get(client) ?? null;
}

function pageInstance(id: ClientId): PageInstance {
  let listeners: Set<() => void> | null = new Set();
  const instance: PageInstance = {
    id,
    onGone(listener) {
      if (!listeners) {
        listener();
        return () => {};
      }
      const entry = () => listener(); // its own identity, so one function added twice unsubscribes each
      listeners.add(entry);
      return () => listeners?.delete(entry);
    },
    end() {
      if (!listeners) return;
      const ending = [...listeners];
      listeners = null;
      pages.delete(instance);
      for (const listener of ending) {
        try {
          listener();
        } catch (error) {
          console.error(`[ipc] a gone listener of ${id} failed`, error); // the others still release
        }
      }
    },
  };
  return instance;
}
