import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GlassGroup, GlassRoot, GlassSurface, useGlassRoot } from '@vitreajs/vitrea-react';
import type { Scheme } from '../../lab/types';
import { paintGround, type GroundSpec } from './paint';
import s from './orange.module.css';

// Not a design state: the evidence for the path this synthesis took. `x=lib` in the address draws the glass
// library's own surfaces (WebGPU, texture path) over the same painted ground, beside one pane drawn the way the
// synthesis draws every surface, so measure.mjs can read both bodies. `tint=` passes a tint seed to the library's
// groups and `tier=css` asks for its CSS tier. DESIGN.md records what came back.

const BOXES: [string, CSSProperties, number | 'capsule'][] = [
  ['library capsule', { left: 40, top: 40, width: 300, height: 36 }, 'capsule'],
  ['library composer', { left: 400, top: 40, width: 600, height: 110 }, 26],
  ['library pane', { left: 40, top: 200, width: 272, height: 600 }, 20],
];

function Plane({ spec }: { spec: GroundSpec }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const root = useGlassRoot();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    paintGround(c, spec);
    root?.setBackdropTexture('x-orange-plane', { kind: 'canvas', canvas: c });
  }, [root, spec]);
  return <canvas ref={ref} className={s.ground} aria-hidden="true" />;
}

export default function Probe({ scheme, spec }: { scheme: Scheme; spec: GroundSpec }) {
  const q = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? ''), []);
  const tint = q.get('tint') ?? undefined;
  // The library portals its hosts into its container; keeping that inside the experiment keeps them measurable.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl}>
      {el && (
        <GlassRoot renderer={q.get('tier') === 'css' ? 'css' : 'webgpu'} colorScheme={scheme} windowActivation="active" container={el}>
          <Plane spec={spec} />
          {BOXES.map(([label, box, r]) => (
            <GlassGroup key={label} id={`x-orange-${label.replace(/ /g, '-')}`} backdrop={{ kind: 'texture', id: 'x-orange-plane' }} tint={tint}>
              <GlassSurface
                radius={r === 'capsule' ? undefined : r}
                capsule={r === 'capsule'}
                thickness={8}
                style={{ position: 'fixed', boxSizing: 'border-box', ...box }}
                data-o-surface={label}
              />
            </GlassGroup>
          ))}
          <div className={s.glass} data-o-surface="CSS pane" style={{ position: 'fixed', left: 400, top: 200, width: 400, height: 600, borderRadius: 26 }} />
        </GlassRoot>
      )}
    </div>
  );
}
