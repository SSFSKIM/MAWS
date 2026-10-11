// Comment mode's hover UI and pick (E4d execution document, Design §3; A-33): imported by the browser view's preload
// (`browser.ts`) alone, so Rollup inlines it, with the two zod-free shared modules it reads, into out/preload/browser.js.
//
// Armed by main, it puts two nodes of its own under the page's root: a transparent shield over the viewport, which is
// what the pointer is over wherever it goes (a frame or a shadow host included), and an outline with a badge naming the
// element under the pointer, and tells main the shield is up (main shows the tab armed from that answer alone, so a
// page with no preload is never shown armed). A click picks that element; a drag past `DRAG_THRESHOLD_PX` picks the
// area and the smallest element that holds it. The pick hides the outline, waits two frames so the presented frame
// carries none of it, re-measures, and sends main one report of geometry and names; main decides whether it counts
// (A-33). Esc is main's (`before-input-event`), and so is the URL; the crosshair is main's `insertCSS`, repeated on the
// shield.
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
// P2-F L147 (the owner's ruling at P2-F's sitting, B3): the comment card docks in a strip under the page, so opening it
// shrinks the viewport from the bottom and could hide the element just picked. The preload keeps the latest pick (the
// element, or an area's marquee as an offset in the smallest element holding it) with how far down from its top it
// shows, through every scrolling ancestor that clips it and the viewport (re-read at each scroll and resize). When the
// viewport shrinks, what showed before is brought back by the least scroll: each clipping ancestor, nearest first (an
// app-style page scrolls a viewport-sized pane, not its root), then the page, never the element's top above what clips
// it; nothing when it still shows or did not show. Scrolls are vertical, so the card's caret still points at it. The
// pick stays a subject for its card's life: the strip holds the page's bottom while the card is open, so the viewport
// back at its height at the pick means the card closed, and the pick is forgotten.
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

// An instant scroll, so whether it moved anything can be read back at once (a smooth one would not have moved yet).
type ScrollStep = { left: number; top: number; behavior: 'instant' };
interface PageRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
interface PageElement extends DomElement {
  readonly parentElement: PageElement | null;
  readonly isConnected: boolean;
  readonly clientTop: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  getBoundingClientRect(): PageRect;
  scrollBy(step: ScrollStep): void;
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
  readonly body: PageElement | null;
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
  scrollBy(step: ScrollStep): void;
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
  // P2-F L147: the latest pick (its rect in today's viewport, null once it left the page; the element its clipping
  // ancestors start from; the viewport's height at the pick; how far down from its top it showed), and the viewport's height
  type Subject = { rect(): PickRect | null; from: PageElement | null; height: number; shown: number | null };
  let subject: Subject | null = null;
  let viewportHeight = page.innerHeight;

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
        keep(element, kept === null ? null : rect);
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
    // the shield is up: main counts the tab armed from this answer alone (Decision Log 34)
    send({ type: 'armed', epoch: next });
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
  // pointer that can still scroll its way, so nested panes scroll while the person looks, and to the viewport when none
  // does. `scrollingElement` is the viewport's scroller; the body is a scroller of its own only when the root's overflow
  // is not visible (else the body's overflow is the viewport's, CSS Overflow 3 §3.3, and scrolling the body does
  // nothing). An ancestor that did not move when asked passes the wheel on, so a misjudged one never eats it.
  const canScroll = (element: PageElement, dx: number, dy: number) => {
    const style = page.getComputedStyle(element);
    const room = (position: number, view: number, extent: number, delta: number) => (delta > 0 ? position + view < extent - SCROLL_SLACK_PX : position > SCROLL_SLACK_PX);
    const vertical = dy !== 0 && SCROLLABLE.has(style.overflowY) && room(element.scrollTop, element.clientHeight, element.scrollHeight, dy);
    const horizontal = dx !== 0 && SCROLLABLE.has(style.overflowX) && room(element.scrollLeft, element.clientWidth, element.scrollWidth, dx);
    return vertical || horizontal;
  };
  const scrollsItself = (element: PageElement) => element !== doc.body || doc.documentElement === null || page.getComputedStyle(doc.documentElement).overflowY !== 'visible';
  const onWheel: Listener = (event) => {
    if (epoch === null || !event.isTrusted) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const wheel = event as PageWheelEvent;
    if (wheel.ctrlKey) return; // a trackpad pinch (or ctrl+wheel) is a zoom, not a scroll: taken, nothing moves
    const dx = wheel.deltaX * (wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? page.innerWidth : 1);
    const dy = wheel.deltaY * (wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? page.innerHeight : 1);
    const step: ScrollStep = { left: dx, top: dy, behavior: 'instant' };
    const viewport = doc.scrollingElement ?? doc.documentElement;
    for (let element = hit(wheel.clientX, wheel.clientY); element !== null && element !== viewport && element !== doc.documentElement; element = element.parentElement) {
      if (!scrollsItself(element) || !canScroll(element, dx, dy)) continue;
      const { scrollTop, scrollLeft } = element;
      element.scrollBy(step);
      if (element.scrollTop !== scrollTop || element.scrollLeft !== scrollLeft) return;
    }
    page.scrollBy(step);
  };

  // --- P2-F L147: the latest pick kept in view while its card's strip shrinks the viewport ---

  // The ancestors that scroll their own content and so clip the subject, nearest first (the viewport's scroller apart).
  const clippers = (from: PageElement | null): PageElement[] => {
    const found: PageElement[] = [];
    const viewport = doc.scrollingElement ?? doc.documentElement;
    for (let element = from; element !== null && element !== viewport && element !== doc.documentElement; element = element.parentElement)
      if (scrollsItself(element) && SCROLLABLE.has(page.getComputedStyle(element).overflowY)) found.push(element);
    return found;
  };
  const clipOf = (element: PageElement) => {
    const top = element.getBoundingClientRect().top + element.clientTop;
    return { top, bottom: top + element.clientHeight };
  };
  // How far down from its top the subject shows through its clippers and the viewport; null when it does not show.
  const shownOf = (kept: Subject): number | null => {
    const rect = kept.rect();
    if (rect === null) return null;
    let top = Math.max(rect.y, 0);
    let bottom = Math.min(rect.y + rect.height, page.innerHeight);
    for (const clip of clippers(kept.from).map(clipOf)) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    return bottom > top ? bottom - rect.y : null;
  };
  // A pick becomes the subject: the element itself, or (an area) the marquee as an offset in the element holding it,
  // moving with that element's box and its own scrolled content (an app-style pane holding the marquee).
  const keep = (element: PageElement, area: PickRect | null) => {
    const at = area && { box: rectOf(element.getBoundingClientRect()), scrollTop: element.scrollTop, scrollLeft: element.scrollLeft };
    const rect =
      area === null || at === null
        ? () => (element.isConnected ? rectOf(element.getBoundingClientRect()) : null)
        : () => {
            if (!element.isConnected) return null;
            const now = element.getBoundingClientRect();
            return { ...area, x: area.x + now.left - at.box.x - (element.scrollLeft - at.scrollLeft), y: area.y + now.top - at.box.y - (element.scrollTop - at.scrollTop) };
          };
    subject = { rect, from: area === null ? element.parentElement : element, height: page.innerHeight, shown: null };
    subject.shown = shownOf(subject);
  };
  // What showed of the subject (`shown` down from its top) back in view by the least scroll: each clipping ancestor
  // nearest first, then the page, each never past the subject's top; a scroller that moves less passes the rest on.
  const reveal = (kept: Subject, shown: number) => {
    const rect = kept.rect();
    if (rect === null) return;
    let top = rect.y;
    const need = (clip: { top: number; bottom: number }) => Math.ceil(Math.min(top + shown - clip.bottom, Math.max(0, top - clip.top)));
    for (const element of clippers(kept.from)) {
      const by = need(clipOf(element));
      if (by <= 0) continue;
      const was = element.scrollTop;
      element.scrollBy({ left: 0, top: by, behavior: 'instant' });
      top -= element.scrollTop - was;
    }
    const by = need({ top: 0, bottom: page.innerHeight });
    if (by > 0) page.scrollBy({ left: 0, top: by, behavior: 'instant' });
  };
  const onViewport: Listener = () => {
    const before = viewportHeight;
    viewportHeight = page.innerHeight;
    if (subject === null) return;
    if (viewportHeight > before && viewportHeight >= subject.height) {
      subject = null; // the strip gave the page its bottom back: the card closed
      return;
    }
    if (viewportHeight < before && subject.shown !== null) reveal(subject, subject.shown);
    subject.shown = shownOf(subject);
  };
  const onScrolled: Listener = () => {
    if (subject !== null) subject.shown = shownOf(subject);
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
    if (described === null || element === null) return;
    keep(element, null);
    sendPicked({ epoch: at, requestId, mode: 'click' }, described, rectOf(element.getBoundingClientRect()));
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
  page.addEventListener('resize', onViewport, CAPTURE);
  page.addEventListener('scroll', onScrolled, CAPTURE);
  ipc.on(COMMENT_CHANNEL.toPreload, onMessage);

  return () => {
    teardown();
    for (const type of TAKEN) page.removeEventListener(type, onPointer, CAPTURE);
    page.removeEventListener('scroll', onLayout, CAPTURE);
    page.removeEventListener('resize', onLayout, CAPTURE);
    page.removeEventListener('resize', onViewport, CAPTURE);
    page.removeEventListener('scroll', onScrolled, CAPTURE);
    ipc.removeListener(COMMENT_CHANNEL.toPreload, onMessage);
  };
}
