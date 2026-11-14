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
import { FULL, type Presence } from './paper';
import { gatherOf, type Gather } from './plain';
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
/** The right column's container: four modules, one card as tall as the window's content, or a card that grows out of a round button. */
export type SideForm = 'modules' | 'card' | 'button';

// ---- The five open calls (DESIGN.md §13). The first position of each is the design as it stood. ----------------

/** How present Paper's painted form is on a scene where words and controls sit. New chat always has the whole of it. */
const FORM: Record<string, Presence> = {
  everywhere: FULL,
  // Out of focus: the same picture with no line left in it, at 85 % of its depth.
  recede: { sharp: 0, soft: 0.85 },
  // The ground with its light alone.
  home: { sharp: 0, soft: 0 },
};
const FORM_MS = 620;

/**
 * Paper's "needs you" mark, when it is not the solid ink badge. Both alternatives take the tint off the capsule's
 * glass: the mark is one small disc with the state's glyph in it, the same object in a row, a tab and the capsule.
 * `soft` fills the disc with the surface's own ink, thin, so every value of it lives in the sheet. `accent` fills
 * it with the one pigment this colouring then spends: a gold, the glyph near black on it in both schemes, and a
 * hairline of its own shade where the glass under it is nearly as light.
 */
const PIN: Record<Scheme, { disc: string; glyph: string; ring: string }> = {
  light: { disc: '#e6b450', glyph: '#2b1f04', ring: 'rgb(120 84 0 / 0.3)' },
  dark: { disc: '#ecbf63', glyph: '#231a04', ring: 'transparent' },
};

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

/**
 * The pieces of glass the plain ground gathers under, read where they stand now: Open's shares of the pane's
 * strength (the side card 0.86, the composer 0.8, the tabs 0.36 there and 0.4 here, where nothing passes under
 * them), and a reach that a small control cannot spend.
 */
function gatherings(host: HTMLElement | null): Gather[] {
  if (!host) return [];
  const out: Gather[] = [];
  const add = (selector: string, keep: number, reach: number, r: number) => {
    for (const el of host.querySelectorAll<HTMLElement>(selector)) {
      const b = el.getBoundingClientRect();
      const span = Math.min(b.width, b.height);
      out.push({ x: b.left, y: b.top, w: b.width, h: b.height, r: Math.min(r, span / 2), keep: span < 60 ? Math.min(keep, 0.4) : keep, reach: Math.min(reach, 36 + span * 0.6) });
    }
  };
  add('.xl-pane', 1, 150, 20);
  add('.xl-bud, .xl-one', 0.86, 130, 20);
  add(".xl-module:not(.xl-bud, .xl-one):not([data-shown='false'])", 0.7, 84, 20);
  add('.xl-composer', 0.8, 120, 26);
  add('.xl-tabs', 0.4, 72, 18);
  add('.xl-waiting, .xl-round', 0.36, 48, 18);
  if (host.dataset.pane === 'closed') add('.xl-lead', 0.36, 48, 18);
  return out;
}

interface PlaneProps {
  field: Field;
  strength: Strength;
  ground: string;
  /** The plain ground: nothing drawn but what gathers under the glass. `host` is where the glass is looked for. */
  plain: boolean;
  host: HTMLElement | null;
  /** Changes whenever a piece of glass is about to move; the gatherings then follow for the length of the move. */
  follow: string;
  /** How present a picture field's form is on this scene. A change is shown over `FORM_MS`, not cut to. */
  presence: Presence;
  onPaint: (c: HTMLCanvasElement) => void;
  /** Told while the field is changing, so the other root reads it on every frame for that long. */
  onLive: (live: boolean) => void;
}

function Plane({ field, strength, ground, plain, host, follow, presence, onPaint, onLive }: PlaneProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  // What is painted now; it trails `presence` while the form comes into focus or leaves it.
  const shown = useRef(presence);
  const what = useRef({ field, strength, ground, plain, host });
  what.current = { field, strength, ground, plain, host };
  const under = () => (what.current.plain ? gatherings(what.current.host) : undefined);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      paintField(c, field, strength, ground, shown.current, under());
      // The field is still: it is read once per painting, not on every frame.
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
      onPaint(c);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, strength, ground, plain, host, root, onPaint]);

  // On the plain ground a gathering follows its piece of glass: while a pane slides, the side card grows or a
  // scene arrives, the field is repainted from where the glass stands on each frame (a quarter-size canvas of soft
  // pools), and both roots read it for that long. At rest it is as still as the picture.
  useEffect(() => {
    const c = ref.current;
    if (!c || !plain || !host) return;
    root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: true });
    onLive(true);
    const until = performance.now() + 1500;
    const again = () => paintField(c, what.current.field, what.current.strength, what.current.ground, shown.current, under());
    let frame = requestAnimationFrame(function tick(now) {
      again();
      if (now < until) {
        frame = requestAnimationFrame(tick);
        return;
      }
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
      onPaint(c);
      onLive(false);
    });
    // A bar that changes size at rest (a second line typed, a tab closed) is followed too.
    const sizes = new ResizeObserver(() => {
      again();
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
      onPaint(c);
    });
    for (const el of host.querySelectorAll('.xl-composer, .xl-tabs, .xl-waiting')) sizes.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      onLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plain, follow, host, root, onPaint, onLive]);

  // The form comes into focus on New chat and leaves it for a session: one dissolve between two kept layers, on
  // the curve the scene's own content arrives on. Nothing moves once it has settled.
  const { sharp, soft } = presence;
  useEffect(() => {
    const c = ref.current;
    const from = shown.current;
    if (!c || (from.sharp === sharp && from.soft === soft)) return;
    const paint = (p: Presence) => {
      shown.current = p;
      paintField(c, what.current.field, what.current.strength, what.current.ground, p, under());
    };
    const settle = () => {
      paint({ sharp, soft });
      root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: false });
      onPaint(c);
    };
    if (!what.current.field.picture || what.current.plain || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle();
      return;
    }
    root?.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas: c, live: true });
    onLive(true);
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / FORM_MS);
      const e = 1 - (1 - t) ** 3;
      if (t < 1) {
        paint({ sharp: from.sharp + (sharp - from.sharp) * e, soft: from.soft + (soft - from.soft) * e });
        frame = requestAnimationFrame(tick);
      } else {
        settle();
        onLive(false);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      onLive(false);
    };
  }, [sharp, soft, root, onPaint, onLive]);
  return <canvas ref={ref} className="xl-plane" aria-hidden="true" />;
}

/** The attached root has its own device, so it is handed the same canvas. */
function SupplyField({ stamp, live = false }: { stamp: string; live?: boolean }) {
  const canvas = useContext(FieldCtx);
  const root = useGlassRoot();
  useEffect(() => {
    if (canvas && root) root.setBackdropTexture(PLANE.id, { kind: 'canvas', canvas, live });
  }, [canvas, root, stamp, live]);
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
  // What two small controls owe each other: the tab capsule and the waiting capsule, when they share the column.
  const seam = useGlassSamplingGap([{ members: [[560, 36]] }, { members: [[84, 36]] }]);
  const widest = useRef(0);
  const widestSeam = useRef(0);
  // The pose the runtime resolved, published for the CSS shadows: a receded window casts none.
  const active = useGlassWindowActivation();
  useLayoutEffect(() => {
    host?.setAttribute('data-pose', active ?? 'active');
  }, [active, host]);
  useLayoutEffect(() => {
    if (!host) return;
    widest.current = Math.max(widest.current, gap);
    widestSeam.current = Math.max(widestSeam.current, seam);
    host.style.setProperty('--xl-room', `${widest.current}px`);
    // The runtime's derived answer for this pair (24 px) was reported by its own check as too near once the tabs
    // came within 26 px of the capsule, and was clean from 30: the layout spends the answer and a quarter more.
    host.style.setProperty('--xl-seam', `${Math.ceil(widestSeam.current * 1.25)}px`);
  }, [gap, seam, host]);
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
  const [fieldLive, setFieldLive] = useState(false);

  // A colouring settles the field, the tint and the mark together; one that is about its ground also names it.
  const colour = colouringOf(knobs.colour);
  const tokens = colour.tokens[scheme];
  const ground = (colour.ground ?? GROUNDS[knobs.ground ?? 'warm'] ?? GROUNDS.warm!)[scheme];
  const strength = (['whisper', 'soft', 'warm', 'vivid'].includes(knobs.field ?? '') ? knobs.field : 'warm') as Strength;
  const material = (['glass', 'veil', 'opaque'].includes(knobs.blocks ?? '') ? knobs.blocks : 'glass') as Material;
  // The owner refused Figtree as too round (2026-11-14): the system face, which is Quiet's, is the default.
  const face = ['figtree', 'geist', 'system'].includes(knobs.face ?? '') ? knobs.face! : 'system';

  // The five open calls. Three of them are about Paper, which is now a family (Paper and the warmer Papers of §14:
  // every colouring whose field is the still life), and are not consulted under another colouring.
  // Four of the five are answered (DESIGN.md §15), and the answers are what a missing knob now means: the form out
  // of focus where you work, the line in the sans, the column rule, the card that grows from its button.
  const isPaper = !!colour.field[scheme].picture;
  const presence = isPaper && scene !== 'home' ? FORM[knobs.form ?? ''] ?? FORM.recede! : FULL;
  // Open's ground, as the switch's last position: no drawing on any page, New chat included (DESIGN.md §16).
  const plain = isPaper && knobs.form === 'plain';
  const gather = plain ? gatherOf(scheme === 'dark', colour.field[scheme].light) : undefined;
  const line = !isPaper ? undefined : knobs.line === 'serif' ? 'serif' : 'sans';
  // A colouring that brings a pigment for its mark has settled the mark; the Mark switch speaks for the others.
  const own = colour.pin?.[scheme];
  const needs = own ? 'accent' : isPaper && (knobs.mark === 'soft' || knobs.mark === 'accent') ? knobs.mark : undefined;
  const pin = own ? { ring: 'transparent', ...own } : needs === 'accent' ? PIN[scheme] : undefined;
  const align = knobs.align === 'layers' ? undefined : 'column';
  const sideForm: SideForm = knobs.side === 'card' || knobs.side === 'modules' ? knobs.side : 'button';

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
            data-paper={isPaper ? '' : undefined}
            data-ground={plain ? 'plain' : undefined}
            data-mark={colour.mark}
            data-line={line}
            data-needs={needs}
            data-align={align}
            data-sideform={sideForm === 'modules' ? undefined : sideForm}
            style={
              {
                '--xl-ground': ground,
                '--xl-ink-rgb': tokens.ink,
                '--xl-shade-rgb': tokens.shade,
                '--xl-accent': tokens.accent,
                '--xl-on-accent': tokens.onAccent,
                '--xl-accent-mark': tokens.mark,
                '--xl-focus': tokens.focus,
                ...(pin ? { '--xl-pin': pin.disc, '--xl-on-pin': pin.glyph, '--xl-pin-ring': pin.ring } : null),
                ...(gather ? { '--xl-gather-rgb': gather.rgb.join(' '), '--xl-gather-a': Math.min(0.34, gather.a * 1.3).toFixed(3) } : null),
                colorScheme: scheme,
              } as CSSProperties
            }
          >
            <Plane
              field={colour.field[scheme]}
              strength={strength}
              ground={ground}
              plain={plain}
              host={el}
              follow={`${layout}:${sideOpen}:${sideForm}:${align}:${needs}`}
              presence={presence}
              onPaint={onPaint}
              onLive={setFieldLive}
            />
            <LayoutPump layout={layout} />
            <Room host={el} />
            {dev && <Readout name="window" />}

            <Shell
              scene={scene}
              scheme={scheme}
              material={material}
              tint={needs ? undefined : tokens.accent}
              own={align === 'column'}
              sideForm={sideForm}
              layout={layout}
              stamp={`${stamp}`}
              fieldLive={fieldLive}
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
  /** The seed of the page's one tinted piece of glass; none where the mark is a disc on clear glass. */
  tint: string | undefined;
  /** The waiting capsule stands on the reading column's right edge, beside the tabs, as a group of its own. */
  own: boolean;
  sideForm: SideForm;
  layout: string;
  stamp: string;
  fieldLive: boolean;
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

  const capsule = scene !== 'settings' && p.waiting.length > 0 && (
    <Waiting key={p.tint ? 'tinted' : 'clear'} waiting={p.waiting} tint={p.tint} onAnswer={p.setAnswer} open={p.flags.includes('waiting')} alone={scene !== 'session'} />
  );
  // Under the column rule the capsule is the tabs' neighbour on the reading column, not the side column's: it
  // leaves the side group, so the two capsules owe each other a small control's room and not a pane's.
  const apart = p.own && scene === 'session';
  const toggle = () => p.setSideOpen((v) => !v);

  const trail = (
    <>
      {!apart && capsule}
      {scene === 'session' && p.sideForm !== 'button' && (
        <GlassSurface asChild capsule thickness={THICKNESS} foreground="vibrant">
          <div className="xl-host xl-round" data-glass-role="control" role="group" aria-label="Details">
            <GBtn label={p.sideOpen ? 'Hide the side column' : 'Show the side column'} tip={p.sideOpen ? 'Hide details' : 'Show details'} data-tip-at="end" aria-pressed={p.sideOpen} onClick={toggle}>
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
                  <SupplyField stamp={p.stamp} live={p.fieldLive} />
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
          <Modules open={p.sideOpen} form={p.sideForm} onToggle={toggle} />
        </GlassLayer>
      ) : (
        <GlassGroup id="xl-side" backdrop={PLANE}>
          {trail}
        </GlassGroup>
      )}

      {apart && (
        <GlassGroup id="xl-wait" backdrop={PLANE}>
          {capsule}
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
