// The board. One window in the Layers style under the Paper colouring: the same field, the same glass runtime, the
// same pane. The pane is the index of parts; the main space holds one part's variants together. Nothing here is a
// design of its own: every A is Layers' markup on Layers' styles, and the other letters are built beside it.
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { consoleDiagnosticSink, GlassGroup, GlassRoot, GlassSurface, useGlassGroups, useGlassRoot, useGlassWindowActivation, type VitreaDiagnosticSink } from '@vitreajs/vitrea-react';
import { ClipboardCheck, ClipboardCopy, PanelLeft, RotateCcw } from 'lucide-react';
import { projects, usage } from '../../content/fixtures';
import type { ExperimentProps, Scheme } from '../../lab/types';
import { colouringOf } from '../layers/colour';
import { GlassLayer, PLANE, THICKNESS, useKick } from '../layers/glass';
import { paintField } from '../layers/paint';
import { cx, GBtn, Ring, RootCtx, StateGlyph } from '../layers/parts';
import '../layers/layers.css';
import './choices.css';
import { BoardCtx, ClipCtx, type Board } from './board';
import { ComposerPage } from './composer';
import { GroundPage, paintBands } from './ground';
import { MenuPage, PanePage, UsagePage, type PaneMotion } from './motion';
import { PlanPage, QuestionPage } from './needs';
import { GROUNDS, JUDGED, PARTS, partOf, SUGGESTED, type PartDef } from './parts';
import { Together } from './together';
import { AgentsPage, CommandPage, DiffPage, MessagePage, ThoughtPage } from './transcript';

const toConsole = consoleDiagnosticSink();
const sink: VitreaDiagnosticSink = (event) => toConsole(event);

// As in Layers: the runtime's exterior shadow is clipped to each surface's sampling padding, which shows as a seam
// beside surfaces this close together, so shadows are drawn in CSS (layers.css) and the runtime's are off.
const NO_OUTER_SHADOW = {
  outerShadow: { thinOcclusionDark: 0, thinOcclusionMid: 0, thinOcclusionBright: 0, thickOcclusionAt96: 0, thickOcclusionAt128: 0, thickOcclusionAt160: 0 },
} as const;

const PAPER = colouringOf('paper');
const STORE = 'maws-design-lab:choices:picks';

function flagsOf(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

/** Move within the board: the part and the ground live in the address, so a page can be linked and captured. */
function go(patch: Record<string, string | null>) {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = 'choices/session', query = ''] = raw.split('?');
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  window.location.hash = `#/${path}${s ? `?${s}` : ''}`;
}

function Plane({ scheme, ground, bands }: { scheme: Scheme; ground: string; bands: readonly string[] | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  const key = bands ? bands.join() : '';
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      if (bands) paintBands(c, scheme === 'dark', bands);
      else paintField(c, PAPER.field[scheme], 'warm', ground);
      // The field is still: it is read once per painting, not on every frame.
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme, ground, key, root]);
  return <canvas ref={ref} className="xl-plane" aria-hidden="true" />;
}

/** A host that slides keeps its size, which no observer reports: the root re-measures on its own frames meanwhile. */
function LayoutPump({ layout }: { layout: string }) {
  const root = useGlassRoot();
  const first = useRef(true);
  useEffect(() => {
    if (!root) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const started = performance.now();
    let off: (() => void) | null = root.subscribe(() => {
      root.invalidateGeometry();
      if (performance.now() - started > 900 && off) {
        off();
        off = null;
      }
    });
    return () => off?.();
  }, [root, layout]);
  return null;
}

/** The pose the runtime resolved, published for the CSS shadows: a receded window casts none. */
function Pose({ host }: { host: HTMLElement | null }) {
  const active = useGlassWindowActivation();
  useLayoutEffect(() => {
    host?.setAttribute('data-pose', active ?? 'active');
  }, [active, host]);
  return null;
}

function Readout() {
  const groups = useGlassGroups();
  const line = groups.map(({ id, state }) => `${id}:${state.activeRenderer}/${state.refraction}/${state.analysis}/${state.health}${state.demotionReason ? `(${state.demotionReason})` : ''}`).join(' ');
  useEffect(() => {
    if (line) console.warn(`[choices] ${line}`);
  }, [line]);
  return null;
}

/** Blocks stand on glass placed from their boxes; when the page scrolls, the glass is told to follow. */
function Scroller({ children, part }: { children: React.ReactNode; part: string }) {
  const kick = useKick();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (el) el.scrollTop = 0;
    kick(600);
  }, [part, kick, el]);
  // A block that is moved by a neighbour's growth keeps its own size, which its observer does not report; the
  // page's own box does change, so the glass is told to follow from that.
  useEffect(() => {
    const page = el?.firstElementChild;
    if (!page) return;
    const ro = new ResizeObserver(() => kick(360));
    ro.observe(page);
    return () => ro.disconnect();
  }, [el, part, kick]);
  return (
    <div className="xc-scroll" ref={setEl} onScroll={() => kick(160)} tabIndex={-1}>
      <ClipCtx.Provider value={el}>{children}</ClipCtx.Provider>
    </div>
  );
}

const SETS = [
  ['yours', 'Yours'],
  ['today', 'Before'],
  ['suggested', 'In Layers'],
] as const;

const SEND_STATES = [
  ['running', 'Running'],
  ['running-typed', 'Running, typed'],
  ['idle', 'Idle'],
  ['idle-typed', 'Idle, typed'],
] as const;

export default function Choices({ scheme, knobs }: ExperimentProps) {
  const flags = useMemo(flagsOf, [scheme, knobs]);
  const x = (flags.get('x') ?? '').split(',');
  const part = partOf(knobs.part);
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  // ---- what the pages share ---------------------------------------------------------------------------------------
  const [open, setOpen] = useState(x.includes('open'));
  const [state, setState] = useState(flags.get('s') ?? 'running');
  const [replay, setReplay] = useState(0);
  const firstPart = useRef(true);
  useEffect(() => {
    if (firstPart.current) {
      firstPart.current = false;
      return;
    }
    setOpen(false);
    setState('running');
  }, [part.id]);

  const [picks, setPicks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });
  const pick = useCallback((id: string, letter: string) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (next[id] === letter) delete next[id];
      else next[id] = letter;
      try {
        window.localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* a private window keeps the picks for the visit only */
      }
      return next;
    });
  }, []);

  // ---- the ground ---------------------------------------------------------------------------------------------------
  const grounds = GROUNDS[scheme];
  const ground = (scheme === 'dark' ? grounds.find((g) => g.id === knobs.ground) : undefined) ?? grounds[0]!;
  const bands = part.id === 'ground' ? grounds.map((g) => g.hex) : null;
  const tokens = PAPER.tokens[scheme];

  // ---- the pane: it is the index, and on its own page it is also the thing judged ---------------------------------------
  const [motion, setMotion] = useState<PaneMotion>(x.includes('rail') ? 'rail' : x.includes('melt') ? 'melt' : 'slide');
  const [away, setAway] = useState(x.includes('nopane') || x.includes('rail') || x.includes('melt'));
  // Melting has two beats: the glass and its content go, then the main space takes the room (and the reverse).
  const [melted, setMelted] = useState(x.includes('melt'));
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  const setPane = useCallback((wantAway: boolean, how: PaneMotion) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setMotion(how);
    if (how !== 'melt') {
      setMelted(false);
      setAway(wantAway);
    } else if (wantAway) {
      setMelted(true);
      later(200, () => setAway(true));
    } else {
      setAway(false);
      later(240, () => setMelted(false));
    }
  }, []);
  const play = useCallback(
    (how: PaneMotion) => {
      setPane(true, how);
      later(how === 'melt' ? 1700 : 1500, () => setPane(false, how));
    },
    [setPane],
  );
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const paneState = !away ? 'open' : motion === 'rail' ? 'rail' : 'closed';

  // ---- keys: up and down step through the parts; O opens; R replays ------------------------------------------------
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const i = PARTS.indexOf(part);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = PARTS[(i + (ev.key === 'ArrowDown' ? 1 : PARTS.length - 1)) % PARTS.length]!;
        go({ part: next.id, x: null, s: null });
      } else if ((ev.key === 'o' || ev.key === 'O') && part.opens) setOpen((v) => !v);
      else if ((ev.key === 'r' || ev.key === 'R') && part.motion) setReplay((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [part]);

  // The Together page draws one of three sets of letters; it opens on the owner's own.
  const set = SETS.some(([id]) => id === state) ? state : 'yours';

  const board = useMemo<Board>(() => ({ part, scheme, open, state, replay, picks, pick }), [part, scheme, open, state, replay, picks, pick]);
  const pose = flags.get('pose') === 'inactive' ? 'inactive' : flags.get('pose') === 'active' ? 'active' : 'auto';
  const tier = flags.get('tier') === 'css' ? 'css' : 'webgpu';
  const dev = flags.has('dev');
  const layout = `${part.id}:${paneState}:${melted ? 1 : 0}`;

  return (
    <RootCtx.Provider value={el}>
      <GlassRoot asChild renderer={tier} colorScheme={scheme} windowActivation={pose} devMode={dev} onDiagnostic={sink} materialProfile={NO_OUTER_SHADOW}>
        <div
          ref={setEl}
          className="x-layers x-choices"
          data-scheme={scheme}
          data-scene="session"
          data-pane={paneState}
          data-melted={melted}
          data-side="closed"
          data-material="glass"
          data-face="figtree"
          data-colour="paper"
          data-mark="badge"
          data-part={part.id}
          data-layout={part.layout}
          style={
            {
              '--xl-ground': ground.hex,
              '--xl-ink-rgb': tokens.ink,
              '--xl-shade-rgb': tokens.shade,
              '--xl-accent': tokens.accent,
              '--xl-on-accent': tokens.onAccent,
              '--xl-accent-mark': tokens.mark,
              '--xl-focus': tokens.focus,
              colorScheme: scheme,
            } as CSSProperties
          }
        >
          <Plane scheme={scheme} ground={ground.hex} bands={bands} />
          <LayoutPump layout={layout} />
          <Pose host={el} />
          {dev && <Readout />}

          <BoardCtx.Provider value={board}>
            {/* ---- the main space: one part, its variants together ---- */}
            <main className="xl-main xc-main">
              <GlassLayer group="xc-blocks" space="viewport" layout={`${layout}:${open ? 1 : 0}:${state}`}>
                <header className="xc-head">
                  <h1 className="xc-title">{part.name}</h1>
                  <span className="xl-grow" />
                  {part.id === 'together' && (
                    <div className="xc-seg" role="radiogroup" aria-label="Which letters">
                      {SETS.map(([id, label]) => (
                        <button key={id} type="button" role="radio" aria-checked={set === id} onClick={() => setState(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {part.id === 'send' && (
                    <div className="xc-seg" role="radiogroup" aria-label="Session state">
                      {SEND_STATES.map(([id, label]) => (
                        <button key={id} type="button" role="radio" aria-checked={state === id} onClick={() => setState(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {part.opens && (
                    <div className="xc-seg" role="radiogroup" aria-label="Show">
                      <button type="button" role="radio" aria-checked={!open} onClick={() => setOpen(false)}>
                        At rest
                      </button>
                      <button type="button" role="radio" aria-checked={open} onClick={() => setOpen(true)}>
                        Opened
                      </button>
                    </div>
                  )}
                  {part.motion && (
                    <button type="button" className="xc-replay" onClick={() => setReplay((n) => n + 1)}>
                      <RotateCcw size={14} strokeWidth={2} />
                      Replay
                    </button>
                  )}
                </header>
                {part.id === 'together' ? (
                  <Together which={set} letters={set === 'today' ? NONE : set === 'suggested' ? SUGGESTED : picks} />
                ) : (
                  <Scroller part={part.id}>
                    <div className="xc-page" key={part.id}>
                      <Page part={part} play={play} />
                    </div>
                  </Scroller>
                )}
              </GlassLayer>
            </main>

            {/* ---- the pane: Layers' own, holding the index ---- */}
            <GlassGroup id="xl-pane" backdrop={PLANE}>
              <GlassSurface asChild radius={20} thickness={THICKNESS} foreground="vibrant" present={!melted}>
                <nav aria-label="Parts" data-glass-role="window" className="xl-host xl-pane" inert={away && motion !== 'rail'}>
                  <Index part={part} picks={picks} rail={paneState === 'rail'} />
                </nav>
              </GlassSurface>
            </GlassGroup>
          </BoardCtx.Provider>

          <div className="xl-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <GlassGroup id="xl-lead" backdrop={PLANE}>
            <GlassSurface asChild capsule thickness={THICKNESS} plane="overlay" foreground="vibrant" present={away}>
              <div className="xl-host xl-lead" data-glass-role="control" role="group" aria-label="Window">
                <GBtn label={away ? 'Show the sidebar' : 'Hide the sidebar'} tip={away ? 'Show sidebar' : 'Hide sidebar'} aria-pressed={!away} onClick={() => setPane(!away, motion)}>
                  <PanelLeft size={16} strokeWidth={1.75} />
                </GBtn>
              </div>
            </GlassSurface>
          </GlassGroup>
        </div>
      </GlassRoot>
    </RootCtx.Provider>
  );
}

const NONE: Record<string, string> = {};

function Page({ part, play }: { part: PartDef; play: (how: PaneMotion) => void }) {
  switch (part.id) {
    case 'message':
      return <MessagePage />;
    case 'thought':
      return <ThoughtPage />;
    case 'diff':
      return <DiffPage />;
    case 'command':
      return <CommandPage />;
    case 'agents':
      return <AgentsPage />;
    case 'queued':
    case 'model':
    case 'context':
    case 'send':
      return <ComposerPage />;
    case 'question':
      return <QuestionPage />;
    case 'plan':
      return <PlanPage />;
    case 'usage':
      return <UsagePage />;
    case 'pane':
      return <PanePage play={play} />;
    case 'menu':
      return <MenuPage />;
    default:
      return <GroundPage />;
  }
}

// ---- the index: the pane's rows are the parts; a row's slot holds the letter picked --------------------------------

function Index({ part, picks, rail }: { part: PartDef; picks: Record<string, string>; rail: boolean }) {
  const [copied, setCopied] = useState(false);
  const { scheme } = useContext(BoardCtx)!;
  const groups = [
    ['Transcript', 'Transcript'],
    ['Composer', 'Composer'],
    ['Needs you', 'Needs you'],
    ['Pane', 'Pane'],
    ['Window', 'Window'],
    ['Sum', 'Your picks'],
  ] as const;
  const judged = JUDGED;
  const done = judged.filter((p) => picks[p.id]).length;
  const letterOf = (id: string) => picks[id === 'ground' && scheme === 'light' ? 'ground-light' : id];
  const copy = () => {
    if (done === 0) return;
    const line = judged
      .filter((p) => picks[p.id])
      .map((p) => `${p.name.toLowerCase()} ${picks[p.id]}`)
      .concat(picks['ground-light'] ? [`light ground ${picks['ground-light']}`] : [])
      .join(', ');
    void navigator.clipboard?.writeText(line).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  const waiting = projects.flatMap((p) => p.sessions).filter((s) => s.state !== 'idle');
  return (
    <>
      <div className="xc-pane-clip">
      <div className="xl-pane-in" inert={rail}>
        <div className="xl-pane-top" />
        <div className="xl-pane-body" key="index">
          {groups.map(([g, label], gi) => (
            <div className="xl-group" key={g} style={gi === 0 ? { marginTop: 0 } : undefined}>
              <div className="xl-group-head">
                <span>{label}</span>
              </div>
              {PARTS.filter((p) => p.group === g).map((p) => (
                <div key={p.id} className="xl-row" data-selected={p.id === part.id}>
                  <button type="button" className="xl-row-main" aria-current={p.id === part.id ? 'page' : undefined} onClick={() => go({ part: p.id, x: null, s: null })}>
                    <span className="xl-fade">{p.name}</span>
                  </button>
                  {letterOf(p.id) && <span className="xc-picked">{letterOf(p.id)}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="xl-pane-foot">
          <button type="button" className={cx('xl-icon', 'xc-copy')} aria-label="Copy your picks" data-tip={copied ? 'Copied' : done === 0 ? 'Nothing picked yet' : 'Copy your picks'} data-tip-at="above-start" onClick={copy}>
            {copied ? <ClipboardCheck size={17} strokeWidth={1.75} /> : <ClipboardCopy size={17} strokeWidth={1.75} />}
          </button>
          <span className="xc-count">
            {done} of {judged.length}
          </span>
        </div>
      </div>
      </div>
      {/* Variant B of the pane's collapse: what stays when it folds to a rail is who needs you. */}
      <div className="xc-rail" inert={!rail} aria-hidden={!rail}>
        {waiting.map((s) => (
          <span key={s.id} className="xc-rail-mark" title={s.title}>
            <StateGlyph state={s.state} />
          </span>
        ))}
        <span className="xl-grow" />
        <span className="xc-rail-mark">
          <Ring value={usage.week} inner={usage.fiveHour} />
        </span>
      </div>
    </>
  );
}
