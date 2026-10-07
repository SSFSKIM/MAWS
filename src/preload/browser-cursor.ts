// The agent's cursor in the page (E4c execution document, Design §9; Decision Log 10, 20, 23, 72, 77 (a)): imported by
// the browser view's preload (`browser.ts`) alone, so Rollup inlines it, with the zod-free `@shared/browser/cursor`, into
// out/preload/browser.js.
//
// Main sends `browser:cursor` messages while the agent holds the tab (agent/cursor.ts): the pointer moving, a button
// going down or up, the element an action resolved, and `hide` when the agent lets go. This draws them and sends
// nothing. One `<maws-agent-cursor>` element under the page's root, created at the first message, carries the parts in a
// closed shadow root: a 20 px arrow (white, a near-black edge, a soft glow in E2's picker blue; the page has no MAWS
// tokens, so the colours are a system cursor's and fixed), placed at the first point and eased over 160 ms after it, a
// 24 px ripple on a press, the target's box outlined for a moment and fading over 800 ms. The whole fades 1.5 s after the
// last message, and `hide` takes it away within the frame, with no fade, since the covered screenshot's 50 ms grace
// relies on it (Decision Log 77 (a)).
//
// What the page sees of it: one element it can observe or remove (the next message, or DOMContentLoaded, puts it back)
// and nothing else; the channel is main's, one way. The element never takes the pointer, so E4d's comment mode, whose
// hit test reads `elementsFromPoint`, never meets it; at the same top z-index, whichever of the two the root received
// later paints above, which is comment mode's shield and hover UI when the person arms it after the agent acted.
// Styles are inline CSSOM writes (a page's CSP governs neither them nor nodes made with createElement); `display` is
// never written on the element, so a screenshot's `maws-agent-cursor{display:none!important}` (Design §7) hides it.
//
// The DOM is typed structurally, as `browser-comment.ts`'s is: src/preload compiles under the Node program, which has no
// DOM lib.
import { BROWSER_CURSOR_CHANNEL, type AgentCursorBox, type AgentCursorMessage } from '@shared/browser/cursor';

export const AGENT_CURSOR_TAG = 'maws-agent-cursor';

export const CURSOR_TIMING = {
  moveMs: 160, // the pointer's ease between two points
  rippleMs: 450, // a press's ripple, grown and faded
  outlineMs: 800, // the target's outline fading
  idleMs: 1_500, // shown this long after the last message
  fadeMs: 400, // then faded over this long
  tipPx: 2, // the arrow's tip inside its 20 px box
} as const;

// --- the slice of the page this module touches (a browser window, and happy-dom's, satisfy it) ---

interface OwnNode {
  readonly style: { setProperty(name: string, value: string, priority?: string): void };
  readonly isConnected: boolean;
  setAttribute(name: string, value: string): void;
  appendChild(child: OwnNode): unknown;
  getBoundingClientRect(): unknown;
  remove(): void;
}
interface HostNode extends OwnNode {
  attachShadow(init: { mode: 'closed' }): { appendChild(child: OwnNode): unknown };
}
interface CursorDocument {
  readonly documentElement: { appendChild(child: OwnNode): unknown } | null;
  createElement(tagName: string): OwnNode;
  createElementNS(namespace: string, qualifiedName: string): OwnNode;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}
export interface CursorPage {
  readonly document: CursorDocument;
}
// Electron's `ipcRenderer` satisfies it.
export interface CursorIpc {
  on(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, message: unknown) => void): unknown;
}

// --- the look: fixed colours (Decision Log 20) ---

const ACCENT = '#2f6feb'; // E2's picker blue, as E4d's hover UI uses
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW = 'M2 2 L2 17.5 L6.4 13.4 L9.3 19.6 L12.1 18.3 L9.3 12.3 L15.3 12.3 Z';
const RIPPLE_PX = 24;

// The element in the page: every property a page's stylesheet could plausibly set on an unknown element is pinned inline
// (`!important` inline beats the page's own), but `display`, which a screenshot's stylesheet sets to hide it.
const HOST = {
  position: 'fixed',
  left: '0',
  top: '0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  border: 'none',
  overflow: 'visible',
  transform: 'none',
  filter: 'none',
  'clip-path': 'none',
  contain: 'none',
  'will-change': 'auto',
  opacity: '1',
  visibility: 'visible',
  'pointer-events': 'none',
  'z-index': '2147483647',
};
// Inside the closed shadow root only inherited properties reach from the page; these are set anyway.
const ABSOLUTE = { position: 'absolute', left: '0', top: '0', margin: '0', padding: '0', 'pointer-events': 'none', 'box-sizing': 'border-box' };
const LAYER = { ...ABSOLUTE, opacity: '0', transition: 'none', visibility: 'visible' };
const POINTER = { ...ABSOLUTE, width: '20px', height: '20px', 'z-index': '2', filter: `drop-shadow(0 0 3px ${ACCENT}) drop-shadow(0 0 6px rgba(47, 111, 235, 0.55))` };
const OUTLINE = { ...ABSOLUTE, 'z-index': '0', border: `2px solid ${ACCENT}`, 'border-radius': '2px', opacity: '0', transition: 'none' };
const RIPPLE = { ...ABSOLUTE, 'z-index': '1', width: `${RIPPLE_PX}px`, height: `${RIPPLE_PX}px`, 'border-radius': '50%', border: `2px solid ${ACCENT}`, background: 'rgba(47, 111, 235, 0.18)' };

const KINDS = new Set(['move', 'press', 'release', 'target', 'hide']);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBox = (value: unknown): value is AgentCursorBox => {
  if (typeof value !== 'object' || value === null) return false;
  const box = value as Record<string, unknown>;
  return isNumber(box.x) && isNumber(box.y) && isNumber(box.width) && isNumber(box.height);
};

// Main's message, checked: the channel is main's alone, but a malformed one draws nothing rather than half a cursor.
function cursorMessage(message: unknown): AgentCursorMessage | null {
  if (typeof message !== 'object' || message === null) return null;
  const m = message as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !KINDS.has(m.kind)) return null;
  if (m.kind === 'hide') return { kind: 'hide' };
  if (!isNumber(m.x) || !isNumber(m.y)) return null;
  if (m.kind === 'target') return isBox(m.box) ? { kind: 'target', x: m.x, y: m.y, box: m.box } : null;
  return { kind: m.kind as 'move' | 'press' | 'release', x: m.x, y: m.y };
}

export function installAgentCursor(ipc: CursorIpc, page: CursorPage = globalThis as unknown as CursorPage): () => void {
  const doc = page.document;
  const set = (node: OwnNode, styles: Record<string, string>) => {
    for (const [name, value] of Object.entries(styles)) node.style.setProperty(name, value, 'important');
  };
  const own = (tag: string, part: string, styles: Record<string, string>) => {
    const node = doc.createElement(tag);
    node.setAttribute('data-part', part);
    set(node, styles);
    return node;
  };
  const svg = (tag: string, attributes: Record<string, string>) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  // A style written, then read back, so the next write starts a transition from it rather than replacing it.
  const flush = (node: OwnNode) => void node.getBoundingClientRect();

  let ui: { host: HostNode; layer: OwnNode; pointer: OwnNode; outline: OwnNode } | null = null;
  let placed = false; // the pointer has a position to ease from
  let idle: ReturnType<typeof setTimeout> | null = null;
  const ripples = new Map<OwnNode, ReturnType<typeof setTimeout>>();

  const build = () => {
    const host = doc.createElement(AGENT_CURSOR_TAG) as HostNode;
    set(host, HOST);
    const root = host.attachShadow({ mode: 'closed' });
    const layer = own('div', 'layer', LAYER);
    const outline = own('div', 'outline', OUTLINE);
    const pointer = own('div', 'pointer', POINTER);
    const arrow = svg('svg', { width: '20', height: '20', viewBox: '0 0 20 20', 'aria-hidden': 'true' });
    arrow.appendChild(svg('path', { d: ARROW, fill: '#ffffff', stroke: '#1a1a1a', 'stroke-width': '1.25', 'stroke-linejoin': 'round' }));
    pointer.appendChild(arrow);
    layer.appendChild(outline);
    layer.appendChild(pointer);
    root.appendChild(layer);
    return { host, layer, pointer, outline };
  };

  // The element in the page, made at the first message and put back when the page removed it.
  const attached = () => {
    const root = doc.documentElement;
    if (root === null) return null; // no document to draw in
    ui ??= build();
    if (!ui.host.isConnected) root.appendChild(ui.host);
    return ui;
  };

  const clearRipples = () => {
    for (const [ripple, timer] of ripples) {
      clearTimeout(timer);
      ripple.remove();
    }
    ripples.clear();
  };

  const show = (parts: NonNullable<typeof ui>) => {
    set(parts.layer, { opacity: '1', transition: 'none' });
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      set(parts.layer, { opacity: '0', transition: `opacity ${CURSOR_TIMING.fadeMs}ms ease` });
    }, CURSOR_TIMING.idleMs);
  };

  const pointAt = (parts: NonNullable<typeof ui>, x: number, y: number) => {
    const transition = placed ? `transform ${CURSOR_TIMING.moveMs}ms ease` : 'none';
    set(parts.pointer, { transition, transform: `translate(${x - CURSOR_TIMING.tipPx}px, ${y - CURSOR_TIMING.tipPx}px)` });
    placed = true;
  };

  const ripple = (parts: NonNullable<typeof ui>, x: number, y: number) => {
    const half = RIPPLE_PX / 2;
    const node = own('div', 'ripple', { ...RIPPLE, opacity: '0.9', transition: 'none', transform: `translate(${x - half}px, ${y - half}px) scale(0.4)` });
    parts.layer.appendChild(node);
    flush(node);
    const ms = CURSOR_TIMING.rippleMs;
    set(node, { opacity: '0', transition: `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`, transform: `translate(${x - half}px, ${y - half}px) scale(1)` });
    ripples.set(
      node,
      setTimeout(() => {
        ripples.delete(node);
        node.remove();
      }, ms),
    );
  };

  const outline = (parts: NonNullable<typeof ui>, box: AgentCursorBox) => {
    set(parts.outline, { opacity: '1', transition: 'none', left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    flush(parts.outline);
    set(parts.outline, { opacity: '0', transition: `opacity ${CURSOR_TIMING.outlineMs}ms ease-in` });
  };

  // Gone within the frame: no fade, no timer left to bring anything back.
  const hide = () => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    clearRipples();
    placed = false;
    if (ui === null) return;
    set(ui.layer, { opacity: '0', transition: 'none' });
    set(ui.outline, { opacity: '0', transition: 'none' });
  };

  const onMessage = (_event: unknown, raw: unknown) => {
    const message = cursorMessage(raw);
    if (message === null) return;
    if (message.kind === 'hide') return hide();
    const parts = attached();
    if (parts === null) return;
    pointAt(parts, message.x, message.y);
    if (message.kind === 'press') ripple(parts, message.x, message.y);
    if (message.kind === 'target') outline(parts, message.box);
    show(parts);
  };

  // A document the parser finished after the element went in: the element goes last in the root again, above what the
  // page appended meanwhile at the same z-index.
  const onLoaded = () => {
    if (ui !== null && doc.documentElement !== null) doc.documentElement.appendChild(ui.host);
  };

  ipc.on(BROWSER_CURSOR_CHANNEL, onMessage);
  doc.addEventListener('DOMContentLoaded', onLoaded);

  return () => {
    ipc.removeListener(BROWSER_CURSOR_CHANNEL, onMessage);
    doc.removeEventListener('DOMContentLoaded', onLoaded);
    hide();
    ui?.host.remove();
    ui = null;
  };
}
