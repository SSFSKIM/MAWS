// The render instances this window has mounted, keyed by session, site and instance (R2; the engine's ui_render
// contract, r6 §3.7; Claude Desktop's own registry, c95e4d2cf-BLkI1oZK.js:1302-1800, simplified): each instance asks
// `session.ui.render` when it mounts and when its props change, keeps one ask in flight (a change meanwhile asks again
// once it lands, so the last answer is for the latest props), and is asked again whenever the engine says its trees may
// be stale (`plugin.invalidate`, from a live batch). A site whose answer says no plugin hooks it (`hooked: false`) is not
// asked again until the next invalidate, as the engine allows. The answers live in a small store React reads; the
// bookkeeping is module state.
import { create } from 'zustand';
import type { RenderAnswer, SurfaceSite, SurfaceViewport } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { parseTree, type SurfaceNode } from './tree';

export interface SiteAddress {
  appSessionId: AppSessionId;
  component: SurfaceSite;
  instanceId: string;
}

export interface SiteAnswer {
  tree: SurfaceNode | null; // null: past the bounds, drawn as MAWS's own
  hooked: boolean;
  props: Record<string, unknown>; // what core was handed (a hook's rewrite of the props)
  rewritten: boolean;
}

interface Entry extends SiteAddress {
  client: MawsBridge;
  props: Record<string, unknown>;
  propsKey: string;
  viewport: SurfaceViewport | undefined;
  inFlight: boolean;
  again: boolean; // asked while in flight: ask once more when it lands
  mounts: number;
}

export const siteKey = ({ appSessionId, component, instanceId }: SiteAddress): string => `${appSessionId}\u0000${component}\u0000${instanceId}`;
const hookKey = (appSessionId: AppSessionId, component: SurfaceSite) => `${appSessionId}\u0000${component}`;

interface SurfaceAnswers {
  answers: ReadonlyMap<string, SiteAnswer>;
}
export const useSurfaceAnswers = create<SurfaceAnswers>()(() => ({ answers: new Map() }));

const entries = new Map<string, Entry>();
const unhooked = new Set<string>(); // sites a ui_render answered `hooked: false`, until the session's next invalidate

const propsKeyOf = (props: Record<string, unknown>, viewport: SurfaceViewport | undefined): string => JSON.stringify([props, viewport ?? null]);

function store(key: string, answer: SiteAnswer | null): void {
  useSurfaceAnswers.setState((s) => {
    const answers = new Map(s.answers);
    if (answer === null) answers.delete(key);
    else answers.set(key, answer);
    return { answers };
  });
}

function answerOf(value: RenderAnswer): SiteAnswer {
  return { tree: parseTree(value.tree), hooked: value.hooked, props: value.props, rewritten: value.rewritten };
}

async function ask(key: string): Promise<void> {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.inFlight) {
    entry.again = true;
    return;
  }
  if (unhooked.has(hookKey(entry.appSessionId, entry.component))) return;
  entry.inFlight = true;
  entry.again = false;
  const { appSessionId, component, instanceId, props, viewport } = entry;
  const result = await entry.client.invoke('session.ui.render', { appSessionId, component, instanceId, props, ...(viewport && { viewport }) });
  entry.inFlight = false;
  if (entries.get(key) !== entry) return; // unmounted meanwhile
  if (result.ok) {
    if (!result.value.hooked) unhooked.add(hookKey(appSessionId, component));
    store(key, answerOf(result.value));
  } else {
    console.warn(`[engine-surface] ${component} ${instanceId} not drawn: ${result.error.message}`);
  }
  if (entry.again) void ask(key);
}

// A site mounted: the instance is kept while any mount holds it. Returns the release, which forgets the instance and
// its answer once the last mount of it goes.
export function retainSite(client: MawsBridge, address: SiteAddress): () => void {
  const key = siteKey(address);
  let entry = entries.get(key);
  if (!entry) {
    entry = { ...address, client, props: {}, propsKey: '', viewport: undefined, inFlight: false, again: false, mounts: 0 };
    entries.set(key, entry);
  }
  entry.mounts += 1;
  entry.client = client;
  const held = entry;
  return () => {
    held.mounts -= 1;
    if (held.mounts > 0 || entries.get(key) !== held) return;
    entries.delete(key);
    store(key, null);
  };
}

// The mounted site's props and viewport as the app holds them now: asked when they differ from the last ask's.
export function setSiteProps(address: SiteAddress, props: Record<string, unknown>, viewport?: SurfaceViewport): void {
  const key = siteKey(address);
  const entry = entries.get(key);
  if (!entry) return;
  const propsKey = propsKeyOf(props, viewport);
  if (entry.propsKey === propsKey) return;
  entry.props = props;
  entry.viewport = viewport;
  entry.propsKey = propsKey;
  void ask(key);
}

// The engine says every tree it drew for the session may be stale: every mounted instance of it is asked again, and
// sites answered unhooked may be hooked now.
export function invalidateSession(appSessionId: AppSessionId): void {
  for (const key of [...unhooked]) if (key.startsWith(`${appSessionId}\u0000`)) unhooked.delete(key);
  for (const [key, entry] of entries) if (entry.appSessionId === appSessionId) void ask(key);
}

// The session's process went (or detached): its answers were that process's plugins'; a mounted instance asks afresh
// at the next attach.
export function forgetSession(appSessionId: AppSessionId): void {
  const prefix = `${appSessionId}\u0000`;
  for (const key of [...unhooked]) if (key.startsWith(prefix)) unhooked.delete(key);
  useSurfaceAnswers.setState((s) => ({ answers: new Map([...s.answers].filter(([key]) => !key.startsWith(prefix))) }));
  for (const entry of entries.values()) if (entry.appSessionId === appSessionId) entry.propsKey = '';
}

// Tests.
export function resetSurfaceRegistry(): void {
  entries.clear();
  unhooked.clear();
  useSurfaceAnswers.setState({ answers: new Map() });
}
