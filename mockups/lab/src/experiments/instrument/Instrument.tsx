import {
  ArrowUp,
  ChevronRight,
  FileCode2,
  GitBranch,
  Hand,
  LayoutGrid,
  PanelLeft,
  Plus,
  Search,
  Shapes,
  SlidersHorizontal,
  SquarePen,
  X,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type BackdropHint,
  consoleDiagnosticSink,
  GlassGroup,
  GlassPopover,
  GlassPopoverClose,
  GlassPopoverContent,
  GlassPopoverTrigger,
  GlassRoot,
  GlassSurface,
  useGlassBarInset,
  useGlassGroups,
  useGlassRoot,
  useGlassScrollEdge,
  type VitreaDiagnosticSink,
} from '@vitreajs/vitrea-react';
import {
  approval,
  composer,
  destinations,
  overview,
  pinned,
  projects,
  type Session,
  tabs,
  transcript,
  type TranscriptItem,
  usage,
} from '../../content/fixtures';
import type { ExperimentProps, Scheme } from '../../lab/types';
import s from './instrument.module.css';
import { cx, DoneMark, Fold, GBtn, luminance, luminanceOver, Ring, Spinner, StateMark } from './parts';
import { SettingsIndex, SettingsPage } from './Settings';

const ACCENT = '#FD780F';

// Every finding goes to the console, where the lab's capture tool prints it, and onto the window for a check.
const toConsole = consoleDiagnosticSink();
const sink: VitreaDiagnosticSink = (event) => {
  const w = window as unknown as { __xiDiagnostics?: string[] };
  (w.__xiDiagnostics ??= []).push(event.diagnostic.code);
  toConsole(event);
};

/**
 * What is behind the glass, declared, because the DOM path cannot read pixels. The plane is the ground with ink on
 * it, so its level under a bar is computed from the layout: each block of the transcript states its own mean level
 * (`data-xi-l`, from the share of its box that is inked), and a bar's footprint takes the blocks under it by area,
 * thinned by the scroll edge. Re-read on every scroll and resize; DESIGN.md has the readings it was checked against.
 */
interface Plane {
  ground: number;
  ink: number;
  /** The fills content paints on the ground, each as the level of the fill itself. */
  user: number;
  diff: number;
  block: number;
}
function planeOf(ground: string, scheme: Scheme): Plane {
  const dark = scheme === 'dark';
  const ink = dark ? '#f5f5f5' : '#0a0a0a';
  return {
    ground: luminance(ground),
    ink: luminance(ink),
    user: luminanceOver(ground, ink, dark ? 0.13 : 0.07),
    diff: luminanceOver(ground, dark ? '#4ade80' : '#15803d', 0.1),
    block: luminanceOver(ground, ink, dark ? 0.06 : 0.035),
  };
}
/** Mean level of one transcript block's own box. `cover` is the share of the box its glyphs ink. */
function blockLevel(p: Plane, kind: TranscriptItem['kind']): number {
  const inked = (base: number, cover: number) => base + (p.ink - base) * cover;
  switch (kind) {
    case 'user':
      return inked(p.user, 0.09);
    case 'edit':
      return inked(p.diff, 0.07);
    case 'running':
      return inked(p.block, 0.06);
    case 'assistant':
      return inked(p.ground, 0.085);
    default:
      return inked(p.ground, 0.03);
  }
}
// One object per declared level, so a hint keeps its identity until the level under the glass really changes.
const hints = new Map<number, BackdropHint>();
function hintOf(level: number): BackdropHint {
  const l = Math.min(1, Math.max(0, Math.round(level * 100) / 100));
  let hint = hints.get(l);
  if (!hint) hints.set(l, (hint = { tone: l > 0.6 ? 'light' : l < 0.2 ? 'dark' : 'mixed', luminance: l }));
  return hint;
}

/** The level under each bar that floats over a scroller, as hints that follow the scroll. */
function usePlaneHints(
  scroller: RefObject<HTMLElement | null>,
  bars: Record<string, RefObject<HTMLElement | null>>,
  plane: Plane,
  fallbackCover: number,
) {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const barsRef = useRef(bars);
  barsRef.current = bars;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const blocks = [...el.querySelectorAll<HTMLElement>('[data-xi-l]')].map((b) => ({ r: b.getBoundingClientRect(), l: Number(b.dataset.xiL) }));
      const more = { top: el.scrollTop > 1, bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 1 };
      const next: Record<string, number> = {};
      for (const [id, ref] of Object.entries(barsRef.current)) {
        const bar = ref.current?.getBoundingClientRect();
        if (!bar || bar.width === 0) continue;
        let level = plane.ground;
        if (blocks.length === 0) level += (plane.ink - plane.ground) * fallbackCover;
        for (const { r, l } of blocks) {
          const w = Math.min(bar.right, r.right) - Math.max(bar.left, r.left);
          const h = Math.min(bar.bottom, r.bottom) - Math.max(bar.top, r.top);
          if (w > 0 && h > 0) level += ((l - plane.ground) * w * h) / (bar.width * bar.height);
        }
        // The soft scroll edge thins the content to about half across a bar that sits in it.
        const edge = bar.top < el.clientHeight / 2 ? more.top : more.bottom;
        next[id] = plane.ground + (level - plane.ground) * (edge ? 0.55 : 1);
      }
      (window as unknown as { __xiLevels?: unknown }).__xiLevels = next;
      setLevels((prev) => {
        const same = Object.keys(next).every((k) => Math.round((prev[k] ?? -1) * 100) === Math.round(next[k]! * 100));
        return same && Object.keys(prev).length === Object.keys(next).length ? prev : next;
      });
    };
    const queue = () => {
      frame ||= requestAnimationFrame(read);
    };
    read();
    el.addEventListener('scroll', queue, { passive: true });
    const sizes = new ResizeObserver(queue);
    sizes.observe(el);
    if (el.firstElementChild) sizes.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', queue);
      sizes.disconnect();
    };
  }, [scroller, plane, fallbackCover]);
  return (id: string) => hintOf(levels[id] ?? plane.ground);
}

export default function Instrument({ scene, scheme, knobs }: ExperimentProps) {
  const ground = `#${scheme === 'dark' ? knobs.dark : knobs.light}`;
  const [sidebar, setSidebar] = useState<'docked' | 'rail'>(knobs.sidebar === 'rail' ? 'rail' : 'docked');
  useEffect(() => setSidebar(knobs.sidebar === 'rail' ? 'rail' : 'docked'), [knobs.sidebar]);
  const plane = useMemo(() => planeOf(ground, scheme), [ground, scheme]);

  return (
    <GlassRoot asChild renderer="webgpu" colorScheme={scheme} devMode onDiagnostic={sink}>
      <div
        className={cx(s.root, s[scheme])}
        data-scene={scene}
        data-sidebar={sidebar}
        style={{ '--xi-ground': ground } as CSSProperties}
      >
        <div className={s.lights} aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <Window
          scene={scene === 'settings' ? 'settings' : 'session'}
          scheme={scheme}
          plane={plane}
          sidebar={sidebar}
          setSidebar={setSidebar}
          glassComposer={knobs.composer !== 'opaque'}
        />
      </div>
    </GlassRoot>
  );
}

interface WindowProps {
  scene: 'session' | 'settings';
  scheme: Scheme;
  plane: Plane;
  sidebar: 'docked' | 'rail';
  setSidebar: (v: 'docked' | 'rail') => void;
  glassComposer: boolean;
}

function Window({ scene, scheme, plane, sidebar, setSidebar, glassComposer }: WindowProps) {
  const root = useGlassRoot();
  const sideScroll = useRef<HTMLDivElement>(null);
  const mainScroll = useRef<HTMLDivElement>(null);
  const leadBar = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);
  const rail = sidebar === 'rail';
  const [approved, setApproved] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);

  // Over empty ground the level is the ground's own; over the scrollers it follows what is under each bar.
  const flat = hintOf(plane.ground);
  const mainBars = useMemo(() => ({ tabs: tabBar, composer: composerBar }), []);
  const over = usePlaneHints(mainScroll, mainBars, plane, scene === 'settings' ? 0.05 : 0);
  // A menu on the settings page opens over rows of labels.
  const overRows = hintOf(plane.ground + (plane.ink - plane.ground) * 0.05);

  // Content clears each floating bar by the bar's measured far edge, and thins out under it while it scrolls.
  useGlassBarInset(leadBar, { scrollRef: sideScroll, edge: 'top', measure: 'far-edge' });
  useGlassBarInset(tabBar, { scrollRef: mainScroll, edge: 'top' });
  useGlassBarInset(composerBar, { scrollRef: mainScroll, edge: 'bottom', measure: 'far-edge' });
  useGlassScrollEdge(sideScroll, { edges: ['top'], style: 'soft', inset: 12 });
  useGlassScrollEdge(mainScroll, { edges: scene === 'session' ? ['top', 'bottom'] : ['top'], style: 'soft', inset: { top: 4 } });

  // The bars slide with the sidebar and keep their size, which no observer reports: re-read them on the root's own frames.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!root) return;
    const started = performance.now();
    const stop = root.subscribe(() => {
      root.invalidateGeometry();
      if (performance.now() - started > 520) stop();
    });
    return stop;
  }, [root, sidebar]);

  // A live session is read from its end.
  useLayoutEffect(() => {
    const el = mainScroll.current;
    if (!el || scene !== 'session') return;
    const toEnd = () => {
      el.scrollTop = el.scrollHeight;
    };
    toEnd();
    const t = [setTimeout(toEnd, 60), setTimeout(toEnd, 400)];
    void document.fonts?.ready.then(toEnd);
    return () => t.forEach(clearTimeout);
  }, [scene, glassComposer]);

  // What the runtime resolved for each group, readable from the console; nothing of it is drawn.
  const groups = useGlassGroups();
  useEffect(() => {
    (window as unknown as { __xiGroups?: unknown }).__xiGroups = groups.map(({ id, state }) => ({
      id,
      renderer: state.activeRenderer,
      sampling: state.samplingBackend,
      refraction: state.refraction,
      analysis: state.analysis,
      health: state.health,
    }));
  }, [groups]);

  const tokens = s[scheme];
  return (
    <>
      <aside className={s.sidebar} aria-label={scene === 'settings' ? 'Settings sections' : 'Sessions'} inert={rail}>
        <div className={s.sideScroll} ref={sideScroll}>
          <div>{scene === 'settings' ? <SettingsIndex scroller={mainScroll} /> : <SidebarList approved={approved} />}</div>
        </div>
        {scene === 'session' && <Usage />}
      </aside>

      <main className={s.main}>
        <div className={s.scroll} ref={mainScroll} tabIndex={-1}>
          {scene === 'settings' ? <SettingsPage scheme={scheme} hint={overRows} /> : <Transcript plane={plane} />}
        </div>
      </main>

      {scene === 'session' && <SideColumn />}

      {/* ---- The floating layer: four pieces of glass at rest, a fifth when the sidebar floats. ---- */}
      <GlassGroup id="xi-lead" hint={flat}>
        <GlassSurface asChild capsule thickness={8} foreground="vibrant" data-glass-role="control">
          <div className={cx(s.host, s.lead, tokens)} ref={leadBar} role="group" aria-label="Window">
            <GBtn label={rail ? 'Dock the sidebar' : 'Collapse the sidebar'} aria-pressed={!rail} onClick={() => setSidebar(rail ? 'docked' : 'rail')}>
              <PanelLeft />
            </GBtn>
            <GBtn label="Search">
              <Search />
            </GBtn>
          </div>
        </GlassSurface>
      </GlassGroup>

      <GlassGroup id="xi-tabs" hint={over('tabs')}>
        <GlassSurface asChild capsule thickness={8} foreground="vibrant" data-glass-role="control">
          <nav className={cx(s.host, s.tabs, tokens)} ref={tabBar} aria-label="Tabs">
            <Tabs settings={scene === 'settings'} approved={approved} />
          </nav>
        </GlassSurface>
      </GlassGroup>

      {!approved && (
        <div className={s.needsSlot}>
          {/* The tint is the status, so it belongs to the closed control; the platter it grows into is plain glass. */}
          <GlassPopover open={approvalOpen} onOpenChange={setApprovalOpen} groupProps={{ id: 'xi-needs', hint: approvalOpen ? overRows : flat, tint: approvalOpen ? null : ACCENT }}>
            <GlassPopoverTrigger capsule thickness={8} className={cx(s.platter, s.needs, tokens)}>
              <Hand />
              Approve…
            </GlassPopoverTrigger>
            <GlassPopoverContent
              aria-label="Approval waiting"
              placement="bottom-end"
              gap={8}
              radius={24}
              thickness={8}
              className={cx(s.platter, s.approval, tokens)}
            >
              <div className={s.approvalFrom}>
                <StateMark state="approval" />
                {approval.session}
                <time>{approval.waited}</time>
              </div>
              <h3>{approval.title}</h3>
              <code>{approval.command}</code>
              <p>{approval.why}</p>
              <div className={s.approvalActions}>
                <GlassPopoverClose className={s.deny}>Deny</GlassPopoverClose>
                <GlassPopoverClose className={s.approve} onClick={() => setApproved(true)}>
                  Approve
                </GlassPopoverClose>
              </div>
            </GlassPopoverContent>
          </GlassPopover>
        </div>
      )}

      <GlassGroup id="xi-rail" hint={flat}>
        <GlassSurface asChild capsule thickness={8} foreground="vibrant" present={rail} data-glass-role="control">
          <nav className={cx(s.host, s.rail, tokens)} data-shown={rail} aria-label="Sessions, collapsed" inert={!rail}>
            <div className={s.railInner}>
              <Rail approved={approved} />
            </div>
          </nav>
        </GlassSurface>
      </GlassGroup>

      {scene === 'session' &&
        (glassComposer ? (
          <GlassGroup id="xi-composer" hint={over('composer')}>
            <GlassSurface asChild radius={26} thickness={8} foreground="vibrant" data-glass-role="control">
              <form className={cx(s.host, s.composer, tokens)} ref={composerBar} aria-label="Message" onSubmit={(e) => e.preventDefault()}>
                <ComposerBody />
              </form>
            </GlassSurface>
          </GlassGroup>
        ) : (
          <form
            className={cx(s.host, s.composer, s.composerOpaque, tokens)}
            ref={composerBar}
            aria-label="Message"
            onSubmit={(e) => e.preventDefault()}
          >
            <ComposerBody />
          </form>
        ))}
    </>
  );
}

// ---- The floating layer's contents ------------------------------------------------------------------------------

const destinationIcon: Record<string, ReactNode> = {
  compose: <SquarePen />,
  grid: <LayoutGrid />,
  shapes: <Shapes />,
  sliders: <SlidersHorizontal />,
};

function Tabs({ settings, approved }: { settings: boolean; approved: boolean }) {
  const [current, setCurrent] = useState(settings ? 'settings' : tabs.find((t) => t.active)?.id ?? tabs[0]!.id);
  const all = settings ? [...tabs, { id: 'settings', title: 'Settings', kind: 'settings' as const }] : tabs;
  return (
    <>
      {all.map((t) => {
        const state = 'state' in t ? t.state : undefined;
        const quiet = approved && state === 'approval';
        return (
          <button key={t.id} type="button" className={s.tab} aria-current={t.id === current ? 'page' : undefined} onClick={() => setCurrent(t.id)}>
            {t.kind === 'file' && <FileCode2 />}
            {t.kind === 'settings' && <SlidersHorizontal />}
            {state && !quiet && <StateMark state={state} />}
            <span>{t.title}</span>
          </button>
        );
      })}
      <GBtn label="New tab">
        <Plus />
      </GBtn>
    </>
  );
}

function Rail({ approved }: { approved: boolean }) {
  const live = projects.flatMap((p) => p.sessions).filter((x) => x.state !== 'idle');
  return (
    <>
      {destinations.map((d) => (
        <GBtn key={d.id} label={d.label}>
          {destinationIcon[d.icon]}
        </GBtn>
      ))}
      <span className={s.railRule} aria-hidden />
      {live.map((x) => (
        <GBtn key={x.id} label={`${x.title}: ${x.line}`}>
          <StateMark state={approved && x.state === 'approval' ? 'running' : x.state} />
        </GBtn>
      ))}
      <span className={s.railRule} aria-hidden />
      <GBtn label={`Usage: ${Math.round(usage.fiveHour * 100)}% of five hours, ${Math.round(usage.week * 100)}% of the week`}>
        <Ring value={usage.fiveHour} size={16} />
      </GBtn>
    </>
  );
}

function ComposerBody() {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState(true);
  return (
    <>
      <Fold open={queued}>
        <div className={s.queued}>
          Queued
          <b>{composer.queued}</b>
          <GBtn label="Remove the queued message" onClick={() => setQueued(false)}>
            <X />
          </GBtn>
        </div>
      </Fold>
      <textarea
        className={s.field}
        rows={1}
        placeholder={composer.placeholder}
        aria-label={composer.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={s.composerRow}>
        <GBtn label="Attach">
          <Plus />
        </GBtn>
        <button type="button" className={s.chip} title="Permission mode">
          {composer.mode}
        </button>
        <span className={s.spacer} />
        <button type="button" className={s.chip} title="Model and effort">
          <b>{composer.model}</b> {composer.effort}
        </button>
        <button type="button" className={s.ring} aria-label={`Context ${Math.round(composer.context * 100)}% used`}>
          <Ring value={composer.context} />
          <span>{Math.round(composer.context * 100)}%</span>
        </button>
        <button type="submit" className={s.send} aria-label={text ? 'Send' : 'Stop'} title={text ? 'Send' : 'Stop'}>
          {text ? <ArrowUp /> : <i className={s.stopMark} />}
        </button>
      </div>
    </>
  );
}

// ---- The sidebar: print on the ground ----------------------------------------------------------------------------

function SessionRow({ x, current, approved }: { x: Session; current?: boolean; approved: boolean }) {
  const state = approved && x.state === 'approval' ? 'running' : x.state;
  const needs = state === 'approval' || state === 'question' || state === 'plan';
  return (
    <button type="button" className={cx(s.row, s.session, state === 'unread' && s.unread)} aria-current={current ? 'true' : undefined} title={needs ? undefined : x.line}>
      <span className={s.sessionText}>
        <span className={s.rowLabel}>{x.title}</span>
        {needs && <span className={s.sessionLine}>{x.line}</span>}
      </span>
      <span className={s.slot}>
        <StateMark state={state} />
        <span className={s.age}>{x.age}</span>
      </span>
    </button>
  );
}

function SidebarList({ approved }: { approved: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(projects.map((p) => [p.id, p.open])));
  return (
    <>
      <div className={s.nav}>
        {destinations.map((d) => (
          <button key={d.id} type="button" className={s.row}>
            {destinationIcon[d.icon]}
            <span className={s.rowLabel}>{d.label}</span>
            {'shortcut' in d && <span className={s.kbd}>{d.shortcut}</span>}
          </button>
        ))}
      </div>
      <div className={s.group}>
        <div className={s.groupHead}>Pinned</div>
        {pinned.map((x) => (
          <SessionRow key={x.id} x={x} approved={approved} />
        ))}
      </div>
      {projects.map((p) => (
        <div className={s.group} key={p.id} style={{ marginTop: open[p.id] || p.id === 'atlas' ? undefined : 2 }}>
          <button type="button" className={s.groupHead} aria-expanded={!!open[p.id]} onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
            {p.name}
            <ChevronRight />
          </button>
          <Fold open={!!open[p.id]}>
            {p.sessions.map((x) => (
              <SessionRow key={x.id} x={x} current={x.id === 's1'} approved={approved} />
            ))}
          </Fold>
        </div>
      ))}
    </>
  );
}

function Usage() {
  return (
    <button type="button" className={s.usage} aria-label={`Usage: ${Math.round(usage.fiveHour * 100)}% of the five-hour limit, ${Math.round(usage.week * 100)}% of the week. Resets in ${usage.resetsIn}.`}>
      <span>
        <Ring value={usage.fiveHour} size={16} />
        5h
      </span>
      <span>
        <Ring value={usage.week} size={16} />
        Week
      </span>
      <small>resets in {usage.resetsIn}</small>
    </button>
  );
}

// ---- The transcript ----------------------------------------------------------------------------------------------

function Activity({ label, seconds, children }: { label: string; seconds: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.act}>
      <button type="button" className={s.actHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
        <ChevronRight />
        <time>{seconds}s</time>
      </button>
      <Fold open={open}>{children}</Fold>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return <div className={s.user}>{item.text}</div>;
    case 'assistant':
      return (
        <div className={s.prose}>
          {item.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <Activity label="Thought" seconds={item.seconds}>
          <div className={s.thought}>{item.summary}</div>
        </Activity>
      );
    case 'tools':
      return (
        <Activity label={item.summary} seconds={item.seconds}>
          <div className={s.calls}>
            {item.calls.map((c, i) => (
              <div className={s.call} key={c.target} style={{ '--i': i } as CSSProperties}>
                <b>{c.tool}</b>
                <code>{c.target}</code>
                {c.detail && <small>{c.detail}</small>}
              </div>
            ))}
          </div>
        </Activity>
      );
    case 'edit':
      return (
        <div>
          <div className={s.blockHead}>
            <b>{item.file}</b>
            <span className={s.counts}>
              <span className={s.plus}>+{item.added}</span>
              {item.removed > 0 && <span className={s.minus}> −{item.removed}</span>}
            </span>
          </div>
          <div className={cx(s.block, s.diff)}>
            {item.lines.map((l, i) => (
              <div className={s.dl} data-sign={l.sign} key={i}>
                <i>{l.sign}</i>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'agents':
      return (
        <div className={s.agentsLine}>
          {item.names.map((n) => (
            <span key={n}>
              <Spinner />
              {n}
            </span>
          ))}
          {item.line}
        </div>
      );
    case 'running': {
      const m = Math.floor(item.seconds / 60);
      return (
        <div>
          <div className={s.blockHead}>
            <Spinner />
            <b>{item.command}</b>
            <time>{m > 0 ? `${m}m ${item.seconds % 60}s` : `${item.seconds}s`}</time>
          </div>
          <div className={s.block}>
            {item.tail.map((line) => {
              const live = line.startsWith('◌');
              return (
                <div className={s.tail} data-s={live ? 'live' : 'ok'} key={line}>
                  <i className={live ? s.pulse : undefined}>{line[0]}</i>
                  <span>{line.slice(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }
}

function Transcript({ plane }: { plane: Plane }) {
  return (
    <div className={s.column}>
      {transcript.map((item, i) => (
        <div key={i} className={cx(s.item, s[`item_${item.kind}`])} data-xi-l={blockLevel(plane, item.kind).toFixed(4)}>
          <Item item={item} />
        </div>
      ))}
    </div>
  );
}

// ---- The side column ---------------------------------------------------------------------------------------------

function SideColumn() {
  return (
    <aside className={s.side} aria-label="Overview">
      <section className={s.sideSec}>
        <h4>
          Changes
          <span>
            <span className={s.plus}>+{overview.added}</span> <span className={s.minus}>−{overview.removed}</span>
          </span>
        </h4>
        <div className={s.branch}>
          <GitBranch />
          {overview.branch}
        </div>
        <div style={{ marginTop: 6 }}>
          {overview.files.map((f) => (
            <div className={s.sideRow} key={f.path}>
              <code>
                <bdi>{f.path}</bdi>
              </code>
              <small>
                <span className={s.plus}>+{f.added}</span>
                {f.removed > 0 && <span className={s.minus}> −{f.removed}</span>}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className={s.sideSec}>
        <h4>Agents</h4>
        {overview.agents.map((a) => (
          <div className={s.sideRow} key={a.name}>
            {a.state === 'running' ? <StateMark state="running" /> : <DoneMark />}
            <span className={s.sideName}>{a.name}</span>
            <span className={s.sideNote}>{a.line}</span>
          </div>
        ))}
      </section>
      <section className={s.sideSec}>
        <h4>Background</h4>
        {overview.background.map((b) => (
          <div className={s.sideRow} key={b.label}>
            <StateMark state="running" />
            <code style={{ direction: 'ltr' }}>{b.label}</code>
            <small>{b.line}</small>
          </div>
        ))}
      </section>
      <section className={s.sideSec}>
        <h4>
          Tasks
          <span>
            {overview.todos.filter((t) => t.done).length}/{overview.todos.length}
          </span>
        </h4>
        {overview.todos.map((t) => (
          <div className={s.todo} key={t.text} data-s={t.done ? 'done' : 'current' in t && t.current ? 'current' : 'todo'}>
            {t.done ? <DoneMark /> : 'current' in t && t.current ? <StateMark state="running" /> : <span className={cx(s.mark)}><i className={s.todoRing} /></span>}
            {t.text}
          </div>
        ))}
      </section>
    </aside>
  );
}

