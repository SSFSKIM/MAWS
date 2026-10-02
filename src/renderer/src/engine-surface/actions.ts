// What the person does to a plugin's drawing, sent to the engine through X2 (R2): an element is named by the `plugin`
// and `handle` its latest drawing carried, with its `key`, site and instance so a field redrawn while typed in is
// re-resolved; the engine runs the plugin's own handler and answers whether one ran. A failure is logged, never thrown
// at the person: the drawing simply stays as it was until the plugin redraws it.
import type { ScrollSite, SurfaceElement, SurfaceSite } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Press } from './tree';

export interface Site {
  appSessionId: AppSessionId;
  component: SurfaceSite;
  instanceId: string;
  client: MawsBridge;
}

const warn = (what: string) => (result: { ok: boolean; error?: { message: string } }) => {
  if (!result.ok) console.warn(`[engine-surface] ${what} not sent: ${result.error?.message ?? 'unknown error'}`);
};

export function press(site: Site, element: Press, key: string, href?: string): void {
  void site.client.invoke('session.ui.press', { appSessionId: site.appSessionId, plugin: element.plugin, handle: element.handle, key, ...(href !== undefined && { href }) }).then(warn(`press on ${key}`));
}

export function input(site: Site, element: Press, key: string, kind: 'change' | 'submit', value: string): void {
  void site.client
    .invoke('session.ui.input', { appSessionId: site.appSessionId, plugin: element.plugin, handle: element.handle, kind, value, key, component: site.component, instanceId: site.instanceId })
    .then(warn(`${kind} of ${key}`));
}

export function select(site: Site, element: Press, key: string, value: string): void {
  void site.client
    .invoke('session.ui.select', { appSessionId: site.appSessionId, plugin: element.plugin, handle: element.handle, value, key, component: site.component, instanceId: site.instanceId })
    .then(warn(`pick in ${key}`));
}

// The keyboard moved in a scrolling site (the band, a pane): held or let go, and the element now holding it.
export function focus(site: Site & { component: ScrollSite }, isHeld: boolean, element: SurfaceElement | null): void {
  void site.client.invoke('session.ui.focus', { appSessionId: site.appSessionId, component: site.component, instanceId: site.instanceId, isHeld, element, by: 'person' }).then(warn('focus'));
}

// The person scrolled a site: its window in rows of the line height, and the move.
export async function scroll(site: Site & { component: ScrollSite }, window: { offset: number; by: number; bodyRows: number; contentRows: number }): Promise<{ offset: number | null; followEnd: boolean } | null> {
  const result = await site.client.invoke('session.ui.scroll', { appSessionId: site.appSessionId, component: site.component, instanceId: site.instanceId, ...window });
  if (!result.ok) {
    warn('scroll')(result);
    return null;
  }
  return { offset: result.value.offset, followEnd: result.value.followEnd };
}
