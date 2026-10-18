// DX8 — the layout: where the owner is (the grid, every session of the org, or a project and one of its channels) and
// the depth column's state. The route is the URL's (`/`, `/sessions`, `/p/<project>`, `/p/<project>/s/<session>`), so a
// reload and a link land in the same place; the depth column's open state and width are the browser's own and outlive a reload.
import { create } from 'zustand';

export type Channel = { kind: 'group' } | { kind: 'session'; session: string };
export type Route = { view: 'grid' } | { view: 'org' } | { view: 'project'; project: string; channel: Channel };

export type DepthState = { open: boolean; width: number };
const DEPTH_DEFAULT: DepthState = { open: true, width: 380 }; // MAWS's --panel-w
const DEPTH_KEY = 'desk.depth';

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) {
    if (parts[2] === 's' && parts[3]) return { view: 'project', project: parts[1], channel: { kind: 'session', session: parts[3] } };
    return { view: 'project', project: parts[1], channel: { kind: 'group' } };
  }
  if (parts[0] === 'sessions' && parts.length === 1) return { view: 'org' };
  return { view: 'grid' };
}

export function routePath(route: Route): string {
  if (route.view === 'grid') return '/';
  if (route.view === 'org') return '/sessions';
  const base = `/p/${encodeURIComponent(route.project)}`;
  return route.channel.kind === 'group' ? base : `${base}/s/${encodeURIComponent(route.channel.session)}`;
}

function readDepth(): DepthState {
  try {
    const stored = JSON.parse(localStorage.getItem(DEPTH_KEY) ?? 'null') as Partial<DepthState> | null;
    return { open: typeof stored?.open === 'boolean' ? stored.open : DEPTH_DEFAULT.open, width: typeof stored?.width === 'number' ? stored.width : DEPTH_DEFAULT.width };
  } catch {
    return DEPTH_DEFAULT;
  }
}

export type DeskLayout = {
  route: Route;
  depth: DepthState;
  navigate(route: Route): void;
  setDepth(depth: Partial<DepthState>): void;
};

export const useDeskLayout = create<DeskLayout>()((set, get) => ({
  route: parseRoute(location.pathname),
  depth: readDepth(),
  navigate(route) {
    const path = routePath(route);
    if (path !== location.pathname) history.pushState(null, '', path);
    set({ route });
  },
  setDepth(depth) {
    const next = { ...get().depth, ...depth };
    localStorage.setItem(DEPTH_KEY, JSON.stringify(next));
    set({ depth: next });
  },
}));

/** Follows the browser's back and forward buttons. */
export function followHistory(): () => void {
  const onPop = () => useDeskLayout.setState({ route: parseRoute(location.pathname) });
  addEventListener('popstate', onPop);
  return () => removeEventListener('popstate', onPop);
}
