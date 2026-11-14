import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  GlassGroup,
  GlassRoot,
  GlassSurface,
  type GlassRootProps,
  useGlassAccessibility,
  useGlassRoot,
  useGlassTicker,
} from '@vitreajs/vitrea-react';
import { PanelLeft } from 'lucide-react';
import type { SessionState } from '../../content/fixtures';
import type { ExperimentProps } from '../../lab/types';
import { FieldPainter, type FieldPalette } from './field';
import { ApprovalPop, SessionScene, Tabs } from './Session';
import { SettingsScene } from './Settings';
import { SidebarContent, type Peek } from './Sidebar';
import { Ctx, ORDER, type SignalCtx } from './store';
import './signal.css';

const GROUND: Record<string, { light: string; dark: string }> = {
  paper: { light: '#faf9f5', dark: '#191919' },
  pure: { light: '#ffffff', dark: '#000000' },
  moss: { light: '#faf9f5', dark: '#191c19' },
  lift: { light: '#ffffff', dark: '#1f1f1f' },
};
// The one place the material is tuned, and why. A pane as wide as a sidebar is the most occluding body the material
// draws, so the default glass turns the field into a faint wash. Two leaves change: the body's own tint drops to the
// value of the system's clearer glass setting (the 0.25 document: 0.30 light, 0.70 dark, against 0.46 and 0.90), and
// the share of the backdrop's chroma the body keeps rises into the band measured on Apple's own material (0.71 to
// 0.83 light, 0.90 to 0.97 dark), which the library ships lower and names as an open gap.
const TUNE: Record<'light' | 'dark', NonNullable<GlassRootProps['materialProfile']>> = {
  light: { bodyChromaRetention: 0.83, optics: { regular: { tintAlpha: 0.3 } } },
  dark: { bodyChromaRetention: 0.95, optics: { regular: { tintAlpha: 0.7 } } },
};
// With no glass nothing thins the field, so it is painted weaker. On dark the limit is the text: white on a pool
// stronger than about a third of the full orange falls under 4.5:1, so the bare dark field stops there at Vivid.
const BARE_GAIN = { light: 0.5, dark: 0.25 } as const;
const GAIN: Record<string, number> = { soft: 0.45, full: 1, vivid: 1.38 };

function palette(dark: boolean, ground: string, glass: boolean): FieldPalette {
  const p: FieldPalette = dark
    ? { ground, need: [253, 120, 15], core: [255, 150, 44], live: [48, 136, 255], needA: 1, coreA: 0.9, liveA: 1.25, emberA: 0.6, spill: 0.45, floor: ground === '#000000' ? 0.035 : 0 }
    : { ground, need: [255, 146, 0], core: [252, 118, 0], live: [20, 150, 232], needA: 1.35, coreA: 1.2, liveA: 1.3, emberA: 0.8, spill: 0.24, floor: 0 };
  // With no glass over it nothing thins the field, so nothing needs holding back at the pane's edge.
  return glass ? p : { ...p, spill: 1, floor: 0 };
}

/** A capture can ask for a pose or a tier in the address; these are not knobs. */
function debugParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get(name);
}

function Field({ dark, ground, gain, glass, scope, kickRef }: { dark: boolean; ground: string; gain: number; glass: boolean; scope: RefObject<HTMLDivElement | null>; kickRef: RefObject<() => void> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  const ticker = useGlassTicker();
  const still = useGlassAccessibility()?.reducedMotion ?? false;
  const now = { pal: palette(dark, ground, glass), gain: gain * (glass ? 1 : BARE_GAIN[dark ? 'dark' : 'light']), still };
  const live = useRef(now);
  live.current = now;
  const painter = useRef<FieldPainter | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = scope.current;
    if (!canvas || !host) return;
    const p = new FieldPainter(canvas, host);
    painter.current = p;
    kickRef.current = () => {
      p.kick(70);
      ticker.requestFrame();
    };
    let supplied = false;
    const off = ticker.subscribe((dt, t) => {
      const more = p.frame(dt, t, live.current.pal, live.current.gain, live.current.still);
      if (!supplied && root) {
        // Supplied in the frame that first paints it: a canvas handed over empty logs on every frame until it has pixels.
        root.setBackdropTexture('signal-field', { kind: 'canvas', canvas });
        supplied = true;
      }
      return more ? undefined : false;
    });
    const wake = () => {
      p.kick(3);
      ticker.requestFrame();
    };
    const ro = new ResizeObserver(wake);
    ro.observe(canvas);
    host.querySelectorAll('.pane').forEach((el) => ro.observe(el));
    window.addEventListener('resize', wake);
    return () => {
      off();
      ro.disconnect();
      window.removeEventListener('resize', wake);
    };
  }, [root, ticker, scope, kickRef]);

  // A knob or a state changed: the field has work again.
  useEffect(() => {
    painter.current?.kick(3);
    ticker.requestFrame();
  });

  return <canvas ref={ref} className="field" aria-hidden />;
}

export default function Signal({ scene, scheme, knobs }: ExperimentProps) {
  const dark = scheme === 'dark';
  const ground = (GROUND[knobs.ground ?? 'paper'] ?? GROUND.paper!)[scheme];
  const gain = GAIN[knobs.field ?? 'full'] ?? 1;
  const glass = knobs.lens !== 'bare';
  const scope = useRef<HTMLDivElement>(null);
  const [states, setStates] = useState<Record<string, SessionState>>({});
  const [collapsed, setCollapsedRaw] = useState(false);
  const [asking, setAsking] = useState<{ id: string; top: number } | null>(null);
  const [asideOpen, setAsideOpen] = useState(true);
  const [peek, setPeek] = useState<Peek | null>(null);
  const lastPeek = useRef<Peek | null>(null);
  if (peek) lastPeek.current = peek;

  const kickRef = useRef<() => void>(() => {});
  const kick = useCallback(() => kickRef.current(), []);
  const ctx = useMemo<SignalCtx>(
    () => ({
      stateOf: (id, fallback) => states[id] ?? fallback,
      setState: (id, state) => setStates((m) => ({ ...m, [id]: state })),
      cycle: (id, from) => setStates((m) => ({ ...m, [id]: ORDER[(ORDER.indexOf(from) + 1) % ORDER.length]! })),
      kick,
      collapsed,
      setCollapsed: (v) => {
        kick();
        setCollapsedRaw(v);
      },
    }),
    [states, collapsed, kick],
  );

  const pose = debugParam('pose');
  const sidebar = (
    <section className="pane" aria-label="Sidebar" data-glass-role="control">
      <SidebarContent
        openId={asking?.id ?? null}
        onPeek={setPeek}
        onOpen={(id, el) => {
          // Only a waiting approval has something to open here; the other rows would switch the session on screen.
          if (el.dataset.state !== 'approval') return setAsking(null);
          setAsking((v) => (v?.id === id ? null : { id, top: el.getBoundingClientRect().top }));
        }}
      />
    </section>
  );

  return (
    <Ctx.Provider value={ctx}>
      <GlassRoot
        asChild
        renderer={debugParam('tier') === 'css' ? 'css' : 'webgpu'}
        colorScheme={scheme}
        materialProfile={TUNE[scheme]}
        windowActivation={pose === 'active' || pose === 'inactive' ? pose : 'auto'}
        reducedTransparency={debugParam('rt') === '1' ? true : 'system'}
        devMode={debugParam('dev') === '1' ? true : undefined}
        zIndex={2}
      >
        <div
          ref={scope}
          className="x-signal"
          data-scheme={scheme}
          data-scene={scene}
          data-words={knobs.words ?? 'hover'}
          data-collapsed={collapsed}
          style={{ ['--ground' as string]: ground, colorScheme: scheme }}
        >
          <Field dark={dark} ground={ground} gain={gain} glass={glass} scope={scope} kickRef={kickRef} />
          {glass ? (
            <GlassGroup id="signal-pane" backdrop={{ kind: 'texture', id: 'signal-field' }}>
              <GlassSurface asChild radius={18} thickness={8} foreground="token">
                {sidebar}
              </GlassSurface>
            </GlassGroup>
          ) : (
            sidebar
          )}
          <div className="lights" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <button
            type="button"
            className="toggle"
            aria-label={collapsed ? 'Show the sidebar' : 'Hide the sidebar'}
            aria-pressed={!collapsed}
            onClick={() => ctx.setCollapsed(!collapsed)}
          >
            <PanelLeft size={16} strokeWidth={1.9} aria-hidden />
          </button>
          <main className="work">
            <Tabs scene={scene === 'settings' ? 'settings' : 'session'} asideOpen={asideOpen} onAside={() => setAsideOpen((v) => !v)} />
            {scene === 'settings' ? <SettingsScene /> : <SessionScene asideOpen={asideOpen} />}
          </main>
          <ApprovalPop anchor={asking} onClose={() => setAsking(null)} />
          {/* On the rail a row has no room for its words, so they come out beside it. */}
          <div className="tip" data-open={collapsed && !!peek && !asking} style={{ top: (lastPeek.current?.top ?? 0) + 1 }} aria-hidden>
            <b>{lastPeek.current?.title}</b>
            <span>{lastPeek.current?.line}</span>
            <i>{lastPeek.current?.age}</i>
          </div>
        </div>
      </GlassRoot>
    </Ctx.Provider>
  );
}
