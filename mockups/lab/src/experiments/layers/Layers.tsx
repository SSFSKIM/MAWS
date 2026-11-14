import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  consoleDiagnosticSink,
  GlassGroup,
  GlassRoot,
  GlassSurface,
  useGlassBarInset,
  useGlassGroups,
  useGlassRoot,
  useGlassSamplingGap,
  useGlassWindowActivation,
  type VitreaDiagnosticSink,
} from '@vitreajs/vitrea-react';
import { PanelLeft, PanelRight } from 'lucide-react';
import { approval, projects, type Session } from '../../content/fixtures';
import type { ExperimentProps, SceneId, Scheme } from '../../lab/types';
import { colouringOf, type Field } from './colour';
import { GlassLayer, PLANE, THICKNESS } from './glass';
import { paintField, type Strength } from './paint';
import { GBtn, isYours, RootCtx } from './parts';
import { Sidebar } from './Sidebar';
import { Composer, Home, Modules, SIDE_ROOM_MS, Tabs, Transcript, Waiting } from './Session';
import { Settings } from './Settings';
import './layers.css';

/** The owner's ground candidates. A chip names a light and a dark value; the scheme picks which one is painted. */
const GROUNDS: Record<string, Record<Scheme, string>> = {
  warm: { light: '#faf9f5', dark: '#191919' },
  green: { light: '#faf9f5', dark: '#191c19' },
  lifted: { light: '#ffffff', dark: '#1f1f1f' },
  pure: { light: '#ffffff', dark: '#000000' },
};

export type Answer = null | 'approved' | 'denied';
export type Material = 'glass' | 'veil' | 'opaque';

/** Capture and review aids read from the address (`x=tools,card`, `pose=inactive`, `tier=css`, `dev=1`); never design states. */
function addressFlags(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

// Every finding goes to the console, where the lab's capture tool prints it.
const toConsole = consoleDiagnosticSink();
const sink: VitreaDiagnosticSink = (event) => toConsole(event);

/**
 * Exterior shadows are drawn in CSS, on both roots. The runtime clips each surface's own shadow to its sampling
 * padding, and under surfaces this large and this close together (a 680 px card, four modules 12 px apart) the
 * shadow is wider than the padding, so it ended in a visible seam beside every one. This tuning takes the
 * runtime's shadow off; `layers.css` draws one per surface, and takes it away again in the receded pose.
 */
const NO_OUTER_SHADOW = {
  outerShadow: { thinOcclusionDark: 0, thinOcclusionMid: 0, thinOcclusionBright: 0, thickOcclusionAt96: 0, thickOcclusionAt128: 0, thickOcclusionAt160: 0 },
} as const;

/** The painted field, shared by the two roots as one texture. */
const FieldCtx = createContext<HTMLCanvasElement | null>(null);

function Plane({ field, strength, ground, onPaint }: { field: Field; strength: Strength; ground: string; onPaint: (c: HTMLCanvasElement) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      paintField(c, field, strength, ground);
      // The field is still: it is read once per painting, not on every frame.
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
      onPaint(c);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [field, strength, ground, root, onPaint]);
  return <canvas ref={ref} className="xl-plane" aria-hidden="true" />;
}

/** The attached root has its own device, so it is handed the same canvas. */
function SupplyField({ stamp }: { stamp: string }) {
  const canvas = useContext(FieldCtx);
  const root = useGlassRoot();
  useEffect(() => {
    if (canvas && root) root.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas, live: false });
  }, [canvas, root, stamp]);
  return null;
}

/** What each root resolved, for the record: printed when the address asks (`dev=1`), never drawn. */
function Readout({ name }: { name: string }) {
  const groups = useGlassGroups();
  const line = groups.map(({ id, state }) => `${id}:${state.activeRenderer}/${state.refraction}/${state.analysis}/${state.health}${state.demotionReason ? `(${state.demotionReason})` : ''}`).join(' ');
  useEffect(() => {
    if (line) console.warn(`[layers ${name}] ${line}`);
  }, [line, name]);
  return null;
}

/**
 * A host that slides keeps its size, which no observer reports, so while a layout transition runs the root is
 * asked to re-measure on its own frames.
 */
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
      if (performance.now() - started > 700 && off) {
        off();
        off = null;
      }
    });
    return () => off?.();
  }, [root, layout]);
  return null;
}

/**
 * The room two neighbouring groups owe each other is the runtime's to derive, from the blur it draws under the
 * resolved accessibility policy. The layout reads it as a variable; the largest value seen is kept, so a
 * preference can open the layout and never snaps it shut.
 */
function Room({ host }: { host: HTMLElement | null }) {
  const gap = useGlassSamplingGap([{ members: [[272, 880]] }, { members: [[560, 36]] }]);
  const widest = useRef(0);
  // The pose the runtime resolved, published for the CSS shadows: a receded window casts none.
  const active = useGlassWindowActivation();
  useLayoutEffect(() => {
    host?.setAttribute('data-pose', active ?? 'active');
  }, [active, host]);
  useLayoutEffect(() => {
    if (!host) return;
    widest.current = Math.max(widest.current, gap);
    host.style.setProperty('--xl-room', `${widest.current}px`);
  }, [gap, host]);
  return null;
}

export default function Layers({ scene, scheme, knobs }: ExperimentProps) {
  const flags = useMemo(addressFlags, [scene, scheme, knobs]);
  const x = (flags.get('x') ?? '').split(',');
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [field, setField] = useState<HTMLCanvasElement | null>(null);
  const [paneOpen, setPaneOpen] = useState(!x.includes('nopane'));
  const [sideOpen, setSideOpen] = useState(!x.includes('noside'));
  const [answer, setAnswer] = useState<Answer>(null);
  const [section, setSection] = useState('Engine');
  const [stamp, setStamp] = useState(0);
  const onPaint = useCallback((c: HTMLCanvasElement) => {
    setField(c);
    setStamp((n) => n + 1);
  }, []);

  // A colouring settles the field, the tint and the mark together; one that is about its ground also names it.
  const colour = colouringOf(knobs.colour);
  const tokens = colour.tokens[scheme];
  const ground = (colour.ground ?? GROUNDS[knobs.ground ?? 'warm'] ?? GROUNDS.warm!)[scheme];
  const strength = (['whisper', 'soft', 'warm', 'vivid'].includes(knobs.field ?? '') ? knobs.field : 'warm') as Strength;
  const material = (['glass', 'veil', 'opaque'].includes(knobs.blocks ?? '') ? knobs.blocks : 'glass') as Material;
  const face = ['figtree', 'geist', 'system'].includes(knobs.face ?? '') ? knobs.face! : 'figtree';

  // Answering the approval is real in the lab: the session goes back to work and its orange leaves the window.
  const live = useCallback(
    (s: Session): Session => {
      if (s.id !== 's2' || answer === null) return s;
      return answer === 'approved' ? { ...s, state: 'running', line: approval.command, age: 'now' } : { ...s, state: 'idle' };
    },
    [answer],
  );
  const waiting = projects.flatMap((p) => p.sessions).map(live).filter((s) => isYours(s.state));

  const go = useCallback((to: SceneId) => {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const [, query = ''] = raw.split('?');
    window.location.hash = `#/layers/${to}${query ? `?${query}` : ''}`;
  }, []);

  // The modules leave before the main space takes their room, and arrive after it has given it back.
  const [sideLaid, setSideLaid] = useState(sideOpen);
  useEffect(() => {
    if (sideOpen) {
      setSideLaid(true);
      return;
    }
    const t = window.setTimeout(() => setSideLaid(false), SIDE_ROOM_MS);
    return () => window.clearTimeout(t);
  }, [sideOpen]);
  const side = scene === 'session' && sideLaid;
  const layout = `${scene}:${paneOpen ? 1 : 0}:${side ? 1 : 0}`;
  const pose = flags.get('pose') === 'inactive' ? 'inactive' : flags.get('pose') === 'active' ? 'active' : 'auto';
  const tier = flags.get('tier') === 'css' ? 'css' : 'webgpu';
  const dev = flags.has('dev');
  const rt = flags.get('rt') === '1' ? true : 'system';

  const scroller = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);

  return (
    <RootCtx.Provider value={el}>
      <FieldCtx.Provider value={field}>
        <GlassRoot asChild renderer={tier} colorScheme={scheme} windowActivation={pose} reducedTransparency={rt} devMode={dev} onDiagnostic={sink} materialProfile={NO_OUTER_SHADOW}>
          <div
            ref={setEl}
            className="x-layers"
            data-scheme={scheme}
            data-scene={scene}
            data-pane={paneOpen ? 'open' : 'closed'}
            data-side={side ? 'open' : 'closed'}
            data-material={material}
            data-face={face}
            data-aid={x.includes('field') ? 'field' : undefined}
            data-colour={colour.id}
            data-mark={colour.mark}
            style={
              {
                '--xl-ground': ground,
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
            <Plane field={colour.field[scheme]} strength={strength} ground={ground} onPaint={onPaint} />
            <LayoutPump layout={layout} />
            <Room host={el} />
            {dev && <Readout name="window" />}

            <Shell
              scene={scene}
              scheme={scheme}
              material={material}
              tint={tokens.accent}
              layout={layout}
              stamp={`${stamp}`}
              flags={x}
              dev={dev}
              tier={tier}
              pose={pose}
              rt={rt}
              refs={{ scroller, tabBar, composerBar }}
              paneOpen={paneOpen}
              setPaneOpen={setPaneOpen}
              sideOpen={sideOpen}
              setSideOpen={setSideOpen}
              live={live}
              waiting={waiting}
              answer={answer}
              setAnswer={setAnswer}
              section={section}
              setSection={setSection}
              go={go}
            />
          </div>
        </GlassRoot>
      </FieldCtx.Provider>
    </RootCtx.Provider>
  );
}

interface ShellProps {
  scene: SceneId;
  scheme: Scheme;
  material: Material;
  /** The seed of the page's one tinted piece of glass. */
  tint: string;
  layout: string;
  stamp: string;
  flags: string[];
  dev: boolean;
  tier: 'css' | 'webgpu';
  pose: 'auto' | 'active' | 'inactive';
  rt: true | 'system';
  refs: { scroller: React.RefObject<HTMLDivElement | null>; tabBar: React.RefObject<HTMLElement | null>; composerBar: React.RefObject<HTMLFormElement | null> };
  paneOpen: boolean;
  setPaneOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  sideOpen: boolean;
  setSideOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  live: (s: Session) => Session;
  waiting: Session[];
  answer: Answer;
  setAnswer: (a: Answer) => void;
  section: string;
  setSection: (s: string) => void;
  go: (scene: SceneId) => void;
}

/** Everything inside the window root. A component of its own so its hooks run inside the glass root. */
function Shell(p: ShellProps) {
  const { scene, scheme, material, layout, refs } = p;
  const [column, setColumn] = useState<HTMLDivElement | null>(null);

  // Content clears each floating bar by the bar's measured far edge, never by a typed constant.
  useGlassBarInset(refs.tabBar, { scrollRef: refs.scroller, edge: 'top', measure: 'far-edge' });
  useGlassBarInset(refs.composerBar, { scrollRef: refs.scroller, edge: 'bottom', measure: 'far-edge' });

  // A live session is read from its end.
  useLayoutEffect(() => {
    const el = refs.scroller.current;
    if (!el || scene !== 'session') return;
    const toEnd = () => {
      el.scrollTop = p.flags.includes('top') ? 0 : p.flags.includes('mid') ? (el.scrollHeight - el.clientHeight) * 0.45 : el.scrollHeight;
    };
    toEnd();
    const t = [setTimeout(toEnd, 80), setTimeout(toEnd, 420)];
    void document.fonts?.ready.then(toEnd);
    return () => t.forEach(clearTimeout);
  }, [scene, refs.scroller, material]);

  const transcript = <Transcript open={p.flags.includes('tools')} />;

  const trail = (
    <>
      {scene !== 'settings' && p.waiting.length > 0 && <Waiting waiting={p.waiting} tint={p.tint} onAnswer={p.setAnswer} open={p.flags.includes('waiting')} alone={scene !== 'session'} />}
      {scene === 'session' && (
        <GlassSurface asChild capsule thickness={THICKNESS} foreground="vibrant">
          <div className="xl-host xl-round" data-glass-role="control" role="group" aria-label="Details">
            <GBtn label={p.sideOpen ? 'Hide the side column' : 'Show the side column'} tip={p.sideOpen ? 'Hide details' : 'Show details'} data-tip-at="end" aria-pressed={p.sideOpen} onClick={() => p.setSideOpen((v) => !v)}>
              <PanelRight size={16} strokeWidth={1.75} />
            </GBtn>
          </div>
        </GlassSurface>
      )}
    </>
  );

  return (
    <>
      {/* ---- The main space: prose on the field, blocks standing over it ---- */}
      <main className="xl-main">
        {scene === 'session' && (
          <div className="xl-scroll" ref={refs.scroller} tabIndex={-1}>
            {material === 'glass' ? (
              <GlassRoot
                asChild
                attachment="container"
                renderer={p.tier}
                colorScheme={scheme}
                windowActivation={p.pose}
                reducedTransparency={p.rt}
                devMode={p.dev}
                onDiagnostic={sink}
                materialProfile={NO_OUTER_SHADOW}
              >
                <div className="xl-column" ref={setColumn}>
                  <SupplyField stamp={p.stamp} />
                  {p.dev && <Readout name="blocks" />}
                  <GlassLayer group="xl-blocks" space="container" origin={column} layout={layout}>
                    {transcript}
                  </GlassLayer>
                </div>
              </GlassRoot>
            ) : (
              <div className="xl-column">{transcript}</div>
            )}
          </div>
        )}
        {scene === 'settings' && <Settings scheme={scheme} onSection={p.setSection} scroller={refs.scroller} />}
        {scene === 'home' && <Home />}
      </main>

      {/* ---- The side column: one module per section, each its own piece of glass. The waiting capsule and the
          column's toggle stand above it in the same group: neighbours, and the capsule is the page's one tint. ---- */}
      {scene === 'session' ? (
        <GlassLayer group="xl-side" space="viewport" layout={layout}>
          {trail}
          <Modules open={p.sideOpen} />
        </GlassLayer>
      ) : (
        <GlassGroup id="xl-side" backdrop={PLANE}>
          {trail}
        </GlassGroup>
      )}

      {/* ---- The pane ---- */}
      <GlassGroup id="xl-pane" backdrop={PLANE}>
        <GlassSurface asChild radius={20} thickness={THICKNESS} foreground="vibrant">
          <nav aria-label={scene === 'settings' ? 'Settings sections' : 'Sessions'} data-glass-role="window" className="xl-host xl-pane" inert={!p.paneOpen}>
            <Sidebar scene={scene} live={p.live} onAnswer={p.setAnswer} section={p.section} go={p.go} card={p.flags.includes('card')} />
          </nav>
        </GlassSurface>
      </GlassGroup>

      <div className="xl-lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {/* One toggle, in one place: a fill while it stands on the pane, a small piece of glass once the pane has left. */}
      <GlassGroup id="xl-lead" backdrop={PLANE}>
        <GlassSurface asChild capsule thickness={THICKNESS} plane="overlay" foreground="vibrant" present={!p.paneOpen}>
          <div className="xl-host xl-lead" data-glass-role="control" role="group" aria-label="Window">
            <GBtn label={p.paneOpen ? 'Hide the sidebar' : 'Show the sidebar'} tip={p.paneOpen ? 'Hide sidebar' : 'Show sidebar'} aria-pressed={p.paneOpen} onClick={() => p.setPaneOpen((v) => !v)}>
              <PanelLeft size={16} strokeWidth={1.75} />
            </GBtn>
          </div>
        </GlassSurface>
      </GlassGroup>

      {/* ---- The floating controls over the main space ---- */}
      {scene !== 'home' && (
        <GlassGroup id="xl-tabs" backdrop={PLANE}>
          <GlassSurface asChild capsule thickness={THICKNESS} foreground="vibrant">
            <nav className="xl-host xl-tabs" ref={refs.tabBar} aria-label="Tabs" data-glass-role="control">
              <Tabs settings={scene === 'settings'} live={p.live} go={p.go} />
            </nav>
          </GlassSurface>
        </GlassGroup>
      )}

      {scene === 'session' && (
        <GlassGroup id="xl-composer" backdrop={PLANE}>
          <GlassSurface asChild radius={26} thickness={THICKNESS} foreground="vibrant">
            <form className="xl-host xl-composer" ref={refs.composerBar} aria-label="Message" data-glass-role="control" onSubmit={(e) => e.preventDefault()}>
              <Composer running queued />
            </form>
          </GlassSurface>
        </GlassGroup>
      )}
    </>
  );
}
