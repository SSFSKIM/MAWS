import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { consoleDiagnosticSink, GlassRoot, useGlassGroups, useGlassPress, useGlassRoot, type BackdropHint, type VitreaDiagnosticSink } from '@vitreajs/vitrea-react';
import { FileCode, PanelLeft, PanelRight, Plus, SlidersHorizontal, X } from 'lucide-react';
import { approval, projects, tabs, type Session } from '../../content/fixtures';
import type { ExperimentProps, SceneId, Scheme } from '../../lab/types';
import { Gaps, Glass, LayoutPump, ShellProvider, type ShellValue } from './glass';
import { StateGlyph, isYours, stateWord } from './glyphs';
import { Pop, RootCtx } from './overlay';
import { paintField, sampleField, type Gather, type Sampler, type Strength } from './paint';
import { Sidebar } from './Sidebar';
import { Ask, AsideBody, ComposerBody, Transcript, type Answer } from './Session';
import { SettingsPage } from './Settings';
import './sheet.css';

/** The owner's ground candidates, as the colour of the sheet. A chip names a light and a dark value. */
const GROUNDS: Record<string, Record<Scheme, string>> = {
  a: { light: '#ffffff', dark: '#191919' },
  b: { light: '#faf9f5', dark: '#191c19' },
  c: { light: '#ffffff', dark: '#1f1f1f' },
  d: { light: '#faf9f5', dark: '#000000' },
};

// The fixed geometry the layout is computed from; the same numbers are tokens in sheet.css.
const GAP = 8; // the panes' margin from the window edge (Field's)
const PANE = 272;
const SIDE = 296;
const FRAME: Record<string, number> = { hairline: 8, band: 16, frame: 28 };

// Every finding goes to the console, where the lab's capture tool prints it, and onto the window for a check.
const toConsole = consoleDiagnosticSink();
const sink: VitreaDiagnosticSink = (event) => {
  const w = window as unknown as { __xsDiagnostics?: string[] };
  (w.__xsDiagnostics ??= []).push(event.diagnostic.code);
  toConsole(event);
};

function relLuminance(hex: string, ink: string, share: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const mix = (i: number) => ch(hex, i) * (1 - share) + ch(ink, i) * share;
  return 0.2126 * lin(mix(0)) + 0.7152 * lin(mix(1)) + 0.0722 * lin(mix(2));
}

/**
 * The field: painted for the size, the scheme and the strength, and handed to the glass as its backdrop texture.
 * One of its masses follows the composer, so a change of layout repaints it along the way and the colour arrives
 * with the glass it stands under.
 */
function Plane({ dark, strength, gather, onPaint }: { dark: boolean; strength: Strength; gather: Gather; onPaint: (s: Sampler) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  const now = useRef<Gather | null>(null);
  const handed = useRef(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = now.current ?? gather;
    const started = performance.now();
    const settle = () => {
      if (!handed.current && c.width > 0) {
        root?.setBackdropTexture('xs-field', { kind: 'canvas', canvas: c });
        handed.current = true;
      }
      onPaint(sampleField(c));
    };
    const same = Math.abs(from.x - gather.x) + Math.abs(from.y - gather.y) + Math.abs(from.k - gather.k) < 0.002;
    const frame = (t: number) => {
      const p = same || reduce ? 1 : Math.min(1, (t - started) / 520);
      const e = 1 - (1 - p) ** 3.2;
      const g = { x: from.x + (gather.x - from.x) * e, y: from.y + (gather.y - from.y) * e, k: from.k + (gather.k - from.k) * e };
      now.current = g;
      paintField(c, dark, strength, g);
      if (p < 1) raf = requestAnimationFrame(frame);
      else settle();
    };
    frame(started);
    const resize = () => {
      paintField(c, dark, strength, now.current ?? gather);
      settle();
    };
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [dark, strength, gather, root, onPaint]);
  // A new root holds no texture: hand the canvas over again after a rebuild.
  useEffect(() => {
    handed.current = false;
  }, [root]);
  return <canvas ref={ref} className="xs-plane" aria-hidden="true" />;
}

/** What the runtime resolved for each group, readable from the console (`__xsGroups`); nothing of it is drawn. */
function Readout() {
  const groups = useGlassGroups();
  useEffect(() => {
    (window as unknown as { __xsGroups?: unknown }).__xsGroups = groups.map(({ id, state }) => ({
      id,
      renderer: state.activeRenderer,
      sampling: state.samplingBackend,
      refraction: state.refraction,
      analysis: state.analysis,
      health: state.health,
      cssBody: state.cssBody,
    }));
  }, [groups]);
  return null;
}

/** A tab is a fill inside the capsule, and a press on it presses the glass it sits on (Instrument's). */
function Tab({ current, onSelect, glyph, title, word }: { current: boolean; onSelect: () => void; glyph: React.ReactNode; title: string; word?: string }) {
  const press = useGlassPress();
  return (
    <div className="xs-tab" role="tab" aria-selected={current} tabIndex={0} title={word} onClick={onSelect} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()} {...press}>
      <span className="xs-slot">
        <span className="xs-slot-state">{glyph}</span>
        <button className="xs-slot-act" aria-label={`Close ${title}`} tabIndex={-1}>
          <X size={13} strokeWidth={2} />
        </button>
      </span>
      <span className="xs-tab-title">{title}</span>
    </div>
  );
}

function Tabs({ settings, live }: { settings: boolean; live: (x: Session) => Session }) {
  const all = projects.flatMap((p) => p.sessions);
  const [picked, setPicked] = useState(tabs.find((t) => 'active' in t && t.active)?.id ?? tabs[0]!.id);
  const current = settings ? 'settings' : picked;
  const press = useGlassPress();
  return (
    <div className="xs-tablist" role="tablist">
      {tabs.map((tab) => {
        const session = all.find((x) => x.id === tab.id);
        const state = session ? live(session).state : undefined;
        return (
          <Tab
            key={tab.id}
            current={tab.id === current}
            onSelect={() => setPicked(tab.id)}
            title={tab.title}
            word={state ? stateWord[state] : undefined}
            glyph={tab.kind === 'file' ? <FileCode size={14} strokeWidth={1.75} /> : state ? <StateGlyph state={state} size={14} /> : null}
          />
        );
      })}
      {settings && <Tab current onSelect={() => undefined} title="Settings" glyph={<SlidersHorizontal size={14} strokeWidth={1.75} />} />}
      <button type="button" className="xs-gbtn" aria-label="New tab" data-tip="New tab" {...press}>
        <Plus size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** What waits for you, as the same glyphs the sidebar uses. It opens the list, with the approval answerable in place. */
function Waiting({ waiting, onAnswer, away, startOpen }: { waiting: Session[]; onAnswer: (a: Answer) => void; away: boolean; startOpen: boolean }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(startOpen);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Glass
        id="xs-waiting"
        tag="button"
        type="button"
        glassRole="control"
        className="xs-waiting"
        capsule
        plane="overlay"
        interactive
        tint="rgb(253 120 15 / 30%)"
        hostRef={setEl}
        data-away={away}
        inert={away}
        aria-expanded={open}
        aria-label={`${waiting.length} sessions are waiting for you`}
        onClick={() => setOpen((v) => !v)}
      >
        {waiting.map((x) => (
          <StateGlyph key={x.id} state={x.state} size={15} />
        ))}
      </Glass>
      <Pop open={open && !away} anchor={el} place="below-end" onClose={close} className="xs-wait-list">
        {waiting.map((x) => (
          <div key={x.id} className="xs-wait-item" data-open={x.state === 'approval'}>
            <div className="xs-wait-head">
              <StateGlyph state={x.state} />
              <div className="xs-wait-text">
                <div className="xs-card-title">{x.title}</div>
                <div className="xs-card-line">{x.state === 'approval' ? approval.title : x.line}</div>
              </div>
              <span className="xs-wait-age">{x.age}</span>
            </div>
            {x.state === 'approval' && <Ask onAnswer={onAnswer} />}
          </div>
        ))}
      </Pop>
    </>
  );
}

/** Move between the lab's scenes from inside the window, keeping the scheme and the knobs. */
function go(scene: SceneId) {
  const h = window.location.hash;
  window.location.hash = /^#\/sheet\/[a-z]+/.test(h) ? h.replace(/^#\/sheet\/[a-z]+/, `#/sheet/${scene}`) : `#/sheet/${scene}`;
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return size;
}

export default function Sheet({ scene, scheme, knobs }: ExperimentProps) {
  const dark = scheme === 'dark';
  // Capture aids read from the address (`x=tools,top,nopane,noside,waiting,css`); never a design state.
  const flags = useMemo(() => (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('x') ?? '').split(',').filter(Boolean), [scene, scheme, knobs]);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const { w, h } = useViewport();
  const [paneOpen, setPaneOpen] = useState(() => !flags.includes('nopane'));
  const [sideWanted, setSideWanted] = useState(() => !flags.includes('noside'));
  const [answer, setAnswer] = useState<Answer>(null);
  const [section, setSection] = useState('Engine');
  const [composerH, setComposerH] = useState(130);
  const [sampler, setSampler] = useState<Sampler | null>(null);
  const onPaint = useCallback((s: Sampler) => setSampler(() => s), []);

  // Answering the approval is real in the lab: the session goes back to work and its orange leaves the window.
  const live = useCallback(
    (x: Session): Session => {
      if (x.id !== 's2' || answer === null) return x;
      return answer === 'approved' ? { ...x, state: 'running', line: approval.command, age: 'now' } : { ...x, state: 'idle' };
    },
    [answer],
  );
  const waiting = projects.flatMap((p) => p.sessions).map(live).filter((x) => isYours(x.state));

  // Layout, in the window's own pixels. The centre column is what the two panes leave; the sheet, the tab capsule
  // and the composer all stand in it. Under 1100 px the right pane leaves, under 860 px the left one too.
  const frame = FRAME[knobs.frame ?? 'hairline'] ?? 8;
  const paneShown = paneOpen && w >= 860;
  const sideShown = scene === 'session' && sideWanted && w >= 1100;
  const cl = paneShown ? GAP + PANE + frame : frame;
  const cr = sideShown ? GAP + SIDE + frame : frame;
  const composerShown = scene !== 'settings';

  // Where the field gathers: under the composer, wherever the scene puts it; nowhere when there is none.
  const gather = useMemo<Gather>(() => {
    const x = (cl + (w - cr)) / 2 / w;
    if (scene === 'home') return { x, y: (h * 0.54 + 52) / h, k: 1.06 };
    if (scene === 'settings') return { x, y: 1.04, k: 0 };
    return { x, y: (h - GAP - composerH * 0.35) / h, k: 1 };
  }, [scene, cl, cr, w, h, composerH]);

  const layout = `${scene}:${paneShown ? 1 : 0}:${sideShown ? 1 : 0}:${frame}:${composerH}:${waiting.length}`;
  const shell = useMemo<ShellValue>(() => ({ sampler, layout }), [sampler, layout]);

  const ground = (GROUNDS[knobs.ground ?? 'a'] ?? GROUNDS.a!)[scheme];
  // What a platter that opens over the settings rows has behind it: the sheet with a little ink on it.
  const overRows = useMemo<BackdropHint>(() => {
    const l = Math.round(relLuminance(ground, dark ? '#f4f2ed' : '#1b1a17', 0.05) * 100) / 100;
    return { tone: l > 0.6 ? 'light' : l < 0.2 ? 'dark' : 'mixed', luminance: l };
  }, [ground, dark]);

  const composerRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const ro = new ResizeObserver(() => setComposerH(Math.round(node.getBoundingClientRect().height)));
    ro.observe(node);
  }, []);

  const style = {
    '--xs-ground': ground,
    '--xs-frame': `${frame}px`,
    '--xs-cl': `${cl}px`,
    '--xs-cr': `${cr}px`,
    '--xs-ch': `${composerH}px`,
    colorScheme: scheme,
  } as CSSProperties;

  return (
    <RootCtx.Provider value={el}>
      <div
        ref={setEl}
        className="x-sheet"
        style={style}
        data-scheme={scheme}
        data-scene={scene}
        data-pane={paneShown ? 'open' : 'closed'}
        data-side={sideShown ? 'open' : 'closed'}
        data-type={knobs.type ?? 'system'}
        data-x={flags.join(' ')}
      >
        {el && (
          <GlassRoot renderer={flags.includes('css') ? 'css' : 'webgpu'} colorScheme={scheme} container={el} devMode onDiagnostic={sink}>
            <ShellProvider value={shell}>
              <Plane dark={dark} strength={(knobs.field as Strength) ?? 'warm'} gather={gather} onPaint={onPaint} />
              <LayoutPump />
              <Gaps />
              <Readout />

              {/* The reading surface. Opaque, and the only thing on the field that is not glass. */}
              <main className="xs-sheet" inert={scene === 'home'}>
                {scene === 'session' && (
                  <div className="xs-scene" key="session">
                    <Transcript flags={flags} />
                  </div>
                )}
                {scene === 'settings' && (
                  <div className="xs-scene" key="settings">
                    <SettingsPage onSection={setSection} hint={overRows} />
                  </div>
                )}
              </main>

              {/* New chat has nothing to read, so it has no sheet: one line on the field and the glass to write in. */}
              <p className="xs-question" aria-hidden={scene !== 'home'}>
                What needs doing?
              </p>

              <Glass id="xs-pane" tag="nav" glassRole="window" className="xs-pane" radius={20} aria-label="Sidebar" inert={!paneShown}>
                <Sidebar scene={scene} live={live} onAnswer={setAnswer} section={section} go={go} />
              </Glass>

              <Glass id="xs-side" tag="aside" glassRole="window" className="xs-side" radius={20} aria-label="Session details" inert={!sideShown}>
                <AsideBody />
              </Glass>

              {/* The pane toggles ride on their panes as plain buttons, and become glass of their own when the pane is away. */}
              <Glass
                id="xs-lead"
                tag="button"
                type="button"
                glassRole="control"
                className="xs-toggle xs-toggle-pane"
                capsule
                plane="overlay"
                interactive
                present={!paneShown}
                aria-label={paneShown ? 'Hide the sidebar' : 'Show the sidebar'}
                aria-pressed={paneShown}
                data-tip={paneShown ? 'Hide sidebar' : 'Show sidebar'}
                data-tip-at="start"
                onClick={() => setPaneOpen((v) => !v)}
              >
                <i className="xs-toggle-fill" />
                <PanelLeft size={17} strokeWidth={1.75} />
              </Glass>
              <Glass
                id="xs-side-toggle"
                tag="button"
                type="button"
                glassRole="control"
                className="xs-toggle xs-toggle-side"
                capsule
                plane="overlay"
                interactive
                present={scene === 'session'}
                data-away={scene !== 'session'}
                inert={scene !== 'session'}
                aria-label={sideShown ? 'Hide the side column' : 'Show the side column'}
                aria-pressed={sideShown}
                data-tip={sideShown ? 'Hide details' : 'Show details'}
                data-tip-at="end"
                onClick={() => setSideWanted((v) => !v)}
              >
                <i className="xs-toggle-fill" />
                <PanelRight size={17} strokeWidth={1.75} />
              </Glass>

              <Glass id="xs-tabs" tag="nav" glassRole="control" className="xs-tabs" capsule plane="overlay" aria-label="Tabs" data-away={scene === 'home'} inert={scene === 'home'}>
                <Tabs settings={scene === 'settings'} live={live} />
              </Glass>

              {waiting.length > 0 && <Waiting waiting={waiting} onAnswer={setAnswer} away={scene === 'settings'} startOpen={flags.includes('waiting')} />}

              <Glass
                id="xs-composer"
                tag="form"
                glassRole="control"
                className="xs-composer"
                radius={26}
                plane="overlay"
                hostRef={composerRef}
                aria-label="Message"
                data-away={!composerShown}
                inert={!composerShown}
                onSubmit={(e) => e.preventDefault()}
              >
                <ComposerBody fresh={scene === 'home'} />
              </Glass>

              <div className="xs-lights" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </ShellProvider>
          </GlassRoot>
        )}
      </div>
    </RootCtx.Provider>
  );
}
