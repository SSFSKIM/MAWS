// The session's furniture: Instrument's tab capsule, Quiet's waiting capsule with the list it opens, New chat, and
// the side column. The transcript and the composer are files of their own (Transcript.tsx, Composer.tsx).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GlassGroup, GlassSurface } from '@vitreajs/vitrea-react';
import { ArrowUpRight, Check, ChevronDown, Circle, CircleCheck, FileCode, Folder, GitBranch, LoaderCircle, PanelRight, Plus, SlidersHorizontal, Terminal, X } from 'lucide-react';
import { approval, composer, fleet, overview, type Session } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Composer } from './Composer';
import { PLANE, THICKNESS, useGlassUnder, useKick } from './glass';
import type { SideForm } from './Layers';
import { Remote, useNeeds } from './needs';
import { cx, Fold, GBtn, isYours, Pop, split, StateGlyph, stateWord } from './parts';

// ---- Tabs: Instrument's capsule, with the marks the sidebar uses -------------------------------------------------

export interface TabItem {
  id: string;
  title: string;
  kind: string;
  /** A file tab's own file; the first file tab holds whichever file was opened last. */
  path?: string;
}

// The row's sizes, as the stylesheet draws them: its padding, the gap between tabs, a tab's own padding and mark,
// the few letters a title is cut to before it is given up, a tab that is only its mark, a round button.
const ROW_PAD = 6;
const GAP = 1;
/** A tab's own padding, mark and gap; its trailing space is the stylesheet's `--xl-tab-end`. */
const TAB_LEAD = 8 + 16 + 6;
const TITLE_FLOOR = 26;
const TAB_MAX = 200;
const FOLDED = 30;
const BTN = 30;

/** How the row stands for the room it has (DESIGN.md section 20). */
export interface TabFit {
  /** Tabs that have given up their titles and stand as their marks: always the ones nearest the row's end. */
  folded: string[];
  /** Tabs that are not in the row at all: they wait in the menu at its end. */
  hidden: string[];
}

/**
 * The rule, as arithmetic. The room decides, and none of it is left unused while a name is hidden. The current
 * tab keeps its whole title. The others shorten together, as far as a few letters. When even that does not fit,
 * tabs give up their names one at a time from the end of the row, each only when the row is full, and the names
 * that are left take the room that frees. When every other tab is a mark and the row is still full, tabs leave for
 * the menu from the end, and one that waits for the person never leaves.
 */
export function fitTabs(tabs: { id: string; width: number; current: boolean; waits: boolean }[], room: number, end: number): TabFit {
  const current = tabs.find((t) => t.current);
  const others = tabs.filter((t) => !t.current);
  const fixed = ROW_PAD + BTN + (current ? current.width + GAP : 0);
  const short = TAB_LEAD + TITLE_FLOOR + end + GAP;
  const mark = FOLDED + GAP;
  // How many of the others can keep a name, however short: the rest, from the end, are marks.
  let named = others.length;
  while (named > 0 && fixed + named * short + (others.length - named) * mark > room) named--;
  const folded = others.slice(named).map((t) => t.id);
  if (named > 0 || fixed + others.length * mark <= room) return { folded, hidden: [] };
  // All marks, and still full. The menu's button takes a place of its own.
  const places = Math.max(0, Math.floor((room - fixed - BTN - GAP) / mark));
  const hidden: string[] = [];
  for (let i = others.length - 1; i >= 0 && others.length - hidden.length > places; i--) if (!others[i]!.waits) hidden.push(others[i]!.id);
  return { folded, hidden };
}

interface TabsProps {
  list: TabItem[];
  current: string;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
  live: (s: Session) => Session;
  /** The row's own element, for its face. */
  bar: React.RefObject<HTMLElement | null>;
  /** An empty element laid from the row's left limit to its right limit: its width is the room. */
  room: React.RefObject<HTMLElement | null>;
  /** Changes when the room may have (a pane sliding, the side column leaving). */
  layout: string;
  /** Capture aid: the menu is open at once. */
  open?: boolean;
}

/** The tabs are the window's: which is current, and what a press on one opens, are decided above. */
export function Tabs({ list, current, onPick, onClose, live, bar, room: probe, layout, open: openAtOnce }: TabsProps) {
  const all = fleet.flatMap((p) => p.sessions);
  const stateOf = (tab: TabItem) => {
    const session = tab.kind === 'session' ? all.find((s) => s.id === tab.id) : undefined;
    return session ? live(session).state : undefined;
  };
  const [fit, setFit] = useState<TabFit>({ folded: [], hidden: [] });
  const [more, setMore] = useState<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const key = list.map((t) => `${t.id}:${t.title}:${stateOf(t) ?? ''}`).join('|');
  useLayoutEffect(() => {
    const read = () => {
      // The row's element is its parent's, and is not there yet the first time this runs.
      const el = bar.current;
      if (!el) return;
      const style = getComputedStyle(el);
      const room = probe.current?.getBoundingClientRect().width ?? 0;
      if (room <= 0) return;
      const pen = document.createElement('canvas').getContext('2d')!;
      pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const end = parseFloat(style.getPropertyValue('--xl-tab-end')) || 9;
      const next = fitTabs(
        list.map((t) => ({ id: t.id, width: Math.min(TAB_MAX, TAB_LEAD + Math.ceil(pen.measureText(t.title).width) + end), current: t.id === current, waits: isYours(stateOf(t) ?? 'idle') })),
        room,
        end,
      );
      setFit((was) => (was.folded.join() === next.folded.join() && was.hidden.join() === next.hidden.join() ? was : next));
    };
    read();
    const frame = requestAnimationFrame(read);
    window.addEventListener('resize', read);
    void document.fonts?.ready.then(read);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current, layout, bar, probe]);
  useEffect(() => {
    if (openAtOnce && more) setMenu(true);
  }, [openAtOnce, more]);

  const mark = (tab: TabItem, state: Session['state'] | undefined) =>
    tab.kind === 'file' ? (
      <FileCode size={14} strokeWidth={1.75} />
    ) : tab.kind === 'settings' ? (
      <SlidersHorizontal size={14} strokeWidth={1.75} />
    ) : state && state !== 'idle' ? (
      <StateGlyph state={state} size={14} />
    ) : (
      // A session at rest has no glyph in the pane; a tab needs something to hold, so here it is a ring.
      <i className="xl-tab-rest" />
    );
  const shown = list.filter((t) => !fit.hidden.includes(t.id));
  const waiting = list.filter((t) => fit.hidden.includes(t.id));
  return (
    <>
      {shown.map((tab) => {
        const state = stateOf(tab);
        const isCurrent = tab.id === current;
        const folded = !isCurrent && fit.folded.includes(tab.id);
        return (
          <div key={tab.id} className="xl-tab" data-current={isCurrent} data-fold={folded || undefined}>
            <button
              type="button"
              className="xl-tab-main"
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={folded ? tab.title : undefined}
              title={!folded && state ? stateWord[state] || undefined : undefined}
              data-tip={folded ? tab.title : undefined}
              onClick={() => onPick(tab.id)}
            >
              <span className="xl-tab-mark">{mark(tab, state)}</span>
              <span className="xl-tab-title">{tab.title}</span>
            </button>
            {/* A folded tab is all mark, so a press on it opens it; it is closed once it is open. */}
            {!folded && (
              <button type="button" className="xl-tab-x" aria-label={`Close ${tab.title}`} tabIndex={-1} onClick={() => onClose(tab.id)}>
                <X size={13} strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
      {waiting.length > 0 && (
        <>
          <button type="button" ref={setMore} className="xl-gbtn xl-tab-more" aria-label={`${waiting.length} more tabs`} aria-expanded={menu} data-tip="More tabs" onClick={() => setMenu((v) => !v)}>
            <ChevronDown size={16} strokeWidth={1.75} />
          </button>
          <Pop open={menu} anchor={more} place="below-end" onClose={closeMenu} className="xl-tab-menu" label="More tabs">
            {waiting.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="xl-item"
                onClick={() => {
                  onPick(tab.id);
                  closeMenu();
                }}
              >
                <i className="xl-tab-mark">{mark(tab, stateOf(tab))}</i>
                <span>{tab.title}</span>
              </button>
            ))}
          </Pop>
        </>
      )}
      <GBtn label="New tab" tip="New tab">
        <Plus size={16} strokeWidth={1.75} />
      </GBtn>
    </>
  );
}

// ---- What waits for you ----------------------------------------------------------------------------------------------

/**
 * What waits for you, as the glyphs the sidebar uses: no count, no word. It is the page's one tinted piece of glass.
 * It opens the list, in which each waiting session is answered in place: one item is open at a time, and holds what
 * that session's own composer holds (needs.tsx). The arrow in an item's head opens the session itself. With no
 * `tint` the capsule is clear glass, and the marks in it are the discs the rows carry (DESIGN.md §13.3).
 */
export function Waiting({ waiting, tint, open: openAtOnce, first, alone }: { waiting: Session[]; tint?: string; open?: boolean; first?: string; alone?: boolean }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (openAtOnce && el) setOpen(true);
  }, [openAtOnce, el]);
  return (
    <>
      <GlassSurface asChild capsule thickness={THICKNESS} tint={tint} foreground={tint ? undefined : 'vibrant'} interactive>
        <button
          type="button"
          ref={setEl}
          className="xl-host xl-waiting"
          data-alone={alone}
          data-clear={tint ? undefined : ''}
          data-glass-role="control"
          aria-expanded={open}
          aria-label={`${waiting.length} sessions are waiting for you`}
          data-tip="Waiting for you"
          data-tip-at="end"
          onClick={() => setOpen((v) => !v)}
        >
          {waiting.map((s) => (
            <StateGlyph key={s.id} state={s.state} size={14} />
          ))}
        </button>
      </GlassSurface>
      <Pop open={open} anchor={el} place="below-end" onClose={close} className="xl-wait-list" label="Waiting for you">
        <WaitItems waiting={waiting} first={first} onOpen={close} />
      </Pop>
    </>
  );
}

/**
 * The sessions that wait, each answered in place: one item is open at a time and holds what that session's own
 * composer holds. The capsule's list is these, and so is the Overview's one piece of glass (Overview.tsx).
 */
export function WaitItems({ waiting, first, onOpen }: { waiting: Session[]; first?: string; onOpen?: () => void }) {
  const needs = useNeeds();
  const [picked, setPicked] = useState<string | null>(first ?? null);
  // The item that is open: the one pressed, or the first that still waits.
  const which = waiting.some((s) => s.id === picked) ? picked : waiting[0]?.id;
  return (
    <>
      {waiting.map((s) => {
        const isOpen = s.id === which;
        return (
          <div key={s.id} className="xl-wait-item" data-open={isOpen}>
            <div className="xl-wait-head">
              <button type="button" className="xl-wait-main" aria-expanded={isOpen} onClick={() => setPicked(s.id)}>
                <StateGlyph state={s.state} />
                <span className="xl-wait-text">
                  <span className="xl-card-title">{s.title}</span>
                  {/* Open, a question or a plan shows itself; an approval keeps the line that says what it is for. */}
                  {(!isOpen || s.state === 'approval') && <span className="xl-card-line">{s.state === 'approval' ? approval.title : s.line}</span>}
                </span>
              </button>
              <span className="xl-wait-slot">
                <span className="xl-wait-age">{s.age}</span>
                <button
                  type="button"
                  className="xl-wait-go"
                  aria-label={`Open ${s.title}`}
                  data-tip="Open"
                  data-tip-at="end"
                  onClick={() => {
                    needs.open(s.id);
                    onOpen?.();
                  }}
                >
                  <ArrowUpRight size={15} strokeWidth={1.9} />
                </button>
              </span>
            </div>
            {/* Only the open item holds its answer: a closed one keeps no fields waiting out of sight. */}
            <Fold open={isOpen}>{isOpen && <Remote session={s} />}</Fold>
          </div>
        );
      })}
    </>
  );
}

// ---- New chat: Quiet's layout, the composer as glass ---------------------------------------------------------------

export function Home() {
  return (
    <div className="xl-home">
      <div className="xl-home-in">
        <p className="xl-home-ask">What needs doing?</p>
        <div className="xl-home-slot" />
        <div className="xl-where">
          <button type="button" className="xl-chip">
            <Folder size={14} strokeWidth={1.75} />
            {composer.folder}
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button type="button" className="xl-chip">
            <GitBranch size={14} strokeWidth={1.75} />
            {composer.branch}
          </button>
        </div>
      </div>
      <GlassGroup id="xl-composer" backdrop={PLANE}>
        <GlassSurface asChild radius={26} thickness={THICKNESS} foreground="vibrant">
          <form className="xl-host xl-composer" data-home="" aria-label="Message" data-glass-role="control" onSubmit={(e) => e.preventDefault()}>
            <Composer fresh />
          </form>
        </GlassSurface>
      </GlassGroup>
    </div>
  );
}

// ---- The side column: one module per section ---------------------------------------------------------------------

/** How long the side column's modules are given to leave before the main space takes their room, and the reverse. */
export const SIDE_ROOM_MS = 320;

/**
 * A piece of the side column arrives once the main space has made room and leaves before it takes the room back;
 * its glass materialises and dematerialises with its content, and is registered only while it stands there, so
 * nothing invisible is in the way of the tabs or the composer.
 */
function useStanding(open: boolean, index: number) {
  const kick = useKick();
  const [want, setWant] = useState(open);
  const [kept, setKept] = useState(open);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timers = open
      ? [window.setTimeout(() => setKept(true), SIDE_ROOM_MS - 20), window.setTimeout(() => (setWant(true), kick(700)), SIDE_ROOM_MS + index * 55)]
      : [window.setTimeout(() => (setWant(false), kick(700)), index * 30), window.setTimeout(() => setKept(false), SIDE_ROOM_MS)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open, index, kick]);
  return { want, kept };
}

function Module({ title, meta, index, open, children }: { title: string; meta?: ReactNode; index: number; open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  // Modules arrive one after another and leave one after another.
  const { want, kept } = useStanding(open, index);
  useGlassUnder(ref, { radius: 20, want, on: kept });
  return (
    <section ref={ref} className="xl-module" data-shown={want} aria-label={title}>
      <h3 className="xl-module-head">
        {title}
        {meta}
      </h3>
      {children}
    </section>
  );
}

/** A section of the one card: the same head and the same lines a module has, with no surface of its own. */
function Part({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="xl-part" aria-label={title}>
      <h3 className="xl-module-head">
        {title}
        {meta}
      </h3>
      {children}
    </section>
  );
}

/** One card as tall as the window's content (Sheet's container): the four sections on a single piece of glass. */
function OneCard({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { want, kept } = useStanding(open, 0);
  useGlassUnder(ref, { radius: 20, want, on: kept });
  return (
    <div ref={ref} className="xl-module xl-one" data-shown={want}>
      <div className="xl-one-in">{children}</div>
    </div>
  );
}

/**
 * The column closed to a round glass button that grows into the one card (Open's container). One surface for the
 * pair's whole life: the element's own box grows from the button's place down and to the left, and the layer keeps
 * its glass under that box frame by frame, as it does for a tool run that opens. The button never moves; the
 * glass grows out around it. The card is as tall as what it holds, so its foot is free.
 */
export function Growing({
  open,
  onToggle,
  children,
  icon,
  words = { show: 'Show the side column', hide: 'Hide the side column', tipShow: 'Show details', tipHide: 'Hide details' },
}: {
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
  /** The button's own mark, where it is not the side column's. */
  icon?: ReactNode;
  words?: { show: string; hide: string; tipShow: string; tipHide: string };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const kick = useKick();
  // Mounted as its button; opening is also its arrival. The room is made before it grows into it.
  const [grown, setGrown] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    kick(1000);
    if (!open) {
      first.current = false;
      setGrown(false);
      return;
    }
    const t = window.setTimeout(() => (setGrown(true), kick(1000)), first.current ? 160 : SIDE_ROOM_MS - 60);
    first.current = false;
    return () => window.clearTimeout(t);
  }, [open, kick]);
  // As tall as its content, which no stylesheet can name ahead of time.
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const read = () => setHeight(el.offsetHeight);
    read();
    const seen = new ResizeObserver(read);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  useGlassUnder(ref, { radius: 20 });
  return (
    <div ref={ref} className="xl-module xl-bud" data-grown={grown} style={{ ['--xl-bud-h' as string]: `${height}px` }}>
      <div className="xl-bud-in" ref={inner} inert={!grown}>
        {children}
      </div>
      <button type="button" className="xl-bud-btn" aria-label={open ? words.hide : words.show} aria-expanded={open} data-tip={open ? words.tipHide : words.tipShow} data-tip-at="end" onClick={onToggle}>
        {icon ?? <PanelRight size={16} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

/** The side column leaves a window too narrow for it; its glass leaves with it. */
function useRoomForSide() {
  const [wide, setWide] = useState(() => window.matchMedia('(width >= 1180px)').matches);
  useEffect(() => {
    const q = window.matchMedia('(width >= 1180px)');
    const on = () => setWide(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return wide;
}

/** What the side column lists: the session's own. */
export type SideData = Pick<typeof overview, 'branch' | 'added' | 'removed' | 'files' | 'agents' | 'background' | 'todos'>;

/**
 * The side column. Its content is plain (the real app will supply it); what is judged is its container, so that is
 * a prop: four modules (as it was, and the default), one card, or a card that grows out of a button.
 */
export function Modules({
  open: asked,
  form = 'modules',
  onToggle,
  data = overview,
  file,
  onFile,
}: {
  open: boolean;
  form?: SideForm;
  onToggle?: () => void;
  data?: SideData;
  /** The file on screen, when the page is a file's: its line is the current one. */
  file?: string;
  /** Opens a changed file as a tab; undefined for a file the lab holds no body of. */
  onFile?: (path: string) => (() => void) | undefined;
}) {
  const wide = useRoomForSide();
  const open = wide && asked;
  const every: { title: string; has: boolean; meta?: ReactNode; body: ReactNode }[] = [
    {
      title: 'Changes',
      has: data.files.length > 0,
      meta: (
        <span className="xl-stat">
          <span className="xl-add">+{data.added}</span> <span className="xl-del">−{data.removed}</span>
        </span>
      ),
      body: (
        <>
          {data.branch && (
            <div className="xl-line">
              <GitBranch size={14} strokeWidth={1.75} />
              <span className="xl-line-text xl-mono">{data.branch}</span>
            </div>
          )}
          {data.files.map((f) => {
            const [dir, name] = split(f.path);
            const go = onFile?.(f.path);
            const inside = (
              <>
                <span className="xl-line-text xl-fade">
                  {name} <span className="xl-quiet">{dir.replace(/\/$/, '')}</span>
                </span>
                <span className="xl-stat">
                  <span className="xl-add">+{f.added}</span>
                  {f.removed > 0 && <span className="xl-del"> −{f.removed}</span>}
                </span>
              </>
            );
            // A changed file opens as a tab, beside its session; the one on screen is the current line.
            return go ? (
              <button key={f.path} type="button" className="xl-line" aria-current={f.path === file ? 'page' : undefined} onClick={go}>
                {inside}
              </button>
            ) : (
              <div key={f.path} className="xl-line">
                {inside}
              </div>
            );
          })}
        </>
      ),
    },
    {
      title: 'Agents',
      has: data.agents.length > 0,
      body: data.agents.map((a) => (
        <div key={a.name} className="xl-line" data-top="">
          {a.state === 'running' ? (
            <span className="xl-line-mark">
              <i className="xl-dot" data-run="" />
            </span>
          ) : (
            <Check size={15} strokeWidth={1.75} />
          )}
          <span className="xl-line-text">
            <span className={a.state === 'done' ? 'xl-quiet' : undefined}>{a.name}</span>
            {a.state === 'running' && <span className="xl-line-sub">{a.line}</span>}
          </span>
        </div>
      )),
    },
    {
      title: 'To do',
      has: data.todos.length > 0,
      body: data.todos.map((todo) => {
        const current = 'current' in todo && todo.current;
        return (
          <div key={todo.text} className="xl-line" data-top="">
            {todo.done ? <CircleCheck size={15} strokeWidth={1.75} /> : current ? <LoaderCircle className="xl-spin" size={15} strokeWidth={2} /> : <Circle size={15} strokeWidth={1.75} />}
            <span className={cx('xl-line-text', todo.done && 'xl-quiet', current && 'xl-current')}>{todo.text}</span>
          </div>
        );
      }),
    },
    {
      title: 'Background',
      has: data.background.length > 0,
      body: data.background.map((b) => (
        <div key={b.label} className="xl-line">
          <Terminal size={14} strokeWidth={1.75} />
          <span className="xl-line-text xl-mono">{b.label}</span>
          <span className="xl-stat">{b.line}</span>
        </div>
      )),
    },
  ];
  // A session shows the sections it has something in.
  const parts = every.filter((p) => p.has);
  if (parts.length === 0) return null;
  const asParts = parts.map((p) => (
    <Part key={p.title} title={p.title} meta={p.meta}>
      {p.body}
    </Part>
  ));
  // The button form keeps its button while the column is closed, so only its content is inert then.
  return (
    <aside className="xl-side" aria-label="Session details" inert={form === 'button' ? !wide : !open} data-open={open} data-form={form}>
      {form === 'modules' &&
        parts.map((p, i) => (
          <Module key={p.title} index={i} open={open} title={p.title} meta={p.meta}>
            {p.body}
          </Module>
        ))}
      {form === 'card' && <OneCard open={open}>{asParts}</OneCard>}
      {form === 'button' && wide && (
        <Growing open={open} onToggle={onToggle}>
          {asParts}
        </Growing>
      )}
    </aside>
  );
}
