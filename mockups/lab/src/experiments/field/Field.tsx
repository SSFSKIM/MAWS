import { useCallback, useEffect, useRef, useState, type ReactNode, type TransitionEvent } from 'react';
import { GlassGroup, GlassRoot, GlassSurface, useGlassRoot } from '@vitreajs/vitrea-react';
import type { ExperimentProps, SceneId } from '../../lab/types';
import { paintField, type Strength } from './paint';
import { Sidebar } from './Sidebar';
import { Bar, HomeBody, SessionBody } from './Session';
import { SettingsBody } from './Settings';
import './field.css';

/** The field, painted once per size and handed to the glass as its backdrop texture. */
function Plane({ dark, strength }: { dark: boolean; strength: Strength }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      paintField(c, dark, strength);
      root?.setBackdropTexture('xf-plane', { kind: 'canvas', canvas: c });
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [dark, strength, root]);
  return <canvas ref={ref} className="xf-plane" aria-hidden="true" />;
}

/** The one pane of glass. It slides with the layout, so the runtime is told to re-read its box while it travels. */
function Pane({ open, children }: { open: boolean; children: ReactNode }) {
  const root = useGlassRoot();
  const first = useRef(true);
  const travelling = useRef(false);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    let raf = 0;
    travelling.current = true;
    const giveUp = performance.now() + 10_000;
    const tick = () => {
      root?.invalidateGeometry();
      if (travelling.current && performance.now() < giveUp) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, root]);
  const arrived = (e: TransitionEvent) => {
    if (e.propertyName === 'left' && e.target === e.currentTarget) travelling.current = false;
  };
  return (
    <GlassGroup id="xf-pane" backdrop={{ kind: 'texture', id: 'xf-plane' }}>
      <GlassSurface asChild radius={20} thickness={8} foreground="vibrant">
        <nav aria-label="Sessions" data-glass-role="window" className="xf-pane" inert={!open} onTransitionEnd={arrived}>
          {children}
        </nav>
      </GlassSurface>
    </GlassGroup>
  );
}

export default function Field({ scene: routed, scheme, knobs }: ExperimentProps) {
  const dark = scheme === 'dark';
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [paneOpen, setPaneOpen] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [approved, setApproved] = useState(false);
  const ground = dark ? `#${knobs.dark ?? '191919'}` : knobs.light === 'paper' ? '#faf9f5' : '#ffffff';
  // Moving between scenes goes through the lab's own route, so its panel and keys stay in step.
  const go = useCallback((scene: SceneId) => {
    window.location.hash = window.location.hash.replace(/^#\/field\/[a-z]*/, `#/field/${scene}`);
  }, []);
  return (
    <div ref={setEl} className="x-field" data-scheme={scheme} data-pane={paneOpen ? 'open' : 'closed'} style={{ ['--xf-sheet' as string]: ground, colorScheme: scheme }}>
      {el && (
        <GlassRoot renderer="webgpu" colorScheme={scheme} container={el}>
          <Plane dark={dark} strength={(knobs.field as Strength) ?? 'warm'} />
          <main className="xf-sheet">
            <Bar scene={routed} approved={approved} paneOpen={paneOpen} togglePane={() => setPaneOpen((v) => !v)} sideOpen={sideOpen} toggleSide={() => setSideOpen((v) => !v)} />
            {routed === 'session' && <SessionBody sideOpen={sideOpen} />}
            {routed === 'settings' && <SettingsBody />}
            {routed === 'home' && <HomeBody />}
          </main>
          <Pane open={paneOpen}>
            <Sidebar scene={routed} approved={approved} onApprove={() => setApproved(true)} go={go} />
          </Pane>
          <div className="xf-lights" aria-hidden="true"><i /><i /><i /></div>
        </GlassRoot>
      )}
    </div>
  );
}
