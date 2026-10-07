// Comment mode's hover UI and pick (E4d execution document, Design §3; A-33): imported by the browser view's preload
// (`browser.ts`) alone, so Rollup inlines it, with the two zod-free shared modules it reads, into out/preload/browser.js.
//
// Armed by main, it puts two nodes of its own under the page's root: a transparent shield over the viewport, which is
// what the pointer is over wherever it goes (a frame or a shadow host included), and an outline with a badge naming the
// element under the pointer. A click picks that element; a drag past `DRAG_THRESHOLD_PX` picks the area and the
// smallest element that holds it. The pick hides the outline, waits two frames so the presented frame carries none of
// it, re-measures, and sends main one report of geometry and names; main decides whether it counts (A-33). Esc is
// main's (`before-input-event`), and so is the URL; the crosshair is main's `insertCSS`, repeated on the shield.
//
// What the page sees of it: two nodes it can observe or remove, and nothing else. The shield carries no listener: it is
// a hit-test sink, so the pointer is over a MAWS node and never over a page element, frame or shadow host. Every trusted
// pointer and mouse event (`pointerrawupdate` included) while armed is taken at the window's capture phase, where this
// listener is the first (it is registered at install, and a preload runs before any page script), so no page listener,
// on an element, the document or the window, receives one, even when the page has raised something above the shield.
// The wheel is the one exception: its listener is registered at each arm (a non-passive wheel listener would hold every
// page's scrolling on its main thread), so only a window capture listener the page registered before the arm sees a
// wheel; every listener on the document or below is stopped. An event the page dispatches itself is never acted on
// (`isTrusted`). Nothing is posted to the page and no page string becomes markup (the badge is `textContent`). Styles
// are inline `!important` CSSOM writes, which a page's CSP does not govern.
//
// The DOM is typed structurally (`CommentPage`), as `describe.ts`'s is: src/preload compiles under the Node program,
// which has no DOM lib (Decision Log 27(l)).
import {
  COMMENT_CHANNEL,
  COMMENT_NODES,
  COMMENT_WORDS,
  DRAG_THRESHOLD_PX,
  elementLabel,
  trimDescription,
  type PickRect,
  type PreloadMessage,
} from '@shared/browser/comment-protocol';
import { accessibleNameOf, describeElement, roleOf, type DomDocument, type DomElement } from '@shared/browser/describe';

// --- the slice of the page this module reads (a browser window, and happy-dom's, satisfy it) ---

interface PageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
interface PageElement extends DomElement {
  readonly parentElement: PageElement | null;
  readonly isConnected: boolean;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  getBoundingClientRect(): PageRect;
  scrollBy(x: number, y: number): void;
}
// A node MAWS creates and owns.
interface OwnNode {
  readonly style: { setProperty(name: string, value: string, priority?: string): void };
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: OwnNode): unknown;
  getBoundingClientRect(): PageRect;
  remove(): void;
}
interface PageDocument extends DomDocument {
  readonly documentElement: (PageElement & { appendChild(child: OwnNode): unknown }) | null;
  readonly scrollingElement: PageElement | null; // the viewport's scroller: the root in standards mode, the body in quirks
  createElement(tagName: string): OwnNode;
  elementsFromPoint(x: number, y: number): ArrayLike<PageElement>;
}
interface PageEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
interface PagePointerEvent extends PageEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly relatedTarget: unknown;
}
interface PageWheelEvent extends PagePointerEvent {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}
type Listener = (event: PageEvent) => void;
type ListenerOptions = { capture: boolean; passive?: boolean };
export interface CommentPage {
  readonly document: PageDocument;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly scrollX: number;
  readonly scrollY: number;
  requestAnimationFrame(callback: () => void): number;
  scrollBy(x: number, y: number): void;
  getComputedStyle(element: PageElement): { readonly overflowX: string; readonly overflowY: string };
  addEventListener(type: string, listener: Listener, options: ListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options: ListenerOptions): void;
}
// Electron's `ipcRenderer` satisfies it.
export interface PreloadIpc {
  on(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
  send(channel: string, message: PreloadMessage): void;
}

// --- the hover UI's look: fixed colours (the page has no tokens; E2's picker and E4c's cursor use the same blue) ---

// Every property a page's stylesheet could plausibly set on an unknown element is pinned inline (`!important` inline
// beats the page's own `!important`); `transform`, `filter`, `contain` and `will-change` stay off so a fixed badge
// inside the overlay is placed against the viewport.
const RESET = { margin: '0', padding: '0', border: 'none', transform: 'none', filter: 'none', contain: 'none', 'will-change': 'auto', transition: 'none', animation: 'none', opacity: '1', visibility: 'visible', 'box-sizing': 'border-box', 'z-index': '2147483647' };
const SHIELD = { ...RESET, display: 'block', position: 'fixed', inset: '0', background: 'transparent', 'pointer-events': 'auto', 'user-select': 'none', 'touch-action': 'none', cursor: 'crosshair' };
const OVERLAY = { ...RESET, display: 'none', position: 'fixed', 'pointer-events': 'none', border: '2px solid #2f6feb', 'border-radius': '2px', background: 'rgba(47, 111, 235, 0.12)' };
const BADGE = {
  ...RESET,
  display: 'block',
  position: 'fixed',
  'pointer-events': 'none',
  'max-width': 'calc(100vw - 8px)',
  padding: '2px 6px',
  'border-radius': '4px',
  background: 'rgba(20, 20, 20, 0.85)',
  color: '#ffffff',
  font: '11px/16px -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  'letter-spacing': 'normal',
  'text-align': 'left',
  'text-transform': 'none',
  'white-space': 'pre',
  overflow: 'hidden',
  'text-overflow': 'ellipsis',
};
const BADGE_LABEL_MAX = 40; // E2's `TEXT_MAX` for page text
const BADGE_GAP = 4;

// Every pointer event a page could hear while armed (wheel apart: it is forwarded, and listened to only while armed, so
// an unarmed page keeps its scrolling off the main thread). Keys are untouched: the shield takes no focus.
const TAKEN = ['pointerdown', 'pointermove', 'pointerrawupdate', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'gotpointercapture', 'lostpointercapture', 'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'click', 'auxclick', 'dblclick', 'contextmenu'];
const CAPTURE: ListenerOptions = { capture: true };
const WHEEL: ListenerOptions = { capture: true, passive: false };
const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);
const LINE_PX = 16; // a wheel delta in lines (`deltaMode` 1)
const SCROLL_SLACK_PX = 1; // a scroller within a pixel of its end is at it (a fractional scrollTop at DPR 2)

type Point = { x: number; y: number };
// The press, in viewport and document coordinates, so a marquee survives a scroll during the drag.
type Press = { at: Point; doc: Point; area: boolean };
type Described = ReturnType<typeof trimDescription>;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const contains = (outer: PageRect, inner: PickRect) =>
  outer.left <= inner.x && outer.top <= inner.y && outer.left + outer.width >= inner.x + inner.width && outer.top + outer.height >= inner.y + inner.height;
const rectOf = (box: PageRect): PickRect => ({ x: box.left, y: box.top, width: box.width, height: box.height });

export function installCommentMode(ipc: PreloadIpc, page: CommentPage = globalThis as unknown as CommentPage): () => void {
  const doc = page.document;
  const send = (message: PreloadMessage) => ipc.send(COMMENT_CHANNEL.fromPreload, message);

  // armed while `epoch` is not null; `generation` counts arms and disarms, so a pick waiting on frames knows it is stale
  let epoch: number | null = null;
  let generation = 0;
  let picked = false; // the arm's one report is taken
  let ui: { shield: OwnNode; overlay: OwnNode; badge: OwnNode } | null = null;
  let hovered: PageElement | null = null;
  let hinted = false;
  let pointer: Point | null = null;
  let press: Press | null = null;

  const set = (node: OwnNode, styles: Record<string, string>) => {
    for (const [name, value] of Object.entries(styles)) node.style.setProperty(name, value, 'important');
  };
  const own = (tag: string, styles: Record<string, string>): OwnNode => {
    const node = doc.createElement(tag);
    node.setAttribute(COMMENT_NODES.marker, '');
    set(node, styles);
    return node;
  };

  // The page element under a point: the top of the hit-test stack, MAWS's own nodes skipped. A shadow tree answers its
  // host and a frame its element (Decision Log 11).
  const hit = (x: number, y: number): PageElement | null => {
    for (const element of Array.from(doc.elementsFromPoint(x, y))) if (!element.hasAttribute(COMMENT_NODES.marker)) return element;
    return null;
  };

  const outline = (rect: PickRect, label: string) => {
    if (ui === null) return;
    set(ui.overlay, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    if (ui.badge.textContent !== label) ui.badge.textContent = label;
    const { width, height } = ui.badge.getBoundingClientRect(); // above the element, else below it, inside the viewport
    const above = rect.y - height - BADGE_GAP;
    const top = above >= 0 ? above : Math.min(rect.y + rect.height + BADGE_GAP, page.innerHeight - height);
    set(ui.badge, { left: `${clamp(rect.x, 0, Math.max(0, page.innerWidth - width))}px`, top: `${Math.max(0, top)}px` });
  };
  const hide = () => {
    if (ui !== null) set(ui.overlay, { display: 'none' });
  };

  // The badge names the hovered element with its role and name alone (`describeElement` walks every ancestor, so it
  // runs once per pick, Decision Log 27(n)); the first element hovered in an arm carries the hint under its name.
  let named: { element: PageElement; label: string } | null = null; // the last element named, so a drag names it once
  const nameOf = (element: PageElement) => {
    if (named?.element !== element) named = { element, label: elementLabel({ role: roleOf(element), name: accessibleNameOf(element), tag: element.localName }, BADGE_LABEL_MAX) };
    return named.label;
  };
  let hoverLabel = '';
  const hover = (at: Point) => {
    const element = hit(at.x, at.y);
    if (element === null) {
      hovered = null;
      hide();
      return;
    }
    if (element !== hovered) {
      hoverLabel = hinted ? nameOf(element) : `${nameOf(element)}\n${COMMENT_WORDS.hint}`;
      hinted = true;
      hovered = element;
    }
    outline(rectOf(element.getBoundingClientRect()), hoverLabel);
  };

  // The marquee from the press to a point, in today's viewport coordinates, clamped to the viewport.
  const marquee = (from: Press, to: Point): PickRect => {
    const start = { x: from.doc.x - page.scrollX, y: from.doc.y - page.scrollY };
    const left = clamp(Math.min(start.x, to.x), 0, page.innerWidth);
    const right = clamp(Math.max(start.x, to.x), 0, page.innerWidth);
    const top = clamp(Math.min(start.y, to.y), 0, page.innerHeight);
    const bottom = clamp(Math.max(start.y, to.y), 0, page.innerHeight);
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  // The smallest element holding the marquee: from the element under its centre up to the root.
  const container = (area: PickRect): PageElement | null => {
    let element = hit(area.x + area.width / 2, area.y + area.height / 2) ?? doc.documentElement;
    while (element !== null && element !== doc.documentElement && !contains(element.getBoundingClientRect(), area)) element = element.parentElement;
    return element;
  };
  const drag = (from: Press, to: Point) => {
    const area = marquee(from, to);
    const element = container(area);
    outline(area, element === null ? '' : nameOf(element));
  };

  // The trimmed description of a picked element, or null after sending the refusal that says why there is none.
  // `describeElement` runs here, once per pick.
  const describeOrRefuse = (element: PageElement | null, epoch: number, requestId: string | null): Described | null => {
    if (element === null) {
      send({ type: 'refused', epoch, requestId, reason: 'noElement' });
      return null;
    }
    const described = describeElement(element);
    if (described === null) {
      send({ type: 'refused', epoch, requestId, reason: 'tooDeep' });
      return null;
    }
    return trimDescription(described);
  };
  const sendPicked = (pick: { epoch: number; requestId: string | null; mode: 'click' | 'area' }, described: Described, rect: PickRect) =>
    send({ type: 'picked', ...pick, ...described, rect, scroll: { x: page.scrollX, y: page.scrollY }, viewport: { width: page.innerWidth, height: page.innerHeight } });

  // The pointer's pick: the hover UI hidden, two frames waited so the presented frame (what main's crop reads) carries
  // none of it, the rect measured again, one report.
  const pick = (from: Press, to: Point) => {
    if (epoch === null) return;
    picked = true;
    const area = from.area ? marquee(from, to) : null;
    const element = area === null ? hit(to.x, to.y) : container(area);
    const described = describeOrRefuse(element, epoch, null);
    hide();
    if (described === null || element === null) return;
    // the marquee kept in document coordinates and re-derived after the wait, so a page that scrolled meanwhile is
    // still cropped where the person pointed
    const kept = area === null ? null : { ...area, x: area.x + page.scrollX, y: area.y + page.scrollY };
    // a clicked element that went away (or out of layout) during the wait measures 0 x 0: its pointer-up rect stands
    const atUp = rectOf(element.getBoundingClientRect());
    const remeasured = () => {
      const now = rectOf(element.getBoundingClientRect());
      return element.isConnected && now.width > 0 && now.height > 0 ? now : atUp;
    };
    const report = { epoch, requestId: null, mode: area === null ? ('click' as const) : ('area' as const) };
    const mine = generation;
    page.requestAnimationFrame(() =>
      page.requestAnimationFrame(() => {
        if (mine !== generation) return; // disarmed or re-armed meanwhile: main would drop it
        const rect = kept === null ? remeasured() : { ...kept, x: kept.x - page.scrollX, y: kept.y - page.scrollY };
        sendPicked(report, described, rect);
      }),
    );
  };

  const teardown = () => {
    if (ui !== null) {
      ui.shield.remove();
      ui.overlay.remove();
      page.removeEventListener('wheel', onWheel, WHEEL);
    }
    ui = null;
    epoch = null;
    generation += 1;
    picked = false;
    hovered = null;
    named = null;
    hinted = false;
    pointer = null;
    press = null;
  };

  const arm = (next: number) => {
    teardown();
    const root = doc.documentElement;
    if (root === null) return; // no document to pick in yet: stay disarmed rather than take input with no shield up
    const shield = own(COMMENT_NODES.shield, SHIELD);
    const overlay = own(COMMENT_NODES.overlay, OVERLAY);
    const badge = own(COMMENT_NODES.badge, BADGE);
    overlay.appendChild(badge);
    root.appendChild(shield);
    root.appendChild(overlay);
    ui = { shield, overlay, badge };
    epoch = next;
    page.addEventListener('wheel', onWheel, WHEEL);
  };

  // --- the page's pointer events, while armed ---

  const onPointer: Listener = (event) => {
    if (epoch === null || !event.isTrusted) return;
    event.stopImmediatePropagation();
    // a pointerdown is left uncancelled so its mousedown still comes, and that one's default (focus, selection) is cancelled
    if (event.type !== 'pointerdown') event.preventDefault();
    if (picked) return;
    const { clientX: x, clientY: y, button, relatedTarget } = event as PagePointerEvent;
    switch (event.type) {
      case 'pointermove':
        pointer = { x, y };
        if (press === null) hover(pointer);
        else {
          if (!press.area && Math.hypot(x - press.at.x, y - press.at.y) > DRAG_THRESHOLD_PX) press.area = true;
          if (press.area) drag(press, pointer);
        }
        return;
      case 'pointerdown':
        if (button === 0) press = { at: { x, y }, doc: { x: x + page.scrollX, y: y + page.scrollY }, area: false };
        return;
      case 'pointerup': {
        const from = press;
        press = null;
        if (button === 0 && from !== null) pick(from, { x, y });
        return;
      }
      case 'pointercancel':
        press = null;
        return;
      case 'pointerout':
        if (relatedTarget === null && press === null) {
          pointer = null;
          hovered = null;
          hide();
        }
        return;
    }
  };

  // A wheel over the shield would scroll only the viewport; it goes to the nearest ancestor of the element under the
  // pointer that can still scroll its way (the viewport when none: `scrollingElement` is the viewport's scroller, so a
  // body that scrolls by itself is an ancestor like any other), so nested panes scroll while the person looks.
  const canScroll = (element: PageElement, dx: number, dy: number) => {
    const style = page.getComputedStyle(element);
    const room = (position: number, view: number, extent: number, delta: number) => (delta > 0 ? position + view < extent - SCROLL_SLACK_PX : position > SCROLL_SLACK_PX);
    const vertical = dy !== 0 && SCROLLABLE.has(style.overflowY) && room(element.scrollTop, element.clientHeight, element.scrollHeight, dy);
    const horizontal = dx !== 0 && SCROLLABLE.has(style.overflowX) && room(element.scrollLeft, element.clientWidth, element.scrollWidth, dx);
    return vertical || horizontal;
  };
  const onWheel: Listener = (event) => {
    if (epoch === null || !event.isTrusted) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const wheel = event as PageWheelEvent;
    if (wheel.ctrlKey) return; // a trackpad pinch (or ctrl+wheel) is a zoom, not a scroll: taken, nothing moves
    const dx = wheel.deltaX * (wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? page.innerWidth : 1);
    const dy = wheel.deltaY * (wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? page.innerHeight : 1);
    const viewport = doc.scrollingElement ?? doc.documentElement;
    for (let element = hit(wheel.clientX, wheel.clientY); element !== null && element !== viewport && element !== doc.documentElement; element = element.parentElement) {
      if (canScroll(element, dx, dy)) return element.scrollBy(dx, dy);
    }
    page.scrollBy(dx, dy);
  };

  // A scroll or resize moves what is under a still pointer: the outline (or the marquee) follows.
  const onLayout: Listener = () => {
    if (epoch === null || picked || pointer === null) return;
    if (press === null) hover(pointer);
    else if (press.area) drag(press, pointer);
  };

  // --- main's messages ---

  const pickAt = (x: number, y: number, requestId: string, at: number) => {
    const element = hit(x, y);
    const described = describeOrRefuse(element, at, requestId);
    if (described !== null && element !== null) sendPicked({ epoch: at, requestId, mode: 'click' }, described, rectOf(element.getBoundingClientRect()));
  };

  const onMessage = (_event: unknown, message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const m = message as Record<string, unknown>;
    if (m.type === 'arm' && isNumber(m.epoch)) arm(m.epoch);
    else if (m.type === 'disarm') teardown();
    else if (m.type === 'pickAt' && isNumber(m.x) && isNumber(m.y) && isNumber(m.epoch) && typeof m.requestId === 'string') pickAt(m.x, m.y, m.requestId, m.epoch);
  };

  for (const type of TAKEN) page.addEventListener(type, onPointer, CAPTURE);
  page.addEventListener('scroll', onLayout, CAPTURE);
  page.addEventListener('resize', onLayout, CAPTURE);
  ipc.on(COMMENT_CHANNEL.toPreload, onMessage);

  return () => {
    teardown();
    for (const type of TAKEN) page.removeEventListener(type, onPointer, CAPTURE);
    page.removeEventListener('scroll', onLayout, CAPTURE);
    page.removeEventListener('resize', onLayout, CAPTURE);
    ipc.removeListener(COMMENT_CHANNEL.toPreload, onMessage);
  };
}
