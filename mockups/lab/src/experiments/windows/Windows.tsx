import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlassRoot, useGlassCapabilities, useGlassRoot, useGlassSamplingGap, useGlassWindowActivation } from '@vitreajs/vitrea-react';
import type { ExperimentProps } from '../../lab/types';
import { paintEnv, sampleEnv, type EnvScene } from './env';
import { ENV, ShellProvider, THICKNESS, type Sampler, type ShellValue } from './shell';
import { Sidebar } from './Sidebar';
import { Session } from './Session';
import { Settings } from './Settings';
import { Home } from './Home';
import './windows.css';

const GROUNDS: Record<string, { dark: string; light: string }> = {
  a: { dark: '#191919', light: '#faf9f5' },
  b: { dark: '#191c19', light: '#faf9f5' },
  c: { dark: '#000000', light: '#ffffff' },
  d: { dark: '#1f1f1f', light: '#ffffff' },
};

function addressFlags(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

/** The environment canvas: painted at its own box, handed to the root as the texture every group samples. */
function Environment(props: { scene: EnvScene; dark: boolean; ground: string; probe: boolean; onPaint: (s: Sampler) => void }) {
  const { scene, dark, ground, probe, onPaint } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      paintEnv(c, { scene, dark, ground, probe });
      root?.setBackdropTexture(ENV.id, { kind: 'canvas', canvas: c });
      onPaint(sampleEnv(c));
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [scene, dark, ground, probe, root, onPaint]);
  return <canvas ref={ref} className="x-windows-env" aria-hidden="true" />;
}

/**
 * A window that slides moves its host without always resizing it, which no observer sees, so while a layout
 * transition runs the root is asked to re-measure on its own frames (never a second animation loop).
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
      if (performance.now() - started > 640 && off) {
        off();
        off = null;
      }
    });
    return () => off?.();
  }, [root, layout]);
  return null;
}

/**
 * The room two neighbouring groups owe each other is the runtime's to derive, from the blur the material draws
 * for surfaces of this size under the resolved accessibility policy; the layout reads it as a variable and never
 * types it. One number serves window to window and window to ornament, taken for the largest window.
 */
function Gaps({ log, tight }: { log: boolean; tight: boolean }) {
  const mark = useRef<HTMLSpanElement>(null);
  // The pose the runtime resolved, published for the one rule that authors ink (the tinted approval).
  const pose = useGlassWindowActivation();
  useEffect(() => {
    mark.current?.closest<HTMLElement>('.x-windows')?.setAttribute('data-pose', pose ?? 'active');
  }, [pose]);
  const windows = useGlassSamplingGap([{ members: [[880, 880]] }, { members: [[280, 880]] }]);
  const ornaments = useGlassSamplingGap([{ members: [[620, 44]] }, { members: [[44, 44]] }]);
  // What drew, read back for the record when the address asks (`dev=1`).
  const drew = useGlassCapabilities('x-windows-sidebar');
  const drewLine = drew ? `${drew.activeRenderer} · refraction ${drew.refraction} · analysis ${drew.analysis} · cssBody ${drew.cssBody ?? 'n/a'} · ${drew.health}` : '';
  useEffect(() => {
    if (log && drewLine) console.warn(`[windows] drew: ${drewLine}`);
  }, [log, drewLine]);
  // A preference may open the room and never close it: forced colours drops the derived padding to its floor,
  // and a layout that Reduce Transparency opened must not snap shut, so the largest value seen is kept.
  const widest = useRef({ windows: 0, ornaments: 0 });
  useLayoutEffect(() => {
    const host = mark.current?.closest<HTMLElement>('.x-windows');
    if (!host) return;
    widest.current = { windows: Math.max(widest.current.windows, windows), ornaments: Math.max(widest.current.ornaments, ornaments) };
    // Tight is the knob's other position: the gaps a designer would draw by eye, under the derived room. The
    // runtime reports each such pair (group-proxy-overlap), and DESIGN.md records it as the rule that position breaks.
    host.style.setProperty('--x-g', `${tight ? 16 : widest.current.windows}px`);
    host.style.setProperty('--x-og', `${tight ? 12 : widest.current.ornaments}px`);
    if (log) console.warn(`[windows] derived gaps: windows ${windows}px, ornaments ${ornaments}px`);
  }, [windows, ornaments, log, tight]);
  return <span ref={mark} hidden />;
}

export default function Windows({ scene, scheme, knobs }: ExperimentProps) {
  const dark = scheme === 'dark';
  const flags = useMemo(addressFlags, [scene, scheme, knobs]);
  const x = flags.get('x') ?? '';
  const [sidebar, setSidebar] = useState(() => !x.includes('nosidebar'));
  const [side, setSide] = useState(() => !x.includes('noside'));
  const [sampler, setSampler] = useState<Sampler | null>(null);
  const onPaint = useCallback((s: Sampler) => setSampler(() => s), []);

  const ground = (GROUNDS[knobs.ground ?? 'a'] ?? GROUNDS.a!)[dark ? 'dark' : 'light'];
  const env = (['sun', 'dunes', 'orbit'].includes(knobs.env ?? '') ? knobs.env : 'sun') as EnvScene;
  const reading = knobs.reading ?? 'glass';
  const sideShown = scene === 'session' && side;
  const layout = `${scene}:${sidebar ? 1 : 0}:${sideShown ? 1 : 0}:${knobs.gaps ?? ''}`;
  const thickness = Number(flags.get('thick')) || THICKNESS;

  const shell = useMemo<ShellValue>(
    () => ({
      dark,
      thickness,
      sampler,
      layout,
      sidebar,
      side: sideShown,
      setSidebar,
      setSide,
      flag: (name) => x.split(',').includes(name),
    }),
    [dark, thickness, sampler, layout, sidebar, sideShown, x],
  );

  // Capture and review aids, off unless the address asks: the receded pose, the CSS tier, Reduce Transparency,
  // and the runtime's dev-mode checks (a production build turns those off by default).
  const pose = flags.get('pose') === 'inactive' ? 'inactive' : flags.get('pose') === 'active' ? 'active' : 'auto';
  const tier = flags.get('tier') === 'css' ? 'css' : 'webgpu';

  return (
    <GlassRoot
      asChild
      renderer={tier}
      colorScheme={scheme}
      windowActivation={pose}
      reducedTransparency={flags.get('rt') === '1' ? true : 'system'}
      devMode={flags.has('dev')}
    >
      <div
        className="x-windows"
        data-scheme={scheme}
        data-scene={scene}
        data-sb={sidebar ? 'open' : 'closed'}
        data-side={sideShown ? 'open' : 'closed'}
        data-reading={reading}
        style={{ colorScheme: scheme }}
      >
        <ShellProvider value={shell}>
          <Environment scene={env} dark={dark} ground={ground} probe={flags.has('probe')} onPaint={onPaint} />
          <LayoutPump layout={layout} />
          <Gaps log={flags.has('dev')} tight={knobs.gaps === 'tight'} />
          <div className="x-windows-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <Sidebar scene={scene} />
          {scene === 'session' && <Session />}
          {scene === 'settings' && <Settings />}
          {scene === 'home' && <Home />}
        </ShellProvider>
      </div>
    </GlassRoot>
  );
}
