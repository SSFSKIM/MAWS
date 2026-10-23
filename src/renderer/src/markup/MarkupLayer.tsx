// P3-G (§D4.2): the mark-up overlay, mounted once in the Shell (inside #root, never a body child and never a dialog, so
// the browser's cover watch never sees it; the page is held covered by the surface's `begin`). Over the surface's rect it
// lays the still, the drawing (an SVG in the surface's CSS px as measured when the still was taken, stretched with the
// rect if the surface resizes meanwhile) and, 10 px above the bottom edge, the toolbar: the tool and the ink (two radio
// groups), Undo, Clear, Cancel and Add to chat (Claude's annotate toolbar). Escape outside a text field discards, unless
// a menu or dialog open over the shell answers it; Tab and Shift+Tab go round the overlay's controls.
import { RadioGroup } from 'radix-ui';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon, PenIcon } from '../app/IconButton';
import { useLayout } from '../stores/layout';
import {
  addMark,
  canClear,
  canUndo,
  clearMarks,
  drawOps,
  EMPTY_DRAWING,
  HALO_WIDTH,
  INKS,
  inkToken,
  isDrawn,
  MARKUP_TOOLS,
  STROKE_WIDTH,
  TEXT_SIZE,
  undoMark,
  type DrawOp,
  type InkName,
  type Mark,
  type MarkupTool,
  type Point,
} from './drawing';
import { addMarkupToChat, endMarkup, MARKUP_COPY, useMarkup, type MarkupSession } from './session';

export function MarkupLayer() {
  const session = useMarkup((s) => s.session);
  return session ? <MarkupOverlay key={session.id} session={session} /> : null;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The surface element's rect, followed through its resizes, the window's and any change of the regions (a move a
// ResizeObserver misses); a surface whose element is gone ends the session.
function useSurfaceRect(session: MarkupSession): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const element = session.surface.element();
    if (!element) {
      endMarkup();
      return;
    }
    const measure = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      setRect((was) => (was && was.left === left && was.top === top && was.width === width && was.height === height ? was : { left, top, width, height }));
    };
    measure();
    let frame = 0;
    const later = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(element);
    const offLayout = useLayout.subscribe(later);
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      offLayout();
      window.removeEventListener('resize', later);
    };
  }, [session]);
  return rect;
}

const TOOL_LABEL: Record<MarkupTool, string> = { pen: 'Pen', box: 'Box', arrow: 'Arrow', text: 'Text' };
const INK_LABEL: Record<InkName, string> = { red: 'Red', blue: 'Blue', green: 'Green', black: 'Black', white: 'White' };
const ink = (name: InkName) => `var(${inkToken(name)})`;

function MarkupOverlay({ session }: { session: MarkupSession }) {
  const rect = useSurfaceRect(session);
  const root = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(EMPTY_DRAWING);
  const [tool, setTool] = useState<MarkupTool>('pen');
  const [inkName, setInk] = useState<InkName>('red');
  const [draft, setDraft] = useState<Mark | null>(null); // the stroke or shape under the pointer
  const [field, setFieldState] = useState<{ at: Point; text: string } | null>(null); // a text being typed
  // the field as last set, so a commit runs once whichever of Enter, a press elsewhere and the blur comes first
  const fieldNow = useRef(field);
  const setField = (next: { at: Point; text: string } | null) => {
    fieldNow.current = next;
    setFieldState(next);
  };
  const swallowUp = useRef(false); // the press that committed a text starts nothing on its release
  const [adding, setAdding] = useState(false);
  const { width, height } = session.size;

  const placed = rect !== null;
  useEffect(() => {
    if (placed) root.current?.focus({ preventScroll: true }); // the keyboard to the overlay, out of whatever had it
  }, [placed]);
  // Escape outside a text field discards the session. With the keyboard on the overlay (or nowhere) it does so before
  // anything under the overlay hears the key (the composer's Esc Esc). With the keyboard elsewhere, in a menu or a dialog
  // open over the shell, an Escape that layer answers is the layer's: Radix's layers hear it at the document, after the
  // window's capture, so the overlay takes only an Escape that comes back to the window unanswered (P3-F, F-shell).
  useEffect(() => {
    const discards = (event: KeyboardEvent) =>
      event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && !(event.target instanceof Element && event.target.closest('[data-markup-text]'));
    const onOverlay = (target: EventTarget | null) => target === document.body || (target instanceof Node && root.current?.contains(target) === true);
    const before = (event: KeyboardEvent) => {
      if (!discards(event) || !onOverlay(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      endMarkup();
    };
    const unanswered = (event: KeyboardEvent) => {
      if (!discards(event)) return;
      event.preventDefault();
      endMarkup();
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', unanswered);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', unanswered);
    };
  }, []);

  if (!rect) return null;
  const sx = rect.width / width;
  const sy = rect.height / height;
  const toSurface = (event: ReactPointerEvent): Point => ({ x: (event.clientX - rect.left) / sx, y: (event.clientY - rect.top) / sy });

  const commitField = () => {
    const open = fieldNow.current;
    if (open === null) return;
    setField(null);
    const mark: Mark = { tool: 'text', ink: inkName, at: open.at, text: open.text };
    if (isDrawn(mark)) setDrawing((d) => addMark(d, mark));
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (fieldNow.current !== null) {
      commitField(); // a click elsewhere commits the text; it starts nothing
      swallowUp.current = true;
      return;
    }
    if (tool === 'text') return; // placed on pointer-up, once the press's own focus change is over
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = toSurface(event);
    setDraft(tool === 'pen' ? { tool, ink: inkName, points: [p] } : { tool, ink: inkName, from: p, to: p });
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (draft === null) return;
    const p = toSurface(event);
    setDraft(draft.tool === 'pen' ? { ...draft, points: [...draft.points, p] } : draft.tool === 'text' ? draft : { ...draft, to: p });
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (swallowUp.current) {
      swallowUp.current = false;
      return;
    }
    if (tool === 'text' && draft === null && fieldNow.current === null && event.button === 0) {
      setField({ at: toSurface(event), text: '' });
      return;
    }
    if (draft === null) return;
    setDraft(null);
    if (isDrawn(draft)) setDrawing((d) => addMark(d, draft));
  };
  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitField();
      root.current?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setField(null); // the field only; the session stays
      root.current?.focus({ preventScroll: true });
    }
  };
  // The live surface is under the still: Tab and Shift+Tab go round the overlay's controls and never out to it, where
  // an editor would take keys the person cannot see (P3-F, F-shell). A stop may be a roving group (the radio groups):
  // the key leaves the first or last stop from anywhere inside it.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'));
    const [first, last] = [stops[0], stops.at(-1)];
    if (!first || !last) return;
    const at = event.target as Node;
    if (event.shiftKey ? at !== event.currentTarget && !first.contains(at) : !last.contains(at)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  };
  const add = async () => {
    setAdding(true);
    await addMarkupToChat(drawing.marks);
    setAdding(false); // a busy composer refused it: the drawing stays, and Add to chat can be pressed again
  };

  return (
    <div
      ref={root}
      role="region"
      aria-label={MARKUP_COPY.layer}
      tabIndex={-1}
      data-markup-layer=""
      onKeyDown={onKeyDown}
      className="fixed z-30 overflow-hidden outline-none select-none"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <img alt="" draggable={false} src={`data:${session.still.mediaType};base64,${session.still.data}`} className="pointer-events-none absolute inset-0 size-full" />
      <svg
        data-markup-canvas=""
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`absolute inset-0 size-full touch-none ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDraft(null)}
      >
        <Ops ops={drawOps(draft ? [...drawing.marks, draft] : drawing.marks)} />
      </svg>
      {field && (
        <input
          autoFocus // the field exists because the person just placed it
          data-markup-text=""
          aria-label={MARKUP_COPY.text}
          value={field.text}
          onChange={(event) => setField({ ...field, text: event.target.value })}
          onKeyDown={onFieldKey}
          onBlur={commitField}
          className="absolute min-w-16 border border-dashed border-border-strong bg-transparent p-0 font-semibold outline-none"
          style={{ left: field.at.x * sx, top: field.at.y * sy, fontSize: TEXT_SIZE, lineHeight: 1.25, color: ink(inkName), width: `${Math.max(field.text.length + 1, 4)}ch` }}
        />
      )}
      <Toolbar
        bounds={rect}
        tool={tool}
        ink={inkName}
        onTool={(next) => {
          commitField();
          setTool(next);
        }}
        onInk={setInk}
        undo={canUndo(drawing) ? () => setDrawing(undoMark) : null}
        clear={canClear(drawing) ? () => setDrawing(clearMarks) : null}
        adding={adding}
        onAdd={() => void add()}
      />
    </div>
  );
}

// The draw operations as SVG, as composite.ts paints them on the canvas.
function Ops({ ops }: { ops: readonly DrawOp[] }) {
  return ops.map((op, i) =>
    op.kind === 'path' ? (
      <path key={i} d={op.d} fill="none" stroke={ink(op.ink)} strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <text
        key={i}
        x={op.x}
        y={op.y}
        fill={ink(op.ink)}
        stroke={ink(op.halo)}
        strokeWidth={HALO_WIDTH * 2}
        strokeLinejoin="round"
        paintOrder="stroke"
        fontSize={TEXT_SIZE}
        fontWeight={600}
        fontFamily="var(--font-ui)"
      >
        {op.text}
      </text>
    ),
  );
}

const BUTTON =
  'inline-flex h-7 shrink-0 items-center justify-center rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';
const RADIO = `${BUTTON} w-7 px-0 data-[state=checked]:bg-bg-active data-[state=checked]:text-fg`;

interface ToolbarProps {
  bounds: Rect;
  tool: MarkupTool;
  ink: InkName;
  onTool(tool: MarkupTool): void;
  onInk(ink: InkName): void;
  undo: (() => void) | null;
  clear: (() => void) | null;
  adding: boolean;
  onAdd(): void;
}

function Toolbar({ bounds, tool, ink: inkName, onTool, onInk, undo, clear, adding, onAdd }: ToolbarProps) {
  const self = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Point | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drag = useRef<{ id: number; x: number; y: number; start: Point } | null>(null);
  useLayoutEffect(() => {
    const element = self.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const clamp = (point: Point, measured = size): Point => ({
    x: Math.max(8, Math.min(point.x, bounds.width - measured.width - 8)),
    y: Math.max(8, Math.min(point.y, bounds.height - measured.height - 8)),
  });
  const current = () => {
    const box = self.current!.getBoundingClientRect();
    setSize({ width: box.width, height: box.height });
    return { box, point: position ? clamp(position, box) : { x: box.left - bounds.left, y: box.top - bounds.top } };
  };
  const placed = position && clamp(position);
  return (
    <div
      ref={self}
      data-markup-toolbar=""
      style={placed ? { left: placed.x, top: placed.y, bottom: 'auto', transform: 'none', translate: 'none' } : undefined}
      className="absolute bottom-2.5 left-1/2 flex max-w-[calc(100%-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-border-strong bg-bg-raised p-1 shadow-float"
    >
      <button
        type="button"
        aria-label="Move mark-up toolbar"
        title="Drag to move; arrow keys to adjust"
        className={`${BUTTON} cursor-move touch-none`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: current().point };
        }}
        onPointerMove={(event) => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          setPosition(clamp({ x: gesture.start.x + event.clientX - gesture.x, y: gesture.start.y + event.clientY - gesture.y }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(event) => {
          const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
          if (!delta) return;
          event.preventDefault();
          const { point, box } = current();
          setPosition(clamp({ x: point.x + delta[0], y: point.y + delta[1] }, box));
        }}
      >
        <Icon><path d="M5 3v10M10 3v10" strokeDasharray="1 3" strokeLinecap="round" /></Icon>
      </button>
      <RadioGroup.Root aria-label={MARKUP_COPY.tools} value={tool} onValueChange={(value) => onTool(value as MarkupTool)} orientation="horizontal" className="flex items-center gap-0.5">
        {MARKUP_TOOLS.map((name) => (
          <RadioGroup.Item key={name} value={name} aria-label={TOOL_LABEL[name]} title={TOOL_LABEL[name]} className={RADIO}>
            {TOOL_ICON[name]}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <RadioGroup.Root aria-label={MARKUP_COPY.inks} value={inkName} onValueChange={(value) => onInk(value as InkName)} orientation="horizontal" className="flex items-center gap-0.5">
        {INKS.map((name) => (
          <RadioGroup.Item key={name} value={name} aria-label={INK_LABEL[name]} title={INK_LABEL[name]} className={RADIO}>
            <span aria-hidden className="size-3.5 rounded-full border border-border-strong" style={{ background: ink(name) }} />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" aria-label={MARKUP_COPY.undo} title={undo ? MARKUP_COPY.undo : MARKUP_COPY.nothingToUndo} disabled={!undo} onClick={() => undo?.()} className={`${BUTTON} w-7 px-0`}>
        <UndoIcon />
      </button>
      <button type="button" aria-label={MARKUP_COPY.clear} title={clear ? MARKUP_COPY.clear : MARKUP_COPY.nothingToClear} disabled={!clear} onClick={() => clear?.()} className={`${BUTTON} w-7 px-0`}>
        <ClearIcon />
      </button>
      <button type="button" onClick={endMarkup} className={`${BUTTON} px-2`}>
        {MARKUP_COPY.cancel}
      </button>
      <button
        type="button"
        disabled={adding}
        onClick={onAdd}
        className="h-7 shrink-0 rounded-sm bg-accent px-2.5 text-ui-sm text-bg outline-accent hover:opacity-90 focus-visible:outline-2 disabled:bg-bg-active disabled:text-fg-faint"
      >
        {MARKUP_COPY.addToChat}
      </button>
    </div>
  );
}

const TOOL_ICON: Record<MarkupTool, ReactNode> = {
  pen: <PenIcon />,
  box: (
    <Icon>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    </Icon>
  ),
  arrow: (
    <Icon>
      <path d="M3 13 13 3M7.5 3H13v5.5" />
    </Icon>
  ),
  text: (
    <Icon>
      <path d="M3.5 4V3h9v1M8 3v10M6 13h4" />
    </Icon>
  ),
};
const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" />
  </Icon>
);
const ClearIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9" />
  </Icon>
);
