// One render site as the app places it (R2): asks the instance while the session is attached and draws the answer
// through SurfaceTree, or MAWS's own drawing (`engine`) when no plugin hooks the site, the answer is MAWS's own, or the
// tree is past the bounds. A scrolling site (the band above the composer, a pane) also tells the engine where the
// keyboard and the window are (`session.ui.focus`, `session.ui.scroll`, in rows of the line height), follows a plugin's
// own moves of them (`plugin.focus`, `plugin.scroll`, from live batches), and presses a Button by its hotkey while the
// site holds the keyboard.
import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { ScrollSite, SurfaceSite as SiteName, SurfaceViewport } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { focus as sendFocus, scroll as sendScroll, type Site } from './actions';
import type { SiteAnswer } from './registry';
import { useSurfaceSite } from './site';
import { SurfaceTree } from './SurfaceTree';
import { drawsEngine } from './tree';

export interface SurfaceSiteProps {
  appSessionId: AppSessionId | null;
  component: SiteName;
  instanceId: string;
  props: Record<string, unknown>;
  viewport?: SurfaceViewport;
  enabled?: boolean;
  // MAWS's own drawing of the site, or how to draw it from the answer (a hook that rewrote the props and drew nothing)
  engine?: ReactNode | ((answer: SiteAnswer | null) => ReactNode);
  // what wraps a drawn tree (the band's frame, the chip's look); absent, the tree alone
  frame?: (tree: ReactNode, answer: SiteAnswer) => ReactNode;
  client?: MawsBridge;
}

const isScrollSite = (component: SiteName): component is ScrollSite => component === 'Pane' || component === 'AbovePrompt';

// The plugin's drawing when there is one to draw, else null.
export function drawnTree(answer: SiteAnswer | null): SiteAnswer | null {
  return answer && answer.hooked && !drawsEngine(answer.tree) ? answer : null;
}

export function SurfaceSite({ appSessionId, component, instanceId, props, viewport, enabled = true, engine = null, frame, client = ipc }: SurfaceSiteProps) {
  const answer = useSurfaceSite({ appSessionId, component, instanceId, props, viewport, enabled, client });
  const drawn = drawnTree(answer);
  const own = typeof engine === 'function' ? engine(answer) : engine;
  if (appSessionId === null || drawn === null) return <>{own}</>;
  const site: Site = { appSessionId, component, instanceId, client };
  const tree = <SurfaceTree tree={drawn.tree!} site={site} engine={own} />;
  const body = isScrollSite(component) ? <ScrollingSite site={{ ...site, component }}>{tree}</ScrollingSite> : tree;
  return <>{frame ? frame(body, drawn) : body}</>;
}

const lineHeight = (element: HTMLElement): number => {
  const parsed = Number.parseFloat(getComputedStyle(element).lineHeight);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
};

// The window and its content in rows of the line height.
function geometry(container: HTMLElement) {
  const line = lineHeight(container);
  return { line, offset: Math.round(container.scrollTop / line), bodyRows: Math.max(1, Math.round(container.clientHeight / line)), contentRows: Math.round(container.scrollHeight / line) };
}

// MAWS moves the window itself (a plugin's move, the engine's adjustment, following the end): a scroll event that finds
// the window where MAWS put it is not the person's and is not reported back.
function moveTo(container: HTMLElement, top: number, placed: { current: number | null }): void {
  container.scrollTop = top;
  placed.current = container.scrollTop; // as clamped
}

function ScrollingSite({ site, children }: { site: Site & { component: ScrollSite }; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastOffset = useRef(0); // the window's first row as the engine last heard or set it
  const reported = useRef(''); // the geometry last reported, so an unchanged layout reports nothing
  const following = useRef(false); // a plugin asked the window to follow its end, until it says otherwise or the person scrolls away
  const placed = useRef<number | null>(null); // where MAWS last put the window itself, until a scroll event finds it there
  const frame = useRef<number | null>(null);
  const siteRef = useRef(site);
  useLayoutEffect(() => void (siteRef.current = site));


  // The layout as it stands, on mount and whenever the window or its content changes size (a zero-move report), so a
  // plugin's `$.ui.scroll({ to: 'end' })` knows the last row before the person ever scrolls (pass3/mods-surface-panes
  // seq 49 before 52); a followed end stays in view through redraws and resizes.
  useEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const onResize = () => {
      if (following.current) moveTo(container, container.scrollHeight, placed);
      const { offset, bodyRows, contentRows } = geometry(container);
      const key = `${offset}:${bodyRows}:${contentRows}`;
      if (key === reported.current) return;
      reported.current = key;
      lastOffset.current = offset;
      void sendScroll(siteRef.current, { offset, by: 0, bodyRows, contentRows });
    };
    const observer = new ResizeObserver(onResize);
    const watch = () => {
      observer.disconnect();
      observer.observe(container);
      for (const child of Array.from(container.children)) observer.observe(child);
    };
    watch();
    const redrawn = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch); // a redraw may replace the root
    redrawn?.observe(container, { childList: true });
    return () => {
      observer.disconnect();
      redrawn?.disconnect();
    };
  }, []);

  // a plugin's own moves of the ring and the window
  useEffect(
    () =>
      site.client.on('session.eventBatch', ({ appSessionId, events }) => {
        if (appSessionId !== site.appSessionId) return;
        const container = ref.current;
        if (!container) return;
        for (const event of events) {
          if ((event.kind !== 'plugin.focus' && event.kind !== 'plugin.scroll') || event.component !== site.component || event.instanceId !== site.instanceId) continue;
          if (event.kind === 'plugin.focus') {
            const target = container.querySelector<HTMLElement>(`[data-plugin="${CSS.escape(event.plugin)}"][data-key="${CSS.escape(event.key)}"]`);
            const focusable = target?.matches('button, input, select') ? target : target?.querySelector<HTMLElement>('input, select, button');
            focusable?.focus();
          } else {
            following.current = event.followEnd;
            const line = lineHeight(container);
            moveTo(container, event.followEnd ? container.scrollHeight : event.offset * line, placed);
            lastOffset.current = event.followEnd ? Math.round(container.scrollTop / line) : event.offset;
          }
        }
      }),
    [site.client, site.appSessionId, site.component, site.instanceId],
  );
  useEffect(() => () => void (frame.current !== null && cancelAnimationFrame(frame.current)), []);

  const elementOf = (target: EventTarget | null) => {
    const element = (target as HTMLElement | null)?.closest?.('[data-plugin][data-key]');
    return element ? { plugin: element.getAttribute('data-plugin')!, key: element.getAttribute('data-key')! } : null;
  };
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    sendFocus(site, true, elementOf(event.target));
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (ref.current?.contains(event.relatedTarget as Node | null)) return;
    sendFocus(site, false, null);
  };
  // The person's move, once per frame: the offset the engine held before it and the rows it covered (the engine applies
  // `by` to `offset`, pass3/mods-surface-panes seq 59/60); the window then goes where the engine says it is.
  const onScroll = () => {
    const container = ref.current;
    if (container && placed.current !== null && container.scrollTop === placed.current) {
      placed.current = null;
      return;
    }
    placed.current = null;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const container = ref.current;
      if (!container) return;
      const { line, offset, bodyRows, contentRows } = geometry(container);
      const before = lastOffset.current;
      const by = offset - before;
      if (by === 0) return;
      if (by < 0) following.current = false; // scrolled up, away from the followed end
      lastOffset.current = offset;
      reported.current = `${offset}:${bodyRows}:${contentRows}`;
      void sendScroll(site, { offset: before, by, bodyRows, contentRows }).then((answer) => {
        if (!answer) return;
        following.current = answer.followEnd;
        if (answer.offset === null || answer.offset === lastOffset.current || ref.current !== container) return;
        lastOffset.current = answer.offset;
        moveTo(container, answer.offset * line, placed);
      });
    });
  };
  // a Button's hotkey presses it while the site holds the keyboard, never from a field
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || !/^[0-9a-z]$/i.test(event.key)) return;
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    const button = ref.current?.querySelector<HTMLButtonElement>(`[data-hotkey="${event.key.toLowerCase()}"]`);
    if (!button) return;
    event.preventDefault();
    button.click();
  };
  return (
    <div ref={ref} data-surface-site={site.component} data-instance={site.instanceId} className="min-h-0 min-w-0 overflow-auto" onFocus={onFocus} onBlur={onBlur} onScroll={onScroll} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
