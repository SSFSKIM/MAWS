// E4a (Task 3.2): which layers the renderer draws over a placed pane (E4a execution document, Design §3 "Which layers
// cover"; Decision Log 2). A page's view is a native view above the whole renderer, so anything drawn where a pane is
// would be hidden under the page; the window's cover (`covering.ts`) hides the page while any layer here covers.
//
// One observer on `document.body`'s direct children: Radix portals render `asChild` into body, so a body child *is* the
// dialog element or the popper wrapper. Each child is classified in this order, because a Popover's content carries
// role="dialog" inside its popper wrapper:
//   1. a Radix popper wrapper (Popover, DropdownMenu, ContextMenu, HoverCard, Tooltip): covers when its rect meets a
//      pane, measured after two animation frames (floating-ui positions it asynchronously) and again on its own resize;
//      a Tooltip's never covers (small, transient; the chrome's own controls use native titles);
//   2. a dialog or alertdialog, or a child holding one: modal, covers while mounted (every Sheet, the palette, the widget
//      dialog, InlineEdit's confirm, the resume picker);
//   3. anything else but the app root, Radix's focus guards and inert elements: the intersection rule (the composer's
//      `@` and `/` popups, which tiptap mounts into body with no Radix marker; a Dialog's overlay).
// A second observer watches the toast viewport's toasts (inside the shell, at the window's bottom right, where a panel
// pane sits) under the intersection rule.
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoverWatch {
  refresh(): void; // the panes moved: every layer measured again (and a toast viewport mounted since, found)
  unwatch(): void;
}

export type LayerKind = 'modal' | 'measured' | 'never';

const POPPER = '[data-radix-popper-content-wrapper]';
const DIALOG = '[role="dialog"], [role="alertdialog"]';
const TOAST_VIEWPORT = '[data-toast-viewport]';
const INERT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);

export function classifyLayer(element: Element): LayerKind {
  if (element.matches(POPPER)) return element.querySelector('[role="tooltip"]') ? 'never' : 'measured';
  if (element.matches(DIALOG) || element.querySelector(DIALOG)) return 'modal';
  if (element.id === 'root' || element.matches('[data-radix-focus-guard]') || INERT.has(element.tagName)) return 'never';
  return 'measured';
}

// An area in common (an edge shared is none).
function meets(layer: DOMRect, pane: PaneRect): boolean {
  return layer.left < pane.x + pane.width && layer.right > pane.x && layer.top < pane.y + pane.height && layer.bottom > pane.y;
}

interface Measured {
  rect: DOMRect | null; // null until its two frames have passed
  frame: number;
  resize: ResizeObserver | null;
}

const elementsOf = (nodes: NodeList) => [...nodes].filter((node): node is Element => node instanceof Element);

// `rectsOf`: the placed panes' rects now; `onChange`: called on every change of the answer.
export function watchCoverLayers(rectsOf: () => readonly PaneRect[], onChange: (covered: boolean) => void, doc: Document = document): CoverWatch {
  const modal = new Set<Element>();
  const measured = new Map<Element, Measured>();
  let covered = false;
  let stopped = false;

  const evaluate = () => {
    if (stopped) return;
    const panes = rectsOf();
    const next = modal.size > 0 || [...measured.values()].some(({ rect }) => rect !== null && panes.some((pane) => meets(rect, pane)));
    if (next === covered) return;
    covered = next;
    onChange(next);
  };

  const forget = (element: Element) => {
    modal.delete(element);
    const entry = measured.get(element);
    if (entry) {
      cancelAnimationFrame(entry.frame);
      entry.resize?.disconnect();
      measured.delete(element);
    }
  };

  const track = (element: Element, kind: LayerKind = classifyLayer(element)) => {
    if (modal.has(element) || measured.has(element) || kind === 'never') return;
    if (kind === 'modal') {
      modal.add(element);
      return;
    }
    const entry: Measured = { rect: null, frame: 0, resize: null };
    measured.set(element, entry);
    entry.frame = requestAnimationFrame(() => {
      entry.frame = requestAnimationFrame(() => {
        entry.frame = 0;
        if (element.matches(POPPER) && classifyLayer(element) === 'never') {
          forget(element); // a tooltip whose content arrived after its wrapper
          return;
        }
        entry.rect = element.getBoundingClientRect();
        evaluate();
      });
    });
    if (typeof ResizeObserver !== 'undefined') {
      entry.resize = new ResizeObserver(() => {
        if (entry.rect === null) return;
        entry.rect = element.getBoundingClientRect();
        evaluate();
      });
      entry.resize.observe(element);
    }
  };

  const onMutations = (kind?: LayerKind) => (records: MutationRecord[]) => {
    for (const record of records) {
      elementsOf(record.removedNodes).forEach(forget);
      elementsOf(record.addedNodes).forEach((element) => track(element, kind));
    }
    evaluate();
  };

  const body = new MutationObserver(onMutations());
  body.observe(doc.body, { childList: true });
  [...doc.body.children].forEach((element) => track(element));

  const toasts = new MutationObserver(onMutations('measured'));
  let viewport: Element | null = null;
  const findViewport = () => {
    if (viewport?.isConnected) return;
    toasts.disconnect();
    viewport = doc.querySelector(TOAST_VIEWPORT);
    if (!viewport) return;
    toasts.observe(viewport, { childList: true });
    [...viewport.children].forEach((element) => track(element, 'measured'));
  };
  findViewport();
  evaluate();

  return {
    refresh() {
      if (stopped) return;
      findViewport();
      for (const [element, entry] of measured) {
        if (!element.isConnected) forget(element);
        else if (entry.rect !== null) entry.rect = element.getBoundingClientRect();
      }
      evaluate();
    },
    unwatch() {
      stopped = true;
      body.disconnect();
      toasts.disconnect();
      [...modal, ...measured.keys()].forEach(forget);
    },
  };
}
