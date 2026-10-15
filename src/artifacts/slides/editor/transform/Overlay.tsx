// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", "Transform layer"; M5): the
// stage's overlay. It sits beside the scaled slide in screen pixels (handles keep their size at any zoom) and draws the
// selection's outlines, the eight resize handles and the rotation handle, a connector's two ends, the snapping guides,
// the marquee and a flow child's insertion bar. It takes the stage's pointer presses (click, shift-click, ⌘-click,
// double-click, marquee, drags), its keys (Escape, Tab, Enter, Delete, arrows, ⌘D, ⌘G, ⇧⌘G, ⌘] and ⌘[, ⌘A) and the
// clipboard while the stage has focus. Gestures are gestures.ts's; which element a press picks is selection.ts's.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { SlideCanvas } from '../../canvas';
import { apply, applyLinear, HANDLES, union, type Box, type Guide, type Handle, type Pt } from '../../geometry';
import { isPinned } from '../../ir';
import { ROOT } from '../../model';
import type { ElementWrites } from '../../writers-elements';
import { writeElements } from '../../writers-elements';
import { DECK_COPY as C } from '../copy';
import type { DeckSession } from '../session';
import { copySelection, pasteClipboard, type ClipboardContext, type ImportAsset } from './clipboard';
import { selectionCommands } from './commands';
import { handlesOf, nudge, startEndpoint, startFlowMove, startMarquee, startMove, startResize, startRotate, type Frame, type Gesture, type Mods } from './gestures';
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
  /** The deck's artifact, named on what is copied, and how a paste brings another deck's pictures over (fix wave 1). */
  artifactId?: string;
  importAsset?: ImportAsset;
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

export function Overlay({ session, canvas, slideId, scale, readOnly, surface, frame, onNotice, renderText, artifactId, importAsset }: OverlayProps) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const version = useDocVersion(session);
  const selection = state.selection;
  const editing = state.editingText;
  const [measured, setMeasured] = useState<Map<string, Measured>>(new Map());
  const [shown, setShown] = useState<Frame | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<Pending | null>(null);

  const remote = useRemoteSelections(session, slideId);
  // the selection's boxes (and other replicas' on this slide), measured again whenever the slide, a selection or the
  // zoom changes; a selected element another replica removed leaves the selection (and a text edit of it ends)
  useLayoutEffect(() => {
    if (canvas) {
      const live = selection.filter((id) => canvas.node(id) !== undefined);
      if (live.length !== selection.length) session.select(live);
    }
    setMeasured(canvas ? measureAll(canvas, new Set([...selection, ...remote.flatMap((r) => r.elementIds)]), scale) : new Map());
  }, [canvas, selection, remote, scale, version, slideId, session]);

  const ctx = useCallback((): ClipboardContext | null => (canvas ? { session, slideId, canvas, scale, artifactId, importAsset } : null), [canvas, session, slideId, scale, artifactId, importAsset]);

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
      void pasteClipboard(e, c, session.snapshot().selection).then((result) => {
        if (result && 'ids' in result) session.select(result.ids);
        else if (result) onNotice?.(result.reason);
      });
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
  const at = (p: Pt) => ({ left: s(p.x), top: s(p.y) });
  const boxStyle = (b: Box) => ({ left: s(b.x), top: s(b.y), width: s(b.w), height: s(b.h) });
  const outline = (m: Measured) => (m.route ?? m.corners).map((q) => `${s(q.x)},${s(q.y)}`).join(' ');
  const all = items.length > 1 ? union(items.map((m) => m.bounds)) : null;
  const tag = single ? tree?.element(single.id)?.tag : undefined;
  const rotatable = single !== null && !single.points && tag !== 'x-connector' && !['tr', 'th', 'td'].includes(tag ?? '');
  // the rotation handle: above the middle of the top edge, along the element's own up, 22 screen px off
  const rotateAt = (m: Measured) => {
    const top = apply(m.matrix, { x: m.w / 2, y: 0 });
    const up = applyLinear(m.matrix, { x: 0, y: -1 });
    const len = Math.hypot(up.x, up.y) || 1;
    return { left: s(top.x) + (up.x / len) * ROTATE_OFFSET, top: s(top.y) + (up.y / len) * ROTATE_OFFSET };
  };

  return (
    <div className="deck-overlay" data-overlay>
      <svg className="deck-overlay-lines" width={s(1920)} height={s(1080)} aria-hidden>
        {remote.flatMap((r) =>
          r.elementIds.flatMap((id) => {
            const m = measured.get(id);
            return m ? [<polygon key={`${r.clientId}:${id}`} className="deck-remote-sel" data-remote-selected={id} aria-label={r.name} style={{ '--remote-color': authorColor(r.color) } as CSSProperties} points={outline(m)} />] : [];
          }),
        )}
        {items.map((m) =>
          m.points ? (
            <polyline key={m.id} className="deck-sel-line" data-selected={m.id} points={outline(m)} />
          ) : (
            <polygon key={m.id} className="deck-sel" data-selected={m.id} data-editing={editing === m.id || undefined} points={outline(m)} />
          ),
        )}
        {all && <rect className="deck-sel-all" x={s(all.x)} y={s(all.y)} width={s(all.w)} height={s(all.h)} />}
      </svg>
      {remote.map((r) => {
        const first = r.elementIds.map((id) => measured.get(id)).find((m) => m !== undefined);
        return first ? (
          <span key={r.clientId} className="deck-remote-name" style={{ ...at(first.bounds), '--remote-color': authorColor(r.color) } as CSSProperties}>
            {r.name}
          </span>
        ) : null;
      })}
      {showHandles &&
        single &&
        !single.points &&
        HANDLES.filter((h) => handles.includes(h)).map((h) => <span key={h} className="deck-handle" data-handle={h} data-at={h} aria-label={C.resizeHandle(h)} style={at(apply(single.matrix, { x: HANDLE_AT[h][0] * single.w, y: HANDLE_AT[h][1] * single.h }))} />)}
      {showHandles && single && rotatable && <span className="deck-handle deck-rotate" data-handle="rotate" aria-label={C.rotateHandle} style={rotateAt(single)} />}
      {showHandles && single?.points && single.points.map((q, i) => <span key={i} className="deck-handle deck-end" data-handle={`end${i}`} aria-label={C.endHandle(i)} style={at(q)} />)}
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

const ROTATE_OFFSET = 22; // screen px between the top edge and the rotation handle
/** Where each handle sits on the element's own box, as fractions of its width and height. */
const HANDLE_AT: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

/** The selection's box in its host for the inspector (its measured layout, the host's px). */
export function measureInHost(canvas: SlideCanvas | null, id: string, scale: number): Box | null {
  if (!canvas) return null;
  return measure(canvas, id, scale)?.inHost ?? null;
}

// ---- other replicas' selections (fix wave 1; D8's overlay)

export interface RemoteSelection {
  clientId: number;
  name: string;
  color: string;
  elementIds: readonly string[];
}

// B's author palette (`--author-1..8`) is not on this branch's base yet: each reads with a fallback until it lands
const AUTHOR_FALLBACKS = ['#c9663f', '#2b7a78', '#7c5cd6', '#3b6fd1', '#b86a1a', '#1f8f55', '#c93b3b', '#6a7179'];
/** An awareness colour (an author colour's custom property, `--author-N`) as CSS; anything else draws in the first. */
export function authorColor(name: string): string {
  const n = /^--author-([1-8])$/.exec(name)?.[1];
  const i = n ? Number(n) - 1 : 0;
  return `var(--author-${i + 1}, ${AUTHOR_FALLBACKS[i]})`;
}

/** The other replicas' selections on `slideId`, from the session's awareness (the same array while nothing changed). */
export function useRemoteSelections(session: DeckSession, slideId: string): readonly RemoteSelection[] {
  const cache = useRef<{ key: string; value: readonly RemoteSelection[] }>({ key: '[]', value: [] });
  const read = useCallback((): readonly RemoteSelection[] => {
    const awareness = session.awareness;
    if (!awareness) return cache.current.value;
    const out: RemoteSelection[] = [];
    for (const [clientId, state] of awareness.getStates() as Map<number, Record<string, unknown>>) {
      if (clientId === awareness.clientID) continue;
      const deck = state.deck as { slideId?: unknown; elementIds?: unknown } | null | undefined;
      if (!deck || deck.slideId !== slideId || !Array.isArray(deck.elementIds) || deck.elementIds.length === 0) continue;
      out.push({ clientId, name: typeof state.name === 'string' ? state.name : '', color: typeof state.color === 'string' ? state.color : '', elementIds: deck.elementIds.filter((id): id is string => typeof id === 'string') });
    }
    const key = JSON.stringify(out);
    if (key !== cache.current.key) cache.current = { key, value: out };
    return cache.current.value;
  }, [session, slideId]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const awareness = session.awareness;
      if (!awareness) return () => {};
      awareness.on('change', listener);
      return () => awareness.off('change', listener);
    },
    [session],
  );
  return useSyncExternalStore(subscribe, read);
}
