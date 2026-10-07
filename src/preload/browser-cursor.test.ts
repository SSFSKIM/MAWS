// @vitest-environment happy-dom
// The agent's cursor in the page (E4c execution document, Design §9; Decision Log 10, 20, 23, 72, 77 (a)): main's
// `browser:cursor` messages draw one `<maws-agent-cursor>` under the page's root, its parts in a closed shadow root: the
// pointer placed at the first point and moved with a 160 ms ease after it, a ripple on a press, the target's box
// outlined and fading over 800 ms, the whole fading 1.5 s after the last message, and gone within a frame on `hide`. A
// removed element is put back by the next message and on DOMContentLoaded. It never takes the pointer, sits at the top
// z-index, and leaves `display` to the page's styles, so a screenshot's `maws-agent-cursor{display:none!important}`
// hides it. It sends nothing (`CursorIpc` has no way to).
//
// The shadow root is closed, so the suite reads it by recording what `attachShadow` returns.
import type { CSSStyleDeclaration, Document as HappyDocument, Element as HappyElement, ShadowRoot as HappyShadowRoot, Window as HappyWindow } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_CURSOR_CHANNEL, type AgentCursorMessage } from '@shared/browser/cursor';
import { AGENT_CURSOR_TAG, CURSOR_TIMING, installAgentCursor, type CursorIpc } from './browser-cursor';

const win = (): HappyWindow => globalThis as unknown as HappyWindow;
const doc = (): HappyDocument => win().document;

function fakeIpc() {
  const listeners = new Map<string, (event: unknown, message: unknown) => void>();
  const ipc = {
    on: vi.fn((channel: string, listener: (event: unknown, message: unknown) => void) => listeners.set(channel, listener)),
    removeListener: vi.fn((channel: string) => listeners.delete(channel)),
  };
  const deliver = (message: AgentCursorMessage | unknown) => listeners.get(BROWSER_CURSOR_CHANNEL)?.({}, message);
  return { ipc: ipc as CursorIpc & typeof ipc, deliver, listeners };
}

let shadows: HappyShadowRoot[];
let ipc: ReturnType<typeof fakeIpc>;
let uninstall: () => void;

const hosts = () => Array.from(doc().querySelectorAll(AGENT_CURSOR_TAG));
const host = () => hosts()[0] as HappyElement | undefined;
const part = (name: string) => shadows[0]!.querySelector(`[data-part="${name}"]`) as HappyElement | null;
const parts = (name: string) => Array.from(shadows[0]!.querySelectorAll(`[data-part="${name}"]`));
const style = (el: HappyElement | null | undefined, name: string) => (el as unknown as { style: CSSStyleDeclaration }).style.getPropertyValue(name);

beforeEach(() => {
  vi.useFakeTimers();
  doc().body.innerHTML = '<main><h1>Order form</h1></main>';
  shadows = [];
  const attach = win().Element.prototype.attachShadow;
  vi.spyOn(win().Element.prototype, 'attachShadow').mockImplementation(function (this: HappyElement, init) {
    const root = attach.call(this, init);
    shadows.push(root);
    return root;
  });
  ipc = fakeIpc();
  uninstall = installAgentCursor(ipc.ipc);
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the agent cursor', () => {
  // That it sends nothing is the type's to enforce: `CursorIpc` offers `on` and `removeListener` alone.
  it('listens on the cursor channel and draws nothing before a message', () => {
    expect(ipc.listeners.has(BROWSER_CURSOR_CHANNEL)).toBe(true);
    expect(hosts()).toHaveLength(0);
  });

  it('a move appends one element under the root, in a closed shadow root, that never takes the pointer, at the top', () => {
    ipc.deliver({ kind: 'move', x: 120, y: 80 });
    expect(hosts()).toHaveLength(1);
    expect(host()!.parentElement).toBe(doc().documentElement);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!.mode).toBe('closed');
    expect(host()!.shadowRoot).toBeNull();
    expect(style(host(), 'pointer-events')).toBe('none');
    expect(style(host(), 'z-index')).toBe('2147483647');
    expect(style(host(), 'position')).toBe('fixed');
    // `display` is the page's to decide: a screenshot's stylesheet hides the element (Design §7)
    expect(style(host(), 'display')).toBe('');
    ipc.deliver({ kind: 'move', x: 130, y: 90 });
    expect(hosts()).toHaveLength(1);
    expect(shadows).toHaveLength(1);
  });

  it('places the pointer at the first point at once, then eases each later move over 160 ms', () => {
    ipc.deliver({ kind: 'move', x: 120, y: 80 });
    const pointer = part('pointer');
    expect(style(pointer, 'transform')).toBe(`translate(${120 - CURSOR_TIMING.tipPx}px, ${80 - CURSOR_TIMING.tipPx}px)`);
    expect(style(pointer, 'transition')).toBe('none');
    expect(pointer!.querySelector('svg')).not.toBeNull();
    ipc.deliver({ kind: 'move', x: 300, y: 200 });
    expect(style(pointer, 'transform')).toBe(`translate(${300 - CURSOR_TIMING.tipPx}px, ${200 - CURSOR_TIMING.tipPx}px)`);
    expect(style(pointer, 'transition')).toBe(`transform ${CURSOR_TIMING.moveMs}ms ease`);
    expect(CURSOR_TIMING.moveMs).toBe(160);
  });

  it('a press ripples at its point and the ripple goes once it has played; a release moves the pointer', () => {
    ipc.deliver({ kind: 'move', x: 50, y: 60 });
    ipc.deliver({ kind: 'press', x: 50, y: 60 });
    expect(parts('ripple')).toHaveLength(1);
    const ripple = parts('ripple')[0] as HappyElement;
    expect(style(ripple, 'width')).toBe('24px');
    expect(style(ripple, 'opacity')).toBe('0'); // fading out from the press
    vi.advanceTimersByTime(CURSOR_TIMING.rippleMs + 50);
    expect(parts('ripple')).toHaveLength(0);
    ipc.deliver({ kind: 'release', x: 52, y: 61 });
    expect(style(part('pointer'), 'transform')).toBe(`translate(${52 - CURSOR_TIMING.tipPx}px, ${61 - CURSOR_TIMING.tipPx}px)`);
  });

  it('a target outlines its box, fading over 800 ms, and moves the pointer to its centre', () => {
    ipc.deliver({ kind: 'target', x: 160, y: 47, box: { x: 100, y: 32, width: 120, height: 30 } });
    const outline = part('outline');
    expect([style(outline, 'left'), style(outline, 'top'), style(outline, 'width'), style(outline, 'height')]).toEqual(['100px', '32px', '120px', '30px']);
    expect(style(outline, 'border')).toContain('2px solid');
    expect(style(outline, 'opacity')).toBe('0');
    expect(style(outline, 'transition')).toBe(`opacity ${CURSOR_TIMING.outlineMs}ms ease-in`);
    expect(CURSOR_TIMING.outlineMs).toBe(800);
    expect(style(part('pointer'), 'transform')).toBe(`translate(${160 - CURSOR_TIMING.tipPx}px, ${47 - CURSOR_TIMING.tipPx}px)`);
  });

  it('fades out 1.5 s after the last message, and a message before then keeps it shown', () => {
    ipc.deliver({ kind: 'move', x: 10, y: 10 });
    expect(style(part('layer'), 'opacity')).toBe('1');
    vi.advanceTimersByTime(1_000);
    ipc.deliver({ kind: 'move', x: 20, y: 20 });
    vi.advanceTimersByTime(1_000);
    expect(style(part('layer'), 'opacity')).toBe('1');
    vi.advanceTimersByTime(CURSOR_TIMING.idleMs - 1_000);
    expect(style(part('layer'), 'opacity')).toBe('0');
    expect(style(part('layer'), 'transition')).toBe(`opacity ${CURSOR_TIMING.fadeMs}ms ease`);
    expect(CURSOR_TIMING.idleMs).toBe(1_500);
    // the next move shows it again, from where it was
    ipc.deliver({ kind: 'move', x: 30, y: 30 });
    expect(style(part('layer'), 'opacity')).toBe('1');
    expect(style(part('pointer'), 'transition')).toBe(`transform ${CURSOR_TIMING.moveMs}ms ease`);
  });

  it('hide takes it away at once, with no fade (Decision Log 77 (a)), and the next move places the pointer anew', () => {
    ipc.deliver({ kind: 'target', x: 160, y: 47, box: { x: 100, y: 32, width: 120, height: 30 } });
    ipc.deliver({ kind: 'press', x: 160, y: 47 });
    ipc.deliver({ kind: 'hide' });
    expect(style(part('layer'), 'opacity')).toBe('0');
    expect(style(part('layer'), 'transition')).toBe('none');
    expect(parts('ripple')).toHaveLength(0);
    vi.advanceTimersByTime(CURSOR_TIMING.idleMs * 2);
    expect(style(part('layer'), 'transition')).toBe('none'); // no idle fade armed after a hide
    ipc.deliver({ kind: 'move', x: 400, y: 300 });
    expect(style(part('layer'), 'opacity')).toBe('1');
    expect(style(part('pointer'), 'transition')).toBe('none');
  });

  it('a hide before anything was drawn draws nothing', () => {
    ipc.deliver({ kind: 'hide' });
    expect(hosts()).toHaveLength(0);
  });

  it('is put back by the next message when the page removed it, and moved to the end of the root on DOMContentLoaded', () => {
    ipc.deliver({ kind: 'move', x: 10, y: 10 });
    const first = host()!;
    first.remove();
    expect(hosts()).toHaveLength(0);
    ipc.deliver({ kind: 'move', x: 20, y: 20 });
    expect(hosts()).toEqual([first]);
    expect(shadows).toHaveLength(1); // the same element, its shadow root kept
    const later = doc().createElement('div');
    doc().documentElement.appendChild(later);
    expect(doc().documentElement.lastElementChild).toBe(later);
    doc().dispatchEvent(new (win().Event)('DOMContentLoaded'));
    expect(doc().documentElement.lastElementChild).toBe(first);
  });

  it('ignores what is not a cursor message', () => {
    for (const message of [null, 'move', { kind: 'move', x: '1', y: 2 }, { kind: 'move', x: Number.NaN, y: 2 }, { kind: 'jump', x: 1, y: 2 }, { kind: 'target', x: 1, y: 2 }, { kind: 'target', x: 1, y: 2, box: { x: 0, y: 0, width: 'w', height: 1 } }]) {
      ipc.deliver(message);
    }
    expect(hosts()).toHaveLength(0);
  });

  it('uninstalled, it stops listening and takes its element away', () => {
    ipc.deliver({ kind: 'move', x: 10, y: 10 });
    uninstall();
    expect(ipc.listeners.has(BROWSER_CURSOR_CHANNEL)).toBe(false);
    expect(hosts()).toHaveLength(0);
    doc().dispatchEvent(new (win().Event)('DOMContentLoaded'));
    expect(hosts()).toHaveLength(0);
  });
});
