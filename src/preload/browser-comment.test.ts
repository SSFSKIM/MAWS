// @vitest-environment happy-dom
// Comment mode's preload (E4d execution document, Design §3; Acceptance "the unit suites … browser-comment"): armed, a
// shield takes every trusted pointer event before the page can see it, the hovered element is outlined and named, and a
// click or a drag sends main one report two frames after the hover UI is hidden; `pickAt` answers the context menu's
// one-shot pick; disarm leaves nothing behind. happy-dom has no hit testing and no `elementsFromPoint`, so the suite
// stubs both (each element's rect, and the stack at a point, the shield on top while it is up), dispatches events as
// the browser would after its hit test (on the shield), and runs `requestAnimationFrame` one frame at a time.
import type { CSSStyleDeclaration, Document as HappyDocument, Element as HappyElement, Event as HappyEvent, Window as HappyWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickRefusedSchema, PickReportSchema } from '@shared/browser/comment';
import { COMMENT_CHANNEL, COMMENT_NODES, COMMENT_WORDS, type PreloadMessage, type ToPreload } from '@shared/browser/comment-protocol';
import { installCommentMode, type CommentPage, type PreloadIpc } from './browser-comment';

const win = (): HappyWindow => globalThis as unknown as HappyWindow;
const doc = (): HappyDocument => win().document;
const OPEN = String.fromCharCode(0x201c);
const CLOSE = String.fromCharCode(0x201d);
const quoted = (head: string, name: string) => `${head} ${OPEN}${name}${CLOSE}`;

type Box = { left: number; top: number; width: number; height: number };
const boxes = new Map<HappyElement, Box>();
function place(el: HappyElement, box: Box) {
  boxes.set(el, box);
  (el as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => {
    const now = boxes.get(el)!;
    return { ...now, x: now.left, y: now.top, right: now.left + now.width, bottom: now.top + now.height };
  };
}
const inside = (box: Box, x: number, y: number) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
const depth = (el: HappyElement) => {
  let n = 0;
  for (let node: HappyElement | null = el; node !== null; node = node.parentElement) n += 1;
  return n;
};
const shield = () => doc().querySelector(COMMENT_NODES.shield);
const overlay = () => doc().querySelector(COMMENT_NODES.overlay);
const badge = () => doc().querySelector(COMMENT_NODES.badge);
const styleOf = (el: HappyElement | null) => (el as unknown as { style: CSSStyleDeclaration }).style;
const shown = (el: HappyElement | null) => el !== null && styleOf(el).display !== 'none';

// The browser's hit test: the shield first while it is up (its `pointer-events: auto` covers the viewport), then the
// placed elements under the point, deepest first, then the root. MAWS's overlay is `pointer-events: none`: never listed.
function elementsFromPoint(x: number, y: number): HappyElement[] {
  const under = [...boxes.entries()].filter(([el, box]) => el.isConnected && inside(box, x, y)).map(([el]) => el);
  under.sort((a, b) => depth(b) - depth(a));
  const top = shield();
  return [...(top ? [top] : []), ...under, doc().documentElement];
}

let frames: Array<() => void> = [];
function frame() {
  const due = frames;
  frames = [];
  due.forEach((callback) => callback());
}

function fakeIpc() {
  const listeners = new Map<string, (event: unknown, message: unknown) => void>();
  const ipc = {
    on: vi.fn((channel: string, listener: (event: unknown, message: unknown) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
    send: vi.fn<(channel: string, message: PreloadMessage) => void>(),
  };
  const deliver = (message: ToPreload | unknown) => listeners.get(COMMENT_CHANNEL.toPreload)?.({}, message);
  const all = () => ipc.send.mock.calls.map(([channel, message]) => {
    expect(channel).toBe(COMMENT_CHANNEL.fromPreload);
    return message;
  });
  // the reports and refusals; the arm's acknowledgements apart (Decision Log 34)
  const sent = () => all().filter((message) => message.type !== 'armed');
  const acks = () => all().filter((message) => message.type === 'armed');
  return { ipc: ipc as PreloadIpc & typeof ipc, deliver, sent, acks, listeners };
}

function trusted<T extends HappyEvent>(event: T, isTrusted = true): T {
  Object.defineProperty(event, 'isTrusted', { value: isTrusted });
  return event;
}
type Pointer = { x: number; y: number; button?: number; trusted?: boolean };
function pointer(type: string, at: Pointer, target: HappyElement | null = shield()) {
  const event = trusted(new (win().PointerEvent)(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: at.button ?? 0 }), at.trusted ?? true);
  target!.dispatchEvent(event);
  return event;
}
function mouse(type: string, at: Pointer, target: HappyElement | null = shield()) {
  const event = trusted(new (win().MouseEvent)(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: at.button ?? 0 }), at.trusted ?? true);
  target!.dispatchEvent(event);
  return event;
}
function click(at: Pointer) {
  pointer('pointerdown', at);
  mouse('mousedown', at);
  pointer('pointerup', at);
  mouse('mouseup', at);
  mouse('click', at);
}

type Wheel = { x: number; y: number; deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean };
function wheelAt(at: Wheel) {
  const event = trusted(new (win().WheelEvent)('wheel', { bubbles: true, cancelable: true, deltaX: at.deltaX ?? 0, deltaY: at.deltaY ?? 0, deltaMode: at.deltaMode ?? 0 }));
  // happy-dom's WheelEvent is a UIEvent, not a MouseEvent: no coordinates, no modifier keys
  Object.defineProperties(event, { clientX: { value: at.x }, clientY: { value: at.y }, ctrlKey: { value: at.ctrlKey ?? false } });
  shield()!.dispatchEvent(event);
  return event;
}

// happy-dom computes no `overflow` for the root: its computed style answers the given value there.
function rootOverflow(value: string) {
  const computed = win().getComputedStyle.bind(win());
  vi.spyOn(win(), 'getComputedStyle').mockImplementation((element: HappyElement) =>
    element === doc().documentElement ? ({ overflowX: value, overflowY: value } as unknown as ReturnType<typeof computed>) : computed(element),
  );
}
// The instant scroll the preload asks for, so it can read at once whether anything moved.
const step = (left: number, top: number) => ({ left, top, behavior: 'instant' });
// A scroll container as happy-dom cannot lay one out: its extents, and a `scrollBy` that moves it within them (or, with
// `moves: false`, does not move it at all). Undone after each case, since `<html>` and `<body>` are shared.
const undo: Array<() => void> = [];
type Extent = { scrollHeight: number; clientHeight: number; scrollTop: number; moves?: boolean };
function scrollable(el: HappyElement, extent: Extent) {
  let top = extent.scrollTop;
  const scrollBy = vi.fn((to: { top: number }) => {
    if (extent.moves !== false) top = Math.min(Math.max(top + to.top, 0), extent.scrollHeight - extent.clientHeight);
  });
  Object.defineProperties(el, {
    scrollHeight: { value: extent.scrollHeight, configurable: true },
    clientHeight: { value: extent.clientHeight, configurable: true },
    scrollTop: { get: () => top, configurable: true },
    scrollBy: { value: scrollBy, configurable: true },
  });
  undo.push(() => {
    for (const key of ['scrollHeight', 'clientHeight', 'scrollTop', 'scrollBy']) delete (el as unknown as Record<string, unknown>)[key];
  });
  return { scrollBy };
}

const PAGE = `
  <main>
    <section aria-label="A form"><button id="increment">Increment</button></section>
    <section><ul><li><button>One</button></li><li><button>Act</button></li></ul></section>
    <div id="scroller" style="overflow-y: auto; height: 100px"><p id="inner">Lots of text</p></div>
    <iframe id="frame" title="Frame B"></iframe>
    <button id="long"></button>
  </main>`;
const byId = (id: string) => doc().getElementById(id)!;

// vitest copies the window's properties onto globalThis as plain values; one test moves `scrollY`, and every test ends
// with it restored
const SCROLL_Y = Object.getOwnPropertyDescriptor(globalThis, 'scrollY')!;
const INNER_HEIGHT = Object.getOwnPropertyDescriptor(globalThis, 'innerHeight')!;

let ipc: ReturnType<typeof fakeIpc>;
let uninstall: () => void;

beforeEach(() => {
  doc().body.innerHTML = PAGE;
  boxes.clear();
  place(doc().body, { left: 0, top: 0, width: 1024, height: 768 });
  place(doc().querySelector('main')!, { left: 0, top: 0, width: 1024, height: 700 });
  const [form, list] = Array.from(doc().querySelectorAll('section'));
  place(form, { left: 0, top: 0, width: 400, height: 100 });
  place(byId('increment'), { left: 248, top: 32, width: 96, height: 30 });
  place(list, { left: 0, top: 100, width: 400, height: 200 });
  const ul = list.querySelector('ul')!;
  place(ul, { left: 20, top: 120, width: 300, height: 120 });
  const [one, two] = Array.from(ul.querySelectorAll('li'));
  place(one, { left: 20, top: 120, width: 300, height: 60 });
  place(two, { left: 20, top: 180, width: 300, height: 60 });
  place(one.querySelector('button')!, { left: 30, top: 130, width: 80, height: 30 });
  place(two.querySelector('button')!, { left: 30, top: 190, width: 80, height: 30 });
  place(byId('scroller'), { left: 500, top: 0, width: 300, height: 100 });
  place(byId('inner'), { left: 500, top: 0, width: 300, height: 100 }); // its overflow is the scroller's `scrollHeight`
  place(byId('frame'), { left: 500, top: 300, width: 300, height: 200 });
  place(byId('long'), { left: 500, top: 600, width: 100, height: 30 });
  (doc() as unknown as { elementsFromPoint: typeof elementsFromPoint }).elementsFromPoint = elementsFromPoint;
  frames = [];
  vi.spyOn(win() as unknown as { requestAnimationFrame(callback: (time: number) => void): number }, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(() => callback(0));
    return frames.length;
  });
  ipc = fakeIpc();
  uninstall = installCommentMode(ipc.ipc, win() as unknown as CommentPage);
});

afterEach(() => {
  uninstall();
  undo.splice(0).forEach((restore) => restore());
  doc().body.removeAttribute('style');
  vi.restoreAllMocks();
  delete (doc() as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
  Object.defineProperty(win(), 'scrollY', SCROLL_Y);
  Object.defineProperty(win(), 'innerHeight', INNER_HEIGHT);
});

describe('arming', () => {
  it('starts disarmed: nothing of MAWS in the page, and pointer events pass to it', () => {
    const seen = vi.fn();
    byId('increment').addEventListener('click', seen);
    mouse('click', { x: 250, y: 40 }, byId('increment'));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(doc().querySelectorAll(`[${COMMENT_NODES.marker}]`)).toHaveLength(0);
    expect(ipc.listeners.has(COMMENT_CHANNEL.toPreload)).toBe(true);
  });

  it('arm puts up the shield over the viewport and a hidden overlay with its badge, all marked as MAWS’s', () => {
    ipc.deliver({ type: 'arm', epoch: 3 });
    const top = shield()!;
    expect(top.parentElement).toBe(doc().documentElement);
    const style = styleOf(top);
    expect(style.getPropertyValue('position')).toBe('fixed');
    expect(style.getPropertyPriority('position')).toBe('important');
    expect(style.getPropertyValue('pointer-events')).toBe('auto');
    expect(style.getPropertyValue('z-index')).toBe('2147483647');
    expect(overlay()!.parentElement).toBe(doc().documentElement);
    expect(badge()!.parentElement).toBe(overlay());
    expect(styleOf(overlay()).getPropertyValue('pointer-events')).toBe('none');
    expect(shown(overlay())).toBe(false);
    for (const node of [top, overlay()!, badge()!]) expect(node.hasAttribute(COMMENT_NODES.marker)).toBe(true);
    expect(doc().querySelectorAll('style')).toHaveLength(0); // no style element: inline CSSOM writes only
  });

  it('acknowledges each arm with its epoch once the shield is in the page, and nothing else (Decision Log 34)', () => {
    expect(ipc.acks()).toEqual([]);
    const order: string[] = [];
    ipc.ipc.send.mockImplementation((_channel, message) => void order.push(`${message.type}:${shield() !== null}`));
    ipc.deliver({ type: 'arm', epoch: 3 });
    expect(ipc.acks()).toEqual([{ type: 'armed', epoch: 3 }]);
    expect(order).toEqual(['armed:true']); // sent after the shield went up
    ipc.deliver({ type: 'arm', epoch: 4 });
    expect(ipc.acks()).toEqual([{ type: 'armed', epoch: 3 }, { type: 'armed', epoch: 4 }]);
    ipc.deliver({ type: 'disarm' });
    ipc.deliver({ type: 'pickAt', x: 250, y: 40, requestId: 'r1', epoch: 4 });
    expect(ipc.acks()).toHaveLength(2); // a disarm and a pickAt are never acknowledged
  });

  it('disarm removes the shield, the overlay and the badge, and the page receives pointer events again', () => {
    ipc.deliver({ type: 'arm', epoch: 1 });
    pointer('pointermove', { x: 250, y: 40 });
    ipc.deliver({ type: 'disarm' });
    expect(doc().querySelectorAll(`[${COMMENT_NODES.marker}]`)).toHaveLength(0);
    const seen = vi.fn();
    win().addEventListener('pointerdown', seen, true);
    pointer('pointerdown', { x: 250, y: 40 }, byId('increment'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a second arm replaces the first: one shield, the new epoch on the report', () => {
    ipc.deliver({ type: 'arm', epoch: 1 });
    ipc.deliver({ type: 'arm', epoch: 2 });
    expect(doc().querySelectorAll(COMMENT_NODES.shield)).toHaveLength(1);
    click({ x: 250, y: 40 });
    frame();
    frame();
    expect(ipc.sent()).toEqual([expect.objectContaining({ type: 'picked', epoch: 2 })]);
  });

  it('ignores a message from main it does not know', () => {
    ipc.deliver({ type: 'explode' });
    ipc.deliver(null);
    ipc.deliver({ type: 'arm', epoch: 'one' });
    expect(shield()).toBeNull();
    expect(ipc.sent()).toEqual([]);
  });
});

describe('hover', () => {
  beforeEach(() => ipc.deliver({ type: 'arm', epoch: 1 }));

  it('outlines the element under the pointer and names it in the badge, with the hint on the first hover only', () => {
    pointer('pointermove', { x: 250, y: 40 });
    const style = styleOf(overlay());
    expect(shown(overlay())).toBe(true);
    expect([style.left, style.top, style.width, style.height]).toEqual(['248px', '32px', '96px', '30px']);
    expect(badge()!.textContent).toBe(`${quoted('button', 'Increment')}\n${COMMENT_WORDS.hint}`);
    pointer('pointermove', { x: 40, y: 140 });
    expect([style.left, style.top]).toEqual(['30px', '130px']);
    expect(badge()!.textContent).toBe(quoted('button', 'One'));
  });

  it('names an element without a role by its tag, and a frame by its element', () => {
    pointer('pointermove', { x: 600, y: 50 });
    pointer('pointermove', { x: 600, y: 400 });
    expect(badge()!.textContent).toBe(quoted('iframe', 'Frame B'));
    pointer('pointermove', { x: 900, y: 750 });
    expect(badge()!.textContent).toBe('body');
  });

  it('re-places the outline when the page scrolls under a still pointer', () => {
    pointer('pointermove', { x: 250, y: 40 });
    place(byId('increment'), { left: 248, top: 12, width: 96, height: 30 });
    win().dispatchEvent(new (win().Event)('scroll'));
    expect(styleOf(overlay()).top).toBe('12px');
  });

  it('hides the outline when the pointer leaves the page', () => {
    pointer('pointermove', { x: 250, y: 40 });
    pointer('pointerout', { x: 250, y: 40 }); // no relatedTarget: the pointer left the page
    expect(shown(overlay())).toBe(false);
  });
});

describe('the shield keeps the page from seeing anything', () => {
  beforeEach(() => ipc.deliver({ type: 'arm', epoch: 1 }));

  it('no page listener, on the element, the document or the window, sees a trusted pointer event', () => {
    const seen = vi.fn();
    const types = ['pointerdown', 'pointerup', 'pointermove', 'pointerrawupdate', 'mousedown', 'mouseup', 'click', 'contextmenu', 'dblclick', 'auxclick'];
    for (const type of types) {
      byId('increment').addEventListener(type, seen);
      doc().addEventListener(type, seen);
      doc().addEventListener(type, seen, true);
      win().addEventListener(type, seen);
      win().addEventListener(type, seen, true);
    }
    pointer('pointerrawupdate', { x: 250, y: 40 });
    pointer('pointermove', { x: 250, y: 40 });
    click({ x: 250, y: 40 });
    mouse('dblclick', { x: 250, y: 40 });
    mouse('auxclick', { x: 250, y: 40, button: 1 });
    const menu = mouse('contextmenu', { x: 250, y: 40, button: 2 });
    expect(seen).not.toHaveBeenCalled();
    expect(menu.defaultPrevented).toBe(true); // the native menu's Comment is for the unarmed state
  });

  it('a mousedown is prevented (no focus change, no selection); a pointerdown is not, so the mousedown still comes', () => {
    expect(mouse('mousedown', { x: 250, y: 40 }).defaultPrevented).toBe(true);
    expect(pointer('pointerdown', { x: 250, y: 40 }).defaultPrevented).toBe(false);
  });

  it('an event the page dispatches itself (not trusted) neither picks nor is taken from the page', () => {
    const seen = vi.fn();
    win().addEventListener('pointerdown', seen, true);
    pointer('pointerdown', { x: 250, y: 40, trusted: false });
    pointer('pointerup', { x: 250, y: 40, trusted: false });
    pointer('pointerdown', { x: 250, y: 40, trusted: false }, byId('increment'));
    pointer('pointerup', { x: 250, y: 40, trusted: false }, byId('increment'));
    frame();
    frame();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(ipc.sent()).toEqual([]);
  });

  it('a trusted event aimed past the shield (a node the page raised above it) is still taken and picks by position', () => {
    const seen = vi.fn();
    byId('increment').addEventListener('click', seen);
    pointer('pointerdown', { x: 250, y: 40 }, byId('increment'));
    pointer('pointerup', { x: 250, y: 40 }, byId('increment'));
    mouse('click', { x: 250, y: 40 }, byId('increment'));
    frame();
    frame();
    expect(seen).not.toHaveBeenCalled();
    expect(ipc.sent()).toEqual([expect.objectContaining({ type: 'picked', description: expect.objectContaining({ css: '#increment' }) })]);
  });

  it('a wheel is taken from the page and scrolls the nearest scrollable ancestor of what is under the pointer', () => {
    const { scrollBy } = scrollable(byId('scroller'), { scrollHeight: 1000, clientHeight: 100, scrollTop: 0 });
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    const seen = vi.fn();
    win().addEventListener('wheel', seen, true);
    const inScroller = wheelAt({ x: 600, y: 50, deltaY: 40 });
    expect(inScroller.defaultPrevented).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith(step(0, 40));
    expect(windowScroll).not.toHaveBeenCalled();
    wheelAt({ x: 600, y: 50, deltaY: -60 }); // more than it has: the scroller takes what it can
    expect(scrollBy).toHaveBeenLastCalledWith(step(0, -60));
    wheelAt({ x: 600, y: 50, deltaY: -40 }); // back at the top: the scroller cannot take it, the document does
    expect(windowScroll).toHaveBeenCalledWith(step(0, -40));
    wheelAt({ x: 250, y: 40, deltaY: 25 }); // no scrollable ancestor: the document
    expect(windowScroll).toHaveBeenLastCalledWith(step(0, 25));
    expect(seen).not.toHaveBeenCalled();
  });

  it('a scroller within a pixel of its end (a fractional scrollTop at DPR 2) is at its end: the document scrolls', () => {
    const { scrollBy } = scrollable(byId('scroller'), { scrollHeight: 1000, clientHeight: 100, scrollTop: 899.5 });
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    wheelAt({ x: 600, y: 50, deltaY: 40 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(windowScroll).toHaveBeenCalledWith(step(0, 40));
  });

  it('a scroller that does not move when asked (a stale measure) passes the wheel on', () => {
    const { scrollBy } = scrollable(byId('scroller'), { scrollHeight: 1000, clientHeight: 100, scrollTop: 0, moves: false });
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    wheelAt({ x: 600, y: 50, deltaY: 40 });
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(windowScroll).toHaveBeenCalledWith(step(0, 40));
  });

  it('a page whose body is its own scroller (the root does not let its overflow through) scrolls the body', () => {
    rootOverflow('hidden');
    doc().body.setAttribute('style', 'overflow-y: auto');
    const { scrollBy } = scrollable(doc().body, { scrollHeight: 2000, clientHeight: 768, scrollTop: 0 });
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    expect(doc().scrollingElement).toBe(doc().documentElement); // standards mode: the root is the viewport's scroller
    wheelAt({ x: 250, y: 40, deltaY: 30 });
    expect(scrollBy).toHaveBeenCalledWith(step(0, 30));
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it('a body whose overflow propagates to the viewport (the root’s is visible) is no scroller: the viewport scrolls', () => {
    rootOverflow('visible');
    doc().body.setAttribute('style', 'overflow-x: hidden; overflow-y: auto'); // as `overflow-x: hidden` computes
    const { scrollBy } = scrollable(doc().body, { scrollHeight: 2000, clientHeight: 768, scrollTop: 0 });
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    wheelAt({ x: 250, y: 40, deltaY: 30 });
    expect(scrollBy).not.toHaveBeenCalled();
    expect(windowScroll).toHaveBeenCalledWith(step(0, 30));
  });

  it('a ctrl+wheel (a trackpad pinch) is taken from the page and scrolls nothing', () => {
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    const event = wheelAt({ x: 250, y: 40, deltaY: 12, ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(windowScroll).not.toHaveBeenCalled();
  });

  it('a wheel in pages scales each axis by the viewport’s own extent', () => {
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    wheelAt({ x: 250, y: 40, deltaX: 1, deltaY: 1, deltaMode: 2 });
    expect(windowScroll).toHaveBeenCalledWith(step(win().innerWidth, win().innerHeight));
  });
});

describe('the pick', () => {
  beforeEach(() => ipc.deliver({ type: 'arm', epoch: 7 }));

  it('a click sends one report two frames after the hover UI is hidden, with the rect measured then', () => {
    pointer('pointermove', { x: 250, y: 40 });
    click({ x: 250, y: 40 });
    expect(shown(overlay())).toBe(false); // hidden before the frames that the crop will read
    expect(shield()).not.toBeNull(); // the shield stays until main disarms
    place(byId('increment'), { left: 250, top: 34, width: 96, height: 30 }); // the page re-laid out meanwhile
    expect(ipc.sent()).toEqual([]);
    frame();
    expect(ipc.sent()).toEqual([]);
    frame();
    const [report] = ipc.sent();
    expect(PickReportSchema.parse(report)).toEqual({
      type: 'picked',
      epoch: 7,
      requestId: null,
      mode: 'click',
      description: { css: '#increment', role: 'button', name: 'Increment', a11y: `main > region ${OPEN}A form${CLOSE} > ${quoted('button', 'Increment')}`, tag: 'button', confident: true },
      nameOverLong: false,
      rect: { x: 250, y: 34, width: 96, height: 30 },
      scroll: { x: 0, y: 0 },
      viewport: { width: win().innerWidth, height: win().innerHeight },
    });
  });

  it('sends nothing more for the arm: a second click is taken from the page and ignored', () => {
    click({ x: 250, y: 40 });
    frame();
    frame();
    click({ x: 40, y: 140 });
    frame();
    frame();
    expect(ipc.sent()).toHaveLength(1);
  });

  it('a press with a button other than the primary picks nothing', () => {
    click({ x: 250, y: 40, button: 2 });
    frame();
    frame();
    expect(ipc.sent()).toEqual([]);
  });

  it('a drag past the threshold picks the area and the smallest element that holds it', () => {
    pointer('pointerdown', { x: 22, y: 122 });
    pointer('pointermove', { x: 26, y: 125 }); // within 6 px: still a click
    pointer('pointermove', { x: 200, y: 230 });
    const style = styleOf(overlay());
    expect([style.left, style.top, style.width, style.height]).toEqual(['22px', '122px', '178px', '108px']); // the marquee
    expect(badge()!.textContent).toBe('list');
    pointer('pointerup', { x: 300, y: 235 });
    frame();
    frame();
    const [report] = ipc.sent();
    expect(PickReportSchema.parse(report)).toMatchObject({
      mode: 'area',
      description: { css: 'body > main > section:nth-of-type(2) > ul', role: 'list', name: '' },
      rect: { x: 22, y: 122, width: 278, height: 113 },
    });
  });

  it('a marquee dragged backwards and past the viewport is normalised and clamped to it', () => {
    pointer('pointerdown', { x: 300, y: 230 });
    pointer('pointermove', { x: -50, y: 110 });
    pointer('pointerup', { x: -50, y: 110 });
    frame();
    frame();
    expect(ipc.sent()[0]).toMatchObject({ mode: 'area', rect: { x: 0, y: 110, width: 300, height: 120 } });
  });

  it('an area pick re-derives the marquee from document coordinates when the page scrolled during the wait', () => {
    pointer('pointerdown', { x: 22, y: 122 });
    pointer('pointermove', { x: 200, y: 230 });
    pointer('pointerup', { x: 200, y: 230 });
    Object.defineProperty(win(), 'scrollY', { value: 50, configurable: true });
    frame();
    frame();
    expect(ipc.sent()[0]).toMatchObject({ rect: { x: 22, y: 72, width: 178, height: 108 }, scroll: { x: 0, y: 50 } });
  });

  it('an element detached during the wait is reported at its rect from the pointer-up', () => {
    const picked = byId('increment');
    click({ x: 250, y: 40 });
    picked.remove();
    place(picked, { left: 0, top: 0, width: 0, height: 0 }); // what a detached element measures
    frame();
    frame();
    expect(ipc.sent()[0]).toMatchObject({ description: { css: '#increment' }, rect: { x: 248, y: 32, width: 96, height: 30 } });
  });

  it('an element whose re-measured rect is empty (display: none meanwhile) is reported at its pointer-up rect', () => {
    click({ x: 250, y: 40 });
    place(byId('increment'), { left: 0, top: 0, width: 0, height: 0 });
    frame();
    frame();
    expect(ipc.sent()[0]).toMatchObject({ rect: { x: 248, y: 32, width: 96, height: 30 } });
  });

  it('a frame is picked as its element', () => {
    click({ x: 600, y: 400 });
    frame();
    frame();
    expect(ipc.sent()[0]).toMatchObject({ description: { css: '#frame', role: null, name: 'Frame B', tag: 'iframe' } });
  });

  it('trims a long name to the report’s cap and flags it, so main omits it rather than failing the pick', () => {
    byId('long').textContent = 'x'.repeat(300);
    click({ x: 550, y: 610 });
    frame();
    frame();
    const report = PickReportSchema.parse(ipc.sent()[0]);
    expect(report.nameOverLong).toBe(true);
    expect(report.description.name.length).toBeLessThanOrEqual(200);
  });

  it('a pointercancel drops the press', () => {
    pointer('pointerdown', { x: 250, y: 40 });
    pointer('pointercancel', { x: 250, y: 40 });
    pointer('pointerup', { x: 250, y: 40 });
    frame();
    frame();
    expect(ipc.sent()).toEqual([]);
  });

  it('a disarm during the wait sends nothing', () => {
    click({ x: 250, y: 40 });
    ipc.deliver({ type: 'disarm' });
    frame();
    frame();
    expect(ipc.sent()).toEqual([]);
  });

  it('an element no css can name is refused as tooDeep', () => {
    let deep = byId('inner');
    for (let i = 0; i < 400; i += 1) {
      const child = doc().createElement('div');
      deep.appendChild(child);
      deep = child as unknown as typeof deep;
    }
    place(deep, { left: 510, top: 10, width: 10, height: 10 });
    click({ x: 512, y: 12 });
    frame();
    frame();
    expect(PickRefusedSchema.parse(ipc.sent()[0])).toEqual({ type: 'refused', epoch: 7, requestId: null, reason: 'tooDeep' });
  });
});

describe('pickAt (the context menu)', () => {
  it('names the element at the point at once, with no hover UI, and answers with the request id', () => {
    ipc.deliver({ type: 'pickAt', x: 250, y: 40, requestId: 'r-1', epoch: 4 });
    expect(shield()).toBeNull();
    expect(frames).toEqual([]);
    expect(PickReportSchema.parse(ipc.sent()[0])).toMatchObject({
      type: 'picked',
      epoch: 4,
      requestId: 'r-1',
      mode: 'click',
      description: { css: '#increment' },
      rect: { x: 248, y: 32, width: 96, height: 30 },
    });
  });

  it('answers noElement when nothing is at the point', () => {
    (doc() as unknown as { elementsFromPoint: () => unknown[] }).elementsFromPoint = () => [];
    ipc.deliver({ type: 'pickAt', x: 5000, y: 5000, requestId: 'r-2', epoch: 4 });
    expect(PickRefusedSchema.parse(ipc.sent()[0])).toEqual({ type: 'refused', epoch: 4, requestId: 'r-2', reason: 'noElement' });
  });

  it('ignores a pickAt whose point or request id is malformed', () => {
    ipc.deliver({ type: 'pickAt', x: Number.NaN, y: 40, requestId: 'r-3', epoch: 4 });
    ipc.deliver({ type: 'pickAt', x: 250, y: 40, requestId: 7, epoch: 4 });
    expect(ipc.sent()).toEqual([]);
  });
});

describe('a viewport that shrinks under the picked element (P2-F L147: the comment strip opening under the page)', () => {
  // the view's height in CSS px, as main's `setBounds` changes it: the page sees its viewport resize
  const viewport = (height: number) => {
    Object.defineProperty(win(), 'innerHeight', { value: height, configurable: true });
    win().dispatchEvent(new (win().Event)('resize'));
  };
  // a scroll moves what it scrolls up by as much: the page's every placed box, or a scroller's descendants' boxes
  const moveUp = (by: number, within?: HappyElement) => {
    for (const [el, box] of boxes) if (within === undefined ? el !== doc().body : within !== el && within.contains(el)) box.top -= by;
  };
  let scrollBy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    viewport(768);
    scrollBy = vi.spyOn(win() as unknown as CommentPage, 'scrollBy').mockImplementation((to) => moveUp((to as { top: number }).top)) as unknown as ReturnType<typeof vi.fn>;
  });
  // An app-style page: a pane the viewport's height from `top` that scrolls its own content (overflow-y: auto), and
  // shrinks with the viewport, as a `position: fixed; inset` pane does
  const pane = (top: number, extent: { scrollHeight: number; moves?: boolean }) => {
    const el = byId('scroller');
    let scrollTop = 0;
    const height = () => win().innerHeight - top;
    const paneScrollBy = vi.fn((to: { top: number }) => {
      if (extent.moves === false) return;
      const next = Math.min(Math.max(scrollTop + to.top, 0), extent.scrollHeight - height());
      moveUp(next - scrollTop, el);
      scrollTop = next;
    });
    place(el, { left: 500, top, width: 300, height: height() });
    Object.defineProperties(el, {
      scrollHeight: { value: extent.scrollHeight, configurable: true },
      clientHeight: { get: height, configurable: true },
      clientTop: { value: 0, configurable: true },
      scrollTop: { get: () => scrollTop, configurable: true },
      scrollBy: { value: paneScrollBy, configurable: true },
    });
    // its box follows the viewport's height, read live
    (el as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => {
      const box = { ...boxes.get(el)!, height: height() };
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height };
    };
    undo.push(() => {
      for (const key of ['scrollHeight', 'clientHeight', 'clientTop', 'scrollTop', 'scrollBy']) delete (el as unknown as Record<string, unknown>)[key];
    });
    return { scrollBy: paneScrollBy };
  };
  const pickAt = (x: number, y: number) => ipc.deliver({ type: 'pickAt', x, y, requestId: 'r', epoch: 1 });

  it('scrolls the page by the least that brings a picked element the shrink hid back into view', () => {
    pickAt(510, 610); // #long: 600 to 630
    viewport(568); // a 200 px strip
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith(step(0, 62));
  });

  it('does the same for an element picked with the pointer, once its report is sent', () => {
    ipc.deliver({ type: 'arm', epoch: 2 });
    click({ x: 510, y: 610 });
    frame();
    frame();
    ipc.deliver({ type: 'disarm' }); // main disarms after the pick; the card opens after
    viewport(600);
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith(step(0, 30));
  });

  it('keeps an area pick in view by its marquee, in document coordinates', () => {
    ipc.deliver({ type: 'arm', epoch: 2 });
    pointer('pointerdown', { x: 22, y: 122 });
    pointer('pointermove', { x: 200, y: 230 });
    pointer('pointerup', { x: 200, y: 230 });
    frame();
    frame();
    viewport(200); // the marquee runs from 122 to 230
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith(step(0, 30));
  });

  it('does not move a picked element the shrunk viewport still shows', () => {
    pickAt(250, 40); // #increment: 32 to 62
    viewport(568);
    viewport(62);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not chase an element that was out of view before the shrink', () => {
    place(byId('long'), { left: 500, top: 900, width: 100, height: 30 }); // below the viewport (a pick past it, as a test can)
    pickAt(510, 910);
    viewport(568);
    place(byId('long'), { left: 500, top: -60, width: 100, height: 30 }); // and above it
    viewport(400);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('brings back what showed of an element that ran past the bottom, never its top above the viewport', () => {
    place(byId('long'), { left: 500, top: 700, width: 100, height: 200 }); // 700 to 900: 68 px showed
    pickAt(510, 710);
    viewport(568);
    expect(scrollBy).toHaveBeenLastCalledWith(step(0, 200)); // the showing part's bottom (768) back at the viewport's
    place(byId('long'), { left: 500, top: 100, width: 100, height: 600 }); // taller than the viewport that remains
    win().dispatchEvent(new (win().Event)('scroll')); // the page scrolled it there
    viewport(400);
    expect(scrollBy).toHaveBeenLastCalledWith(step(0, 100)); // its top at the viewport's top
  });

  it('ignores a viewport that grows, and an element removed from the page', () => {
    pickAt(510, 610);
    viewport(900);
    expect(scrollBy).not.toHaveBeenCalled();
    byId('long').remove();
    viewport(568);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('reveals an element its own scrolling pane clips, scrolling that pane by the least and the page not at all', () => {
    const { scrollBy: paneScrollBy } = pane(400, { scrollHeight: 1000 }); // 400 to the viewport's bottom
    place(byId('inner'), { left: 500, top: 700, width: 300, height: 30 }); // 700 to 730 inside it
    pickAt(510, 710);
    viewport(568); // the pane now ends at 568
    expect(paneScrollBy).toHaveBeenCalledExactlyOnceWith(step(0, 162));
    expect(scrollBy, 'the page itself does not scroll (its root never does on such a page)').not.toHaveBeenCalled();
  });

  it('passes what a pane cannot scroll on to the page', () => {
    const { scrollBy: paneScrollBy } = pane(400, { scrollHeight: 1000, moves: false });
    place(byId('inner'), { left: 500, top: 700, width: 300, height: 30 });
    pickAt(510, 710);
    viewport(568);
    expect(paneScrollBy).toHaveBeenCalledOnce();
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith(step(0, 162));
  });

  it('keeps the latest pick only, and nothing before any pick', () => {
    viewport(568);
    pickAt(510, 610);
    viewport(768);
    pickAt(250, 40); // #increment replaces #long
    viewport(568);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('uninstall', () => {
  it('removes the listeners and the nodes', () => {
    ipc.deliver({ type: 'arm', epoch: 1 });
    uninstall();
    expect(shield()).toBeNull();
    expect(ipc.ipc.removeListener).toHaveBeenCalledWith(COMMENT_CHANNEL.toPreload, expect.any(Function));
    const seen = vi.fn();
    win().addEventListener('click', seen, true);
    mouse('click', { x: 250, y: 40 }, byId('increment'));
    expect(seen).toHaveBeenCalledTimes(1);
    uninstall = () => undefined;
  });
});
