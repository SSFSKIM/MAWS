// Shell keyboard navigation uses the mounted DOM, not just persisted layout state: a narrow window, maximized
// surface or collapsed split can leave its content mounted but inert/hidden. Never move the keyboard into it.
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { focusPaneElement } from '../main/pane-dom';
import { showSidebar } from '../app/shell-view';

function available(element: HTMLElement): boolean {
  for (let at: HTMLElement | null = element; at !== null; at = at.parentElement) {
    if (at.hidden || at.hasAttribute('inert') || at.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(at);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

const FOCUSABLE = 'button, a[href], input:not([type="hidden"]), textarea, select, [tabindex], [contenteditable="true"]';

function firstControl(root: HTMLElement): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .find((element) => element.tabIndex >= 0 && !element.matches(':disabled, [role="separator"]') && available(element)) ?? null;
}

function focus(element: HTMLElement): void {
  // An empty pane still needs a focus stop. Programmatic-only tabindex does not add an extra Tab stop.
  if (!element.matches(FOCUSABLE)) element.tabIndex = -1;
  element.focus({ preventScroll: true });
}

function modalOwnsFocus(): boolean {
  return document.activeElement?.closest('[role="dialog"][data-state="open"]:not([data-hover-card]), [role="alertdialog"][data-state="open"], [aria-modal="true"]') !== null;
}

interface FocusStop { root: HTMLElement; target: HTMLElement }
function stop(root: HTMLElement): FocusStop | null {
  if (!available(root)) return null;
  return { root, target: firstControl(root) ?? root };
}

function regionStops(): FocusStop[] {
  const sidebar = document.getElementById('region-sidebar');
  const main = document.getElementById('region-main');
  const panel = document.getElementById('region-panel');
  const result: FocusStop[] = [];
  const add = (root: HTMLElement | null) => {
    const next = root && stop(root);
    if (next) result.push(next);
  };
  add(sidebar);
  if (main) {
    // The tab strip and pane body are distinct destinations. The chrome's portaled strips live outside region-main;
    // pair them with their pane, without treating tabs inside a tool's content as shell destinations.
    const panes = main.querySelectorAll<HTMLElement>('[data-pane]');
    if (panes.length === 0) add(main);
    for (const pane of panes) {
      const index = pane.getAttribute('data-pane');
      const strip = document.querySelector<HTMLElement>(`[data-chrome-pane="${index}"] [role="tablist"]`) ?? pane.querySelector<HTMLElement>('[data-pane-strip] [role="tablist"]');
      if (strip) {
        const next = stop(strip);
        const selected = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        if (next) result.push(selected && available(selected) ? { root: strip, target: selected } : next);
      }
      add(pane.querySelector<HTMLElement>('[role="tabpanel"]'));
    }
  }
  add(main?.querySelector<HTMLElement>('[data-region="cards"]') ?? null);
  if (panel && available(panel)) {
    const surfaces = panel.querySelectorAll<HTMLElement>('[data-surface]');
    if (surfaces.length > 0) {
      for (const surface of surfaces) {
        const content = surface.querySelector<HTMLElement>('[role="tabpanel"]');
        const next = content && stop(content);
        if (next) result.push({ root: surface, target: next.target });
      }
    } else {
      const next = stop(panel.querySelector<HTMLElement>('[data-panel-content]') ?? panel);
      if (next) result.push({ root: panel, target: next.target });
    }
  }
  return result;
}

export function focusRegion(delta: 1 | -1): void {
  if (modalOwnsFocus()) return;
  const stops = regionStops();
  if (stops.length === 0) return;
  const current = stops.findIndex(({ root }) => document.activeElement !== null && root.contains(document.activeElement));
  const index = current === -1 ? (delta === 1 ? 0 : stops.length - 1) : (current + delta + stops.length) % stops.length;
  focus(stops[index].target);
}

export function focusSidebar(): void {
  if (modalOwnsFocus()) return;
  showSidebar();
  const place = () => {
    const sidebar = document.getElementById('region-sidebar');
    const next = sidebar && stop(sidebar);
    if (next) focus(next.target);
    return next !== null;
  };
  // The explicit sidebar action reveals it (including the narrow-window overlay); region stepping never does.
  if (!place()) requestAnimationFrame(place);
}

export function stepMainTab(delta: 1 | -1): void {
  const main = document.getElementById('region-main');
  if (main && !available(main)) return;
  const focused = document.activeElement;
  const owner = focused?.closest('[data-chrome-pane]')?.getAttribute('data-chrome-pane') ?? focused?.closest('#region-main [data-pane]')?.getAttribute('data-pane');
  const pane = owner === '0' || owner === '1' ? Number(owner) as 0 | 1 : currentSet(useLayout.getState().main).focusedPane;
  useLayout.getState().focusPane(pane);
  useLayout.getState().cycleTab(delta);
  requestAnimationFrame(() => {
    const region = document.getElementById('region-main');
    const strip = document.querySelector<HTMLElement>(`[data-chrome-pane="${pane}"] [role="tablist"]`) ?? document.getElementById(`pane-${pane}`)?.querySelector<HTMLElement>('[data-pane-strip] [role="tablist"]');
    if (region && available(region) && strip && available(strip)) focusPaneElement(pane);
  });
}
