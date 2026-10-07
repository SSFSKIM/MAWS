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
  const sent = () => ipc.send.mock.calls.map(([channel, message]) => {
    expect(channel).toBe(COMMENT_CHANNEL.fromPreload);
    return message;
  });
  return { ipc: ipc as PreloadIpc & typeof ipc, deliver, sent, listeners };
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
  vi.restoreAllMocks();
  delete (doc() as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
  Object.defineProperty(win(), 'scrollY', SCROLL_Y);
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
    const types = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'contextmenu', 'dblclick', 'auxclick'];
    for (const type of types) {
      byId('increment').addEventListener(type, seen);
      doc().addEventListener(type, seen);
      doc().addEventListener(type, seen, true);
      win().addEventListener(type, seen);
      win().addEventListener(type, seen, true);
    }
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
    const scroller = byId('scroller');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 }, scrollTop: { value: 0 } });
    const scrollBy = vi.fn();
    (scroller as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    const windowScroll = vi.spyOn(win(), 'scrollBy').mockImplementation(() => undefined);
    const seen = vi.fn();
    win().addEventListener('wheel', seen, true);
    const wheel = (x: number, y: number, deltaY: number) => {
      const event = trusted(new (win().WheelEvent)('wheel', { bubbles: true, cancelable: true, deltaY }));
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } }); // happy-dom's WheelEvent is no MouseEvent
      shield()!.dispatchEvent(event);
      return event;
    };
    const inScroller = wheel(600, 50, 40);
    expect(inScroller.defaultPrevented).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith(0, 40);
    expect(windowScroll).not.toHaveBeenCalled();
    wheel(600, 50, -40); // already at the top: the scroller cannot take it, the document does
    expect(windowScroll).toHaveBeenCalledWith(0, -40);
    wheel(250, 40, 25); // no scrollable ancestor: the document
    expect(windowScroll).toHaveBeenLastCalledWith(0, 25);
    expect(seen).not.toHaveBeenCalled();
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
