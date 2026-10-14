// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", "Transform layer"; M5): the
// stage's overlay. It sits beside the scaled slide in screen pixels (handles keep their size at any zoom) and draws the
// selection's outlines, the eight resize handles and the rotation handle, a connector's two ends, the snapping guides,
// the marquee and a flow child's insertion bar. It takes the stage's pointer presses (click, shift-click, ⌘-click,
// double-click, marquee, drags), its keys (Escape, Tab, Enter, Delete, arrows, ⌘D, ⌘G, ⇧⌘G, ⌘] and ⌘[, ⌘A) and the
// clipboard while the stage has focus. Gestures are gestures.ts's; which element a press picks is selection.ts's.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { SlideCanvas } from '../../canvas';
import { HANDLES, rotatedBounds, union, type Box, type Guide, type Handle, type Pt } from '../../geometry';
import { isPinned } from '../../ir';
import { ROOT } from '../../model';
import type { ElementWrites } from '../../writers-elements';
import { writeElements } from '../../writers-elements';
import { DECK_COPY as C } from '../copy';
import type { DeckSession } from '../session';
import { copySelection, pasteClipboard } from './clipboard';
import { selectionCommands } from './commands';
import { handlesOf, nudge, startEndpoint, startFlowMove, startMarquee, startMove, startResize, startRotate, type Frame, type Gesture, type GestureContext, type Mods } from './gestures';
import { hitIds, measure, measureAll, type Measured } from './measure';
import { allPinned, drill, escapeUp, isText, pick, selectAll, slideTree, tabNext } from './selection';
import { useDocVersion } from './use-doc-version';

export interface OverlayProps {
  session: DeckSession;
  canvas: SlideCanvas | null;
  slideId: string;
  scale: number;
  readOnly: boolean;
  /** The stage's scroll box: it takes the pointer presses and keys. */
  surface: RefObject<HTMLDivElement | null>;
  /** The scaled slide's frame: screen coordinates are read against it. */
  frame: RefObject<HTMLDivElement | null>;
  /** A refusal or a note to show the owner (a paste that did not load, a group past the limit). */
  onNotice?: (text: string) => void;
  /** The text box for a text element edited in place, drawn inside the overlay (made anew when its node is). */
  renderText?: (elementId: string, canvas: SlideCanvas) => ReactNode;
}

// a key per drawn node, so the text box mounts again on a node the canvas made anew (a tag an agent changed)
const nodeKeys = new WeakMap<object, number>();
let nextNodeKey = 0;
function keyOf(node: object | undefined): number {
  if (!node) return -1;
  if (!nodeKeys.has(node)) nodeKeys.set(node, nextNodeKey++);
  return nodeKeys.get(node)!;
}

const DRAG_START_PX = 3; // screen px a press moves before it is a drag
const HIT_SLACK_PX = 8; // screen px around a connector's line that hit it

interface Pending {
  start: Pt; // client px
  p0: Pt; // slide px
  make: () => Gesture | null;
  target: string | null;
  toggle: boolean;
  pointerId: number;
}

export function Overlay({ session, canvas, slideId, scale, readOnly, surface, frame, onNotice, renderText }: OverlayProps) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const version = useDocVersion(session);
  const selection = state.selection;
  const editing = state.editingText;
  const [measured, setMeasured] = useState<Map<string, Measured>>(new Map());
  const [shown, setShown] = useState<Frame | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<Pending | null>(null);

  // the selection's boxes, measured again whenever the slide, the selection or the zoom changes; a selected element
  // another replica removed leaves the selection (and a text edit of it ends)
  useLayoutEffect(() => {
    if (canvas) {
      const live = selection.filter((id) => canvas.node(id) !== undefined);
      if (live.length !== selection.length) session.select(live);
    }
    setMeasured(canvas ? measureAll(canvas, selection, scale) : new Map());
  }, [canvas, selection, scale, version, slideId, session]);

  const ctx = useCallback((): GestureContext | null => (canvas ? { session, slideId, canvas, scale } : null), [canvas, session, slideId, scale]);

  const slidePoint = useCallback(
    (client: Pt): Pt => {
      const r = frame.current?.getBoundingClientRect();
      return r ? { x: (client.x - r.left) / scale, y: (client.y - r.top) / scale } : { x: 0, y: 0 };
    },
    [frame, scale],
  );

  // a text edit ended (Escape, a click elsewhere): the keys come back to the stage
  const wasEditing = useRef<string | null>(null);
  useEffect(() => {
    const el = surface.current;
    const active = el?.ownerDocument.activeElement;
    if (wasEditing.current !== null && editing === null && el && (!active || active === el.ownerDocument.body || canvas?.root.contains(active))) el.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing, surface, canvas]);

  // ---- pointer
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const mods = (e: PointerEvent | KeyboardEvent): Mods => ({ shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey });

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const c = ctx();
      const target = e.target as HTMLElement;
      if (!c) return;
      if (target.closest('.deck-markbar, .deck-textbox')) return; // the text box's own
      if (editing !== null && c.canvas.node(editing)?.contains(target)) return;
      el.focus({ preventScroll: true });
      const client = { x: e.clientX, y: e.clientY };
      const p = slidePoint(client);
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
      const current = session.snapshot().selection;
      if (handle && !readOnly && current.length === 1) {
        const id = current[0]!;
        const make = () =>
          handle === 'rotate' ? startRotate(c, id) : handle === 'end0' || handle === 'end1' ? startEndpoint(c, id, handle === 'end0' ? 0 : 1) : startResize(c, id, handle as Handle, p);
        gesture.current = make();
        el.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }
      const tree = slideTree(session.doc, slideId);
      const connectors = [...measureAll(c.canvas, tree.childrenOf(ROOT).filter((id) => tree.element(id)?.tag === 'x-connector'), scale).values()];
      const hits = hitIds(c.canvas, client, p, HIT_SLACK_PX / scale, connectors);
      const picked = pick(tree, hits, current, { deep: e.metaKey || e.ctrlKey, toggle: e.shiftKey });
      session.select(picked.selection);
      const base = e.shiftKey ? current : [];
      let make: () => Gesture | null = () => null;
      if (picked.target === null) make = () => startMarquee(c, p, base);
      else if (!readOnly && !e.shiftKey && picked.selection.length > 0) {
        const sel = picked.selection;
        if (allPinned(tree, sel)) make = () => startMove(c, sel, p);
        else if (sel.length === 1) {
          const me = tree.element(sel[0]!)!;
          if (!isPinned(me.tag, me.style, me.attrs) && me.tag !== 'tr' && me.tag !== 'th' && me.tag !== 'td') make = () => startFlowMove(c, sel[0]!, p);
        }
      }
      pending.current = { start: client, p0: p, make, target: picked.target, toggle: e.shiftKey, pointerId: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      const pend = pending.current;
      if (pend && !gesture.current) {
        if (Math.hypot(e.clientX - pend.start.x, e.clientY - pend.start.y) < DRAG_START_PX) return;
        gesture.current = pend.make();
        pending.current = null;
        if (!gesture.current) return;
      }
      const g = gesture.current;
      if (!g) return;
      setShown(g.frame(slidePoint({ x: e.clientX, y: e.clientY }), mods(e)));
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      const pend = pending.current;
      pending.current = null;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (g) {
        g.end(true);
        setShown(null);
        return;
      }
      // a press without a drag inside a multi-selection narrows it to what was pressed
      if (pend && pend.target !== null && !pend.toggle && session.snapshot().selection.length > 1) session.select([pend.target]);
    };

    // a double-click goes into the selected container, or edits the selected text element (a pointer press carries no
    // click count; the dblclick after it does)
    const onDouble = (e: MouseEvent) => {
      const c = ctx();
      const current = session.snapshot().selection;
      if (!c || current.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('.deck-markbar, .deck-textbox, [data-handle]')) return;
      const client = { x: e.clientX, y: e.clientY };
      const p = slidePoint(client);
      const tree = slideTree(session.doc, slideId);
      const connectors = [...measureAll(c.canvas, tree.childrenOf(ROOT).filter((id) => tree.element(id)?.tag === 'x-connector'), scale).values()];
      const into = drill(tree, hitIds(c.canvas, client, p, HIT_SLACK_PX / scale, connectors), current);
      if (into === 'edit' && !readOnly) session.editText(current[0]!);
      else if (Array.isArray(into)) session.select(into);
      else return;
      e.preventDefault();
    };

    const onCancel = () => {
      gesture.current?.end(false);
      gesture.current = null;
      pending.current = null;
      setShown(null);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('dblclick', onDouble);
    return () => {
      el.removeEventListener('dblclick', onDouble);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [surface, ctx, slidePoint, session, slideId, scale, readOnly, editing]);

  // ---- keys and the clipboard, while the stage has focus
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const fromStage = (e: Event) => e.target === el;
    const notice = (reason: string | null) => reason && onNotice?.(reason);

    const onKey = (e: KeyboardEvent) => {
      if (!fromStage(e)) return;
      const c = ctx();
      if (!c) return;
      const tree = slideTree(session.doc, slideId);
      const sel = session.snapshot().selection.filter((id) => tree.has(id));
      const mod = e.metaKey || e.ctrlKey;
      const cmds = selectionCommands(c, sel, readOnly);
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const key = e.key;
      if (key === 'Escape') {
        if (sel.length) {
          session.select(escapeUp(tree, sel));
          done();
        }
      } else if (key === 'Tab' && !mod) {
        session.select(tabNext(tree, sel, e.shiftKey));
        done();
      } else if (key === 'Enter' && sel.length === 1 && !readOnly) {
        const kids = tree.childrenOf(sel[0]!);
        if (isText(tree.element(sel[0]!)?.tag)) session.editText(sel[0]!);
        else if (kids.length) session.select([kids[0]!]);
        done();
      } else if ((key === 'Delete' || key === 'Backspace') && cmds.canEdit) {
        cmds.remove();
        done();
      } else if (key.startsWith('Arrow') && !mod && cmds.canZ) {
        const step = e.shiftKey ? 10 : 1;
        const d = { x: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, y: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0 };
        nudge(c, sel, d, (writes: Record<string, ElementWrites>) => session.typing('nudge', (origin) => writeElements(session.doc, slideId, writes, origin)));
        done();
      } else if (mod && key.toLowerCase() === 'd' && cmds.canEdit) {
        notice(cmds.duplicate());
        done();
      } else if (mod && key.toLowerCase() === 'g') {
        if (e.shiftKey && cmds.canUngroup) notice(cmds.ungroup());
        else if (!e.shiftKey && cmds.canGroup) notice(cmds.group());
        done();
      } else if (mod && (key === ']' || key === '[') && cmds.canZ) {
        cmds.z(key === ']' ? (e.altKey ? 'front' : 'forward') : e.altKey ? 'back' : 'backward');
        done();
      } else if (mod && key.toLowerCase() === 'a') {
        session.select(selectAll(tree, sel));
        done();
      }
    };

    const doc = el.ownerDocument;
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (doc.activeElement !== el) return;
      const c = ctx();
      if (!c) return;
      const sel = session.snapshot().selection;
      copySelection(e, c, sel, cut && !readOnly, () => selectionCommands(c, sel, readOnly).remove());
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    const paste = (e: ClipboardEvent) => {
      if (doc.activeElement !== el || readOnly) return;
      const c = ctx();
      if (!c) return;
      const result = pasteClipboard(e, c, session.snapshot().selection);
      if (result && 'ids' in result) session.select(result.ids);
      else if (result) onNotice?.(result.reason);
    };
    // Chromium enables its Copy, Cut and Paste commands on a focus that holds no text selection only when the page takes
    // them (a cancelled `beforecopy`, `beforecut`, `beforepaste`): the stage takes them while it has focus
    const enable = (needsSelection: boolean) => (e: Event) => {
      if (doc.activeElement === el && (!needsSelection || session.snapshot().selection.length > 0)) e.preventDefault();
    };
    const beforeCopy = enable(true);
    const beforePaste = enable(false);
    el.addEventListener('keydown', onKey);
    doc.addEventListener('copy', copy);
    doc.addEventListener('cut', cut);
    doc.addEventListener('paste', paste);
    doc.addEventListener('beforecopy', beforeCopy);
    doc.addEventListener('beforecut', beforeCopy);
    doc.addEventListener('beforepaste', beforePaste);
    return () => {
      el.removeEventListener('keydown', onKey);
      doc.removeEventListener('copy', copy);
      doc.removeEventListener('cut', cut);
      doc.removeEventListener('paste', paste);
      doc.removeEventListener('beforecopy', beforeCopy);
      doc.removeEventListener('beforecut', beforeCopy);
      doc.removeEventListener('beforepaste', beforePaste);
    };
  }, [surface, ctx, session, slideId, readOnly, onNotice]);

  // ---- drawing
  const tree = canvas ? slideTree(session.doc, slideId) : null;
  const items = selection.map((id) => measured.get(id)).filter((m): m is Measured => m !== undefined);
  const single = items.length === 1 && selection.length === 1 ? items[0]! : null;
  const showHandles = !readOnly && single !== null && editing === null && shown === null;
  const handles = single && tree ? handlesOf(tree, single.id) : [];
  const s = (n: number) => n * scale;
  const boxStyle = (b: Box, rotation = 0) => ({ left: s(b.x), top: s(b.y), width: s(b.w), height: s(b.h), transform: rotation ? `rotate(${rotation}deg)` : undefined });
  const all = items.length > 1 ? union(items.map((m) => rotatedBounds(m.box, m.rotation))) : null;
  const rotatable = single !== null && !single.points && tree?.element(single.id)?.tag !== 'x-connector' && !['tr', 'th', 'td'].includes(tree?.element(single.id)?.tag ?? '');

  return (
    <div className="deck-overlay" data-overlay>
      {items.map((m) =>
        m.points ? (
          <svg key={m.id} className="deck-sel-line" data-selected={m.id} style={{ left: 0, top: 0, width: s(1920), height: s(1080) }}>
            <polyline points={(m.route ?? m.points).map((q) => `${s(q.x)},${s(q.y)}`).join(' ')} />
          </svg>
        ) : (
          <div key={m.id} className="deck-sel" data-selected={m.id} data-editing={editing === m.id || undefined} style={boxStyle(m.box, m.rotation)}>
            {showHandles &&
              single === m &&
              HANDLES.filter((h) => handles.includes(h)).map((h) => <span key={h} className="deck-handle" data-handle={h} data-at={h} aria-label={C.resizeHandle(h)} />)}
            {showHandles && single === m && rotatable && <span className="deck-handle deck-rotate" data-handle="rotate" aria-label={C.rotateHandle} />}
          </div>
        ),
      )}
      {showHandles &&
        single?.points &&
        single.points.map((q, i) => <span key={i} className="deck-handle deck-end" data-handle={`end${i}`} aria-label={C.endHandle(i)} style={{ left: s(q.x), top: s(q.y) }} />)}
      {all && <div className="deck-sel-all" style={boxStyle(all)} />}
      {shown?.guides.map((g: Guide, i) =>
        g.axis === 'x' ? (
          <div key={i} className="deck-guide" data-guide={g.kind} style={{ left: s(g.at), top: s(g.from), width: 0, height: s(g.to - g.from) }} />
        ) : (
          <div key={i} className="deck-guide" data-guide={g.kind} style={{ left: s(g.from), top: s(g.at), width: s(g.to - g.from), height: 0 }} />
        ),
      )}
      {shown?.marquee && <div className="deck-marquee" data-marquee style={boxStyle(shown.marquee)} />}
      {shown?.ghost && <div className="deck-ghost" style={boxStyle(shown.ghost)} />}
      {shown?.insertion && <div className="deck-insertion" data-insertion style={boxStyle(shown.insertion)} />}
      {editing !== null && canvas && renderText && <Fragment key={keyOf(canvas.node(editing))}>{renderText(editing, canvas)}</Fragment>}
    </div>
  );
}

/** The selection's box in its host for the inspector (its measured layout, slide px). */
export function measureInHost(canvas: SlideCanvas | null, id: string, scale: number): Box | null {
  if (!canvas) return null;
  const m = measure(canvas, id, scale);
  return m ? { x: m.layout.x - m.hostOrigin.x, y: m.layout.y - m.hostOrigin.y, w: m.layout.w, h: m.layout.h } : null;
}
