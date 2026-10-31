// Main's clients (P5 O1 M2): one `ClientRef` per page instance. A page instance is a window's top-frame document from its
// load until it ends, and it ends on the first of `destroyed`, `render-process-gone`, or a `did-start-navigation` with
// `isMainFrame && !isSameDocument`. Every piece of per-client state releases on that one moment, so a reloaded page
// loses what its previous document held, and asks again on mount.
//
// The race this does not resolve: a request the old document sent after its navigation started arrives after the end,
// and `clientOf` attributes it to the new instance (as the visibility handler always did). Telling them apart would
// need the sender's frame token at invoke time; the new document re-asks on mount, so the stray request is harmless.
import type { WebContents, WebContentsDidStartNavigationEventParams } from 'electron';
import { endableClientRef, type ClientRef, type EndableClientRef } from '@shared/ipc/client';

interface PageState {
  generation: number;
  live: EndableClientRef | null;
}

const states = new WeakMap<WebContents, PageState>();
const pages = new WeakMap<ClientRef, WebContents>(); // the live instances only
const byId = new Map<string, ClientRef>(); // P5 O3-D M5b: the live instances by id, for a request mawsd sends back (clientOfId)

// The live instance's ref, minting the next generation's on the first call after the previous instance ended.
export function clientOf(contents: WebContents): ClientRef {
  let state = states.get(contents);
  if (!state) {
    const current: PageState = (state = { generation: 0, live: null });
    states.set(contents, state);
    const end = () => {
      const ending = current.live;
      if (!ending) return;
      pages.delete(ending); // before its listeners run, so pageOf answers null inside them
      byId.delete(ending.id);
      ending.end();
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
  const instance = endableClientRef(`page:${contents.id}.${state.generation}`);
  if (contents.isDestroyed()) {
    instance.end(); // a destroyed page emits nothing more; its ref is gone from the start
    return instance;
  }
  state.live = instance;
  pages.set(instance, contents);
  byId.set(instance.id, instance);
  return instance;
}

// P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §E): the live instance a `ClientRef` id
// names (the id main's `machine` transport sent with a request, which `mawsd`'s client port names back); null once it
// ended.
export function clientOfId(id: string): ClientRef | null {
  return byId.get(id) ?? null;
}

// The page itself while its instance lives, for the client-shell handlers that act on it; null once it has ended.
export function pageOf(client: ClientRef): WebContents | null {
  return pages.get(client) ?? null;
}

// P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §D): main itself as the asker of its own
// in-process calls (`library.read`'s files.readResolved). Never ended: it holds no watch; on the daemon shape mawsd's
// front mints a ref for its id that never goes, harmless for a read.
export const mainClient: ClientRef = endableClientRef('main');
