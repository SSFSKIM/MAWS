// Open: one plain ground, the field as light that gathers under the glass, and the transcript running on the
// ground between two panes and under two floating bars. This file is the shell: where each piece of glass stands,
// what it is told is behind it, and how the layout moves. DESIGN.md records where every part was lifted from; its
// last section is the Colour switch: the ground, the ink, the light's colours and the mark come from a colouring.
import { FileCode, GitBranch, Monitor, PanelLeft, PanelRight, Plus, SlidersHorizontal, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type BackdropHint,
  consoleDiagnosticSink,
  GlassGroup,
  GlassMorph,
  type GlassMorphPlacementResolver,
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverTrigger,
  GlassRoot,
  GlassSurface,
  useGlassBarInset,
  useGlassGroups,
  useGlassRoot,
  useGlassSamplingGap,
  useGlassScrollEdge,
  type VitreaDiagnosticSink,
} from '@vitreajs/vitrea-react';
import { approval, composer, pinned, projects, type Session, tabs } from '../../content/fixtures';
import type { ExperimentProps, SceneId, Scheme } from '../../lab/types';
import { colouringOf } from '../layers/colour';
import { type GatherKind, hexRgb, levelUnder, type Light, lightOf, luminanceOf, paintGather, register, type Shape, type Strength, tripleRgb } from './field';
import { cx, GBtn, isYours, StateGlyph, stateWord } from './parts';
import { type Answer, Ask, ComposerBody, SidePanel, Transcript, Where } from './Session';
import { sectionAt, SettingsPage } from './Settings';
import { type CardApi, Sidebar } from './Sidebar';
import './open.css';

/** The owner's ground candidates, paired as the lab's Ground knob names them. */
const grounds: Record<string, Record<Scheme, string>> = {
  warm: { light: '#faf9f5', dark: '#191919' },
  green: { light: '#faf9f5', dark: '#191c19' },
  lifted: { light: '#ffffff', dark: '#1f1f1f' },
  pure: { light: '#ffffff', dark: '#000000' },
};
const STRENGTHS = ['whisper', 'soft', 'warm', 'vivid'];
const CLEARER = { light: { optics: { regular: { tintAlpha: 0.3 } } }, dark: { optics: { regular: { tintAlpha: 0.7 } } } } as const;
/** The two panes are made over their own light as a texture (Field's path): the lens is real there and the body keeps the hue. */
const LEFT = { kind: 'texture', id: 'xo-left' } as const;
const RIGHT = { kind: 'texture', id: 'xo-right' } as const;
/** On the new-chat page nothing passes under the composer, so it takes the same path over the scene's one pool of light. */
const HOME = { kind: 'texture', id: 'xo-home' } as const;
// Every finding the runtime raises goes to the console, where the lab's capture tool prints it, and onto the window.
const toConsole = consoleDiagnosticSink();
const sink: VitreaDiagnosticSink = (event) => {
  const w = window as unknown as { __xoDiagnostics?: string[] };
  (w.__xoDiagnostics ??= []).push(event.diagnostic.code);
  toConsole(event);
};

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });

// One object per declared level, so a hint keeps its identity until the level under the glass really changes.
const hints = new Map<number, BackdropHint>();
function hintOf(level: number): BackdropHint {
  const l = Math.min(1, Math.max(0, Math.round(level * 100) / 100));
  let hint = hints.get(l);
  if (!hint) hints.set(l, (hint = { tone: l > 0.6 ? 'light' : l < 0.2 ? 'dark' : 'mixed', luminance: l }));
  return hint;
}

/**
 * What is behind each piece of glass, declared, because glass that samples the page cannot read its pixels. The
 * level under a surface is the ground with whatever light is gathered there (read back from the painted
 * gatherings), and, for a bar that floats over the transcript, the blocks passing under it by area: each block
 * states the share of its box that is inked and whether it paints a fill (Instrument's method). A soft scroll edge
 * thins what is under a bar to about half. Re-read on scroll, on resize, when a gathering repaints and through a
 * layout change.
 */
function useLevels(scroller: RefObject<HTMLElement | null>, boxes: Record<string, () => Box | null | undefined>, ground: string, ink: string, keys: readonly unknown[]) {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const groundRgb = useMemo(() => hexRgb(ground), [ground]);
  const inkL = useMemo(() => luminanceOf(tripleRgb(ink)), [ink]);
  useEffect(() => {
    const el = scroller.current;
    let frame = 0;
    const read = () => {
      frame = 0;
      const blocks = el ? [...el.querySelectorAll<HTMLElement>('[data-xo-c]')].map((b) => ({ r: b.getBoundingClientRect(), c: Number(b.dataset.xoC), f: Number(b.dataset.xoF) })) : [];
      const sc = el?.getBoundingClientRect();
      const more = el ? { top: el.scrollTop > 1, bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 1 } : { top: false, bottom: false };
      const next: Record<string, number> = {};
      for (const [id, get] of Object.entries(boxesRef.current)) {
        const bar = get();
        if (!bar || bar.width === 0 || bar.height === 0) continue;
        const base = levelUnder(bar, groundRgb);
        let level = base;
        for (const { r, c, f } of blocks) {
          const w = Math.min(bar.right, r.right) - Math.max(bar.left, r.left);
          const h = Math.min(bar.bottom, r.bottom) - Math.max(bar.top, r.top);
          if (w <= 0 || h <= 0) continue;
          const filled = base + (inkL - base) * 0.06 * f;
          const mean = filled + (inkL - filled) * c;
          level += ((mean - base) * w * h) / (bar.width * bar.height);
        }
        const edge = sc && bar.top < sc.top + sc.height / 2 ? more.top : more.bottom;
        next[id] = base + (level - base) * (edge ? 0.55 : 1);
      }
      (window as unknown as { __xoLevels?: unknown }).__xoLevels = next;
      setLevels((prev) => {
        const same = Object.keys(next).every((k) => Math.round((prev[k] ?? -1) * 100) === Math.round(next[k]! * 100));
        return same && Object.keys(prev).length === Object.keys(next).length ? prev : next;
      });
    };
    const queue = () => {
      frame ||= requestAnimationFrame(read);
    };
    read();
    // A layout change slides the bars for about half a second: read on the way and once it has landed.
    const timers = [setTimeout(read, 180), setTimeout(read, 380), setTimeout(read, 620)];
    el?.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    const sizes = new ResizeObserver(queue);
    if (el) sizes.observe(el);
    if (el?.firstElementChild) sizes.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      el?.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      sizes.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, groundRgb, inkL, ...keys]);
  const groundL = luminanceOf(groundRgb);
  return {
    over: (id: string) => hintOf(levels[id] ?? groundL),
    /** Over rows of text on the plain ground: where a platter opens across the page. */
    rows: hintOf(groundL + (inkL - groundL) * 0.05),
  };
}

/** The size of an element's box, followed as it changes. */
function useSize(el: HTMLElement | null): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

/**
 * One gathering of light: a canvas under one surface, painted once per size, scheme and strength, that travels
 * with that surface because it is placed by the same layout variables. `shape` says where the surface is inside
 * the canvas; when the surface is put away the light goes with it (`away`).
 */
function Gather({ kind, light, dark, strength, shape, shapeKey, reach, away, onPaint, texture, blank }: { kind: GatherKind; light: Light; dark: boolean; strength: Strength; shape: (w: number, h: number) => Shape; shapeKey: string; reach: number; away?: boolean; onPaint: () => void; texture?: { id: string; ground?: string }; blank?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  const textureId = texture?.id;
  const textureGround = texture?.ground;
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      register(c, paintGather(c, kind, light, dark, strength, shapeRef.current(c.clientWidth, c.clientHeight), reach, textureId ? { ground: textureGround, blank } : undefined));
      // A pane's light is also what its glass is made over: the canvas is handed to the runtime in the frame that
      // paints it (Field's way), so the pane bends real pixels and keeps their hue.
      if (textureId) root?.setBackdropTexture(textureId, { kind: 'canvas', canvas: c });
      onPaint();
    };
    draw();
    const ro = new ResizeObserver(() => {
      raf ||= requestAnimationFrame(draw);
    });
    ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      register(c, null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, light.key, dark, strength, reach, shapeKey, onPaint, root, textureId, textureGround, blank]);
  return <canvas ref={ref} className={`xo-gather xo-gather-${kind}`} data-away={away ? 'true' : undefined} aria-hidden="true" />;
}

/**
 * Glass that exists in one state of the layout only (Windows' `TransientGlass`): mounted absent, then
 * materialised; leaving, it dematerialises and is unmounted when the runtime says the exit has landed. Its opacity
 * is never touched.
 */
function Transient({ show, delay = 0, children }: { show: boolean; delay?: number; children: (present: boolean, landed: (p: boolean) => void) => ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (!show) {
      setPresent(false);
      return;
    }
    let a = 0;
    let b = 0;
    const t = setTimeout(() => {
      setMounted(true);
      a = requestAnimationFrame(() => {
        b = requestAnimationFrame(() => setPresent(true));
      });
    }, delay);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [show, delay]);
  if (!mounted) return null;
  return <>{children(present, (p) => !p && setMounted(false))}</>;
}

export default function Open({ scene, scheme, knobs }: ExperimentProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [paneOpen, setPaneOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  // A colouring settles the ground's tone, the ink, what the light is made of and the mark, for both schemes; one
  // that is about its ground also names it, and the Ground knob is then not consulted (Layers' rule and records).
  const colour = colouringOf(knobs.colour);
  const tokens = colour.tokens[scheme];
  const ground = (colour.ground ?? grounds[knobs.ground ?? 'warm'] ?? grounds.warm!)[scheme];
  const strength = (STRENGTHS.includes(knobs.field ?? '') ? knobs.field : 'warm') as Strength;
  const field = colour.field[scheme];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const light = useMemo(() => lightOf(field, tokens, ground, scheme === 'dark'), [field, tokens, ground, scheme]);
  const side = scene === 'session' && sideOpen;
  // The layout makes room before the pane arrives and closes up after it has gone, so the waiting capsule never
  // slides through the pane while it is still glass.
  const [sideLaid, setSideLaid] = useState(side);
  useEffect(() => {
    if (side) {
      setSideLaid(true);
      return;
    }
    const t = setTimeout(() => setSideLaid(false), 300);
    return () => clearTimeout(t);
  }, [side]);
  const laid = side || (scene === 'session' && sideLaid);
  // Which way the right pane is sending the top row, known in the commit that moves it. The control in front
  // leaves a moment before the one behind, so two pieces of glass on one plane never close on each other.
  const travel = useRef<{ side: boolean; drift?: 'left' | 'right' }>({ side: laid });
  if (travel.current.side !== laid) travel.current = { side: laid, drift: laid ? 'left' : 'right' };
  const paneWas = useRef(paneOpen);
  if (paneWas.current !== paneOpen) {
    paneWas.current = paneOpen;
    travel.current = { side: laid };
  }
  return (
    <div
      ref={setEl}
      className="x-open"
      data-scheme={scheme}
      data-scene={scene}
      data-pane={paneOpen ? 'open' : 'closed'}
      data-side={laid ? 'open' : 'closed'}
      data-drift={travel.current.drift}
      data-face={knobs.face ?? 'system'}
      data-colour={colour.id}
      data-mark={colour.mark}
      style={
        {
          '--xo-ground': ground,
          '--xo-ink-rgb': tokens.ink,
          '--xo-shade-rgb': tokens.shade,
          '--xo-accent': tokens.accent,
          '--xo-on-accent': tokens.onAccent,
          '--xo-accent-mark': tokens.mark,
          '--xo-focus': tokens.focus,
          colorScheme: scheme,
        } as CSSProperties
      }
    >
      {el && (
        <GlassRoot renderer={/[?&]tier=css/.test(window.location.hash) ? 'css' : 'webgpu'} colorScheme={scheme} container={el} devMode onDiagnostic={sink} materialProfile={/[?&]clear=1/.test(window.location.hash) ? CLEARER[scheme] : undefined}>
          <Shell scene={scene} scheme={scheme} ground={ground} strength={strength} light={light} ink={tokens.ink} seed={tokens.accent} host={el} paneOpen={paneOpen} setPaneOpen={setPaneOpen} sideOpen={side} sideLaid={laid} setSideOpen={setSideOpen} />
        </GlassRoot>
      )}
    </div>
  );
}

interface ShellProps {
  scene: SceneId;
  scheme: Scheme;
  ground: string;
  strength: Strength;
  /** What the colouring lends: the light's colours, the ink as `r g b`, and the seed of the one tinted control. */
  light: Light;
  ink: string;
  seed: string;
  host: HTMLElement;
  paneOpen: boolean;
  setPaneOpen: (v: boolean) => void;
  sideOpen: boolean;
  /** Whether the layout keeps room for the right pane; it trails the pane on the way out. */
  sideLaid: boolean;
  setSideOpen: (v: boolean) => void;
}

function Shell({ scene, scheme, ground, strength, light, ink, seed, host, paneOpen, setPaneOpen, sideOpen, sideLaid, setSideOpen }: ShellProps) {
  const root = useGlassRoot();
  const dark = scheme === 'dark';
  const [answer, setAnswer] = useState<Answer>(null);
  const [section, setSection] = useState('Engine');
  const [painted, setPainted] = useState(0);
  const onPaint = useCallback(() => setPainted((n) => n + 1), []);

  // Answering the approval is real in the lab: the session goes back to work and its mark leaves the window (Quiet's).
  const live = useCallback(
    (x: Session): Session => {
      if (x.id !== 's2' || answer === null) return x;
      return answer === 'approved' ? { ...x, state: 'running', line: approval.command, age: 'now' } : { ...x, state: 'idle' };
    },
    [answer],
  );
  const sessions = useMemo(() => [...pinned, ...projects.flatMap((p) => p.sessions)].map(live), [live]);
  const waiting = sessions.filter((x) => isYours(x.state));

  const scroll = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLElement>(null);
  const composerBar = useRef<HTMLFormElement>(null);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const [tabsEl, setTabsEl] = useState<HTMLElement | null>(null);
  const [composerEl, setComposerEl] = useState<HTMLElement | null>(null);
  const [waitEl, setWaitEl] = useState<HTMLElement | null>(null);
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null);
  const tabsSize = useSize(tabsEl);
  const composerSize = useSize(composerEl);
  useLayoutEffect(() => {
    if (composerSize.h) host.style.setProperty('--xo-composer-h', `${composerSize.h}px`);
  }, [composerSize.h, host]);

  // ---- The room glass owes glass. The runtime derives it from the blur it draws for surfaces of these sizes; the
  // layout spends it as a variable and never types it (Windows' method). Pane to bar is the large number: it is
  // the air between a pane and the reading column, and the bars stand on that column's edges.
  const air = useGlassSamplingGap([{ members: [[272, 880]] }, { members: [[620, 36]] }]);
  const seam = useGlassSamplingGap([{ members: [[36, 36]] }, { members: [[100, 36]] }]);
  const widest = useRef({ air: 0, seam: 0 });
  useLayoutEffect(() => {
    widest.current = { air: Math.max(widest.current.air, air), seam: Math.max(widest.current.seam, seam) };
    host.style.setProperty('--xo-air', `${widest.current.air}px`);
    host.style.setProperty('--xo-seam', `${widest.current.seam}px`);
    (window as unknown as { __xoGaps?: unknown }).__xoGaps = { air, seam };
  }, [air, seam, host]);

  // ---- The right pane grows out of its button and goes back into it: one surface for the pair's whole life. The
  // open end's box is the pane's own place (8 px from the top and right of the window, as tall as its content).
  // The pane is mounted as its button and opens from it on the next frames, so the first thing it does is arrive.
  const [sideShown, setSideShown] = useState(false);
  useEffect(() => {
    if (!sideOpen) {
      setSideShown(false);
      return;
    }
    const t = setTimeout(() => setSideShown(true), 150);
    return () => clearTimeout(t);
  }, [sideOpen]);
  // With the pane away its light goes out on the page, and then in the texture its button is made over.
  const [sideBlank, setSideBlank] = useState(!sideOpen);
  useEffect(() => {
    if (sideOpen) {
      setSideBlank(false);
      return;
    }
    const t = setTimeout(() => setSideBlank(true), 340);
    return () => clearTimeout(t);
  }, [sideOpen]);
  const [sideH, setSideH] = useState(0);
  const sideHRef = useRef(0);
  const sideW = () => parseFloat(getComputedStyle(host).getPropertyValue('--xo-side-w')) || 288;
  const place = useCallback<GlassMorphPlacementResolver>(
    ({ content, viewport }) => {
      const w = sideW();
      const h = Math.round(Math.min(content.height, viewport.height - 16));
      if (h !== sideHRef.current && h > 0) {
        sideHRef.current = h;
        queueMicrotask(() => setSideH(h));
      }
      return { x: viewport.x + viewport.width - 8 - w, y: viewport.y + 8, width: w, height: h };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host],
  );

  // ---- The card that follows the pointer down the sidebar (Quiet's timing): it waits before it first appears,
  // then moves from row to row without waiting again.
  const [card, setCard] = useState<{ id: string; top: number } | null>(null);
  const [cardShown, setCardShown] = useState(false);
  const timer = useRef(0);
  const cardApi = useMemo<CardApi>(() => {
    const put = (id: string, row: HTMLElement) => {
      const r = row.getBoundingClientRect();
      setCard({ id, top: Math.round(r.top - 12) });
    };
    return {
      enter: (id, row) => {
        window.clearTimeout(timer.current);
        setCardShown((shown) => {
          if (shown) put(id, row);
          else {
            put(id, row);
            timer.current = window.setTimeout(() => setCardShown(true), 420);
          }
          return shown;
        });
      },
      leave: () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCardShown(false), 160);
      },
      hide: () => {
        window.clearTimeout(timer.current);
        setCardShown(false);
      },
    };
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const inCard = card ? sessions.find((x) => x.id === card.id) : undefined;
  // The card never hangs off the bottom of the window.
  const cardH = useSize(cardEl).h;
  const cardTop = card ? Math.max(10, Math.min(card.top, window.innerHeight - cardH - 12)) : 0;

  // ---- What each piece of glass is told is behind it.
  const vw = () => window.innerWidth;
  const { over, rows } = useLevels(
    scroll,
    {
      pane: () => paneEl?.getBoundingClientRect(),
      tabs: () => tabsEl?.getBoundingClientRect(),
      composer: () => composerEl?.getBoundingClientRect(),
      wait: () => waitEl?.getBoundingClientRect(),
      side: () => (sideShown ? box(vw() - 8 - sideW(), 8, sideW(), sideHRef.current || 600) : box(vw() - 48, 12, 36, 36)),
      lead: () => box(76, 12, 36, 36),
    },
    ground,
    ink,
    [painted, paneOpen, sideOpen, sideLaid, sideShown, scene, tabsSize.w, composerSize.h, sideH, paneEl, tabsEl, composerEl, waitEl],
  );

  // Content clears each floating bar by the bar's measured far edge, and thins out under it while it scrolls.
  useGlassBarInset(tabBar, { scrollRef: scroll, edge: 'top', measure: 'far-edge' });
  useGlassBarInset(composerBar, { scrollRef: scroll, edge: 'bottom', measure: 'far-edge' });
  useGlassScrollEdge(scroll, { edges: scene === 'session' ? ['top', 'bottom'] : ['top'], style: 'soft', inset: { top: 20, bottom: 6 } });

  // A pane or a bar that slides keeps its size, which no observer reports: the root re-reads on its own frames
  // for the length of the move (Field's and Instrument's).
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
      if (performance.now() - started > 620) stop();
    });
    return stop;
  }, [root, paneOpen, sideOpen, sideLaid, scene, card?.top, cardShown]);

  // A live session is read from its end.
  useLayoutEffect(() => {
    const s = scroll.current;
    if (!s) return;
    if (scene !== 'session') {
      s.scrollTop = 0;
      return;
    }
    const toEnd = () => {
      s.scrollTop = s.scrollHeight;
    };
    toEnd();
    const t = [setTimeout(toEnd, 60), setTimeout(toEnd, 400)];
    void document.fonts?.ready.then(toEnd);
    return () => t.forEach(clearTimeout);
  }, [scene]);

  // What the runtime resolved for each group, readable from the console; nothing of it is drawn.
  const groups = useGlassGroups();
  useEffect(() => {
    (window as unknown as { __xoGroups?: unknown }).__xoGroups = groups.map(({ id, state }) => ({ id, renderer: state.activeRenderer, sampling: state.samplingBackend, refraction: state.refraction, analysis: state.analysis, health: state.health }));
  }, [groups]);

  const session = scene === 'session';
  return (
    <>
      {/* ---- The light, under everything. ---- */}
      <Gather light={light} kind="left" dark={dark} strength={strength} reach={92} away={!paneOpen} onPaint={onPaint} texture={{ id: 'xo-left', ground }} shapeKey="left" shape={(_w, h) => ({ x: -200, y: -200, w: 480, h: h + 400, r: 20 })} />
      {session && (
        <Gather
          light={light}
          kind="right"
          dark={dark}
          strength={strength}
          reach={96}
          away={!sideOpen}
          onPaint={onPaint}
          texture={{ id: 'xo-right', ground }}
          blank={sideBlank}
          shapeKey={`right:${sideH}`}
          shape={(w) => ({ x: w - 8 - sideW(), y: -200, w: sideW() + 208, h: (sideH || 600) + 208, r: 22 })}
        />
      )}
      {session && (
        <div className="xo-gather-seat xo-gather-seat-composer">
          <Gather light={light} kind="composer" dark={dark} strength={strength} reach={120} onPaint={onPaint} shapeKey={`composer:${composerSize.w}:${composerSize.h}`} shape={(w, h) => ({ x: (w - composerSize.w) / 2, y: h - 16 - composerSize.h, w: composerSize.w, h: composerSize.h + 200, r: 26 })} />
        </div>
      )}
      {scene === 'home' && (
        <div className="xo-gather-seat xo-gather-seat-home">
          <Gather light={light} kind="home" dark={dark} strength={strength} reach={210} onPaint={onPaint} texture={{ id: 'xo-home' }} shapeKey={`home:${composerSize.w}:${composerSize.h}`} shape={(w, h) => ({ x: (w - composerSize.w) / 2, y: h / 2 - 80, w: composerSize.w, h: composerSize.h, r: 26 })} />
        </div>
      )}
      {scene !== 'home' && (
        <div className="xo-gather-seat xo-gather-seat-tabs" style={{ width: tabsSize.w + 180 }}>
          <Gather light={light} kind="tabs" dark={dark} strength={strength} reach={78} onPaint={onPaint} shapeKey={`tabs:${tabsSize.w}`} shape={() => ({ x: 90, y: -160, w: tabsSize.w, h: 208, r: 18 })} />
        </div>
      )}

      {/* ---- What is read: on the ground, edge to edge. ---- */}
      <main className="xo-main">
        <div className="xo-scroll" ref={scroll} tabIndex={-1} onScroll={scene === 'settings' ? (e) => setSection(sectionAt(e.currentTarget)) : undefined}>
          {session && <Transcript />}
          {scene === 'settings' && <SettingsPage hint={rows} />}
        </div>
        {scene === 'home' && (
          <div className="xo-home">
            <p className="xo-home-ask">What needs doing?</p>
            <Where />
          </div>
        )}
      </main>

      <div className="xo-lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      {/* ---- The glass. ---- */}
      {/* The left pane declares nothing about its backdrop, as in Field: the runtime reads the texture, and the canvas
          is little more than the pane's own footprint. */}
      <GlassGroup id="xo-pane" backdrop={LEFT}>
        <GlassSurface asChild radius={20} thickness={8} foreground="vibrant" data-glass-role="window">
          <nav ref={setPaneEl} aria-label={scene === 'settings' ? 'Settings sections' : 'Sessions'} className="xo-host xo-pane" inert={!paneOpen}>
            <Sidebar scene={scene} live={live} section={section} card={cardApi} hint={over('pane')} onCollapse={() => setPaneOpen(false)} />
          </nav>
        </GlassSurface>
      </GlassGroup>

      {/* With the pane away, the button that brings it back is a small piece of glass of its own, beside the lights. */}
      <Transient show={!paneOpen} delay={240}>
        {(present, landed) => (
          <GlassGroup id="xo-lead" hint={over('lead')}>
            <GlassSurface asChild capsule thickness={8} plane="overlay" present={present} onPresentEnd={landed} foreground="vibrant" data-glass-role="control">
              <div className="xo-host xo-lead" data-away={!present} role="group" aria-label="Window">
                <GBtn label="Show the sidebar" onClick={() => setPaneOpen(true)}>
                  <PanelLeft size={17} strokeWidth={1.75} />
                </GBtn>
              </div>
            </GlassSurface>
          </GlassGroup>
        )}
      </Transient>

      {scene !== 'home' && (
        <GlassGroup id="xo-tabs" hint={over('tabs')}>
          <GlassSurface asChild capsule thickness={8} foreground="vibrant" data-glass-role="control">
            <nav
              className="xo-host xo-tabs"
              ref={(n) => {
                tabBar.current = n;
                setTabsEl(n);
              }}
              aria-label="Tabs"
            >
              <Tabs settings={scene === 'settings'} live={live} />
            </nav>
          </GlassSurface>
        </GlassGroup>
      )}

      {/* What waits for you, as the glyphs the sidebar uses (Quiet's capsule), made of glass with the one tint. */}
      {waiting.length > 0 && <Waiting waiting={waiting} onAnswer={setAnswer} slot={setWaitEl} hint={over('wait')} rows={rows} tint={seed} moved={`${paneOpen}:${sideLaid}:${scene}`} />}

      {session && (
        <div className="xo-side-slot">
          <GlassGroup id="xo-side" backdrop={RIGHT} hint={over('side')}>
            <GlassMorph open={sideShown} radius={18} openRadius={22} thickness={8} openThickness={8} placement={place} foreground="vibrant" className="xo-platter xo-side" aria-label="Session overview" data-glass-role={sideShown ? 'window' : 'control'}>
              {({ open }) =>
                open ? (
                  <SidePanel onClose={() => setSideOpen(false)} />
                ) : (
                  <button type="button" className="xo-side-open" aria-label="Show the side pane" onClick={() => setSideOpen(true)}>
                    <PanelRight size={17} strokeWidth={1.75} />
                  </button>
                )
              }
            </GlassMorph>
          </GlassGroup>
        </div>
      )}

      {scene !== 'settings' && (
        <GlassGroup key={scene} id="xo-composer" backdrop={scene === 'home' ? HOME : undefined} hint={over('composer')}>
          <GlassSurface asChild radius={26} thickness={8} foreground="vibrant" data-glass-role="control">
            <form
              className={cx('xo-host xo-composer', scene === 'home' && 'xo-composer-home')}
              ref={(n) => {
                composerBar.current = n;
                setComposerEl(n);
              }}
              aria-label="Message"
              onSubmit={(e) => e.preventDefault()}
            >
              {session ? <ComposerBody key="session" running placeholder={composer.placeholder} queued={composer.queued} hint={rows} /> : <ComposerBody key="home" running={false} fresh hint={rows} />}
            </form>
          </GlassSurface>
        </GlassGroup>
      )}

      {/* The row's card: its second line, where it runs, and, for the row that waits on an approval, the answer. */}
      {card && (
        <GlassGroup id="xo-card" hint={rows}>
          <GlassSurface asChild radius={18} thickness={8} plane="overlay" present={cardShown} foreground="vibrant" data-glass-role="platter">
            <div
              ref={setCardEl}
              className="xo-host xo-platter xo-rowcard"
              data-away={!cardShown}
              style={{ top: cardTop }}
              role="group"
              aria-label={inCard ? `${inCard.title}: ${stateWord[inCard.state] || inCard.line}` : undefined}
              onPointerEnter={() => window.clearTimeout(timer.current)}
              onPointerLeave={cardApi.leave}
            >
              {inCard && (
                <div className="xo-rowcard-in">
                  <div className="xo-card-title">{inCard.title}</div>
                  <div className="xo-card-line">{inCard.line}</div>
                  <div className="xo-card-meta">
                    {inCard.branch && (
                      <span>
                        <GitBranch size={12} strokeWidth={1.75} />
                        {inCard.branch}
                      </span>
                    )}
                    {inCard.machine && (
                      <span>
                        <Monitor size={12} strokeWidth={1.75} />
                        {inCard.machine}
                      </span>
                    )}
                    <span>{inCard.age}</span>
                  </div>
                  {inCard.state === 'approval' && <Ask onAnswer={setAnswer} />}
                </div>
              )}
            </div>
          </GlassSurface>
        </GlassGroup>
      )}
    </>
  );
}

/**
 * What waits for you: one capsule holding a glyph per waiting session; it grows into the list, where the approval
 * is answered in place. The capsule's glass belongs to the popover, which re-reads where its trigger stands when
 * it renders and not while a layout transition carries it, so for the length of a move this component renders on
 * the root's frames.
 */
function Waiting({ waiting, onAnswer, slot, hint, rows, tint, moved }: { waiting: Session[]; onAnswer: (a: Answer) => void; slot: (el: HTMLElement | null) => void; hint: BackdropHint; rows: BackdropHint; tint: string; moved: string }) {
  const root = useGlassRoot();
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!root) return;
    const started = performance.now();
    const stop = root.subscribe(() => {
      setFrame((n) => n + 1);
      if (performance.now() - started > 900) stop();
    });
    return stop;
  }, [root, moved]);
  return (
    <div className="xo-wait-slot" ref={slot} data-frame={frame}>
      <GlassPopover open={open} onOpenChange={setOpen} groupProps={{ id: 'xo-wait', hint: open ? rows : hint, tint: open ? null : tint }}>
        <GlassPopoverTrigger capsule thickness={8} className="xo-platter xo-wait" aria-label={`${waiting.length} sessions are waiting for you`}>
          {waiting.map((x) => (
            <StateGlyph key={x.id} state={x.state} size={15} />
          ))}
        </GlassPopoverTrigger>
        <GlassPopoverContent aria-label="Waiting for you" placement="bottom-end" gap={8} radius={22} thickness={8} className="xo-platter xo-waitlist">
          {waiting.map((x) => (
            <div key={x.id} className="xo-wait-item" data-open={x.state === 'approval'}>
              <div className="xo-wait-head">
                <StateGlyph state={x.state} />
                <div className="xo-wait-text">
                  <div className="xo-card-title">{x.title}</div>
                  <div className="xo-card-line">{x.state === 'approval' ? approval.title : x.line}</div>
                </div>
                <span className="xo-wait-age">{x.age}</span>
              </div>
              {x.state === 'approval' && <Ask onAnswer={onAnswer} />}
            </div>
          ))}
        </GlassPopoverContent>
      </GlassPopover>
    </div>
  );
}

// ---- Tabs: Instrument's capsule (one sheet of glass, fills inside it), with Quiet's glyphs for state and Quiet's
// exchange of the glyph for the close button under the pointer. ------------------------------------------------------

function Tabs({ settings, live }: { settings: boolean; live: (x: Session) => Session }) {
  const all = projects.flatMap((p) => p.sessions);
  const list = settings ? [...tabs, { id: 'settings', title: 'Settings', kind: 'settings' as const }] : tabs;
  const [current, setCurrent] = useState(settings ? 'settings' : tabs.find((t) => t.active)?.id ?? tabs[0]!.id);
  return (
    <>
      {list.map((t) => {
        const found = all.find((x) => x.id === t.id);
        const state = found ? live(found).state : undefined;
        return (
          <button key={t.id} type="button" className="xo-tab" aria-current={t.id === current ? 'page' : undefined} title={state ? stateWord[state] : undefined} onClick={() => setCurrent(t.id)}>
            <span className="xo-tab-slot">
              <span className="xo-slot-state">{t.kind === 'file' ? <FileCode size={14} strokeWidth={1.75} /> : t.kind === 'settings' ? <SlidersHorizontal size={14} strokeWidth={1.75} /> : state ? <StateGlyph state={state} size={14} /> : null}</span>
              <span className="xo-tab-x" aria-hidden="true">
                <X size={13} strokeWidth={2} />
              </span>
            </span>
            <span className="xo-tab-title">{t.title}</span>
          </button>
        );
      })}
      <GBtn label="New tab" tip="New tab">
        <Plus size={16} strokeWidth={1.75} />
      </GBtn>
    </>
  );
}
