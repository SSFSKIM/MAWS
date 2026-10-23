// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", "Transform layer"; M5): the
// stage's overlay. It sits beside the scaled slide in screen pixels (handles keep their size at any zoom) and draws the
// selection's outlines, the eight resize handles and the rotation handle, a connector's two ends, the snapping guides,
// the marquee and a flow child's insertion bar. It takes the stage's pointer presses (click, shift-click, ⌘-click,
// double-click, marquee, drags), its keys (Escape, Tab, Enter, Delete, arrows, ⌘D, ⌘G, ⇧⌘G, ⌘] and ⌘[, ⌘A) and the
// clipboard while the stage has focus. Gestures are gestures.ts's; which element a press picks is selection.ts's.
// M7: the comment pins (../comments/Pins.tsx), at each commented element's top-right; a press on a pin is the pin's.
// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D1 to D9; §4.4 of the P4 spec, binding on the states):
// the click model. One selected text element's text box mounts ARMED (focused, its caret hidden) while the stage owns the
// keyboard; the stage's element keys and its clipboard take the keys from that box first, gated on `!isComposing &&
// keyCode !== 229`, and its first printable or keyCode-229 key begins the edit in place (T10, T11). A press is PRESS until
// a 3 px move makes it DRAG (T2); the `click` after a still press on an already selected element is T3 (pointer events
// carry no click count); a double-click edits the deepest text under the pointer whatever the scope, with the word there
// selected (T5); a drag from a cell of the selected table selects a range of cells (CELLS, D8).
// P4-B2 (D15 A2, A3, A5): the focus follows the selection while the stage owns the keyboard (the armed box, one other
// element's node, else the stage; never the page's body), a focus brought to a node selects it, a polite status says a
// multi-selection's count, and a single selection's place among its siblings rides on what the focus reads.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { SlideCanvas } from '../../canvas';
import { apply, applyLinear, HANDLES, union, type Box, type Guide, type Handle, type Pt } from '../../geometry';
import { isPinned } from '../../ir';
import { ROOT } from '../../model';
import { CommentPins } from '../comments/Pins';
import { DECK_COPY as C } from '../copy';
import { armedBox } from '../armed';
import type { DeckSession } from '../session';
import { setText } from '../../model';
import { copySelection, pasteClipboard, type ClipboardContext, type ImportAsset } from './clipboard';
import { selectionCommands } from './commands';
import { handlesOf, nudge, startEndpoint, startFlowMove, startMarquee, startMove, startResize, startRotate, type Frame, type Gesture, type Mods } from './gestures';
import { hitIds, measure, measureAll, type Measured } from './measure';
import { allPinned, cellAt, cellRange, cellsTable, childAt, deepestText, drill, escapeUp, isTextTarget, pick, selectAll, slideTree, tabNext } from './selection';
import { useDocVersion } from './use-doc-version';
import { selectionStatus, stageFocus } from '../a11y';

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
  /**
   * The text box for a text element edited in place, drawn inside the overlay (made anew when its node is). P4-B2:
   * `armed` while it is mounted ARMED on the selected element, before any edit.
   */
  renderText?: (elementId: string, canvas: SlideCanvas, armed: boolean) => ReactNode;
  pins?: boolean; // P4-B2 (D16): the comment pins, the deck's; a design's world draws every board's in one layer of its own
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
  deep: boolean; // P4-B2 (T21): a ⌘-press or Ctrl-press, a deep select and never T3's
  pointerId: number;
  /** P4-B2 (T3): the press's hits, whether its target was selected before it, and whether that was the whole selection */
  hits: readonly string[];
  wasSelected: boolean;
  single: boolean;
}

/** P4-B2 (T3): a still press's release, which the `click` after it reads (its count) and acts on. */
interface ClickCandidate {
  target: string;
  hits: readonly string[];
  wasSelected: boolean;
  single: boolean;
}

/**
 * P4-B2 (D17): a gesture's end, then `after` whatever it threw: the end flushes the replica's hold, whose listeners may
 * throw. Outside the component, since the React Compiler does not lower a `try` without a `catch`.
 */
function endThen(g: Gesture | null, commit: boolean, after: () => void): void {
  try {
    g?.end(commit);
  } finally {
    after();
  }
}

export function Overlay({ session, canvas, slideId, scale, readOnly, surface, frame, onNotice, renderText, artifactId, importAsset, pins = true /* P4-B2 */ }: OverlayProps) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const version = useDocVersion(session);
  const selection = state.selection;
  const editing = state.editingText;
  // P4-B2 (D1): the one selected text element whose box is mounted ARMED, if any, while the stage owns the keyboard; the
  // box shown is its or the edit's
  const one = selection.length === 1 ? selection[0]! : null;
  const armedId =
    !readOnly && editing === null && state.keyboard === 'stage' && one !== null && canvas?.node(one) !== undefined && isTextTarget(slideTree(session.doc, slideId), one) ? one : null;
  const textId = editing ?? armedId;
  const [measured, setMeasured] = useState<Map<string, Measured>>(new Map());
  const [shown, setShown] = useState<Frame | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<Pending | null>(null);
  const clickCandidate = useRef<ClickCandidate | null>(null); // P4-B2 (T3)

  const remote = useRemoteSelections(session, slideId);
  // the final fix wave's B7: measured again after every layout pass of the canvas too (faces arriving, a design-system
  // restyle, a fit pass), so the handles and other replicas' outlines follow geometry that moves with no deck write.
  // Not while a gesture runs (the B7 follow-up): each of its frames writes, and the write re-measures (`version`), so a
  // second measure and commit for the same frame's layout pass is the drag's cost and nothing more; a pass the gesture
  // saw is caught up once, when the gesture ends.
  const [laidOut, setLaidOut] = useState(0);
  const laidOutInGesture = useRef(false);
  useEffect(
    () =>
      canvas?.onLayout(() => {
        if (gesture.current) laidOutInGesture.current = true;
        else setLaidOut((n) => n + 1);
      }),
    [canvas],
  );
  const catchUpLayout = useCallback(() => {
    if (!laidOutInGesture.current) return;
    laidOutInGesture.current = false;
    setLaidOut((n) => n + 1);
  }, []);
  // the selection's boxes (and other replicas' on this slide), measured again whenever the slide, a selection, the
  // zoom or the layout changes; a selected element another replica removed leaves the selection (and a text edit of it
  // ends)
  useLayoutEffect(() => {
    if (canvas) {
      const live = selection.filter((id) => canvas.node(id) !== undefined);
      if (live.length !== selection.length) session.select(live);
    }
    setMeasured(canvas ? measureAll(canvas, new Set([...selection, ...remote.flatMap((r) => r.elementIds)]), scale) : new Map());
  }, [canvas, selection, remote, scale, version, slideId, session, laidOut]);

  // P4-B2 (D13): a gesture still running when the overlay goes (the editor unmounted mid-drag) ends as a cancel, so the
  // session's drag ends with it (the inspector's settled version and the gesture hold read it)
  useEffect(
    () => () => {
      const g = gesture.current;
      gesture.current = null;
      pending.current = null;
      g?.end(false);
    },
    [],
  );

  const ctx = useCallback((): ClipboardContext | null => (canvas ? { session, slideId, canvas, scale, artifactId, importAsset } : null), [canvas, session, slideId, scale, artifactId, importAsset]);

  const slidePoint = useCallback(
    (client: Pt): Pt => {
      const r = frame.current?.getBoundingClientRect();
      return r ? { x: (client.x - r.left) / scale, y: (client.y - r.top) / scale } : { x: 0, y: 0 };
    },
    [frame, scale],
  );

  // P4-B2 (D15 A3, A5): the focus follows the selection while the stage owns the keyboard and the focus is the stage's
  // own (the surface, a node, the box, or nothing once what held it went): the armed box for one text target (it takes
  // the focus as it mounts), the element's node for one other element (any one element where nothing is edited), the
  // stage for several or none. A text edit ending (Escape, a click elsewhere) brings the keys back this way too.
  const lastOwn = useRef<Element | null>(null); // what last held the stage's own focus, while nothing took it since (null after a departure)
  const pressing = useRef(false); // the overlay focusing the stage for a press, whose selection then takes the focus
  const follow = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !canvas) return;
      const s = session.snapshot();
      if (s.keyboard !== 'stage' || s.editingText !== null) return;
      const doc = el.ownerDocument;
      const active = doc.activeElement;
      if (active !== null && active !== doc.body && !el.contains(active)) return;
      const one = s.selection.length === 1 && canvas.node(s.selection[0]!) ? s.selection[0]! : null;
      const box = armedBox(session);
      if (one !== null && box?.elementId === one) {
        if (!box.root.contains(active)) box.focus();
        return;
      }
      if (one !== null && !readOnly && isTextTarget(slideTree(session.doc, slideId), one)) return; // its box mounts armed and takes the focus
      const node = one !== null ? canvas.node(one) : undefined;
      const target = node?.hasAttribute('tabindex') ? node : el; // a node the canvas made focusable (its `describe`), else the stage
      if (active !== target) target.focus({ preventScroll: true });
    },
    [canvas, session, slideId, readOnly],
  );
  useEffect(() => follow(surface.current), [follow, surface, selection, state.keyboard, editing, armedId]);
  // A5: the stage's own focus fallen to the body with the selection unchanged gives it back: its node made anew or gone
  // (an agent's change), or moved (Chromium drops the focus of a node `insertBefore` moves, as the canvas reorders them
  // for ⌘]). A departure (a focus elsewhere, a press outside the stage) clears `lastOwn`, so it is never undone.
  useEffect(() => {
    const own = lastOwn.current;
    const el = surface.current;
    const doc = el?.ownerDocument;
    if (own && doc && (doc.activeElement === null || doc.activeElement === doc.body)) follow(el);
  }, [follow, surface, version, laidOut]);
  // A2: a single selection's place among its siblings ("2 of 5"), on the node or the text box the focus reads
  const described = useRef<Element | null>(null);
  useEffect(() => {
    const one = selection.length === 1 ? selection[0]! : null;
    const node = one !== null ? canvas?.node(one) : undefined;
    const target = node && one === textId ? (node.querySelector('.deck-textbox') ?? node) : (node ?? null);
    if (described.current && described.current !== target) described.current.removeAttribute('aria-description');
    described.current = target;
    if (!target || one === null) return;
    const tree = slideTree(session.doc, slideId);
    const siblings = tree.childrenOf(tree.parentOf(one));
    const text = C.position(siblings.indexOf(one) + 1, siblings.length);
    if (target.getAttribute('aria-description') !== text) target.setAttribute('aria-description', text);
  }, [selection, textId, canvas, session, slideId, version]);
  // P4-B2: the armed box's caret drawn transparent and its root taking no presses (textbox.css), set before it first paints
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el || armedId === null) return;
    el.setAttribute('data-armed', '');
    return () => el.removeAttribute('data-armed');
  }, [armedId, surface]);

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
      if (target.closest('.deck-markbar, .deck-textbox, .deck-comment-pin')) return; // the text box's own; M7: a pin's
      if (editing !== null && c.canvas.node(editing)?.contains(target)) return;
      clickCandidate.current = null;
      session.setKeyboard('stage'); // P4-B2 (D1): a press on the stage's content gives it the keyboard
      // P4-B2 (D3, A3): a focus that is the stage's own (the surface, a node, the armed box: a press on the armed element
      // moves no focus) stays for the press's selection to take; any other focus comes to the stage first
      const armed = armedBox(session);
      const active = el.ownerDocument.activeElement;
      if (!stageFocus(el, active) && !(armed && active && armed.root.contains(active))) {
        pressing.current = true;
        el.focus({ preventScroll: true });
        pressing.current = false;
      }
      const client = { x: e.clientX, y: e.clientY };
      const p = slidePoint(client);
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle;
      const current = session.snapshot().selection;
      if (handle && !readOnly && current.length === 1) {
        const id = current[0]!;
        const make = () =>
          handle === 'rotate' ? startRotate(c, id, p) : handle === 'end0' || handle === 'end1' ? startEndpoint(c, id, handle === 'end0' ? 0 : 1) : startResize(c, id, handle as Handle, p);
        const g = make();
        if (g.refused) {
          onNotice?.(g.refused);
          e.preventDefault();
          return;
        }
        gesture.current = g;
        el.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }
      const tree = slideTree(session.doc, slideId);
      const connectors = [...measureAll(c.canvas, tree.childrenOf(ROOT).filter((id) => tree.element(id)?.tag === 'x-connector'), scale).values()];
      const hits = hitIds(c.canvas, client, p, HIT_SLACK_PX / scale, connectors);
      const deep = e.metaKey || e.ctrlKey;
      const picked = pick(tree, hits, current, { deep, toggle: e.shiftKey });
      session.select(picked.selection);
      follow(el); // P4-B2 (A3)
      const base = e.shiftKey ? current : [];
      let make: () => Gesture | null = () => null;
      // P4-B2 (D8): a press in a cell of the table already selected, dragged, selects the range of cells it crosses
      const table = !readOnly && !e.shiftKey && current.length === 1 && picked.target === current[0] && tree.element(current[0]!)?.tag === 'table' ? current[0]! : null;
      const anchor = table ? cellAt(tree, hits, table) : null;
      if (table && anchor) make = () => cellsGesture(c, table, anchor);
      else if (picked.target === null) make = () => startMarquee(c, p, base);
      else if (!readOnly && !e.shiftKey && picked.selection.length > 0) {
        const sel = picked.selection;
        if (allPinned(tree, sel)) make = () => startMove(c, sel, p);
        else if (sel.length === 1) {
          const me = tree.element(sel[0]!)!;
          if (!isPinned(me.tag, me.style, me.attrs) && me.tag !== 'tr' && me.tag !== 'th' && me.tag !== 'td') make = () => startFlowMove(c, sel[0]!, p);
        }
      }
      const wasSelected = picked.target !== null && current.includes(picked.target);
      pending.current = { start: client, p0: p, make, target: picked.target, toggle: e.shiftKey, deep, pointerId: e.pointerId, hits, wasSelected, single: wasSelected && current.length === 1 };
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    // P4-B2 (D8): DRAG(cells): the range from the anchor cell to the cell under the pointer, selected as it goes
    let lastClient: Pt = { x: 0, y: 0 };
    const cellsGesture = (c: ClipboardContext, table: string, anchor: string): Gesture => ({
      frame: () => {
        const tree = slideTree(session.doc, slideId);
        const p = slidePoint(lastClient);
        const cell = cellAt(tree, hitIds(c.canvas, lastClient, p, 0, []), table);
        if (cell) session.select(cellRange(tree, table, anchor, cell));
        return { guides: [] };
      },
      end: () => {},
    });

    const onMove = (e: PointerEvent) => {
      lastClient = { x: e.clientX, y: e.clientY };
      const pend = pending.current;
      if (pend && !gesture.current) {
        if (Math.hypot(e.clientX - pend.start.x, e.clientY - pend.start.y) < DRAG_START_PX) return;
        gesture.current = pend.make();
        pending.current = null;
        if (gesture.current?.refused) {
          onNotice?.(gesture.current.refused);
          gesture.current = null;
        }
        if (!gesture.current) return;
      }
      const g = gesture.current;
      if (!g) return;
      setShown(g.frame(slidePoint({ x: e.clientX, y: e.clientY }), mods(e)));
    };

    // P4-B2 (D3, A3): a gesture's end gives the focus back to the selection's target (`follow`): an armed box's keys
    // would otherwise reach the stage, with no input method
    // the gesture ends written, its step closed, and the layout passes it saw caught up (P4-B2 D17: the gesture is already
    // let go)
    const finish = (g: Gesture) =>
      endThen(g, true, () => {
        setShown(null);
        catchUpLayout();
        follow(el);
      });

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      const pend = pending.current;
      pending.current = null;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (g) return finish(g);
      // a press without a drag inside a multi-selection narrows it to what was pressed
      if (pend && pend.target !== null && !pend.toggle && session.snapshot().selection.length > 1) session.select([pend.target]);
      // P4-B2 (T3): a still press on an element already selected alone; the `click` after it decides (its count). A
      // Shift-press toggles and a ⌘-press or Ctrl-press selects deep (T21): neither is T3's.
      clickCandidate.current = pend && pend.target !== null && !pend.toggle && !pend.deep ? { target: pend.target, hits: pend.hits, wasSelected: pend.wasSelected, single: pend.single } : null;
      follow(el);
    };

    // P4-B2 (T3): a single click on the element that was the whole selection before the press: a text target edits with
    // the caret at the click; a container selects its child under the click (armed if text); a table edits the cell
    // there. A double-click's first click acts too (an armed element then edits at the click, and the dblclick extends
    // the caret to the word: one EDIT); its second click (detail 2) is the dblclick's.
    const onClick = (e: MouseEvent) => {
      const cand = clickCandidate.current;
      clickCandidate.current = null;
      if (!cand || e.detail !== 1 || !cand.wasSelected || !cand.single || readOnly) return;
      const tree = slideTree(session.doc, slideId);
      if (!tree.has(cand.target)) return;
      const at = { kind: 'point' as const, x: e.clientX, y: e.clientY };
      if (isTextTarget(tree, cand.target)) return session.editText(cand.target, { at });
      if (tree.element(cand.target)?.tag === 'table') {
        const cell = cellAt(tree, cand.hits, cand.target);
        if (cell) session.editText(cell, { at });
        return;
      }
      const child = childAt(tree, cand.hits, cand.target);
      if (child) session.select([child]);
    };

    // P3-F (L218): the capture lost with no release (the surface hidden, the system taking the pointer) ends the gesture
    // as a release does; a press not yet a drag is dropped. After a release nothing is left to end.
    const onLost = () => {
      const g = gesture.current;
      gesture.current = null;
      pending.current = null;
      if (g) finish(g);
      else follow(el);
    };

    // P4-B2 (T5): a double-click from any state edits the deepest text element or cell under the pointer, whatever the
    // scope, with the word there selected; with no text under it, it goes into the selected container as before. A
    // double-click inside the text being edited is the editor's own (the word, natively).
    const onDouble = (e: MouseEvent) => {
      const c = ctx();
      if (!c) return;
      const target = e.target as HTMLElement;
      if (target.closest('.deck-markbar, .deck-textbox, [data-handle], .deck-comment-pin')) return; // M7: a pin's
      const client = { x: e.clientX, y: e.clientY };
      const p = slidePoint(client);
      const tree = slideTree(session.doc, slideId);
      const connectors = [...measureAll(c.canvas, tree.childrenOf(ROOT).filter((id) => tree.element(id)?.tag === 'x-connector'), scale).values()];
      const hits = hitIds(c.canvas, client, p, HIT_SLACK_PX / scale, connectors);
      const deepest = readOnly ? null : deepestText(tree, hits);
      if (deepest) {
        session.select([deepest]);
        session.editText(deepest, { at: { kind: 'word', x: e.clientX, y: e.clientY } });
        e.preventDefault();
        return;
      }
      const current = session.snapshot().selection;
      if (current.length !== 1) return;
      const into = drill(tree, hits, current);
      if (into === 'edit' && !readOnly) session.editText(current[0]!);
      else if (Array.isArray(into)) session.select(into);
      else return;
      e.preventDefault();
    };

    // the gesture let go before its end runs (D17: the end flushes the hold, which may throw), as a release does
    const onCancel = () => {
      const g = gesture.current;
      gesture.current = null;
      pending.current = null;
      endThen(g, false, () => {
        setShown(null);
        catchUpLayout();
        follow(el);
      });
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('lostpointercapture', onLost);
    el.addEventListener('click', onClick);
    el.addEventListener('dblclick', onDouble);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('dblclick', onDouble);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onLost);
    };
  }, [surface, ctx, slidePoint, session, slideId, scale, readOnly, editing, catchUpLayout, follow]);

  // ---- keys and the clipboard, while the stage has focus
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const fromStage = (e: Event) => stageFocus(el, e.target); // P4-B2 (A3): the surface or a node holding the focus
    const notice = (reason: string | null) => reason && onNotice?.(reason);

    // the element keys, from the stage or (P4-B2) the armed box; true when a key was taken
    const stageKey = (e: KeyboardEvent): boolean => {
      const c = ctx();
      if (!c) return false;
      const tree = slideTree(session.doc, slideId);
      const sel = session.snapshot().selection.filter((id) => tree.has(id));
      const mod = e.metaKey || e.ctrlKey;
      const cmds = selectionCommands(c, sel, readOnly);
      let taken = false;
      const done = () => {
        e.preventDefault();
        e.stopPropagation();
        taken = true;
      };
      const key = e.key;
      const cellsOf = cellsTable(tree, sel); // P4-B2 (D8): a range of cells
      if (key === 'Escape' && cellsOf) {
        session.select([cellsOf]);
        done();
      } else if ((key === 'Delete' || key === 'Backspace') && cellsOf && !readOnly) {
        // Keynote's rule for a cell range: the cells' text cleared, one step; the table and its cells kept
        session.edit((origin) => {
          for (const id of sel) {
            const blocks = tree.element(id)?.text ?? [];
            setText(session.doc, slideId, id, [{ ...(blocks[0] ?? { type: 'p' as const, inline: [] }), inline: [] }], origin);
          }
        });
        done();
      } else if (key === 'Escape') {
        if (sel.length) {
          session.select(escapeUp(tree, sel));
          done();
        }
      } else if (key === 'Tab' && !mod) {
        // P3-F: past the last element (before the first with Shift) the key is the browser's: focus leaves the stage
        const next = tabNext(tree, sel, e.shiftKey);
        if (next) {
          session.select(next);
          done();
        } else if (e.shiftKey && e.target !== el) el.focus({ preventScroll: true }); // P4-B2: from the armed box, the browser's step back starts at the stage, so it lands before it, not on it
      } else if (key === 'Enter' && sel.length === 1 && !readOnly) {
        // T12: a text target edits with everything selected (the armed box flips in place); a container selects inside
        const kids = tree.childrenOf(sel[0]!);
        const box = armedBox(session);
        if (box && box.elementId === sel[0]) box.editAll();
        else if (isTextTarget(tree, sel[0]!)) session.editText(sel[0]!, { at: { kind: 'all' } });
        else if (kids.length) session.select([kids[0]!]);
        done();
      } else if ((key === 'Delete' || key === 'Backspace') && cmds.canEdit) {
        cmds.remove();
        done();
      } else if (key.startsWith('Arrow') && !mod && (cmds.canZ || cmds.canDetach)) {
        const step = e.shiftKey ? 10 : 1;
        const d = { x: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, y: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0 };
        notice(nudge(c, sel, d));
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
      } else if (!mod && !e.isComposing && e.keyCode !== 229 && [...key].length === 1 && sel.length === 1 && !readOnly && isTextTarget(tree, sel[0]!)) {
        // P4-B2 (D9): a printable key that reached the stage with one text target selected (something had taken the box's
        // focus): the armed box takes the focus back and the key goes through T10; with no box yet, the edit begins
        const box = armedBox(session);
        if (box && box.elementId === sel[0]) {
          box.focus();
          box.replace(key);
        } else session.editText(sel[0]!, { at: { kind: 'all' } });
        done();
      }
      return taken;
    };
    const onKey = (e: KeyboardEvent) => {
      if (fromStage(e)) stageKey(e);
    };
    // P4-B2 (D6): the armed box's keys, before its editor's own (a listener on an ancestor, in the capture phase).
    // - T11: a keyCode-229 keydown clears the content in that keydown, its default left to the input method, which then
    //   composes in place (findings, Q2).
    // - T10: a printable key replaces the text with itself (typed by the box, so it never depends on the default).
    // - T12: Enter edits with everything selected; ⌘B, ⌘I and ⌘U mark the whole text, still armed.
    // - ⌘Z and ⌘Y stay the box's (the deck's stack); ⌘C, ⌘X and ⌘V the Edit menu's (the armed clipboard below).
    // - The other keys are the stage's element keys (Escape, Delete, Tab, the arrows, ⌘A, ⌘D, ⌘G, the z-order keys).
    const onArmedKey = (e: KeyboardEvent) => {
      const box = armedBox(session);
      if (!box || !(e.target instanceof Node) || !box.root.contains(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.isComposing || e.keyCode === 229) box.replace();
      else if (!mod && [...e.key].length === 1) {
        stop();
        box.replace(e.key);
      } else if (e.key === 'Enter' && !mod) {
        stop();
        box.editAll();
      } else if (mod && !e.shiftKey && !e.altKey && /^[biu]$/i.test(e.key)) {
        stop();
        box.markAll(e.key.toLowerCase() as 'b' | 'i' | 'u');
      } else if (!(mod && /^[zyxcv]$/i.test(e.key)) && stageKey(e)) e.stopPropagation();
    };
    // P4-B2 (D1): the keyboard's owner. A focus of the stage or of its text box gives the stage the keyboard; a focus
    // anywhere else (the inspector, the rail, the notes, a pin, the popover) takes it away, and the armed box unmounts so
    // nothing takes the focus back. Focus falling to the page's body (a box unmounting) changes nothing.
    const onFocusIn = (e: FocusEvent) => {
      const at = e.target;
      const ours = stageFocus(el, at) || (at instanceof Element && el.contains(at) && at.closest('.deck-textbox') !== null);
      session.setKeyboard(ours ? 'stage' : 'away');
      if (!ours) lastOwn.current = null; // A5: a departure, never undone
      if (!ours || !(at instanceof Element)) return;
      lastOwn.current = at;
      // P4-B2 (A3): a focus brought to an element's node (assistive technology's) selects it, so its focus and Delete agree
      const id = at === el ? null : at.getAttribute('data-eid');
      if (id !== null && ctx()?.canvas.root.contains(at)) {
        const sel = session.snapshot().selection;
        if (sel.length !== 1 || sel[0] !== id) session.select([id]);
      }
      // the stage entered from outside it (Tab, F6): the focus goes on to the selection's target
      const from = e.relatedTarget;
      if (at === el && !pressing.current && !(from instanceof Node && el.contains(from))) follow(el);
    };
    // A5: a press outside the stage is a departure too: on chrome that takes no focus it leaves the focus on the body with
    // no focusin
    const onPressAway = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) lastOwn.current = null;
    };

    const doc = el.ownerDocument;
    // the stage's clipboard takes the Edit menu's commands while the stage, or (P4-B2) an armed box, has focus
    const takes = () => stageFocus(el, doc.activeElement) || (doc.activeElement !== null && armedBox(session)?.root === doc.activeElement);
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (!takes()) return;
      const c = ctx();
      if (!c) return;
      const sel = session.snapshot().selection;
      copySelection(e, c, sel, cut && !readOnly, () => selectionCommands(c, sel, readOnly).remove());
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    const paste = (e: ClipboardEvent) => {
      if (!takes() || readOnly) return;
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
      if (takes() && (!needsSelection || session.snapshot().selection.length > 0)) e.preventDefault();
    };
    const beforeCopy = enable(true);
    const beforePaste = enable(false);
    // P4-B2: an armed box's clipboard events reach the stage's handlers before its editor's (which would paste the text
    // into it)
    const armedClip = (handle: (e: ClipboardEvent) => void) => (e: ClipboardEvent) => {
      if (armedBox(session)?.root !== doc.activeElement) return;
      e.stopPropagation();
      handle(e);
    };
    const armedCopy = armedClip(copy);
    const armedCut = armedClip(cut);
    const armedPaste = armedClip(paste);
    el.addEventListener('keydown', onArmedKey, true);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('pointerdown', onPressAway, true);
    el.addEventListener('copy', armedCopy, true);
    el.addEventListener('cut', armedCut, true);
    el.addEventListener('paste', armedPaste, true);
    el.addEventListener('keydown', onKey);
    doc.addEventListener('copy', copy);
    doc.addEventListener('cut', cut);
    doc.addEventListener('paste', paste);
    doc.addEventListener('beforecopy', beforeCopy);
    doc.addEventListener('beforecut', beforeCopy);
    doc.addEventListener('beforepaste', beforePaste);
    return () => {
      el.removeEventListener('keydown', onArmedKey, true);
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('pointerdown', onPressAway, true);
      el.removeEventListener('copy', armedCopy, true);
      el.removeEventListener('cut', armedCut, true);
      el.removeEventListener('paste', armedPaste, true);
      el.removeEventListener('keydown', onKey);
      doc.removeEventListener('copy', copy);
      doc.removeEventListener('cut', cut);
      doc.removeEventListener('paste', paste);
      doc.removeEventListener('beforecopy', beforeCopy);
      doc.removeEventListener('beforecut', beforeCopy);
      doc.removeEventListener('beforepaste', beforePaste);
    };
  }, [surface, ctx, session, slideId, readOnly, onNotice, follow]);

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
      <svg className="deck-overlay-lines" width={s(canvas?.size.w ?? 1920)} height={s(canvas?.size.h ?? 1080)} aria-hidden>{/* P3-E: a board's size */}
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
      {textId !== null && canvas && renderText && <Fragment key={keyOf(canvas.node(textId))}>{renderText(textId, canvas, editing === null)}</Fragment>}
      {pins && canvas && <CommentPins canvas={canvas} slideId={slideId} scale={scale} version={version} />}
      <span role="status" className="deck-overlay-status" data-stage-status>
        {selectionStatus(selection.length, editing !== null)}
      </span>
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
