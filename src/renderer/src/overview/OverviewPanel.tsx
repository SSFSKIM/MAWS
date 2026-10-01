// The floating Overview (§5.2 as amended 2026-10-01, W5; owner's ruling, Claude Desktop's floating side chat as the
// pattern): the board in a panel over the main area, not a tab. The top bar's button toggles it; ⌘0, the View menu and
// the palette open it (or bring focus back to it); Esc, the button and its close control close it. It is dragged by its
// header and resized from its corner, kept inside the main area, and its rect persists in `regions.overview`. The
// session behind it stays mounted and live. Opening moves focus to the panel itself, not to a card: a focused card
// answers its request with Enter and declines it with Esc, and Esc must first mean "close" (ArrowDown or Tab then
// reach the cards). Closing returns focus where it was; a session opened from inside the panel (a card, its request's
// Open session) closes it and leaves focus with the session's pane. The board inside is the Overview unchanged.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { OverviewRect } from '@shared/ipc/schema/layout';
import { focusPaneElement } from '../main/pane-dom';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { Overview } from './Overview';

const MIN = { width: 360, height: 240 };
// The first place: under the tab strip (40px) with a 12px gap, 16px clear of the sides and the bottom.
const DEFAULT = { width: 880, height: 640, top: 52, margin: 16 };
const PANEL_SELECTOR = '[data-overview-panel]';

// Focus onto the open panel.
export function focusOverview(): void {
  document.querySelector<HTMLElement>(PANEL_SELECTOR)?.focus();
}

// The rect inside an area of `bounds`: no smaller than the minimum (unless the area is), no larger than the area, and
// wholly inside it. With nothing stored, centred under the tab strip.
export function placeRect(stored: OverviewRect | null, bounds: { width: number; height: number }): OverviewRect {
  const fit = (value: number, min: number, max: number) => Math.round(Math.max(Math.min(min, max), Math.min(value, max)));
  const base = stored ?? firstPlace(bounds);
  const width = fit(base.width, MIN.width, bounds.width);
  const height = fit(base.height, MIN.height, bounds.height);
  return { width, height, x: fit(base.x, 0, bounds.width - width), y: fit(base.y, 0, bounds.height - height) };
}

function firstPlace(bounds: { width: number; height: number }): OverviewRect {
  const width = Math.min(DEFAULT.width, bounds.width - 2 * DEFAULT.margin);
  const height = Math.min(DEFAULT.height, bounds.height - DEFAULT.top - DEFAULT.margin);
  return { width, height, x: Math.round((bounds.width - width) / 2), y: DEFAULT.top };
}

function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Mounted over the main area (the element it fills is the area the panel moves in).
export function OverviewLayer() {
  const open = useLayout((s) => s.overviewOpen);
  const area = useRef<HTMLDivElement>(null);
  const bounds = useSize(area);
  return (
    <div ref={area} data-overview-area aria-hidden={!open || undefined} className="pointer-events-none absolute inset-0 z-30">
      {open && bounds && <OverviewPanel bounds={bounds} />}
    </div>
  );
}

type Gesture = { kind: 'move' | 'resize'; pointerX: number; pointerY: number; start: OverviewRect };

function OverviewPanel({ bounds }: { bounds: { width: number; height: number } }) {
  const stored = useLayout((s) => s.regions.overview);
  const paneIndex = useLayout((s) => s.main.focusedPane);
  const panel = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<OverviewRect | null>(null); // the rect while a drag or resize moves it
  const gesture = useRef<Gesture | null>(null);
  const rect = live ?? placeRect(stored, bounds);

  // Focus comes in on open and goes back where it was on close, unless a session opened from inside took the stage.
  const opener = useRef<Element | null>(null);
  const restoreFocus = useRef(true);
  useEffect(() => {
    opener.current = document.activeElement;
    focusOverview();
    return () => {
      if (!restoreFocus.current) return;
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus();
      else focusPaneElement(useLayout.getState().main.focusedPane);
    };
  }, []);

  // A session opened while focus is inside the panel (a card's click or Enter, its request's Open session) closes it.
  useEffect(
    () =>
      useLayout.subscribe((state, previous) => {
        if (!state.overviewOpen || activeTab(state.main)?.id === activeTab(previous.main)?.id) return;
        if (!panel.current?.contains(document.activeElement)) return;
        restoreFocus.current = false;
        state.setOverviewOpen(false);
        requestAnimationFrame(() => focusPaneElement(useLayout.getState().main.focusedPane));
      }),
    [],
  );

  const close = () => useLayout.getState().setOverviewOpen(false);

  const begin = (kind: Gesture['kind'], event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (kind === 'move' && (event.target as HTMLElement).closest('button'))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId); // as the Resizer does: happy-dom has none
    gesture.current = { kind, pointerX: event.clientX, pointerY: event.clientY, start: rect };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.pointerX;
    const dy = event.clientY - g.pointerY;
    const next =
      g.kind === 'move'
        ? { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
        : { ...g.start, width: g.start.width + dx, height: g.start.height + dy };
    setLive(placeRect(next, bounds));
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = null;
    if (live) useLayout.getState().setOverviewRect(live);
    setLive(null);
  };

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Overview"
      data-overview-panel
      tabIndex={-1}
      onKeyDown={(event) => {
        // From the panel itself, ArrowDown enters the board at its tab stop.
        if (event.key === 'ArrowDown' && event.target === event.currentTarget) {
          event.preventDefault();
          panel.current?.querySelector<HTMLElement>('[data-card][tabindex="0"]')?.focus();
          return;
        }
        // A card's request takes Esc first (its decline); only a key nobody handled closes the panel.
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        close();
      }}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border border-border-strong bg-bg shadow-float outline-none"
    >
      <div
        data-overview-header
        onPointerDown={(event) => begin('move', event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-bg-raised pr-1.5 pl-4 select-none active:cursor-grabbing"
      >
        <h2 className="m-0 text-ui font-semibold text-fg">Overview</h2>
        <button
          type="button"
          aria-label="Close Overview"
          title="Close · Esc"
          onClick={close}
          className="ml-auto inline-flex size-6 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Overview paneIndex={paneIndex} />
      </div>
      <div
        aria-hidden
        data-overview-resize
        onPointerDown={(event) => begin('resize', event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute right-0 bottom-0 size-4 cursor-nwse-resize"
      />
    </div>
  );
}
